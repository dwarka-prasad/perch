"""Other machines running Perch.

Perch already exposes a token-authenticated read API, so a second Perch is all
the agent a fleet view needs. Strictly read-only: this polls other instances,
it never asks them to do anything.
"""
import json
import os
import re
import threading

from . import util
from .paths import CFG_DIR

# ------------------------------------------------------------- fleet --------
# Perch already exposes a token-authenticated read API, so a second Perch is
# all the agent a fleet view needs — no daemon, no new protocol. Strictly
# read-only: this polls other instances, it never asks them to do anything.

FLEET_FILE = os.path.join(CFG_DIR, "fleet.json")
FLEET_MAX = 24
FLEET_TIMEOUT = 6
def _fleet_clean(h):
    name = str(h.get("name", "")).strip()[:40]
    url = str(h.get("url", "")).strip().rstrip("/")
    if not re.match(r"^https?://[\w.\-\[\]]+(:\d+)?$", url):
        raise ValueError(f"'{url}' is not a host URL like http://10.0.0.5:9080")
    token = str(h.get("token", "")).strip()
    return {"name": name or url, "url": url, "token": token}
def fleet_cfg():
    try:
        with open(FLEET_FILE) as f:
            saved = json.load(f)
    except (OSError, ValueError):
        return []
    out = []
    for h in (saved if isinstance(saved, list) else [])[:FLEET_MAX]:
        try:
            out.append(_fleet_clean(h))
        except ValueError:
            continue
    return out
def fleet_save(hosts):
    if not isinstance(hosts, list):
        raise ValueError("expected a list of hosts")
    if len(hosts) > FLEET_MAX:
        raise ValueError(f"at most {FLEET_MAX} hosts")
    existing = {h["url"]: h["token"] for h in fleet_cfg()}
    cleaned = []
    for h in hosts:
        c = _fleet_clean(h)
        if not c["token"]:                  # blank means "keep what's stored"
            c["token"] = existing.get(c["url"], "")
        cleaned.append(c)
    os.makedirs(CFG_DIR, exist_ok=True)
    util.atomic_write(FLEET_FILE, json.dumps(cleaned))
    os.chmod(FLEET_FILE, 0o600)             # it holds other machines' tokens
    return fleet_public()
def fleet_public():
    """Config for the browser — never hand tokens back out."""
    return [{"name": h["name"], "url": h["url"], "has_token": bool(h["token"])}
            for h in fleet_cfg()]
def _fleet_poll(host, out):
    import urllib.request as ur
    entry = {"name": host["name"], "url": host["url"], "ok": False}
    try:
        req = ur.Request(host["url"] + "/api/overview",
                         headers={"X-Token": host["token"],
                                  "User-Agent": "perch-fleet"})
        with ur.urlopen(req, timeout=FLEET_TIMEOUT) as r:
            o = json.load(r)
        entry.update(ok=True, hostname=o.get("hostname", ""),
                     cpu=o.get("cpu"), mem=(o.get("mem") or {}).get("percent"),
                     uptime=o.get("uptime"), nproc=o.get("nproc"),
                     os=o.get("os", ""),
                     temp=max((t.get("c", 0) for t in o.get("temps", [])),
                              default=None))
    except Exception as e:  # noqa: BLE001 — one unreachable host is normal
        entry["error"] = str(e)[:120]
    out.append(entry)
def fleet_status():
    hosts = fleet_cfg()
    if not hosts:
        return {"hosts": [], "configured": 0}
    out, threads = [], []
    for h in hosts:
        t = threading.Thread(target=_fleet_poll, args=(h, out), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join(timeout=FLEET_TIMEOUT + 2)
    order = {h["url"]: i for i, h in enumerate(hosts)}
    out.sort(key=lambda e: order.get(e["url"], 99))
    return {"hosts": out, "configured": len(hosts),
            "reachable": sum(1 for e in out if e["ok"])}
