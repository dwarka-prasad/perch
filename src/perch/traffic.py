"""Traffic: who this machine is talking to, and packet capture.

Two tiers, because they need different privileges.

Unprivileged — always available: live TCP/UDP connections with the owning
process, and per-interface counters and rates. This answers "what is my
machine talking to right now" without touching a raw socket.

Privileged — packet capture. Every capture tool needs CAP_NET_RAW, so tcpdump
runs through pkexec like the other privileged actions, bounded by a packet
count *and* a wall-clock limit so a forgotten capture cannot fill the disk. It
writes a normal .pcap you can download and open in Wireshark.

Capture records whatever crosses the wire, which on unencrypted protocols
includes credentials. It is never started automatically, and the UI says so.
"""
import os
import re
import shutil
import socket
import time

from . import jobs, util
from .paths import MON_DIR

CAPTURE_DIR = os.path.join(MON_DIR, "captures")
#: a forgotten capture must not fill the disk
MAX_PACKETS = 20000
MAX_SECONDS = 300
MAX_KEEP = 20

IFACE_RE = re.compile(r"[\w.@:-]{1,32}")
#: tcpdump's own filter language; argv is a list so nothing reaches a shell,
#: but keep the charset tight so a filter cannot smuggle in an option
BPF_RE = re.compile(r"[\w\s.:/()\[\]<>=!&|,+-]{0,200}")
CAPTURE_NAME_RE = re.compile(r"capture-[\w.-]{1,60}\.pcap")

_PROTO = {socket.SOCK_STREAM: "tcp", socket.SOCK_DGRAM: "udp"}
_io_prev = {}            # nic -> (counters, timestamp) from the previous poll
_dns_cache = {}          # ip -> hostname or "" when it does not resolve


def _proc_names(pids):
    import psutil
    out = {}
    for pid in pids:
        if not pid:
            continue
        try:
            p = psutil.Process(pid)
            with p.oneshot():
                out[pid] = {"name": p.name(), "user": p.username(),
                            "cmd": " ".join(p.cmdline())[:120]}
        except Exception:  # noqa: BLE001 — another user's process, or gone
            out[pid] = {"name": "?", "user": None, "cmd": None}
    return out


def _resolve(ip):
    """Reverse DNS with a cache. Bounded and opt-in — lookups can be slow."""
    if ip in _dns_cache:
        return _dns_cache[ip]
    old = socket.getdefaulttimeout()
    socket.setdefaulttimeout(1.0)
    try:
        _dns_cache[ip] = socket.gethostbyaddr(ip)[0]
    except Exception:  # noqa: BLE001 — no PTR record is the normal case
        _dns_cache[ip] = ""
    finally:
        socket.setdefaulttimeout(old)
    if len(_dns_cache) > 500:
        _dns_cache.clear()
    return _dns_cache[ip]


def connections(resolve=False, limit=400):
    """Active TCP/UDP sockets, with the owning process where we can see it."""
    import psutil
    try:
        conns = psutil.net_connections(kind="inet")
    except psutil.AccessDenied:
        return {"connections": [], "error": "cannot read the socket table",
                "states": {}, "remotes": [], "total": 0}
    names = _proc_names({c.pid for c in conns})
    rows, states, remotes = [], {}, {}
    me = os.getuid()
    for c in conns:
        states[c.status] = states.get(c.status, 0) + 1
        raddr = f"{c.raddr.ip}:{c.raddr.port}" if c.raddr else ""
        if c.raddr and c.status == "ESTABLISHED":
            remotes[c.raddr.ip] = remotes.get(c.raddr.ip, 0) + 1
        info = names.get(c.pid) or {}
        rows.append({
            "proto": _PROTO.get(c.type, str(c.type)),
            "local": f"{c.laddr.ip}:{c.laddr.port}" if c.laddr else "",
            "remote": raddr,
            "remote_ip": c.raddr.ip if c.raddr else "",
            "status": c.status, "pid": c.pid,
            "process": info.get("name"), "user": info.get("user"),
            "cmd": info.get("cmd"),
            "mine": bool(c.pid and info.get("user") is not None
                         and _is_mine(c.pid, me)),
        })
    # established first, then listeners, then the rest — most interesting first
    rank = {"ESTABLISHED": 0, "LISTEN": 1}
    rows.sort(key=lambda r: (rank.get(r["status"], 2), r["proto"],
                             r["local"]))
    top = sorted(remotes.items(), key=lambda kv: -kv[1])[:12]
    top_rows = [{"ip": ip, "count": n,
                 "host": _resolve(ip) if resolve else ""} for ip, n in top]
    return {"connections": rows[:limit], "total": len(rows),
            "truncated": len(rows) > limit, "states": states,
            "remotes": top_rows, "resolved": bool(resolve)}


def _is_mine(pid, uid):
    import psutil
    try:
        return psutil.Process(pid).uids().real == uid
    except Exception:  # noqa: BLE001
        return False


def interfaces_io():
    """Per-interface counters, plus rates since the previous call."""
    import psutil
    now = time.time()
    stats = psutil.net_if_stats()
    out = []
    for nic, c in psutil.net_io_counters(pernic=True).items():
        prev = _io_prev.get(nic)
        rx = tx = None
        if prev:
            pc, pt = prev
            dt = now - pt
            if dt > 0.2:
                rx = max(0, (c.bytes_recv - pc.bytes_recv) / dt)
                tx = max(0, (c.bytes_sent - pc.bytes_sent) / dt)
        _io_prev[nic] = (c, now)
        st = stats.get(nic)
        out.append({
            "nic": nic, "up": bool(st and st.isup),
            "speed": st.speed if st else 0, "mtu": st.mtu if st else 0,
            "rx_bytes": c.bytes_recv, "tx_bytes": c.bytes_sent,
            "rx_packets": c.packets_recv, "tx_packets": c.packets_sent,
            "rx_err": c.errin, "tx_err": c.errout,
            "rx_drop": c.dropin, "tx_drop": c.dropout,
            "rx_rate": rx, "tx_rate": tx,
        })
    out.sort(key=lambda i: (i["nic"] == "lo", -i["rx_bytes"] - i["tx_bytes"]))
    return {"interfaces": out, "t": now}


# ------------------------------------------------------------ capture ------

def capture_caps():
    return {"tcpdump": bool(shutil.which("tcpdump")),
            "max_packets": MAX_PACKETS, "max_seconds": MAX_SECONDS,
            "dir": CAPTURE_DIR}


def _capture_paths():
    try:
        os.makedirs(CAPTURE_DIR, mode=0o700, exist_ok=True)
    except OSError:
        return []
    out = []
    for name in os.listdir(CAPTURE_DIR):
        if not CAPTURE_NAME_RE.fullmatch(name):
            continue
        p = os.path.join(CAPTURE_DIR, name)
        try:
            st = os.stat(p)
        except OSError:
            continue
        out.append({"name": name, "size": st.st_size, "t": st.st_mtime})
    out.sort(key=lambda c: -c["t"])
    return out


def capture_list():
    return {"captures": _capture_paths(), **capture_caps()}


def capture_file(name):
    """Absolute path of a capture, refusing anything outside the directory."""
    if not CAPTURE_NAME_RE.fullmatch(name or ""):
        raise ValueError("bad capture name")
    root = os.path.realpath(CAPTURE_DIR)
    path = os.path.realpath(os.path.join(root, name))
    if not path.startswith(root + os.sep):
        raise ValueError("bad capture name")
    if not os.path.isfile(path):
        raise ValueError("no such capture")
    return path


def capture_start(iface="any", bpf="", packets=2000, seconds=30):
    """Run a bounded tcpdump as a privileged job, writing a .pcap we own.

    -Z drops tcpdump's privileges after it opens the capture socket, so the
    file lands owned by the invoking user rather than root and can be read,
    downloaded and deleted without another prompt.
    """
    if not shutil.which("tcpdump"):
        raise ValueError("tcpdump is not installed — install it from the "
                         "Packages tab")
    iface = (iface or "any").strip()
    if not IFACE_RE.fullmatch(iface):
        raise ValueError("bad interface name")
    bpf = (bpf or "").strip()
    if not BPF_RE.fullmatch(bpf):
        raise ValueError("that filter has characters tcpdump would not accept")
    # A filter token starting with "-" would be read as an option, not an
    # expression: glibc's getopt permutes, so a trailing "-w /etc/shadow"
    # would override ours and write there as root. Legitimate filters only
    # ever have "-" inside a token (tcp-syn, portrange 1-1024).
    bad = [t for t in bpf.split() if t.startswith("-")]
    if bad:
        raise ValueError(f"filter cannot contain options: {' '.join(bad[:3])}")
    try:
        packets = max(1, min(MAX_PACKETS, int(packets)))
        seconds = max(1, min(MAX_SECONDS, int(seconds)))
    except (TypeError, ValueError):
        raise ValueError("packet count and duration must be numbers")

    os.makedirs(CAPTURE_DIR, mode=0o700, exist_ok=True)
    for old in _capture_paths()[MAX_KEEP - 1:]:
        try:
            os.remove(os.path.join(CAPTURE_DIR, old["name"]))
        except OSError:
            pass
    stamp = time.strftime("%Y%m%d-%H%M%S")
    name = f"capture-{stamp}-{iface}.pcap".replace("/", "-")
    dest = os.path.join(CAPTURE_DIR, name)

    # tcpdump cannot write here directly: Ubuntu's AppArmor profile denies it
    # every path under a dot-directory in $HOME. So capture to a private
    # staging directory it is allowed to use, then move the file into place —
    # Perch itself is unconfined, and `install -o` lands it owned by the user.
    import pwd
    pw = pwd.getpwuid(os.getuid())
    stage_dir = f"/tmp/perch-capture-{pw.pw_uid}"
    stage = os.path.join(stage_dir, name)
    q = util._sh_quote
    script = (
        f"set -e; mkdir -p {q(stage_dir)}; chmod 700 {q(stage_dir)}; "
        f"timeout -s INT {seconds + 2} tcpdump -i {q(iface)} -nn "
        f"-c {packets} -Z {q(pw.pw_name)} -w {q(stage)}"
        + (" " + " ".join(q(t) for t in bpf.split()) if bpf else "")
        + " || true; "
        f"if [ -s {q(stage)} ]; then "
        f"install -m 600 -o {pw.pw_uid} -g {pw.pw_gid} {q(stage)} {q(dest)}; "
        f"echo 'saved {name}'; else echo 'no packets captured'; fi; "
        f"rm -rf {q(stage_dir)}")
    return {**jobs.start_job(["sh", "-c", script],
                             f"Capture up to {packets} packets on {iface} "
                             f"({seconds}s limit)", privileged=True),
            "file": name}


# ---- reading a capture ----
# Deliberately not "tcpdump -r": Ubuntu's AppArmor profile denies tcpdump any
# path under a dot-directory in $HOME, which is exactly where Perch keeps its
# state. Parsing the file here also means viewing a capture keeps working if
# tcpdump is later uninstalled.

LINK_HEADERS = {1: 14, 113: 16, 276: 20, 101: 0, 12: 0}   # ethernet, SLL, SLL2, raw
IP_PROTO = {1: "icmp", 6: "tcp", 17: "udp", 58: "icmpv6"}
TCP_FLAGS = [(0x02, "SYN"), (0x10, "ACK"), (0x01, "FIN"), (0x04, "RST"),
             (0x08, "PSH"), (0x20, "URG")]


def _ip_str(raw, v6=False):
    if v6:
        return socket.inet_ntop(socket.AF_INET6, raw)
    return socket.inet_ntop(socket.AF_INET, raw)


def _decode(payload):
    """One human line for a packet, or None when we cannot make sense of it."""
    import struct
    if len(payload) < 20:
        return None
    version = payload[0] >> 4
    if version == 4:
        ihl = (payload[0] & 0x0F) * 4
        proto = payload[9]
        src, dst = _ip_str(payload[12:16]), _ip_str(payload[16:20])
        rest = payload[ihl:]
    elif version == 6 and len(payload) >= 40:
        proto = payload[6]
        src, dst = _ip_str(payload[8:24], True), _ip_str(payload[24:40], True)
        rest = payload[40:]
    else:
        return None
    name = IP_PROTO.get(proto, str(proto))
    if name in ("tcp", "udp") and len(rest) >= 4:
        sport, dport = struct.unpack("!HH", rest[:4])
        line = f"{name} {src}:{sport} > {dst}:{dport}"
        if name == "tcp" and len(rest) >= 14:
            flags = rest[13]
            set_ = [n for bit, n in TCP_FLAGS if flags & bit]
            if set_:
                line += " [" + ",".join(set_) + "]"
        return line
    return f"{name} {src} > {dst}"


def capture_read(name, limit=800):
    """Readable summary of a capture, parsed here rather than shelled out."""
    import datetime
    import struct
    path = capture_file(name)
    lines, total, truncated = [], 0, False
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
            if magic in (b"\xa1\xb2\xc3\xd4", b"\xa1\xb2\x3c\x4d"):
                endian = ">"
            elif magic in (b"\xd4\xc3\xb2\xa1", b"\x4d\x3c\xb2\xa1"):
                endian = "<"
            else:
                return {"name": name, "lines": [], "total": 0,
                        "truncated": False,
                        "error": "not a pcap file (pcapng is not supported)"}
            hdr = f.read(20)
            if len(hdr) < 20:
                return {"name": name, "lines": [], "total": 0,
                        "truncated": False, "error": "truncated pcap header"}
            link = struct.unpack(endian + "I", hdr[16:20])[0]
            skip = LINK_HEADERS.get(link)
            while True:
                rec = f.read(16)
                if len(rec) < 16:
                    break
                ts, us, incl, _orig = struct.unpack(endian + "IIII", rec)
                data = f.read(incl)
                if len(data) < incl:
                    break
                total += 1
                if len(lines) >= limit:
                    truncated = True
                    continue
                when = datetime.datetime.fromtimestamp(ts).strftime("%H:%M:%S")
                if skip is None:
                    lines.append(f"{when}.{us:06d}  link type {link}")
                    continue
                what = _decode(data[skip:]) or f"{len(data)} bytes"
                lines.append(f"{when}.{us:06d}  {what}")
    except OSError as e:
        return {"name": name, "lines": [], "total": 0, "truncated": False,
                "error": str(e)[:200]}
    return {"name": name, "lines": lines, "total": total,
            "truncated": truncated, "error": ""}


def capture_delete(name):
    os.remove(capture_file(name))
    return {"ok": True}
