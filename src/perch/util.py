"""Shared low-level helpers: subprocess, atomic writes, JSONL, HTTP, sizes.

Everything here is dependency-free within the package — other modules import
from this one, never the other way round.
"""
import json
import os
import socket
import subprocess
import urllib.error
import urllib.request

_SUBPROC_TIMEOUT = 15
_sp_run = subprocess.run
def _run(cmd, **kw):
    """subprocess.run with a default timeout so no request can hang."""
    kw.setdefault("timeout", _SUBPROC_TIMEOUT)
    try:
        return _sp_run(cmd, **kw)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, 124, "", "command timed out")
def atomic_write(path, text, mode=0o600):
    """Write text to path via a temp file + rename, so a crash mid-write
    never leaves a truncated/corrupt file behind."""
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(text)
    os.chmod(tmp, mode)
    os.replace(tmp, path)
def _sd_notify(msg):
    """Tell systemd we're alive (Type=notify + WatchdogSec)."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return
    if addr.startswith("@"):
        addr = "\0" + addr[1:]
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        s.sendto(msg.encode(), addr)
        s.close()
    except OSError:
        pass
def _http_post_json(url, headers, payload, timeout=240):
    import urllib.request as ur
    data = json.dumps(payload).encode()
    req = ur.Request(url, data=data, method="POST",
                     headers={"Content-Type": "application/json", **headers})
    try:
        with ur.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise ValueError(f"provider HTTP {e.code}: {detail}")
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"provider request failed: {e}")
def fmt_bytes(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if n >= 10 or unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
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
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) perch"}


def _get(url, timeout):
    import urllib.request as ur
    return ur.urlopen(ur.Request(url, headers=UA), timeout=timeout)
def _sh_quote(s):
    import shlex
    return shlex.quote(s)
