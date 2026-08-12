"""Container engines: Docker, plus whatever else is installed.

Docker gets the richer treatment (stats, compose, prune) because it is the
common case; Podman, nerdctl, LXD/Incus and Kubernetes are detected and listed
through one normalised shape.
"""
import json
import re
import shutil

# imported as modules, not names: tests (and anything else) can then patch a
# single canonical location, perch.util._run, and have it apply everywhere
from . import jobs, util

# ---------------------------------------------------------------- docker -----


def _docker_json(args, timeout=10):
    r = util._run(["docker", *args], capture_output=True, text=True,
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
    r = util._run(["docker", action, cid], capture_output=True, text=True,
                       timeout=60)
    if r.returncode != 0:
        raise ValueError(r.stderr.strip()[:300])
    return r.stdout.strip()
def docker_logs(cid):
    if not re.fullmatch(r"[0-9a-f]{4,64}", cid):
        raise ValueError("bad container id")
    r = util._run(["docker", "logs", "--tail", "150", cid],
                       capture_output=True, text=True, timeout=15)
    return {"logs": (r.stdout + r.stderr)[-20000:]}
# ------------------------------------------------- other container engines ---
# Docker is handled above; this section detects whatever *else* is installed
# (Podman, nerdctl, LXD, Kubernetes) and lists its containers/pods with the
# same shape, so the Dev tab can render them all through one code path.

CTR_ENGINES = ("docker", "podman", "nerdctl")
CTR_ACTIONS = {"start", "stop", "restart", "rm"}
CTR_ID_RE = re.compile(r"[0-9a-zA-Z][\w.-]{0,63}")
K8S_NAME_RE = re.compile(r"[a-z0-9][a-z0-9.-]{0,252}")
def _ctr_ports(ports):
    """Normalise a ports field: docker gives a string, podman a list."""
    if not isinstance(ports, list):
        return str(ports or "")
    out = []
    for p in ports:
        if not isinstance(p, dict):
            out.append(str(p))
            continue
        host = p.get("host_port") or p.get("hostPort") or ""
        cont = p.get("container_port") or p.get("containerPort") or ""
        proto = p.get("protocol") or "tcp"
        out.append(f"{host}->{cont}/{proto}" if host else f"{cont}/{proto}")
    return ", ".join(str(x) for x in out)
def _ctr_norm(c):
    names = c.get("Names") or c.get("Name") or ""
    if isinstance(names, list):
        names = ", ".join(names)
    state = str(c.get("State") or "").lower()
    status = c.get("Status") or ""
    if state in ("", "unknown"):
        state = "running" if str(status).lower().startswith("up") else state
    return {"id": str(c.get("ID") or c.get("Id") or "")[:64],
            "name": names, "image": c.get("Image") or "",
            "state": state, "status": str(status),
            "ports": _ctr_ports(c.get("Ports"))}
def _ctr_ps(engine):
    """`<engine> ps -a` as a normalised list.

    Docker/nerdctl honour the Go template and emit one JSON object per line;
    Podman ignores it and emits a single JSON array — both are accepted.
    """
    r = util._run([engine, "ps", "-a", "--format", "{{json .}}"],
             capture_output=True, text=True, timeout=12)
    if r.returncode != 0:
        raise ValueError((r.stderr.strip() or engine + " unavailable")[:300])
    text = (r.stdout or "").strip()
    if not text:
        return []
    rows = (json.loads(text) if text[0] == "["
            else [json.loads(x) for x in text.splitlines() if x.strip()])
    return [_ctr_norm(c) for c in rows][:200]
def _ctr_version(engine):
    r = util._run([engine, "--version"], capture_output=True, text=True, timeout=8)
    lines = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()
    return lines[0][:60] if lines else ""
def _lxd_containers():
    """LXD/Incus instances, if that client is installed and talking to a daemon."""
    for binary in ("incus", "lxc"):
        if not shutil.which(binary):
            continue
        r = util._run([binary, "list", "--format", "json"],
                 capture_output=True, text=True, timeout=12)
        if r.returncode != 0 or not (r.stdout or "").strip():
            continue
        try:
            rows = json.loads(r.stdout)
        except ValueError:
            continue
        out = []
        for i in rows[:200]:
            # a stopped instance reports "state": null, so `or {}` at every hop
            net = (i.get("state") or {}).get("network") or {}
            ips = [a["address"] for iface, d in net.items() if iface != "lo"
                   for a in (d.get("addresses") or [])
                   if a.get("family") == "inet"]
            out.append({"id": i.get("name", ""), "name": i.get("name", ""),
                        "image": ((i.get("config") or {})
                                  .get("image.description") or "")[:60],
                        "state": str(i.get("status", "")).lower(),
                        "status": i.get("status", ""), "ports": ", ".join(ips)})
        return {"engine": binary, "kind": "lxd", "version": _ctr_version(binary),
                "containers": out, "error": None}
    return None
def _k8s_pods():
    """Pods from the current kubectl context, or None when there isn't one."""
    if not shutil.which("kubectl"):
        return None
    r = util._run(["kubectl", "config", "current-context"],
             capture_output=True, text=True, timeout=6)
    if r.returncode != 0:
        return None
    ctx = r.stdout.strip()
    # --request-timeout keeps an unreachable cluster from stalling the panel
    r = util._run(["kubectl", "get", "pods", "--all-namespaces", "-o", "json",
              "--request-timeout=8s"], capture_output=True, text=True,
             timeout=20)
    if r.returncode != 0:
        return {"context": ctx, "pods": [],
                "error": (r.stderr.strip() or "cluster unreachable")[:300]}
    try:
        items = json.loads(r.stdout or "{}").get("items", [])
    except ValueError:
        return {"context": ctx, "pods": [], "error": "unreadable kubectl output"}
    pods = []
    for it in items[:300]:
        md, st = it.get("metadata") or {}, it.get("status") or {}
        cs = st.get("containerStatuses") or []
        pods.append({"ns": md.get("namespace", ""), "name": md.get("name", ""),
                     "phase": st.get("phase", ""),
                     "ready": f"{sum(1 for c in cs if c.get('ready'))}/{len(cs)}",
                     "restarts": sum(c.get("restartCount") or 0 for c in cs),
                     "node": (it.get("spec") or {}).get("nodeName", ""),
                     "ip": st.get("podIP") or ""})
    pods.sort(key=lambda p: (p["ns"], p["name"]))
    return {"context": ctx, "pods": pods, "error": None}
def container_envs():
    """Every container environment present on this machine, Docker included."""
    envs = []
    for engine in CTR_ENGINES:
        if not shutil.which(engine):
            continue
        env = {"engine": engine, "kind": "container",
               "version": _ctr_version(engine), "containers": [], "error": None}
        try:
            env["containers"] = _ctr_ps(engine)
        except Exception as e:  # noqa: BLE001 — one dead engine must not hide the rest
            env["error"] = str(e)[:300]
        envs.append(env)
    # one flaky/odd-shaped environment must not take the whole panel down
    try:
        lxd = _lxd_containers()
        if lxd:
            envs.append(lxd)
    except Exception:  # noqa: BLE001
        pass
    try:
        k8s = _k8s_pods()
    except Exception:  # noqa: BLE001
        k8s = None
    return {"envs": envs, "k8s": k8s}
def ctr_action(engine, cid, action):
    if engine not in CTR_ENGINES or action not in CTR_ACTIONS:
        raise ValueError("bad container action")
    if not CTR_ID_RE.fullmatch(cid or ""):
        raise ValueError("bad container id")
    r = util._run([engine, action, cid], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise ValueError((r.stderr.strip() or "command failed")[:300])
    return r.stdout.strip()
def ctr_logs(engine, cid, ns=""):
    """Recent log lines from a container (docker/podman/nerdctl) or a k8s pod."""
    if engine == "k8s":
        if not (K8S_NAME_RE.fullmatch(cid or "")
                and K8S_NAME_RE.fullmatch(ns or "")):
            raise ValueError("bad pod name")
        cmd = ["kubectl", "logs", "-n", ns, cid, "--tail", "150",
               "--all-containers=true"]
    else:
        if engine not in CTR_ENGINES:
            raise ValueError("unknown container engine")
        if not CTR_ID_RE.fullmatch(cid or ""):
            raise ValueError("bad container id")
        cmd = [engine, "logs", "--tail", "150", cid]
    r = util._run(cmd, capture_output=True, text=True, timeout=20)
    return {"logs": (r.stdout + r.stderr)[-20000:]}
# ---------------------------------------------------- docker (extended) ------


def docker_stats():
    r = util._run(["docker", "stats", "--no-stream", "--format",
                        "{{json .}}"], capture_output=True, text=True,
                       timeout=15)
    rows = []
    for line in r.stdout.splitlines():
        try:
            c = json.loads(line)
            rows.append({"name": c.get("Name"), "cpu": c.get("CPUPerc"),
                         "mem": c.get("MemPerc"), "memuse": c.get("MemUsage"),
                         "net": c.get("NetIO"), "block": c.get("BlockIO")})
        except json.JSONDecodeError:
            continue
    return {"stats": rows}
def docker_compose_projects():
    r = util._run(["docker", "ps", "-a", "--format", "{{json .}}"],
                       capture_output=True, text=True, timeout=10)
    projects = {}
    for line in r.stdout.splitlines():
        try:
            c = json.loads(line)
        except json.JSONDecodeError:
            continue
        labels = c.get("Labels", "")
        proj = None
        for kv in labels.split(","):
            if kv.startswith("com.docker.compose.project="):
                proj = kv.split("=", 1)[1]
        if not proj:
            continue
        p = projects.setdefault(proj, {"name": proj, "running": 0, "total": 0})
        p["total"] += 1
        if c.get("State") == "running":
            p["running"] += 1
    return {"projects": sorted(projects.values(), key=lambda x: x["name"])}
def docker_compose_action(project, action):
    if action not in ("up", "down", "restart") \
            or not re.fullmatch(r"[\w.-]+", project or ""):
        raise ValueError("bad compose action")
    sub = {"up": ["up", "-d"], "down": ["down"], "restart": ["restart"]}[action]
    return jobs.start_job(["docker", "compose", "-p", project, *sub],
                     f"compose {action} — {project}")
def docker_disk():
    """`docker system df` — what images/containers/volumes actually cost, so
    you can see what pruning would reclaim before you prune."""
    r = util._run(["docker", "system", "df", "--format", "{{json .}}"],
             capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        raise ValueError((r.stderr.strip() or "docker unavailable")[:300])
    rows = []
    for line in r.stdout.splitlines():
        if not line.strip():
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        rows.append({"type": d.get("Type", ""), "total": d.get("TotalCount", ""),
                     "active": d.get("Active", ""), "size": d.get("Size", ""),
                     "reclaimable": d.get("Reclaimable", "")})
    volumes = []
    rv = util._run(["docker", "volume", "ls", "--format", "{{json .}}"],
              capture_output=True, text=True, timeout=15)
    if rv.returncode == 0:
        for line in rv.stdout.splitlines():
            if not line.strip():
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            volumes.append({"name": d.get("Name", ""), "driver": d.get("Driver", ""),
                            "size": d.get("Size", "")})
    return {"usage": rows, "volumes": volumes[:60]}
def docker_prune(kind):
    if kind == "images":
        return jobs.start_job(["docker", "image", "prune", "-f"],
                         "Prune dangling images")
    if kind == "system":
        return jobs.start_job(["docker", "system", "prune", "-f"],
                         "Prune stopped containers, networks, dangling images")
    raise ValueError("bad prune kind")
def pg_containers():
    """Running containers whose image looks like Postgres — for a quick picker."""
    if not shutil.which("docker"):
        return []
    r = util._run(["docker", "ps", "--format", "{{.Names}}\t{{.Image}}"],
             capture_output=True, text=True)
    out = []
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) == 2 and ("postgres" in parts[1].lower()
                                or "postgis" in parts[1].lower()):
            out.append({"name": parts[0], "image": parts[1]})
    return out
