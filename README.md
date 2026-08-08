<div align="center">

# 🐦 Perch

**Your machine, at a glance.**

[![CI](https://github.com/your-org/perch/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/perch/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

A local system + developer dashboard for Linux — monitoring, ops, a full
developer toolbox, and an AI assistant, in one token-protected web app that
runs on `127.0.0.1`.

</div>

---

## Why

Perch is one place to *see* and *run* everything on your Linux machine:
live charts and alerts, process/service/Docker control, storage cleanup,
whole-system file search, package management, laptop settings, a developer
toolbox, and an AI assistant that knows your live system state — without
juggling `htop`, `df`, `systemctl`, `journalctl`, `lsof`, Postman, and a pile
of scratch converter tabs.

It is a single small Python service (stdlib HTTP server + `psutil`) with a
framework-free HTML/CSS/JS frontend. It binds to localhost and is protected by
an access token printed at startup.

## Features

| Group | Tabs |
|-------|------|
| **System** | Overview (CPU/mem/GPU/disk/temp/net charts + hardware panel + **critical-log panel**), Monitor (threshold alerts + 24 h history), Processes (+ detail inspector), Logs, Kernel, Updates, Users |
| **Storage & files** | Storage (disk + folder analyzer), Files (preview images/PDF/video/audio/Word/Excel, open-with, editor + vim mode, sketch, bulk trash), Search (regex), Clean up |
| **Developer** | Network (ports, kill-by-port, speed test), Dev (Docker containers + live stats + compose + logs + shell + prune, services, toolchain), Git (repo dashboard: branch/dirty/ahead-behind, fetch/pull/stash), API client (collections, environments with `{{vars}}`, history, **flows** with run/export, **import** from Postman/curl/raw-HTTP), Runtimes (versions + switch defaults via rustup / update-alternatives), Tools (HTTP tester, JSON/YAML, regex, diff, cron, color/case, secrets, website preview) |
| **Assistant** | AI chat + one-click **health report**, backed by a **pluggable provider**: the local Claude CLI (default, no key), the **Anthropic API**, any **OpenAI-compatible** endpoint, or a local **Ollama** model — configured in Settings |
| **Settings** | Brightness, volume, power profile, blank/suspend timers, night light, Do Not Disturb, battery %, tap-to-click, natural scroll, text size, Bluetooth, Wi-Fi, GNOME theme, wallpaper + **live wallpaper slideshow**; **dashboard theming** — accent colours, live animated backgrounds (aurora/particles), and a drag-to-reorder **customizable home screen** |
| **Packages** | Search & install/remove via apt + snap |

Plus a **Ctrl+K command palette**, a grouped sidebar with live CPU/MEM/DISK
mini-bars, and a light/dark theme.

## Install

### Debian / Ubuntu (`.deb`)

```bash
make deb                         # builds dist/perch_1.0.0_all.deb
sudo apt install ./dist/perch_1.0.0_all.deb
```

Then launch **Perch** from your app menu (`perch-desktop`), or run `perch`
headless and open the printed URL.

### From source (per-user, no root)

```bash
git clone https://github.com/your-org/perch && cd perch
make install-user                # user service + app launcher (no pip, no root)
```

### Docker (headless host monitoring)

```bash
docker compose -f docker/compose.yaml up -d --build
docker compose -f docker/compose.yaml logs   # copy the token URL
```

> The container uses host PID + network for real visibility. Desktop-only
> features (brightness, wallpaper, Bluetooth, notifications, opening apps)
> work only in the native/`.deb` install on the host.

### Run directly

```bash
make run          # http://127.0.0.1:8090  (token printed at startup)
make desktop      # native GTK/WebKit window
```

## Configuration

| Env | Default | Meaning |
|-----|---------|---------|
| `PERCH_PORT` | `8090` | Port to bind |
| `PERCH_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to reach from LAN — still token-protected) |

The access token lives in `~/.perch-token`. State (search index, alert
history, screenshots) is under `~/.cache/perch`; alert config under
`~/.config/perch`.

## Requirements

- **Required:** Python ≥ 3.8, `psutil`, `PyYAML`
- **Optional:** `python-docx` + `openpyxl` (Word/Excel preview), PyGObject +
  WebKit2GTK (native window), Chrome/Chromium (website preview), Docker,
  the `claude` CLI (AI tab). Missing integrations hide themselves at runtime.

## Security

Perch binds to `127.0.0.1` and every request needs the token from
`~/.perch-token`. Privileged actions (package install, upgrades) go through
`pkexec`, which shows a system password dialog — credentials are never stored
or handled by Perch. Writes from the file editor/sketch are restricted to your
home directory. Review the code before exposing it beyond localhost.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Backend is one organised module;
frontend is plain HTML/CSS/JS with no build step. `make help` lists tasks.

## Releasing

CI (`.github/workflows/ci.yml`) lints, compiles, and builds the `.deb` and
Docker image on every push/PR. To cut a release, bump the version in
`packaging/debian/control` + `pyproject.toml`, then:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

`release.yml` then builds the `.deb`, pushes the image to
`ghcr.io/<owner>/perch`, and publishes a GitHub Release with the `.deb`
attached.

## License

MIT — see [LICENSE](LICENSE).
