# Contributing to Perch

Thanks for your interest! Perch is a small, dependency-light project.

## Layout

```
src/perch/
  server.py     backend: HTTP server, collectors, dev tooling, routing
  config.py     static metadata (name, version, default port)
  desktop.py    native GTK/WebKit window (with browser fallback)
  web/          frontend: index.html + static/{styles.css, app.js}
docker/         Dockerfile + compose for headless host monitoring
packaging/      .deb control files, .desktop, systemd unit, icon, build-deb.sh
scripts/        per-user installer
```

The backend is one module organised by clearly-marked sections; the frontend
is plain HTML/CSS/JS with no build step or framework.

## Running from source

```bash
make run       # server at http://127.0.0.1:8090 (token printed at startup)
make desktop   # native window
```

## Guidelines

- No new runtime dependencies without discussion — `psutil` + `PyYAML` are the
  only required ones (office/desktop extras are optional).
- Keep the server bound to `127.0.0.1` and behind the access token.
- Privileged actions must use `pkexec` (a password prompt), never stored creds.
- Match the existing code style; the frontend stays framework-free.
