"""Perch backend — HTTP server, system collectors, and dev tooling.

Serves the web UI (perch/web) and a JSON API on 127.0.0.1. Run via
``python -m perch`` or the ``perch`` console script.
"""

import glob
import json
import os
import pwd
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import psutil
except ImportError:  # self-install the only external dependency
    print("psutil missing — installing with pip --user …")
    subprocess.run([sys.executable, "-m", "pip", "install", "--user",
                    "psutil"], check=True)
    import psutil

PORT = int(os.environ.get("PERCH_PORT",
           sys.argv[1] if len(sys.argv) > 1 else 8090))
HOST = os.environ.get("PERCH_HOST", "127.0.0.1")
HOME = os.path.expanduser("~")
TOKEN_FILE = os.path.join(HOME, ".perch-token")
BOOT = psutil.boot_time()


def load_token():
    try:
        with open(TOKEN_FILE) as f:
            t = f.read().strip()
            if len(t) >= 16:
                return t
    except OSError:
        pass
    t = secrets.token_urlsafe(24)
    with open(TOKEN_FILE, "w") as f:
        f.write(t)
    os.chmod(TOKEN_FILE, 0o600)
    return t


TOKEN = load_token()

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
STATIC_TYPES = {".css": "text/css", ".js": "text/javascript",
                ".svg": "image/svg+xml", ".png": "image/png",
                ".ico": "image/x-icon"}


def render_index(token):
    with open(os.path.join(WEB_DIR, "index.html"), encoding="utf-8") as f:
        return f.read().replace("{{TOKEN}}", token).replace("{{HOME}}", HOME)


# -------------------------------------------------------------------- gpu ----

GPU_CARD = next((os.path.dirname(p) for p in
                 glob.glob("/sys/class/drm/card*/gt_cur_freq_mhz")), None)


def _gpu_name():
    try:
        r = subprocess.run(["lspci"], capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            if "VGA" in line or "3D" in line:
                name = line.split(": ", 1)[1]
                return re.sub(r"\s*\(rev ..\)$", "", name)
    except Exception:  # noqa: BLE001
        pass
    return "GPU"


GPU_NAME = _gpu_name()
if "46a8" in GPU_NAME:
    GPU_NAME = "Intel Iris Xe Graphics (Alder Lake-P)"


def _gpu_freq(which):
    try:
        with open(os.path.join(GPU_CARD, f"gt_{which}_freq_mhz")) as f:
            return int(f.read())
    except (OSError, TypeError, ValueError):
        return None


# Per-process GPU busyness from /proc/<pid>/fdinfo DRM counters (own procs).
_gpu_pids = {}     # pid -> {"fds": [fd,...], "name": str}
_gpu_prev = {}     # pid -> (t, busy_ns)
_gpu_rates = {}    # pid -> {"name":, "busy": %}
_gpu_scan_at = 0.0


def _gpu_rescan_clients():
    global _gpu_pids, _gpu_scan_at
    _gpu_scan_at = time.time()
    found = {}
    me = os.getuid()
    for p in psutil.process_iter(["pid", "name", "uids"]):
        try:
            if not p.info["uids"] or p.info["uids"].real != me:
                continue
            pid = p.info["pid"]
            fddir = f"/proc/{pid}/fd"
            fds = []
            for fd in os.listdir(fddir):
                try:
                    if "/dev/dri/" in os.readlink(os.path.join(fddir, fd)):
                        fds.append(fd)
                except OSError:
                    continue
            if fds:
                found[pid] = {"fds": fds, "name": p.info["name"]}
        except (psutil.Error, OSError):
            continue
    _gpu_pids = found


def _gpu_pid_busy_ns(pid, fds):
    per_client = {}
    for fd in fds:
        try:
            with open(f"/proc/{pid}/fdinfo/{fd}") as f:
                cid, busy = None, None
                for line in f:
                    if line.startswith("drm-client-id:"):
                        cid = line.split(":")[1].strip()
                    elif line.startswith("drm-engine-render:"):
                        busy = int(line.split(":")[1].strip().split()[0])
                if cid is not None and busy is not None:
                    per_client[cid] = busy
        except (OSError, ValueError):
            continue
    return sum(per_client.values())


def _gpu_sample():
    """Returns total render busy %, updates per-process rates."""
    global _gpu_rates
    now = time.time()
    if now - _gpu_scan_at > 20:
        _gpu_rescan_clients()
    total_pct = 0.0
    rates = {}
    for pid, info in list(_gpu_pids.items()):
        busy = _gpu_pid_busy_ns(pid, info["fds"])
        prev = _gpu_prev.get(pid)
        _gpu_prev[pid] = (now, busy)
        if prev and busy >= prev[1] and now > prev[0]:
            pct = (busy - prev[1]) / ((now - prev[0]) * 1e9) * 100
            if pct > 0.05:
                rates[pid] = {"name": info["name"], "busy": round(pct, 1)}
            total_pct += pct
    for pid in list(_gpu_prev):
        if pid not in _gpu_pids:
            del _gpu_prev[pid]
    _gpu_rates = rates
    return min(100.0, total_pct)


def gpu_info():
    top = sorted(({"pid": k, **v} for k, v in _gpu_rates.items()),
                 key=lambda x: -x["busy"])[:8]
    status = None
    try:
        with open(os.path.join(GPU_CARD, "device/power/runtime_status")) as f:
            status = f.read().strip()
    except (OSError, TypeError):
        pass
    last = HISTORY[-1] if HISTORY else {}
    return {"name": GPU_NAME, "cur": _gpu_freq("cur"), "max": _gpu_freq("max"),
            "min": _gpu_freq("min"), "busy": last.get("gpu"),
            "status": status, "top": top}


# ---------------------------------------------------------------- sampler ----

HISTORY = deque(maxlen=150)  # ~5 min at 2 s
_prev_net = None


_prev_disk = None


def _max_temp():
    try:
        best = None
        for entries in (psutil.sensors_temperatures() or {}).values():
            for e in entries:
                if e.current and (best is None or e.current > best):
                    best = e.current
        return round(best, 1) if best else None
    except Exception:  # noqa: BLE001
        return None


def sampler():
    global _prev_net, _prev_disk
    psutil.cpu_percent(interval=None)  # prime
    while True:
        time.sleep(2)
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory().percent
        io = psutil.net_io_counters()
        now = time.time()
        if _prev_net:
            dt = now - _prev_net[0]
            down = max(0, io.bytes_recv - _prev_net[1]) / dt
            up = max(0, io.bytes_sent - _prev_net[2]) / dt
        else:
            down = up = 0.0
        _prev_net = (now, io.bytes_recv, io.bytes_sent)
        dio = psutil.disk_io_counters()
        if dio and _prev_disk:
            dt2 = now - _prev_disk[0]
            dread = max(0, dio.read_bytes - _prev_disk[1]) / dt2
            dwrite = max(0, dio.write_bytes - _prev_disk[2]) / dt2
        else:
            dread = dwrite = 0.0
        if dio:
            _prev_disk = (now, dio.read_bytes, dio.write_bytes)
        try:
            gpu = _gpu_sample() if GPU_CARD else None
        except Exception:  # noqa: BLE001
            gpu = None
        entry = {"t": now, "cpu": cpu, "mem": mem, "down": down,
                 "up": up, "gpu": gpu,
                 "gfreq": _gpu_freq("cur") if GPU_CARD else None,
                 "dr": dread, "dw": dwrite, "temp": _max_temp()}
        HISTORY.append(entry)
        try:
            monitor_tick(entry)
        except Exception:  # noqa: BLE001
            pass


threading.Thread(target=sampler, daemon=True).start()

# ---------------------------------------------------------------- helpers ----


def overview():
    vm = psutil.virtual_memory()
    sw = psutil.swap_memory()
    batt = None
    try:
        b = psutil.sensors_battery()
        if b:
            batt = {"percent": round(b.percent), "plugged": b.power_plugged,
                    "secsleft": b.secsleft if b.secsleft and b.secsleft > 0 else None}
    except Exception:
        pass
    temps = []
    try:
        for name, entries in (psutil.sensors_temperatures() or {}).items():
            for e in entries:
                if e.current:
                    temps.append({"label": e.label or name, "c": round(e.current)})
    except Exception:
        pass
    la = os.getloadavg()
    return {
        "hostname": os.uname().nodename,
        "os": " ".join(os.uname().sysname.split()) + " " + os.uname().release,
        "uptime": int(time.time() - BOOT),
        "cpu": psutil.cpu_percent(interval=None),
        "percore": psutil.cpu_percent(interval=None, percpu=True),
        "cores": psutil.cpu_count(logical=True),
        "freq": (psutil.cpu_freq().current if psutil.cpu_freq() else None),
        "load": [round(x, 2) for x in la],
        "mem": {"total": vm.total, "used": vm.total - vm.available,
                "available": vm.available, "percent": vm.percent},
        "swap": {"total": sw.total, "used": sw.used, "percent": sw.percent},
        "battery": batt,
        "temps": temps[:6],
        "nproc": len(psutil.pids()),
    }


def disks():
    out = []
    seen = set()
    for p in psutil.disk_partitions(all=False):
        if p.device in seen or p.fstype in ("squashfs", "tmpfs", "devtmpfs"):
            continue
        seen.add(p.device)
        try:
            u = psutil.disk_usage(p.mountpoint)
        except OSError:
            continue
        out.append({"device": p.device, "mount": p.mountpoint, "fstype": p.fstype,
                    "total": u.total, "used": u.used, "free": u.free,
                    "percent": u.percent})
    out.sort(key=lambda d: -d["total"])
    return out


def processes(sort="cpu", query=""):
    procs = []
    me = os.getuid()
    q = query.lower()
    for p in psutil.process_iter(["pid", "name", "username", "memory_info",
                                  "cpu_percent", "status", "create_time",
                                  "cmdline", "uids"]):
        try:
            info = p.info
            name = info["name"] or "?"
            cmd = " ".join(info["cmdline"] or [])[:160]
            if q and q not in name.lower() and q not in cmd.lower():
                continue
            procs.append({
                "pid": info["pid"], "name": name,
                "user": info["username"] or "?",
                "mem": info["memory_info"].rss if info["memory_info"] else 0,
                "cpu": info["cpu_percent"] or 0.0,
                "status": info["status"],
                "started": info["create_time"],
                "cmd": cmd,
                "mine": bool(info["uids"] and info["uids"].real == me),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    key = "mem" if sort == "mem" else "cpu"
    procs.sort(key=lambda x: -x[key])
    return procs[:60]


def kill_proc(pid, force=False):
    p = psutil.Process(pid)
    name = p.name()
    if force:
        p.kill()
    else:
        p.terminate()
    return name


def users():
    sessions = []
    for u in psutil.users():
        sessions.append({"name": u.name, "terminal": u.terminal or "-",
                         "host": u.host or "local", "started": u.started})
    agg = {}
    for p in psutil.process_iter(["username", "memory_info", "cpu_percent"]):
        try:
            un = p.info["username"] or "?"
            a = agg.setdefault(un, {"user": un, "procs": 0, "mem": 0, "cpu": 0.0})
            a["procs"] += 1
            a["mem"] += p.info["memory_info"].rss if p.info["memory_info"] else 0
            a["cpu"] += p.info["cpu_percent"] or 0.0
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    top = sorted(agg.values(), key=lambda a: -a["mem"])[:15]
    human = []
    for u in pwd.getpwall():
        if 1000 <= u.pw_uid < 60000:
            human.append({"user": u.pw_name, "uid": u.pw_uid, "home": u.pw_dir,
                          "shell": u.pw_shell})
    return {"sessions": sessions, "usage": top, "accounts": human}


def browse(path):
    path = os.path.realpath(path or HOME)
    if not os.path.isdir(path):
        raise ValueError("not a directory")
    entries = []
    with os.scandir(path) as it:
        for e in it:
            try:
                st = e.stat(follow_symlinks=False)
                entries.append({
                    "name": e.name,
                    "dir": e.is_dir(follow_symlinks=False),
                    "link": e.is_symlink(),
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                    "hidden": e.name.startswith("."),
                    "pv": preview_kind(e.name),
                })
            except OSError:
                continue
    entries.sort(key=lambda x: (not x["dir"], x["name"].lower()))
    return {"path": path, "parent": os.path.dirname(path) if path != "/" else None,
            "entries": entries[:800], "truncated": len(entries) > 800}


def dir_size(path, deadline):
    """Recursive size with a wall-clock deadline; returns (bytes, complete)."""
    total = 0
    complete = True
    stack = [path]
    while stack:
        if time.time() > deadline:
            return total, False
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        else:
                            total += e.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            complete = False
    return total, complete


def analyze(path):
    path = os.path.realpath(path or HOME)
    if not os.path.isdir(path):
        raise ValueError("not a directory")
    deadline = time.time() + 15
    items = []
    files_size = 0
    with os.scandir(path) as it:
        children = list(it)
    for e in children:
        try:
            if e.is_dir(follow_symlinks=False):
                size, complete = dir_size(e.path, deadline)
                items.append({"name": e.name, "dir": True, "size": size,
                              "complete": complete})
            else:
                files_size += e.stat(follow_symlinks=False).st_size
        except OSError:
            continue
    if files_size:
        items.append({"name": "(files here)", "dir": False, "size": files_size,
                      "complete": True})
    items.sort(key=lambda x: -x["size"])
    return {"path": path, "items": items[:40],
            "timedout": time.time() > deadline}


def open_file(path):
    path = os.path.realpath(path)
    if not os.path.exists(path):
        raise ValueError("no such file")
    subprocess.Popen(["xdg-open", path], stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL,
                     env={**os.environ})
    return path


def trash_file(path):
    path = os.path.realpath(path)
    if not path.startswith(HOME + os.sep):
        raise ValueError("only files under your home can be trashed from here")
    if not os.path.exists(path):
        raise ValueError("no such file")
    if shutil.which("gio"):
        subprocess.run(["gio", "trash", path], check=True, capture_output=True)
    else:
        tdir = os.path.join(HOME, ".local/share/Trash/files")
        os.makedirs(tdir, exist_ok=True)
        shutil.move(path, os.path.join(tdir, os.path.basename(path) + "." +
                                       secrets.token_hex(4)))
    return path


CACHE_DIR = os.path.join(HOME, ".cache")


def quick_size(path, budget=8):
    if not os.path.exists(path):
        return 0
    size, _ = dir_size(path, time.time() + budget)
    return size


def cleanup_report():
    deadline_each = 6
    targets = []
    thumbs = os.path.join(CACHE_DIR, "thumbnails")
    targets.append({"id": "thumbnails", "label": "Thumbnail cache",
                    "path": thumbs, "size": quick_size(thumbs, deadline_each),
                    "desc": "Image/video preview thumbnails. Regenerated on demand."})
    trash = os.path.join(HOME, ".local/share/Trash")
    targets.append({"id": "trash", "label": "Trash",
                    "path": trash, "size": quick_size(trash, deadline_each),
                    "desc": "Deleted files waiting in the trash bin."})
    pipc = subprocess.run(["python3", "-m", "pip", "cache", "dir"],
                          capture_output=True, text=True)
    pip_path = pipc.stdout.strip() if pipc.returncode == 0 else ""
    targets.append({"id": "pip", "label": "pip download cache",
                    "path": pip_path,
                    "size": quick_size(pip_path, deadline_each) if pip_path else 0,
                    "desc": "Cached Python package downloads."})
    # top offenders inside ~/.cache (deletable individually)
    cache_top = []
    try:
        with os.scandir(CACHE_DIR) as it:
            kids = [e for e in it if e.is_dir(follow_symlinks=False)]
        deadline = time.time() + 20
        for e in kids:
            s, _ = dir_size(e.path, deadline)
            cache_top.append({"name": e.name, "path": e.path, "size": s})
        cache_top.sort(key=lambda x: -x["size"])
        cache_top = cache_top[:12]
    except OSError:
        pass
    # sudo-only items: report size + the command to run yourself
    sudo_items = []
    j = subprocess.run(["journalctl", "--disk-usage"], capture_output=True,
                       text=True)
    if j.returncode == 0:
        sudo_items.append({"label": "systemd journal logs",
                           "info": j.stdout.strip(),
                           "cmd": "sudo journalctl --vacuum-size=200M"})
    apt = quick_size("/var/cache/apt/archives", 4)
    if apt > 50 * 2 ** 20:
        sudo_items.append({"label": "APT package cache",
                           "info": f"{apt / 2**30:.2f} GB in /var/cache/apt/archives",
                           "cmd": "sudo apt-get clean"})
    return {"targets": targets, "cache_top": cache_top, "sudo": sudo_items}


def do_clean(target, path=None):
    if target == "thumbnails":
        p = os.path.join(CACHE_DIR, "thumbnails")
        freed = quick_size(p)
        shutil.rmtree(p, ignore_errors=True)
        return freed
    if target == "trash":
        t = os.path.join(HOME, ".local/share/Trash")
        freed = quick_size(t)
        if shutil.which("gio"):
            subprocess.run(["gio", "trash", "--empty"], capture_output=True)
        for sub in ("files", "info"):
            d = os.path.join(t, sub)
            if os.path.isdir(d):
                for name in os.listdir(d):
                    fp = os.path.join(d, name)
                    if os.path.isdir(fp) and not os.path.islink(fp):
                        shutil.rmtree(fp, ignore_errors=True)
                    else:
                        try:
                            os.unlink(fp)
                        except OSError:
                            pass
        return freed
    if target == "pip":
        r = subprocess.run(["python3", "-m", "pip", "cache", "dir"],
                           capture_output=True, text=True)
        freed = quick_size(r.stdout.strip()) if r.returncode == 0 else 0
        subprocess.run(["python3", "-m", "pip", "cache", "purge"],
                       capture_output=True)
        return freed
    if target == "cachedir":
        p = os.path.realpath(path or "")
        if not p.startswith(CACHE_DIR + os.sep) or p == CACHE_DIR:
            raise ValueError("only directories inside ~/.cache can be removed here")
        freed = quick_size(p)
        shutil.rmtree(p, ignore_errors=True)
        return freed
    raise ValueError("unknown cleanup target")


# -------------------------------------------------------------- hardware -----


def _read1(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def hw_info():
    dmi = "/sys/class/dmi/id/"
    model = " ".join(x for x in (_read1(dmi + "sys_vendor"),
                                 _read1(dmi + "product_family")) if x)
    cpu_model = None
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    cpu_model = line.split(":", 1)[1].strip()
                    break
    except OSError:
        pass
    bat, b = {}, "/sys/class/power_supply/BAT0/"
    if os.path.isdir(b):
        full = _read1(b + "energy_full") or _read1(b + "charge_full")
        design = (_read1(b + "energy_full_design")
                  or _read1(b + "charge_full_design"))
        power = _read1(b + "power_now")
        bat = {
            "cycles": _read1(b + "cycle_count"),
            "health": (min(100, round(int(full) / int(design) * 100))
                       if full and design and int(design) else None),
            "status": _read1(b + "status"),
            "capacity": _read1(b + "capacity"),
            "power_w": round(int(power) / 1e6, 1) if power else None,
        }
    wifi = {}
    try:
        r = subprocess.run(["nmcli", "-t", "-f", "active,ssid,signal",
                            "dev", "wifi"], capture_output=True, text=True,
                           timeout=6)
        for line in r.stdout.splitlines():
            if line.startswith("yes"):
                parts = line.split(":")
                wifi = {"ssid": parts[1], "signal": parts[2] if len(parts) > 2
                        else None}
                break
    except Exception:  # noqa: BLE001
        pass
    try:
        with open("/proc/net/wireless") as f:
            last = f.read().splitlines()[-1].split()
            if len(last) > 3 and not last[0].startswith("Inter"):
                wifi["dbm"] = int(float(last[3]))
    except (OSError, ValueError, IndexError):
        pass
    bright = None
    for bl in glob.glob("/sys/class/backlight/*"):
        cur, mx = _read1(bl + "/brightness"), _read1(bl + "/max_brightness")
        if cur and mx and int(mx):
            bright = round(int(cur) / int(mx) * 100)
    return {"model": model or None,
            "product": _read1(dmi + "product_name"),
            "bios": _read1(dmi + "bios_version"),
            "cpu": cpu_model, "gpu": GPU_NAME,
            "ram_gb": round(psutil.virtual_memory().total / 2**30, 1),
            "battery": bat, "wifi": wifi, "brightness": bright}


# ---------------------------------------------------------------- search -----

INDEX_DIR = os.path.join(CACHE_DIR, "perch")
INDEX_FILE = os.path.join(INDEX_DIR, "index.txt")
INDEX_STATUS = {"state": "none", "count": 0, "built": 0, "error": None}
_index_lock = threading.Lock()
PRUNE_PATHS = {"/proc", "/sys", "/dev", "/run", "/snap", "/var/snap",
               "/var/lib/docker", "/lost+found", INDEX_DIR}
PRUNE_NAMES = {".git", "__pycache__"}


def build_index():
    with _index_lock:
        if INDEX_STATUS["state"] == "building":
            return
        INDEX_STATUS.update(state="building", error=None)
    try:
        os.makedirs(INDEX_DIR, exist_ok=True)
        tmp = INDEX_FILE + ".tmp"
        count = 0
        with open(tmp, "w", errors="replace") as f:
            for root, dirs, files in os.walk("/", topdown=True):
                dirs[:] = [d for d in dirs if d not in PRUNE_NAMES
                           and os.path.join(root, d) not in PRUNE_PATHS]
                for name in dirs:
                    f.write(os.path.join(root, name) + "\n")
                for name in files:
                    f.write(os.path.join(root, name) + "\n")
                count += len(dirs) + len(files)
        os.replace(tmp, INDEX_FILE)
        INDEX_STATUS.update(state="ready", count=count, built=time.time())
    except Exception as e:  # noqa: BLE001
        INDEX_STATUS.update(state="error", error=str(e))


def index_boot():
    if os.path.exists(INDEX_FILE):
        age = time.time() - os.path.getmtime(INDEX_FILE)
        n = int(subprocess.run(["wc", "-l", INDEX_FILE], capture_output=True,
                               text=True).stdout.split()[0])
        INDEX_STATUS.update(state="ready", count=n,
                            built=os.path.getmtime(INDEX_FILE))
        if age < 12 * 3600:
            return
    build_index()


threading.Thread(target=index_boot, daemon=True).start()


def search_files(q, limit=250, regex=False):
    q = q.strip()
    status = {"index": INDEX_STATUS["state"], "count": INDEX_STATUS["count"],
              "built": INDEX_STATUS["built"]}
    if len(q) < 2:
        return {"status": status, "results": []}
    if not os.path.exists(INDEX_FILE):
        return {"status": status, "results": [],
                "note": "index is still being built — try again in a minute"}
    if regex:
        try:
            pat = re.compile(q, re.I)
        except re.error as e:
            raise ValueError(f"invalid regex: {e}")
        grep_args = ["grep", "-i", "-E"]
    else:
        grep_args = ["grep", "-i", "-F"]
    r = subprocess.run([*grep_args, "-m", str(limit * 4), "--", q,
                        INDEX_FILE], capture_output=True, text=True, timeout=20)
    if regex and r.returncode == 2:
        raise ValueError("grep rejected that pattern (use POSIX extended "
                         "regex, e.g. \\.log$ or ^/etc/.*conf)")
    starts, contains, pathonly = [], [], []
    ql = q.lower()
    for p in r.stdout.splitlines():
        base = os.path.basename(p).lower()
        if regex:
            m = pat.search(base)
            if m and m.start() == 0:
                starts.append(p)
            elif m:
                contains.append(p)
            else:
                pathonly.append(p)
        elif base.startswith(ql):
            starts.append(p)
        elif ql in base:
            contains.append(p)
        else:
            pathonly.append(p)
    ranked = (starts + contains + pathonly)[:limit]
    results = []
    for p in ranked:
        try:
            st = os.stat(p, follow_symlinks=False)
            results.append({"path": p, "dir": os.path.isdir(p),
                            "size": st.st_size, "mtime": st.st_mtime})
        except OSError:
            continue  # stale index entry
    return {"status": status, "results": results,
            "truncated": len(r.stdout.splitlines()) >= limit * 4}


# --------------------------------------------------------------- network -----


def net_ports():
    listen, established = [], 0
    me = os.getuid()
    names = {}
    for c in psutil.net_connections(kind="inet"):
        if c.status == "ESTABLISHED":
            established += 1
        if c.status != "LISTEN":
            continue
        name, mine = None, False
        if c.pid:
            if c.pid not in names:
                try:
                    pr = psutil.Process(c.pid)
                    names[c.pid] = (pr.name(), pr.uids().real == me)
                except psutil.Error:
                    names[c.pid] = ("?", False)
            name, mine = names[c.pid]
        listen.append({"port": c.laddr.port, "addr": c.laddr.ip,
                       "pid": c.pid, "name": name, "mine": mine,
                       "public": c.laddr.ip in ("0.0.0.0", "::")})
    listen.sort(key=lambda x: x["port"])
    seen, uniq = set(), []
    for p in listen:
        k = (p["port"], p["addr"])
        if k not in seen:
            seen.add(k)
            uniq.append(p)
    ifaces = []
    stats = psutil.net_if_stats()
    for nic, addrs in psutil.net_if_addrs().items():
        if nic == "lo":
            continue
        ips = [a.address for a in addrs if a.family.name == "AF_INET"]
        if ips:
            up = stats.get(nic) and stats[nic].isup
            ifaces.append({"nic": nic, "ips": ips, "up": bool(up)})
    return {"listen": uniq, "established": established, "ifaces": ifaces}


def kill_port(port):
    for c in psutil.net_connections(kind="inet"):
        if c.status == "LISTEN" and c.laddr.port == port and c.pid:
            name = kill_proc(c.pid)
            return f"{name} (pid {c.pid})"
    raise ValueError(f"no killable process found on port {port} "
                     "(root-owned listeners can't be ended from here)")


# ---------------------------------------------------------------- docker -----


def _docker_json(args, timeout=10):
    r = subprocess.run(["docker", *args], capture_output=True, text=True,
                       timeout=timeout)
    if r.returncode != 0:
        raise ValueError((r.stderr.strip() or "docker unavailable")[:300])
    return [json.loads(line) for line in r.stdout.splitlines() if line.strip()]


def docker_info():
    containers = [{"id": c["ID"], "name": c["Names"], "image": c["Image"],
                   "state": c["State"], "status": c["Status"],
                   "ports": c.get("Ports", "")}
                  for c in _docker_json(["ps", "-a", "--format", "{{json .}}"])]
    images = [{"repo": i["Repository"], "tag": i["Tag"], "size": i["Size"],
               "id": i["ID"]}
              for i in _docker_json(["images", "--format", "{{json .}}"])][:20]
    return {"containers": containers, "images": images}


DOCKER_ACTIONS = {"start", "stop", "restart", "rm"}


def docker_action(cid, action):
    if action not in DOCKER_ACTIONS or not re.fullmatch(r"[0-9a-f]{4,64}", cid):
        raise ValueError("bad docker action")
    r = subprocess.run(["docker", action, cid], capture_output=True, text=True,
                       timeout=60)
    if r.returncode != 0:
        raise ValueError(r.stderr.strip()[:300])
    return r.stdout.strip()


def docker_logs(cid):
    if not re.fullmatch(r"[0-9a-f]{4,64}", cid):
        raise ValueError("bad container id")
    r = subprocess.run(["docker", "logs", "--tail", "150", cid],
                       capture_output=True, text=True, timeout=15)
    return {"logs": (r.stdout + r.stderr)[-20000:]}


# -------------------------------------------------------------- services -----

SVC_RE = re.compile(r"^[\w@.\\:-]+\.service$")


def services():
    def list_units(scope, extra=()):
        r = subprocess.run(["systemctl", scope, "list-units", "--type=service",
                            "--all", "--no-pager", "--output=json", *extra],
                           capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return []
        return json.loads(r.stdout or "[]")

    user = [{"name": u["unit"], "active": u["active"], "sub": u["sub"],
             "desc": u["description"]} for u in list_units("--user")]
    user.sort(key=lambda u: (u["active"] != "active", u["name"]))
    failed = [{"name": u["unit"], "desc": u["description"]}
              for u in list_units("--system", ("--state=failed",))]
    return {"user": user, "failed_system": failed}


def service_action(name, action):
    if action not in ("start", "stop", "restart") or not SVC_RE.fullmatch(name):
        raise ValueError("bad service action")
    r = subprocess.run(["systemctl", "--user", action, name],
                       capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise ValueError(r.stderr.strip()[:300])
    return "ok"


# -------------------------------------------------------------- dev info -----

TOOLS = [
    ("git", ["git", "--version"]), ("python", ["python3", "--version"]),
    ("pip", ["python3", "-m", "pip", "--version"]),
    ("node", ["node", "--version"]), ("npm", ["npm", "--version"]),
    ("docker", ["docker", "--version"]),
    ("compose", ["docker", "compose", "version"]),
    ("go", ["go", "version"]), ("rustc", ["rustc", "--version"]),
    ("java", ["java", "-version"]), ("gcc", ["gcc", "--version"]),
    ("make", ["make", "--version"]), ("code", ["code", "--version"]),
]


def devinfo():
    tools = []
    for label, cmd in TOOLS:
        if not shutil.which(cmd[0]):
            continue
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
            line = (r.stdout or r.stderr).strip().splitlines()
            if line:
                tools.append({"tool": label, "version": line[0][:80]})
        except Exception:  # noqa: BLE001
            continue
    git_id = {}
    for k in ("user.name", "user.email"):
        r = subprocess.run(["git", "config", "--global", k],
                           capture_output=True, text=True)
        git_id[k] = r.stdout.strip()
    return {"tools": tools, "git": git_id}


def open_terminal(path):
    path = os.path.realpath(path)
    if not os.path.isdir(path):
        path = os.path.dirname(path)
    if shutil.which("gnome-terminal"):
        subprocess.Popen(["gnome-terminal", f"--working-directory={path}"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen(["x-terminal-emulator"], cwd=path,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return path


def open_editor(path):
    path = os.path.realpath(path)
    for ed in ("code", "subl", "gedit"):
        if shutil.which(ed):
            subprocess.Popen([ed, path], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
            return ed
    raise ValueError("no editor found (looked for code, subl, gedit)")


# ---------------------------------------------------------------- kernel -----

TUNABLES = [
    ("vm.swappiness", "How eagerly the kernel swaps RAM to disk (0–200). "
     "Lower = keep more in RAM; 10 is a common desktop choice."),
    ("vm.vfs_cache_pressure", "Willingness to drop directory/inode caches. "
     "Lower keeps filesystem metadata cached (snappier file ops)."),
    ("vm.dirty_ratio", "Max % of RAM holding unwritten (dirty) data before "
     "writers are blocked to flush."),
    ("vm.dirty_background_ratio", "% of RAM with dirty data at which background "
     "flushing to disk starts."),
    ("vm.overcommit_memory", "0 heuristic / 1 always allow / 2 strict. "
     "Memory-allocation overcommit policy."),
    ("vm.max_map_count", "Max memory-map areas per process. Elasticsearch/"
     "some games need this raised (e.g. 262144)."),
    ("fs.file-max", "System-wide limit on open file handles."),
    ("fs.inotify.max_user_watches", "Max files watched for changes per user. "
     "VS Code / webpack watchers hit this — raise to 524288 if you see "
     "ENOSPC watch errors."),
    ("fs.inotify.max_user_instances", "Max inotify instances per user."),
    ("net.core.somaxconn", "Max pending-connection backlog per listening "
     "socket. Raise for busy local API servers."),
    ("net.ipv4.ip_local_port_range", "Ephemeral (outgoing) port range."),
    ("kernel.pid_max", "Highest PID before wrap-around."),
]


def _sysctl_read(key):
    try:
        with open("/proc/sys/" + key.replace(".", "/")) as f:
            return " ".join(f.read().split())
    except OSError:
        return None


def kernel_info():
    tunables = []
    for key, desc in TUNABLES:
        val = _sysctl_read(key)
        if val is not None:
            tunables.append({"key": key, "value": val, "desc": desc})
    governors = []
    import glob
    for pol in sorted(glob.glob("/sys/devices/system/cpu/cpufreq/policy*")):
        try:
            with open(os.path.join(pol, "scaling_governor")) as f:
                gov = f.read().strip()
            with open(os.path.join(pol, "scaling_available_governors")) as f:
                avail = f.read().split()
            governors.append({"policy": os.path.basename(pol), "governor": gov,
                              "available": avail})
        except OSError:
            continue
    thp = None
    try:
        with open("/sys/kernel/mm/transparent_hugepage/enabled") as f:
            thp = f.read().strip()
    except OSError:
        pass
    with open("/proc/version") as f:
        version = f.read().strip()
    with open("/proc/cmdline") as f:
        cmdline = f.read().strip()
    mods = []
    try:
        with open("/proc/modules") as f:
            for line in f:
                p = line.split()
                mods.append({"name": p[0], "size": int(p[1]),
                             "used_by": p[3] if p[3] != "-" else ""})
        mods.sort(key=lambda m: -m["size"])
        mods = mods[:14]
    except OSError:
        pass
    return {"version": version, "cmdline": cmdline, "tunables": tunables,
            "governors": governors, "thp": thp, "modules": mods,
            "nmodules": sum(1 for _ in open("/proc/modules"))}


# ------------------------------------------------------------------- logs ----

LOG_SOURCES = {"system": ["--system"], "user": ["--user"],
               "kernel": ["--system", "-k"]}


def read_logs(source="system", n=150, q="", prio="", cursor=""):
    args = ["journalctl", *LOG_SOURCES.get(source, ["--system"]),
            "-o", "json", "--no-pager"]
    if cursor:
        args += ["--after-cursor", cursor]
    else:
        args += ["-n", str(min(int(n or 150), 500))]
    if q:
        args += ["-g", q]
    if prio:
        args += ["-p", prio]
    r = subprocess.run(args, capture_output=True, text=True, timeout=20)
    if r.returncode != 0 and not r.stdout:
        raise ValueError((r.stderr.strip() or "journalctl failed")[:200])
    entries, last_cursor = [], cursor
    for line in r.stdout.splitlines()[-500:]:
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = e.get("MESSAGE", "")
        if isinstance(msg, list):  # journald stores non-UTF8 as byte arrays
            msg = bytes(msg).decode("utf-8", "replace")
        ts = int(e.get("__REALTIME_TIMESTAMP", 0)) / 1e6
        entries.append({
            "t": ts,
            "unit": (e.get("_SYSTEMD_UNIT") or e.get("SYSLOG_IDENTIFIER")
                     or e.get("_COMM") or "?"),
            "msg": str(msg)[:600],
            "prio": int(e.get("PRIORITY", 6)),
        })
        last_cursor = e.get("__CURSOR", last_cursor)
    return {"entries": entries, "cursor": last_cursor}


# --------------------------------------------------------------------- ai ----

AI_LOCK = threading.Lock()
AI_SESSION = {"id": None}
CLAUDE_BIN = shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")


def ai_snapshot():
    o = overview()
    lines = [
        f"Host: {o['hostname']}, {o['os']}, uptime {o['uptime']//3600}h",
        f"CPU {o['cpu']:.0f}% (load {o['load']}), "
        f"mem {o['mem']['percent']:.0f}% used "
        f"({o['mem']['used']/2**30:.1f}/{o['mem']['total']/2**30:.1f} GB), "
        f"swap {o['swap']['used']/2**30:.1f} GB",
    ]
    if GPU_CARD and HISTORY:
        lines.append(f"GPU busy {HISTORY[-1].get('gpu') or 0:.0f}%, "
                     f"{_gpu_freq('cur')} MHz")
    for d in disks()[:3]:
        lines.append(f"Disk {d['mount']}: {d['percent']:.0f}% used, "
                     f"{d['free']/2**30:.0f} GB free")
    top = processes("cpu")[:6]
    lines.append("Top CPU: " + ", ".join(
        f"{p['name']}({p['cpu']:.0f}%/{p['mem']/2**20:.0f}MB)" for p in top))
    top = processes("mem")[:6]
    lines.append("Top RAM: " + ", ".join(
        f"{p['name']}({p['mem']/2**20:.0f}MB)" for p in top))
    ports = [f"{p['port']}({p['name'] or '?'})" for p in net_ports()["listen"]]
    lines.append("Listening ports: " + ", ".join(ports[:15]))
    return "\n".join(lines)


def ask_ai(prompt, include_snapshot=True, reset=False, extra=""):
    if not os.path.exists(CLAUDE_BIN):
        raise ValueError("claude CLI not found")
    if not AI_LOCK.acquire(blocking=False):
        raise ValueError("an AI request is already running — wait for it")
    try:
        if reset:
            AI_SESSION["id"] = None
        full = prompt.strip()
        if extra:
            full += "\n\n--- attached data ---\n" + extra[:8000]
        if include_snapshot and not AI_SESSION["id"]:
            full = ("You are the assistant inside a local Linux system "
                    "dashboard. Current system snapshot:\n" + ai_snapshot() +
                    "\n\nUser question: " + full)
        args = [CLAUDE_BIN, "-p", "--output-format", "json"]
        if AI_SESSION["id"]:
            args += ["--resume", AI_SESSION["id"]]
        args.append(full)
        r = subprocess.run(args, capture_output=True, text=True, timeout=240,
                           cwd=HOME)
        if r.returncode != 0:
            raise ValueError((r.stderr.strip() or "claude failed")[:400])
        out = json.loads(r.stdout)
        AI_SESSION["id"] = out.get("session_id") or AI_SESSION["id"]
        return {"text": out.get("result", "").strip(),
                "session": AI_SESSION["id"],
                "cost": out.get("total_cost_usd")}
    finally:
        AI_LOCK.release()


# --------------------------------------------------------------- monitor -----

CFG_DIR = os.path.join(HOME, ".config/perch")
MON_CFG_FILE = os.path.join(CFG_DIR, "monitor.json")
MON_DIR = os.path.join(HOME, ".cache/perch")
ALERTS_FILE = os.path.join(MON_DIR, "alerts.jsonl")
MINUTES_FILE = os.path.join(MON_DIR, "history.jsonl")

MON_DEFAULTS = {
    "cpu": {"on": True, "th": 90, "label": "CPU above % (sustained 60 s)"},
    "mem": {"on": True, "th": 95, "label": "Memory above %"},
    "temp": {"on": True, "th": 85, "label": "Temperature above °C"},
    "disk": {"on": True, "th": 90, "label": "Any disk above % full"},
    "battery": {"on": True, "th": 15, "label": "Battery below % (unplugged)"},
}


def mon_cfg():
    cfg = {k: dict(v) for k, v in MON_DEFAULTS.items()}
    try:
        with open(MON_CFG_FILE) as f:
            saved = json.load(f)
        for k in cfg:
            if k in saved:
                cfg[k]["on"] = bool(saved[k].get("on", cfg[k]["on"]))
                cfg[k]["th"] = float(saved[k].get("th", cfg[k]["th"]))
    except (OSError, ValueError):
        pass
    return cfg


def mon_save(new):
    os.makedirs(CFG_DIR, exist_ok=True)
    cfg = mon_cfg()
    for k in cfg:
        if k in new:
            cfg[k]["on"] = bool(new[k].get("on"))
            cfg[k]["th"] = float(new[k].get("th", cfg[k]["th"]))
    with open(MON_CFG_FILE, "w") as f:
        json.dump(cfg, f)
    return cfg


def notify(title, msg, critical=True):
    try:
        subprocess.Popen(["notify-send", "--app-name=Perch",
                          "--icon=perch",
                          "--urgency=" + ("critical" if critical else "normal"),
                          title, msg],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass


def _alert(rule, msg, value):
    os.makedirs(MON_DIR, exist_ok=True)
    with open(ALERTS_FILE, "a") as f:
        f.write(json.dumps({"t": time.time(), "rule": rule, "msg": msg,
                            "value": value}) + "\n")
    notify("⚠ " + msg.split(" — ")[0], msg)


_mon_breach = {}    # rule -> breach start ts
_mon_fired = {}     # rule -> last fired ts
_mon_minute = 0.0
COOLDOWN = 600


def _fire(rule, msg, value):
    now = time.time()
    if now - _mon_fired.get(rule, 0) < COOLDOWN:
        return
    _mon_fired[rule] = now
    _alert(rule, msg, value)


def monitor_tick(entry):
    global _mon_minute
    cfg = mon_cfg()
    now = entry["t"]
    if cfg["cpu"]["on"]:
        if entry["cpu"] >= cfg["cpu"]["th"]:
            _mon_breach.setdefault("cpu", now)
            if now - _mon_breach["cpu"] >= 60:
                _fire("cpu", f"CPU at {entry['cpu']:.0f}% for over a minute "
                             f"— threshold {cfg['cpu']['th']:.0f}%",
                      entry["cpu"])
        else:
            _mon_breach.pop("cpu", None)
    if cfg["mem"]["on"] and entry["mem"] >= cfg["mem"]["th"]:
        _fire("mem", f"Memory at {entry['mem']:.0f}% — threshold "
                     f"{cfg['mem']['th']:.0f}%", entry["mem"])
    t = entry.get("temp")
    if cfg["temp"]["on"] and t and t >= cfg["temp"]["th"]:
        _fire("temp", f"Temperature {t:.0f}°C — threshold "
                      f"{cfg['temp']['th']:.0f}°C", t)
    if now - _mon_minute >= 60:
        _mon_minute = now
        batt = None
        try:
            b = psutil.sensors_battery()
            if b:
                batt = round(b.percent)
                if (cfg["battery"]["on"] and not b.power_plugged
                        and b.percent <= cfg["battery"]["th"]):
                    _fire("battery", f"Battery at {b.percent:.0f}% and "
                                     "discharging — plug in", b.percent)
        except Exception:  # noqa: BLE001
            pass
        worst = 0.0
        for d in psutil.disk_partitions(all=False):
            if d.fstype in ("squashfs", "tmpfs", "devtmpfs"):
                continue
            try:
                pct = psutil.disk_usage(d.mountpoint).percent
            except OSError:
                continue
            if pct > worst:
                worst = pct
            if cfg["disk"]["on"] and pct >= cfg["disk"]["th"]:
                _fire("disk", f"Disk {d.mountpoint} is {pct:.0f}% full "
                              f"— threshold {cfg['disk']['th']:.0f}%", pct)
        os.makedirs(MON_DIR, exist_ok=True)
        with open(MINUTES_FILE, "a") as f:
            f.write(json.dumps({"t": now, "cpu": round(entry["cpu"], 1),
                                "mem": round(entry["mem"], 1),
                                "temp": t, "batt": batt,
                                "disk": round(worst, 1)}) + "\n")
        _prune_jsonl(MINUTES_FILE, 4000)
        _prune_jsonl(ALERTS_FILE, 1000)


def _prune_jsonl(path, keep):
    try:
        with open(path) as f:
            lines = f.readlines()
        if len(lines) > keep * 1.25:
            with open(path, "w") as f:
                f.writelines(lines[-keep:])
    except OSError:
        pass


def _tail_jsonl(path, n):
    try:
        with open(path) as f:
            return [json.loads(x) for x in f.readlines()[-n:]]
    except (OSError, ValueError):
        return []


def monitor_state():
    return {"cfg": mon_cfg(),
            "events": list(reversed(_tail_jsonl(ALERTS_FILE, 100))),
            "history": _tail_jsonl(MINUTES_FILE, 1440)}


# ------------------------------------------------------------- http tester ---


def http_request(method, url, headers_text="", body="", timeout=20):
    import urllib.request as ur
    if not re.match(r"^https?://", url or ""):
        raise ValueError("URL must start with http:// or https://")
    hdrs = {}
    for line in (headers_text or "").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            hdrs[k.strip()] = v.strip()
    method = (method or "GET").upper()
    data = body.encode() if body and method not in ("GET", "HEAD") else None
    req = ur.Request(url, method=method, data=data)
    for k, v in hdrs.items():
        req.add_header(k, v)
    t0 = time.time()
    try:
        with ur.urlopen(req, timeout=min(int(timeout or 20), 60)) as resp:
            raw = resp.read(512 * 1024)
            status, reason = resp.status, resp.reason
            rheaders = dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read(512 * 1024)
        status, reason, rheaders = e.code, e.reason, dict(e.headers)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"request failed: {e}")
    ms = round((time.time() - t0) * 1000)
    curl = ["curl", "-X", method, f"'{url}'"]
    for k, v in hdrs.items():
        curl.append(f"-H '{k}: {v}'")
    if data:
        curl.append(f"-d '{body}'")
    return {"status": status, "reason": reason, "ms": ms,
            "headers": rheaders, "size": len(raw),
            "body": raw.decode("utf-8", errors="replace"),
            "curl": " ".join(curl)}


# ------------------------------------------------- updates / net extras ------

_upd_cache = {"t": 0.0, "data": None}


def apt_updates(force=False):
    if not force and _upd_cache["data"] and time.time() - _upd_cache["t"] < 600:
        return _upd_cache["data"]
    r = subprocess.run(["apt", "list", "--upgradable"], capture_output=True,
                       text=True, timeout=30,
                       env={**os.environ, "LC_ALL": "C"})
    pkgs = []
    for line in r.stdout.splitlines():
        m = re.match(r"^([^/]+)/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from: "
                     r"(.+)\]", line)
        if m:
            pkgs.append({"name": m.group(1), "repo": m.group(2),
                         "new": m.group(3), "old": m.group(4),
                         "security": "-security" in m.group(2)})
    st = 0.0
    try:
        st = os.path.getmtime("/var/lib/apt/lists")
    except OSError:
        pass
    data = {"packages": pkgs[:300], "count": len(pkgs),
            "security": sum(1 for p in pkgs if p["security"]),
            "lists_updated": st}
    _upd_cache.update(t=time.time(), data=data)
    return data


_pubip_cache = {"t": 0.0, "ip": None}


UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) perch"}


def _get(url, timeout):
    import urllib.request as ur
    return ur.urlopen(ur.Request(url, headers=UA), timeout=timeout)


def public_ip():
    if _pubip_cache["ip"] and time.time() - _pubip_cache["t"] < 900:
        return _pubip_cache["ip"]
    try:
        ip = _get("https://api.ipify.org", 6).read().decode()
        _pubip_cache.update(t=time.time(), ip=ip)
        return ip
    except Exception:  # noqa: BLE001
        return None


def speed_test():
    pings = []
    for _ in range(3):
        t0 = time.time()
        try:
            _get("https://speed.cloudflare.com/__down?bytes=0", 8).read()
            pings.append((time.time() - t0) * 1000)
        except Exception:  # noqa: BLE001
            pass
    nbytes = 20_000_000
    t0 = time.time()
    try:
        with _get(f"https://speed.cloudflare.com/__down?bytes={nbytes}",
                  45) as resp:
            got = 0
            while chunk := resp.read(256 * 1024):
                got += len(chunk)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"speed test failed: {e}")
    secs = time.time() - t0
    return {"mbps": round(got * 8 / secs / 1e6, 1),
            "ping_ms": round(min(pings), 1) if pings else None,
            "mb": round(got / 1e6, 1), "secs": round(secs, 1),
            "ip": public_ip()}


def proc_detail(pid):
    p = psutil.Process(pid)
    with p.oneshot():
        try:
            conns = len(p.net_connections())
        except (psutil.AccessDenied, AttributeError):
            try:
                conns = len(p.connections())
            except Exception:  # noqa: BLE001
                conns = None
        mem = p.memory_info()
        parent = p.parent()
        d = {
            "pid": p.pid, "name": p.name(), "status": p.status(),
            "user": p.username(), "started": p.create_time(),
            "cmdline": " ".join(p.cmdline())[:800],
            "exe": (p.exe() if os.access(f"/proc/{pid}/exe", os.R_OK)
                    else None),
            "cwd": None, "rss": mem.rss, "vms": mem.vms,
            "threads": p.num_threads(), "fds": None,
            "conns": conns, "nice": p.nice(),
            "cpu": p.cpu_percent(interval=0.15),
            "parent": f"{parent.name()} ({parent.pid})" if parent else None,
            "children": [f"{c.name()} ({c.pid})"
                         for c in p.children()[:10]],
        }
        for field, fn in (("cwd", p.cwd), ("fds", p.num_fds)):
            try:
                d[field] = fn()
            except psutil.Error:
                pass
    return d


# ------------------------------------------------------- caps / raw / yaml ---


def capabilities():
    editor = next((e for e in ("code", "subl", "gedit") if shutil.which(e)),
                  None)
    return {
        "editor": editor,
        "terminal": bool(shutil.which("gnome-terminal")
                         or shutil.which("x-terminal-emulator")),
        "opener": bool(shutil.which("xdg-open")),
        "docker": bool(shutil.which("docker")),
        "ai": os.path.exists(CLAUDE_BIN),
        "notify": bool(shutil.which("notify-send")),
        "nmcli": bool(shutil.which("nmcli")),
        "yaml": True,
    }


MIMES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
         ".ico": "image/x-icon", ".bmp": "image/bmp",
         ".pdf": "application/pdf", ".mp4": "video/mp4",
         ".webm": "video/webm", ".mkv": "video/x-matroska",
         ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
         ".m4a": "audio/mp4", ".flac": "audio/flac",
         ".html": "text/html", ".htm": "text/html"}
PREVIEWABLE = {"image": (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
                         ".ico", ".bmp"),
               "pdf": (".pdf",),
               "video": (".mp4", ".webm", ".mkv"),
               "audio": (".mp3", ".wav", ".ogg", ".m4a", ".flac")}


def preview_kind(name):
    ext = os.path.splitext(name.lower())[1]
    for kind, exts in PREVIEWABLE.items():
        if ext in exts:
            return kind
    return None


def yaml_convert(text, direction):
    import yaml
    if direction == "y2j":
        return json.dumps(yaml.safe_load(text), indent=2, default=str)
    return yaml.safe_dump(json.loads(text), sort_keys=False,
                          allow_unicode=True)


# ---------------------------------------------------------- job runner -------

JOBS = {}          # id -> {"cmd","lines","status","code","started","title"}
_job_seq = [0]
_job_lock = threading.Lock()


def start_job(argv, title, privileged=False):
    with _job_lock:
        _job_seq[0] += 1
        jid = str(_job_seq[0])
    if privileged and os.geteuid() != 0:
        argv = ["pkexec", *argv]
    job = {"id": jid, "title": title, "cmd": " ".join(argv),
           "lines": ["$ " + " ".join(argv), ""], "status": "running",
           "code": None, "started": time.time()}
    JOBS[jid] = job
    # keep only the 30 most recent jobs
    if len(JOBS) > 30:
        for k in sorted(JOBS, key=lambda k: JOBS[k]["started"])[:-30]:
            JOBS.pop(k, None)

    def run():
        try:
            p = subprocess.Popen(argv, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True,
                                 bufsize=1,
                                 env={**os.environ, "DEBIAN_FRONTEND":
                                      "noninteractive"})
            for line in p.stdout:
                job["lines"].append(line.rstrip("\n")[:400])
                if len(job["lines"]) > 1000:
                    job["lines"] = job["lines"][-1000:]
            p.wait()
            job["code"] = p.returncode
            job["status"] = "done" if p.returncode == 0 else "failed"
            if p.returncode in (126, 127):
                job["lines"].append("(authentication cancelled or failed)")
        except Exception as e:  # noqa: BLE001
            job["lines"].append("ERROR: " + str(e))
            job["status"] = "failed"
            job["code"] = -1

    threading.Thread(target=run, daemon=True).start()
    return {"id": jid}


def job_status(jid, since=0):
    job = JOBS.get(jid)
    if not job:
        raise ValueError("unknown job")
    since = int(since or 0)
    return {"id": jid, "status": job["status"], "code": job["code"],
            "title": job["title"],
            "lines": job["lines"][since:], "total": len(job["lines"])}


# ------------------------------------------------------------- packages ------


def pkg_search(q):
    q = q.strip()
    if len(q) < 2:
        return {"apt": [], "snap": []}
    apt = []
    r = subprocess.run(["apt-cache", "search", "--names-only", q],
                       capture_output=True, text=True, timeout=20,
                       env={**os.environ, "LC_ALL": "C"})
    installed = set()
    ri = subprocess.run(["dpkg-query", "-f", "${Package}\n", "-W"],
                        capture_output=True, text=True)
    installed = set(ri.stdout.split())
    for line in r.stdout.splitlines()[:40]:
        if " - " in line:
            name, desc = line.split(" - ", 1)
            name = name.strip()
            apt.append({"name": name, "desc": desc[:120],
                        "installed": name in installed})
    snap = []
    rs = subprocess.run(["snap", "find", q], capture_output=True, text=True,
                        timeout=25, env={**os.environ, "LC_ALL": "C"})
    lines = rs.stdout.splitlines()
    snap_inst = set()
    rsl = subprocess.run(["snap", "list"], capture_output=True, text=True)
    for ln in rsl.stdout.splitlines()[1:]:
        snap_inst.add(ln.split()[0])
    for line in lines[1:21]:
        parts = line.split(None, 4)
        if len(parts) >= 5:
            snap.append({"name": parts[0], "version": parts[1],
                         "publisher": parts[2], "desc": parts[4][:120],
                         "installed": parts[0] in snap_inst})
    return {"apt": apt, "snap": snap}


def pkg_install(mgr, name):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,80}", name):
        raise ValueError("invalid package name")
    if mgr == "apt":
        return start_job(["apt-get", "install", "-y", name],
                         f"Install {name} (apt)", privileged=True)
    if mgr == "snap":
        return start_job(["snap", "install", name],
                         f"Install {name} (snap)", privileged=True)
    if mgr == "apt-remove":
        return start_job(["apt-get", "remove", "-y", name],
                         f"Remove {name} (apt)", privileged=True)
    if mgr == "snap-remove":
        return start_job(["snap", "remove", name],
                         f"Remove {name} (snap)", privileged=True)
    raise ValueError("unknown package manager")


def upgrade_all(mgr):
    _upd_cache["t"] = 0
    if mgr == "apt":
        return start_job(["sh", "-c", "apt-get update && apt-get upgrade -y"],
                         "Upgrade all apt packages", privileged=True)
    if mgr == "snap":
        return start_job(["snap", "refresh"], "Refresh all snaps",
                         privileged=True)
    raise ValueError("unknown package manager")


# -------------------------------------------------------------- settings -----


def _gset(schema, key):
    r = subprocess.run(["gsettings", "get", schema, key],
                       capture_output=True, text=True)
    return r.stdout.strip().strip("'") if r.returncode == 0 else None


def get_settings():
    # brightness via GNOME session bus (no root)
    bright = None
    r = subprocess.run(["gdbus", "call", "--session", "--dest",
                        "org.gnome.SettingsDaemon.Power", "--object-path",
                        "/org/gnome/SettingsDaemon/Power", "--method",
                        "org.freedesktop.DBus.Properties.Get",
                        "org.gnome.SettingsDaemon.Power.Screen", "Brightness"],
                       capture_output=True, text=True)
    m = re.search(r"<\s*(?:int32\s+)?(-?\d+)", r.stdout)
    if m and int(m.group(1)) >= 0:
        bright = int(m.group(1))
    vol, muted = None, None
    rv = subprocess.run(["pactl", "get-sink-volume", "@DEFAULT_SINK@"],
                        capture_output=True, text=True)
    mv = re.search(r"(\d+)%", rv.stdout)
    if mv:
        vol = int(mv.group(1))
    rm = subprocess.run(["pactl", "get-sink-mute", "@DEFAULT_SINK@"],
                        capture_output=True, text=True)
    muted = "yes" in rm.stdout
    bt = None
    rb = subprocess.run(["bluetoothctl", "show"], capture_output=True,
                        text=True, timeout=6)
    if "Powered: yes" in rb.stdout:
        bt = True
    elif "Powered: no" in rb.stdout:
        bt = False
    wifi = None
    rw = subprocess.run(["nmcli", "radio", "wifi"], capture_output=True,
                        text=True)
    if rw.returncode == 0:
        wifi = rw.stdout.strip() == "enabled"
    return {
        "brightness": bright,
        "volume": vol, "muted": muted,
        "bluetooth": bt, "wifi": wifi,
        "theme": _gset("org.gnome.desktop.interface", "color-scheme"),
        "wallpaper": _gset("org.gnome.desktop.background", "picture-uri"),
    }


def set_setting(key, value):
    if key == "brightness":
        v = max(5, min(100, int(value)))
        subprocess.run(["gdbus", "call", "--session", "--dest",
                        "org.gnome.SettingsDaemon.Power", "--object-path",
                        "/org/gnome/SettingsDaemon/Power", "--method",
                        "org.freedesktop.DBus.Properties.Set",
                        "org.gnome.SettingsDaemon.Power.Screen", "Brightness",
                        f"<int32 {v}>"], capture_output=True, timeout=6)
        return {"brightness": v}
    if key == "volume":
        v = max(0, min(150, int(value)))
        subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@",
                        f"{v}%"], capture_output=True)
        return {"volume": v}
    if key == "mute":
        subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@",
                        "toggle"], capture_output=True)
        return {"ok": True}
    if key == "theme":
        if value not in ("prefer-dark", "prefer-light", "default"):
            raise ValueError("bad theme")
        subprocess.run(["gsettings", "set", "org.gnome.desktop.interface",
                        "color-scheme", value], capture_output=True)
        subprocess.run(["gsettings", "set", "org.gnome.desktop.interface",
                        "gtk-theme",
                        "Yaru-dark" if value == "prefer-dark" else "Yaru"],
                       capture_output=True)
        return {"theme": value}
    if key == "bluetooth":
        subprocess.run(["bluetoothctl", "power",
                        "on" if value else "off"], capture_output=True,
                       timeout=6)
        return {"bluetooth": bool(value)}
    if key == "wifi":
        subprocess.run(["nmcli", "radio", "wifi",
                        "on" if value else "off"], capture_output=True)
        return {"wifi": bool(value)}
    if key == "wallpaper":
        path = os.path.realpath(value)
        if not os.path.isfile(path):
            raise ValueError("no such image")
        if preview_kind(path) != "image":
            raise ValueError("not an image file")
        uri = "file://" + urllib.parse.quote(path)
        for k in ("picture-uri", "picture-uri-dark"):
            subprocess.run(["gsettings", "set",
                            "org.gnome.desktop.background", k, uri],
                           capture_output=True)
        return {"wallpaper": uri}
    raise ValueError("unknown setting")


# -------------------------------------------------------- open-with / IDE ----

APP_TABLE = [
    ("code", "VS Code", ["code"], "both"),
    ("subl", "Sublime Text", ["subl"], "both"),
    ("idea", "IntelliJ IDEA", ["idea"], "both"),
    ("pycharm", "PyCharm", ["pycharm"], "both"),
    ("goland", "GoLand", ["goland"], "both"),
    ("webstorm", "WebStorm", ["webstorm"], "both"),
    ("gnome-text-editor", "Text Editor", ["gnome-text-editor"], "file"),
    ("gedit", "gedit", ["gedit"], "file"),
    ("nautilus", "Files (Nautilus)", ["nautilus"], "dir"),
    ("xdg-open", "Default app", ["xdg-open"], "both"),
]


def available_apps():
    out = []
    for key, label, cmd, kind in APP_TABLE:
        if shutil.which(cmd[0]):
            out.append({"key": key, "label": label, "kind": kind})
    return out


def open_with(app, path):
    path = os.path.realpath(path)
    if not os.path.exists(path):
        raise ValueError("no such path")
    for key, label, cmd, kind in APP_TABLE:
        if key == app and shutil.which(cmd[0]):
            subprocess.Popen([*cmd, path], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
            return label
    raise ValueError("app not available")


# --------------------------------------------------------- site preview ------

SHOT_DIR = os.path.join(MON_DIR, "shots")


def site_shot(url):
    if not re.match(r"^https?://", url or ""):
        url = "https://" + (url or "").strip()
    if not re.match(r"^https?://[\w.-]", url):
        raise ValueError("invalid URL")
    os.makedirs(SHOT_DIR, exist_ok=True)
    name = re.sub(r"\W+", "_", url)[:60] + ".png"
    out = os.path.join(SHOT_DIR, name)
    chrome = shutil.which("google-chrome") or shutil.which("chromium-browser")
    if not chrome:
        raise ValueError("chrome not installed")
    r = subprocess.run([chrome, "--headless=new", "--disable-gpu",
                        "--hide-scrollbars", "--window-size=1280,1400",
                        f"--screenshot={out}",
                        "--virtual-time-budget=6000", url],
                       capture_output=True, text=True, timeout=45)
    if not os.path.exists(out):
        raise ValueError((r.stderr.strip()[-200:]) or "screenshot failed")
    return {"path": out, "url": url}


# ---------------------------------------------------------- runtimes ---------

RUNTIMES = [
    ("Node.js", ["node", "-v"]), ("npm", ["npm", "-v"]),
    ("Python", ["python3", "--version"]),
    ("Java", ["java", "-version"]), ("Go", ["go", "version"]),
    ("Rust", ["rustc", "--version"]), ("Ruby", ["ruby", "-v"]),
    ("PHP", ["php", "-v"]), ("Deno", ["deno", "-V"]),
]


def runtimes():
    out = []
    for label, cmd in RUNTIMES:
        if not shutil.which(cmd[0]):
            continue
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
            line = (r.stdout or r.stderr).strip().splitlines()
            out.append({"name": label, "version": line[0][:70] if line else "?",
                        "path": shutil.which(cmd[0])})
        except Exception:  # noqa: BLE001
            continue
    rust_tc = []
    rust_active = None
    if shutil.which("rustup"):
        r = subprocess.run(["rustup", "toolchain", "list"],
                           capture_output=True, text=True)
        for ln in r.stdout.splitlines():
            tc = ln.split()[0]
            rust_tc.append(tc)
            if "default" in ln:
                rust_active = tc
    node_versions = []
    nvm = os.path.join(HOME, ".nvm/versions/node")
    if os.path.isdir(nvm):
        node_versions = sorted(os.listdir(nvm), reverse=True)
    return {"tools": out, "rust_toolchains": rust_tc,
            "rust_active": rust_active, "node_versions": node_versions,
            "has_nvm": os.path.exists(os.path.join(HOME, ".nvm/nvm.sh"))}


def set_runtime(kind, value):
    if kind == "rust":
        if not re.fullmatch(r"[\w.+-]+", value):
            raise ValueError("bad toolchain")
        return start_job(["rustup", "default", value],
                         f"Set Rust default → {value}")
    raise ValueError("switching this runtime isn't supported here")


# --------------------------------------------------------- office docs -------


def read_office(path):
    path = os.path.realpath(path)
    ext = os.path.splitext(path.lower())[1]
    if ext == ".docx":
        import docx
        d = docx.Document(path)
        blocks = []
        for para in d.paragraphs:
            if para.text.strip():
                style = (para.style.name or "").lower()
                blocks.append({"h": "heading" in style, "text": para.text})
        tables = [[[c.text for c in row.cells] for row in t.rows[:60]]
                  for t in d.tables[:8]]
        return {"kind": "docx", "blocks": blocks[:800], "tables": tables}
    if ext in (".xlsx", ".xlsm"):
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        sheets = []
        for ws in wb.worksheets[:12]:
            rows = []
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i >= 200:
                    break
                rows.append(["" if c is None else str(c)[:200]
                             for c in row[:40]])
            try:
                dims = ws.calculate_dimension()
            except Exception:  # noqa: BLE001
                dims = f"{len(rows)} rows"
            sheets.append({"name": ws.title, "rows": rows, "dims": dims})
        wb.close()
        return {"kind": "xlsx", "sheets": sheets}
    raise ValueError("unsupported office format")


# ------------------------------------------------------------ file editor ----

MAX_EDIT = 2 * 2 ** 20  # 2 MB


def read_text_file(path):
    path = os.path.realpath(path)
    if not os.path.isfile(path):
        raise ValueError("not a file")
    if os.path.getsize(path) > MAX_EDIT:
        raise ValueError("file larger than 2 MB — open it in a real editor")
    with open(path, "rb") as f:
        raw = f.read()
    if b"\x00" in raw[:8192]:
        raise ValueError("binary file — use Open instead")
    return {"path": path, "content": raw.decode("utf-8", errors="replace"),
            "writable": os.access(path, os.W_OK)}


def _check_home_write(path):
    path = os.path.realpath(path)
    if not path.startswith(HOME + os.sep):
        raise ValueError("writing is limited to your home directory")
    if not os.path.isdir(os.path.dirname(path)):
        raise ValueError("folder does not exist")
    return path


def write_text_file(path, content):
    path = _check_home_write(path)
    if len(content) > MAX_EDIT:
        raise ValueError("content too large (2 MB limit)")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def save_png(path, data_b64):
    import base64
    path = _check_home_write(path)
    if not path.endswith(".png"):
        path += ".png"
    raw = base64.b64decode(data_b64.split(",")[-1])
    if len(raw) > 8 * 2 ** 20 or not raw.startswith(b"\x89PNG"):
        raise ValueError("not a valid PNG")
    with open(path, "wb") as f:
        f.write(raw)
    return path


# ------------------------------------------------------------------ server ---


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj))

    def _err(self, msg, code=400):
        self._json({"error": str(msg)}, code)

    def _raw(self, path):
        path = os.path.realpath(path)
        if not os.path.isfile(path):
            return self._err("no such file", 404)
        size = os.path.getsize(path)
        if size > 512 * 2 ** 20:
            return self._err("file larger than 512 MB", 413)
        ext = os.path.splitext(path.lower())[1]
        ctype = MIMES.get(ext, "application/octet-stream")
        try:
            f = open(path, "rb")
        except OSError as e:
            return self._err(e, 403)
        with f:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            while chunk := f.read(256 * 1024):
                self.wfile.write(chunk)

    def _static(self, rel):
        rel = rel.replace("..", "").lstrip("/")
        path = os.path.join(WEB_DIR, "static", rel)
        if not os.path.isfile(path):
            return self._err("not found", 404)
        with open(path, "rb") as f:
            data = f.read()
        ext = os.path.splitext(path)[1]
        self.send_response(200)
        self.send_header("Content-Type",
                         STATIC_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _authed(self, qs):
        tok = self.headers.get("X-Token") or (qs.get("t", [""])[0])
        return secrets.compare_digest(tok, TOKEN)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        route = parsed.path
        if route.startswith("/static/"):
            return self._static(route[len("/static/"):])
        if route == "/":
            if not self._authed(qs):
                self._send(403, "<h3>Forbidden — open the exact URL printed by "
                                "dashboard.py (it contains the access token).</h3>",
                           "text/html")
                return
            self._send(200, render_index(TOKEN), "text/html")
            return
        if not self._authed(qs):
            return self._err("bad token", 403)
        try:
            if route == "/api/overview":
                return self._json(overview())
            if route == "/api/history":
                return self._json(list(HISTORY))
            if route == "/api/disks":
                return self._json(disks())
            if route == "/api/processes":
                return self._json(processes(qs.get("sort", ["cpu"])[0],
                                            qs.get("q", [""])[0]))
            if route == "/api/users":
                return self._json(users())
            if route == "/api/browse":
                return self._json(browse(qs.get("path", [HOME])[0]))
            if route == "/api/du":
                return self._json(analyze(qs.get("path", [HOME])[0]))
            if route == "/api/cleanup":
                return self._json(cleanup_report())
            if route == "/api/search":
                return self._json(search_files(
                    qs.get("q", [""])[0],
                    regex=qs.get("regex", ["0"])[0] == "1"))
            if route == "/api/net":
                return self._json(net_ports())
            if route == "/api/docker":
                return self._json(docker_info())
            if route == "/api/dockerlogs":
                return self._json(docker_logs(qs.get("id", [""])[0]))
            if route == "/api/services":
                return self._json(services())
            if route == "/api/devinfo":
                return self._json(devinfo())
            if route == "/api/kernel":
                return self._json(kernel_info())
            if route == "/api/gpu":
                return self._json(gpu_info())
            if route == "/api/hw":
                return self._json(hw_info())
            if route == "/api/logs":
                return self._json(read_logs(qs.get("source", ["system"])[0],
                                            qs.get("n", ["150"])[0],
                                            qs.get("q", [""])[0],
                                            qs.get("prio", [""])[0],
                                            qs.get("cursor", [""])[0]))
            if route == "/api/readfile":
                return self._json(read_text_file(qs.get("path", [""])[0]))
            if route == "/api/monitor":
                return self._json(monitor_state())
            if route == "/api/caps":
                return self._json(capabilities())
            if route == "/api/updates":
                return self._json(apt_updates(qs.get("force", ["0"])[0] == "1"))
            if route == "/api/procinfo":
                return self._json(proc_detail(int(qs.get("pid", ["0"])[0])))
            if route == "/api/speedtest":
                return self._json(speed_test())
            if route == "/api/job":
                return self._json(job_status(qs.get("id", [""])[0],
                                             qs.get("since", ["0"])[0]))
            if route == "/api/pkgsearch":
                return self._json(pkg_search(qs.get("q", [""])[0]))
            if route == "/api/settings":
                return self._json(get_settings())
            if route == "/api/apps":
                return self._json({"apps": available_apps()})
            if route == "/api/runtimes":
                return self._json(runtimes())
            if route == "/api/office":
                return self._json(read_office(qs.get("path", [""])[0]))
            if route == "/api/shot":
                return self._raw(qs.get("path", [""])[0])
            if route == "/api/raw":
                return self._raw(qs.get("path", [""])[0])
            return self._err("not found", 404)
        except Exception as e:  # noqa: BLE001 — surfaced to the UI
            return self._err(e)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if not self._authed(urllib.parse.parse_qs(parsed.query)):
            return self._err("bad token", 403)
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            route = parsed.path
            if route == "/api/kill":
                name = kill_proc(int(body["pid"]), bool(body.get("force")))
                return self._json({"ok": True, "name": name})
            if route == "/api/open":
                return self._json({"ok": True, "path": open_file(body["path"])})
            if route == "/api/trash":
                paths = body.get("paths") or [body["path"]]
                done, errors = [], []
                for p in paths[:500]:
                    try:
                        done.append(trash_file(p))
                    except Exception as e:  # noqa: BLE001
                        errors.append(f"{os.path.basename(p)}: {e}")
                return self._json({"ok": not errors, "trashed": len(done),
                                   "errors": errors[:5]})
            if route == "/api/clean":
                freed = do_clean(body["target"], body.get("path"))
                return self._json({"ok": True, "freed": freed})
            if route == "/api/reindex":
                threading.Thread(target=build_index, daemon=True).start()
                return self._json({"ok": True})
            if route == "/api/killport":
                return self._json({"ok": True,
                                   "name": kill_port(int(body["port"]))})
            if route == "/api/dockeraction":
                out = docker_action(body["id"], body["action"])
                return self._json({"ok": True, "out": out})
            if route == "/api/serviceaction":
                service_action(body["name"], body["action"])
                return self._json({"ok": True})
            if route == "/api/terminal":
                return self._json({"ok": True, "path": open_terminal(body["path"])})
            if route == "/api/editor":
                return self._json({"ok": True, "editor": open_editor(body["path"])})
            if route == "/api/writefile":
                p = write_text_file(body["path"], body.get("content", ""))
                return self._json({"ok": True, "path": p})
            if route == "/api/savepng":
                p = save_png(body["path"], body["data"])
                return self._json({"ok": True, "path": p})
            if route == "/api/ai":
                return self._json(ask_ai(body.get("prompt", ""),
                                         bool(body.get("snapshot", True)),
                                         bool(body.get("reset")),
                                         body.get("extra", "")))
            if route == "/api/monitor":
                return self._json({"ok": True, "cfg": mon_save(body)})
            if route == "/api/testnotify":
                notify("Perch", "Test notification — alerts are "
                       "working 🎉", critical=False)
                return self._json({"ok": True})
            if route == "/api/http":
                return self._json(http_request(body.get("method"),
                                               body.get("url"),
                                               body.get("headers", ""),
                                               body.get("body", ""),
                                               body.get("timeout", 20)))
            if route == "/api/yaml":
                try:
                    return self._json({"ok": True, "text": yaml_convert(
                        body.get("text", ""), body.get("dir", "y2j"))})
                except Exception as e:  # noqa: BLE001
                    return self._err(f"conversion failed: {e}")
            if route == "/api/pkginstall":
                return self._json(pkg_install(body["mgr"], body["name"]))
            if route == "/api/upgradeall":
                return self._json(upgrade_all(body["mgr"]))
            if route == "/api/setsetting":
                return self._json(set_setting(body["key"], body.get("value")))
            if route == "/api/openwith":
                return self._json({"ok": True,
                                   "app": open_with(body["app"], body["path"])})
            if route == "/api/sitepreview":
                return self._json(site_shot(body["url"]))
            if route == "/api/setruntime":
                return self._json(set_runtime(body["kind"], body["value"]))
            return self._err("not found", 404)
        except psutil.AccessDenied:
            return self._err("permission denied — that process is not yours", 403)
        except psutil.NoSuchProcess:
            return self._err("process already gone", 410)
        except Exception as e:  # noqa: BLE001
            return self._err(e)


# -------------------------------------------------------------------- page ---




def main():
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/?t={TOKEN}"
    print(f"Perch running on {HOST}:{PORT} (token-protected)")
    print("  " + url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
