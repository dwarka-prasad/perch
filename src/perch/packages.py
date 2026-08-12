"""Package managers: the native one plus snap and flatpak when present.

Search, install, remove, upgrade, and everything already installed. All the
state-changing paths go through the job runner so they get a password prompt
and stream their output.
"""
import os
import re
import shutil
import time

from . import jobs, util

# ------------------------------------------------- updates / net extras ------

_upd_cache = {"t": 0.0, "data": None}
def _parse_updates(pm, out):
    pkgs = []
    if pm == "apt":
        for line in out.splitlines():
            m = re.match(r"^([^/]+)/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from: "
                         r"(.+)\]", line)
            if m:
                pkgs.append({"name": m.group(1), "repo": m.group(2),
                             "new": m.group(3), "old": m.group(4),
                             "security": "-security" in m.group(2)})
    elif pm == "dnf":
        for line in out.splitlines():
            m = re.match(r"^(\S+)\.\S+\s+(\S+)\s+(\S+)\s*$", line)
            if m:
                pkgs.append({"name": m.group(1), "repo": m.group(3),
                             "new": m.group(2), "old": "",
                             "security": False})
    elif pm == "pacman":
        for line in out.splitlines():
            m = re.match(r"^(\S+)\s+(\S+)\s+->\s+(\S+)", line)
            if m:
                pkgs.append({"name": m.group(1), "repo": "",
                             "new": m.group(3), "old": m.group(2),
                             "security": False})
    elif pm == "zypper":
        for line in out.splitlines():
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 5 and parts[0] == "v":
                pkgs.append({"name": parts[2], "repo": parts[1],
                             "new": parts[4], "old": parts[3],
                             "security": False})
    return pkgs
def pkg_updates(force=False):
    if not force and _upd_cache["data"] and time.time() - _upd_cache["t"] < 600:
        return _upd_cache["data"]
    cmds = {"apt": ["apt", "list", "--upgradable"],
            "dnf": ["dnf", "-q", "check-update"],
            "pacman": ["pacman", "-Qu"],
            "zypper": ["zypper", "-q", "lu"]}
    pkgs = []
    if _PM:
        r = util._run(cmds[_PM], capture_output=True, text=True, timeout=60,
                 env={**os.environ, "LC_ALL": "C"})
        pkgs = _parse_updates(_PM, r.stdout)
    st = 0.0
    try:
        st = os.path.getmtime("/var/lib/apt/lists")
    except OSError:
        pass
    data = {"packages": pkgs[:300], "count": len(pkgs), "pm": _PM,
            "security": sum(1 for p in pkgs if p["security"]),
            "lists_updated": st}
    _upd_cache.update(t=time.time(), data=data)
    return data
# ------------------------------------------------------------- packages ------
# Native package manager abstraction: apt / dnf / pacman / zypper detected at
# startup, plus snap and flatpak as universal extras when installed.


def _native_pm():
    for pm in ("apt", "dnf", "pacman", "zypper"):
        if shutil.which(pm):
            return pm
    return None
_PM = _native_pm()
_HAS_SNAP = bool(shutil.which("snap"))
_HAS_FLATPAK = bool(shutil.which("flatpak"))
_PM_SEARCH = {
    "apt": lambda q: ["apt-cache", "search", "--names-only", q],
    "dnf": lambda q: ["dnf", "-q", "search", q],
    "pacman": lambda q: ["pacman", "-Ss", q],
    "zypper": lambda q: ["zypper", "-q", "se", q],
}
_PM_INSTALL = {
    "apt": lambda n: ["apt-get", "install", "-y", n],
    "dnf": lambda n: ["dnf", "install", "-y", n],
    "pacman": lambda n: ["pacman", "-S", "--noconfirm", n],
    "zypper": lambda n: ["zypper", "-n", "install", n],
}
_PM_REMOVE = {
    "apt": lambda n: ["apt-get", "remove", "-y", n],
    "dnf": lambda n: ["dnf", "remove", "-y", n],
    "pacman": lambda n: ["pacman", "-R", "--noconfirm", n],
    "zypper": lambda n: ["zypper", "-n", "remove", n],
}
_PM_UPDATE_ONE = {
    "apt": lambda n: ["apt-get", "install", "--only-upgrade", "-y", n],
    "dnf": lambda n: ["dnf", "upgrade", "-y", n],
    "pacman": lambda n: ["pacman", "-S", "--noconfirm", n],
    "zypper": lambda n: ["zypper", "-n", "update", n],
}
_PM_UPGRADE = {
    "apt": ["sh", "-c", "apt-get update && apt-get upgrade -y"],
    "dnf": ["dnf", "upgrade", "-y"],
    "pacman": ["pacman", "-Syu", "--noconfirm"],
    "zypper": ["sh", "-c", "zypper -n refresh && zypper -n update"],
}
def _parse_pm_search(pm, out):
    pkgs = []
    if pm == "apt":
        for line in out.splitlines():
            if " - " in line:
                name, desc = line.split(" - ", 1)
                pkgs.append({"name": name.strip(), "desc": desc[:120]})
    elif pm == "dnf":
        for line in out.splitlines():
            m = re.match(r"^(\S+)\.\S+\s*:\s*(.*)", line)
            if m:
                pkgs.append({"name": m.group(1), "desc": m.group(2)[:120]})
    elif pm == "pacman":
        cur = None
        for line in out.splitlines():
            m = re.match(r"^\S+/(\S+)\s+\S+", line)
            if m:
                cur = {"name": m.group(1), "desc": ""}
                pkgs.append(cur)
            elif cur is not None and line[:1] in (" ", "\t"):
                cur["desc"] = (cur["desc"] + " " + line.strip()).strip()[:120]
    elif pm == "zypper":
        for line in out.splitlines():
            parts = [p.strip() for p in line.split("|")]
            if (len(parts) >= 4 and parts[1] and parts[1] != "Name"
                    and not set(parts[1]) <= {"-", "+"}):
                pkgs.append({"name": parts[1], "desc": parts[2][:120]})
    return pkgs[:40]
def _installed_native():
    if _PM == "apt":
        r = util._run(["dpkg-query", "-f", "${Package}\n", "-W"],
                 capture_output=True, text=True)
    elif _PM in ("dnf", "zypper"):
        r = util._run(["rpm", "-qa", "--qf", "%{NAME}\n"],
                 capture_output=True, text=True, timeout=30)
    elif _PM == "pacman":
        r = util._run(["pacman", "-Qq"], capture_output=True, text=True)
    else:
        return set()
    return set(r.stdout.split())
def pkg_search(q):
    q = q.strip()
    out = {"native_pm": _PM, "native": [], "snap": [], "flatpak": []}
    if len(q) < 2:
        return out
    if _PM:
        r = util._run(_PM_SEARCH[_PM](q), capture_output=True, text=True,
                 timeout=30, env={**os.environ, "LC_ALL": "C"})
        installed = _installed_native()
        out["native"] = [{**p, "installed": p["name"] in installed}
                         for p in _parse_pm_search(_PM, r.stdout)]
    if _HAS_SNAP:
        rs = util._run(["snap", "find", q], capture_output=True, text=True,
                  timeout=25, env={**os.environ, "LC_ALL": "C"})
        rsl = util._run(["snap", "list"], capture_output=True, text=True)
        snap_inst = {ln.split()[0] for ln in rsl.stdout.splitlines()[1:] if ln}
        for line in rs.stdout.splitlines()[1:21]:
            parts = line.split(None, 4)
            if len(parts) >= 5:
                out["snap"].append(
                    {"name": parts[0], "version": parts[1],
                     "publisher": parts[2], "desc": parts[4][:120],
                     "installed": parts[0] in snap_inst})
    if _HAS_FLATPAK:
        rf = util._run(["flatpak", "search",
                   "--columns=application,name,description", q],
                  capture_output=True, text=True, timeout=30)
        ri = util._run(["flatpak", "list", "--columns=application"],
                  capture_output=True, text=True)
        flat_inst = set(ri.stdout.split())
        for line in rf.stdout.splitlines()[:20]:
            parts = line.split("\t")
            if len(parts) >= 2 and "." in parts[0]:
                out["flatpak"].append(
                    {"name": parts[0], "title": parts[1],
                     "desc": (parts[2] if len(parts) > 2 else "")[:120],
                     "installed": parts[0] in flat_inst})
    return out
# ---- everything installed, from every package manager present ----

def _rows_from(out, cols, sizes_in_kb=False):
    """Tab-separated query output -> package dicts."""
    pkgs = []
    for line in out.splitlines():
        parts = line.split("\t")
        if not parts or not parts[0].strip():
            continue
        d = dict(zip(cols, [p.strip() for p in parts]))
        try:
            size = int(d.get("size") or 0) * (1024 if sizes_in_kb else 1)
        except ValueError:
            size = 0
        pkgs.append({"name": d.get("name", ""), "version": d.get("version", ""),
                     "size": size, "summary": (d.get("summary") or "")[:160]})
    return pkgs
def _installed_for(mgr):
    """Full installed list for one manager, unsorted and unfiltered."""
    cols = ("name", "version", "size", "summary")
    if mgr == "native":
        if _PM == "apt":
            r = util._run(["dpkg-query", "-W", "-f",
                      "${Package}\t${Version}\t${Installed-Size}\t"
                      "${binary:Summary}\n"],
                     capture_output=True, text=True, timeout=30)
            return _rows_from(r.stdout, cols, sizes_in_kb=True)
        if _PM in ("dnf", "zypper"):
            r = util._run(["rpm", "-qa", "--qf",
                      "%{NAME}\t%{VERSION}-%{RELEASE}\t%{SIZE}\t%{SUMMARY}\n"],
                     capture_output=True, text=True, timeout=45)
            return _rows_from(r.stdout, cols)
        if _PM == "pacman":
            if shutil.which("expac"):
                r = util._run(["expac", "-Q", "%n\t%v\t%m\t%d"],
                         capture_output=True, text=True, timeout=30)
                return _rows_from(r.stdout, cols)
            r = util._run(["pacman", "-Q"], capture_output=True, text=True, timeout=30)
            return [{"name": p.split()[0], "version": p.split()[-1],
                     "size": 0, "summary": ""}
                    for p in r.stdout.splitlines() if p.strip()]
        return []
    if mgr == "snap":
        if not _HAS_SNAP:
            return []
        r = util._run(["snap", "list"], capture_output=True, text=True, timeout=25)
        out = []
        for line in r.stdout.splitlines()[1:]:      # drop the header row
            f = line.split()
            if len(f) >= 2:
                out.append({"name": f[0], "version": f[1], "size": 0,
                            "summary": " ".join(f[4:6]) if len(f) > 5 else ""})
        return out
    if mgr == "flatpak":
        if not _HAS_FLATPAK:
            return []
        r = util._run(["flatpak", "list", "--app",
                  "--columns=application,version,size,name"],
                 capture_output=True, text=True, timeout=25)
        out = []
        for line in r.stdout.splitlines():
            f = [x.strip() for x in line.split("\t")]
            if f and f[0]:
                out.append({"name": f[0], "version": f[1] if len(f) > 1 else "",
                            "size": 0,
                            "summary": (f[3] if len(f) > 3 else "")[:160]})
        return out
    raise ValueError("unknown package manager")
def installed_packages(mgr="native", q="", limit=300, sort="name"):
    """Installed packages for one manager, filtered and capped.

    The full list is thousands of rows on a normal desktop, so filtering and
    the cap happen here rather than shipping it all to the browser.
    """
    pkgs = _installed_for(mgr)
    total = len(pkgs)
    q = (q or "").strip().lower()
    if q:
        pkgs = [p for p in pkgs
                if q in p["name"].lower() or q in p["summary"].lower()]
    upgradable = set()
    if mgr == "native":
        try:
            upgradable = {p["name"] for p in pkg_updates()["packages"]}
        except Exception:  # noqa: BLE001 — the list is still useful without it
            pass
    for p in pkgs:
        p["upgradable"] = p["name"] in upgradable
    if sort == "size":
        pkgs.sort(key=lambda p: -p["size"])
    else:
        pkgs.sort(key=lambda p: p["name"].lower())
    try:
        limit = max(1, min(2000, int(limit)))
    except (TypeError, ValueError):
        limit = 300
    return {"mgr": mgr, "pm": _PM, "total": total, "matched": len(pkgs),
            "packages": pkgs[:limit], "truncated": len(pkgs) > limit,
            "bytes": sum(p["size"] for p in pkgs)}
def pkg_install(mgr, name):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,80}", name):
        raise ValueError("invalid package name")
    if mgr in ("native", "apt") and _PM:
        return jobs.start_job(_PM_INSTALL[_PM](name),
                         f"Install {name} ({_PM})", privileged=True)
    if mgr in ("native-remove", "apt-remove") and _PM:
        return jobs.start_job(_PM_REMOVE[_PM](name),
                         f"Remove {name} ({_PM})", privileged=True)
    if mgr == "snap":
        return jobs.start_job(["snap", "install", name],
                         f"Install {name} (snap)", privileged=True)
    if mgr == "snap-remove":
        return jobs.start_job(["snap", "remove", name],
                         f"Remove {name} (snap)", privileged=True)
    if mgr == "flatpak":  # flatpak talks to polkit itself — no pkexec
        return jobs.start_job(["flatpak", "install", "-y", "--noninteractive",
                          name], f"Install {name} (flatpak)")
    if mgr == "flatpak-remove":
        return jobs.start_job(["flatpak", "uninstall", "-y", name],
                         f"Remove {name} (flatpak)")
    if mgr in ("native-update", "apt-update") and _PM:
        return jobs.start_job(_PM_UPDATE_ONE[_PM](name),
                         f"Update {name} ({_PM})", privileged=True)
    if mgr == "snap-update":
        return jobs.start_job(["snap", "refresh", name],
                         f"Update {name} (snap)", privileged=True)
    if mgr == "flatpak-update":
        return jobs.start_job(["flatpak", "update", "-y", "--noninteractive", name],
                         f"Update {name} (flatpak)")
    raise ValueError("unknown package manager")
def upgrade_all(mgr):
    _upd_cache["t"] = 0
    if mgr in ("native", "apt") and _PM:
        return jobs.start_job(_PM_UPGRADE[_PM],
                         f"Upgrade all {_PM} packages", privileged=True)
    if mgr == "snap":
        return jobs.start_job(["snap", "refresh"], "Refresh all snaps",
                         privileged=True)
    if mgr == "flatpak":
        return jobs.start_job(["flatpak", "update", "-y"],
                         "Update all flatpaks")
    raise ValueError("unknown package manager")
