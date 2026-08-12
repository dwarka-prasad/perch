"""Long-term history: hourly rollups of the minute samples.

Minute samples answer "what is happening" and are pruned after a few days.
Rolling each finished hour into one row answers "is this normal for a Tuesday",
which is the question an alert on its own can never settle.
"""
import datetime
import json
import os
import time

from . import util
from .paths import MON_DIR

MINUTES_FILE = os.path.join(MON_DIR, "history.jsonl")

# ---- long-term history: hourly rollups of the minute samples ----
# Minute samples answer "what is happening"; they are pruned after a few days.
# Rolling each finished hour into one row answers "is this normal for a
# Tuesday", which is the question an alert on its own can never settle.

HOURLY_FILE = os.path.join(MON_DIR, "history-hourly.jsonl")
HOURLY_KEEP = 24 * 120                      # ~120 days
HISTORY_RANGES = {"24h": 86400, "7d": 7 * 86400,
                  "30d": 30 * 86400, "90d": 90 * 86400}
def _roll_hour(now):
    """Roll every finished hour the minute file still covers and that hasn't
    been rolled yet. Written as a catch-up rather than "roll the last hour" so
    it backfills on first run and after the machine has been off."""
    hour = int(now // 3600) * 3600
    done = set()
    try:
        with open(HOURLY_FILE) as f:
            for line in f:
                try:
                    done.add(json.loads(line).get("t"))
                except ValueError:
                    continue
    except OSError:
        pass
    buckets = {}
    for r in util._tail_jsonl(MINUTES_FILE, 6000):
        t = r.get("t", 0)
        bucket = int(t // 3600) * 3600
        if bucket >= hour or bucket in done:
            continue                        # current hour, or already rolled
        buckets.setdefault(bucket, []).append(r)
    if not buckets:
        return

    def agg(rows, key, how):
        vals = [r[key] for r in rows if r.get(key) is not None]
        if not vals:
            return None
        return (round(sum(vals) / len(vals), 1) if how == "avg"
                else round(max(vals), 1))

    os.makedirs(MON_DIR, exist_ok=True)
    with open(HOURLY_FILE, "a") as f:
        for bucket in sorted(buckets):
            rows = buckets[bucket]
            f.write(json.dumps({
                "t": bucket, "n": len(rows),
                "cpu": agg(rows, "cpu", "avg"), "cpu_max": agg(rows, "cpu", "max"),
                "mem": agg(rows, "mem", "avg"), "mem_max": agg(rows, "mem", "max"),
                "temp": agg(rows, "temp", "max"), "disk": agg(rows, "disk", "max"),
                "batt": agg(rows, "batt", "avg")}) + "\n")
    util._prune_jsonl(HOURLY_FILE, HOURLY_KEEP)
def history_series(rng="24h"):
    """Minute resolution for a day, hourly beyond it — same row shape either way."""
    span = HISTORY_RANGES.get(rng, 86400)
    cutoff = time.time() - span
    if span <= 86400:
        rows = [r for r in util._tail_jsonl(MINUTES_FILE, 1600)
                if r.get("t", 0) >= cutoff]
        return {"range": rng, "resolution": "minute", "rows": rows}
    rows = [r for r in util._tail_jsonl(HOURLY_FILE, HOURLY_KEEP)
            if r.get("t", 0) >= cutoff]
    return {"range": rng, "resolution": "hour", "rows": rows}
HISTORY_CSV_COLS = ("t", "cpu", "cpu_max", "mem", "mem_max", "temp", "disk",
                    "batt")
def history_csv(rng="24h"):
    data = history_series(rng)
    out = ["time," + ",".join(HISTORY_CSV_COLS[1:])]
    for r in data["rows"]:
        stamp = datetime.datetime.fromtimestamp(r.get("t", 0)).isoformat(
            timespec="seconds")
        out.append(stamp + "," + ",".join(
            "" if r.get(c) is None else str(r.get(c))
            for c in HISTORY_CSV_COLS[1:]))
    return "\n".join(out) + "\n"
