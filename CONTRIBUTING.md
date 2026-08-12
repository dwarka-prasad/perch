# Contributing to Perch

Thanks for your interest! Perch is a small, dependency-light project.

## Layout

```
src/perch/
  server.py     HTTP handler, routing, and the collectors not yet split out
  paths.py      where things live on disk (config, cache, index, token)
  util.py       subprocess, atomic writes, JSONL, HTTP, size formatting
  jobs.py       background job runner (pkexec for privileged commands)
  packages.py   package managers: search, install, remove, what's installed
  containers.py Docker, Podman, nerdctl, LXD/Incus, Kubernetes
  history.py    hourly rollups of the minute samples, ranges, CSV
  fleet.py      polling other Perch instances (read-only)
  config.py     static metadata (name, version, default port) — the version
                the running app reports, so keep it in step with setup.cfg
  desktop.py    native GTK/WebKit window (with browser fallback)
  web/          frontend: index.html + static/{styles.css, js/*.js}
                one global scope, loaded in order — a positional split
                of what used to be a single app.js, still no build step
tests/
  test_perch.py     unit + HTTP smoke tests (stdlib unittest only)
  frontend/         headless-Chrome smoke tests driving the real app
docker/         Dockerfile + compose for headless host monitoring
packaging/      .deb control files, .desktop, systemd unit, icon, build-deb.sh
scripts/        per-user installer
```

Dependencies point one way: `paths` and `util` know nothing about the rest,
`jobs` builds on `util`, and the feature modules build on those. `server.py`
imports and re-exports them, so `from perch import server` still exposes every
name — but **new code should import from the owning module**.

Cross-module calls go through the module object (`util._run(...)`, not
`from .util import _run`). That keeps one canonical patch point per helper, so
a test that patches `perch.util._run` affects every caller instead of only the
module that happened to re-export the name.

`server.py` is still the largest file; splitting more of it out (monitoring,
files/search, settings) is welcome, one cohesive domain at a time, with the
test suites green in between.

The backend is one module organised by clearly-marked sections; the frontend
is plain HTML/CSS/JS with no build step or framework.

## Running from source

```bash
make run       # server at http://127.0.0.1:9080 (token printed at startup)
make desktop   # native window
```

## Tests

```bash
make test            # unit + HTTP smoke tests
make test-frontend   # drives the real app in headless Chrome
```

The frontend suite boots a throwaway Perch on a temp `HOME` and drives it over
the DevTools Protocol, so it never touches your real config. It skips itself
when no Chrome is on `PATH`. Add a check there for anything that only breaks in
the browser — `node --check` proves `app.js` parses and nothing more.

## Guidelines

- No new runtime dependencies without discussion — `psutil` + `PyYAML` are the
  only required ones (office/desktop extras are optional).
- Keep the server bound to `127.0.0.1` and behind the access token.
- Privileged actions must use `pkexec` (a password prompt), never stored creds.
- Match the existing code style; the frontend stays framework-free.
