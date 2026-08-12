"""Background job runner: long commands stream their output to the UI.

Privileged jobs go through pkexec, which shows the system password dialog —
Perch never handles credentials itself.
"""
import os
import shutil
import subprocess
import threading
import time

# ---------------------------------------------------------- job runner -------

JOBS = {}          # id -> {"cmd","lines","status","code","started","title"}
_job_lock = threading.Lock()
_job_seq = [0]
def start_job(argv, title, privileged=False):
    with _job_lock:
        _job_seq[0] += 1
        jid = str(_job_seq[0])
    if privileged and os.geteuid() != 0:
        # the wrapper gives a branded polkit prompt + session-long auth cache
        wrapper = shutil.which("perch-pkexec")
        argv = ["pkexec", wrapper, *argv] if wrapper else ["pkexec", *argv]
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
