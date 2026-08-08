# Changelog

## 1.2.1

- **Fix: terminal Fullscreen button** — now reliably fills the window (an
  in-app maximize) instead of depending only on the native Fullscreen API,
  which could silently fail or leave the terminal small inside a black screen.
  Panes stretch to fill via a flex stage; OS fullscreen is still used when the
  browser supports it, and Esc restores the normal view.

## 1.2.0

- **Terminal: tabs, splits & fullscreen** — the Terminal tab is now a
  kitty-style multiplexer. Open multiple session **tabs**, **split** any pane
  side-by-side (Ctrl+Shift+E) or stacked (Ctrl+Shift+O) with drag-resizable
  gutters, jump to real **fullscreen**, and zoom the font (Ctrl+Shift+±). Each
  pane is its own shell/pty; click a pane to focus it. Keyboard: Ctrl+Shift+T
  new tab, Ctrl+Shift+W close pane.

## 1.1.0

A robustness + capability release: hardened internals, distro-agnostic package
management, several new tools for both developers and non-technical users, and
a refreshed glass UI.

### New tabs & features
- **Web terminal** — a real login shell in the browser (a proper pty over a
  websocket, not a command box), under Developer.
- **Database browser** — inspect SQLite files and PostgreSQL (host `psql` or a
  running container); read-only by default with opt-in writes.
- **Health scorecard** — the Overview now shows a score out of 100 built from
  disk, updates, failed services, memory, temperature and battery, each finding
  in plain language with a one-click fix.
- **Backup helper** — rsync chosen folders to another drive on demand or on a
  daily/weekly schedule (Storage tab), plus an optional **weekly auto tidy-up**
  (Clean up tab).
- **Scheduled-tasks manager** — edit your crontab and enable/disable systemd
  timers (Tools tab).
- **SSH key manager** — list keys with fingerprints, copy public keys, generate
  ed25519 keys (Runtimes tab).
- **Project launcher** — run a repo's own npm/yarn/pnpm scripts or Make targets
  as live jobs, from the Git tab.
- **GNOME Tweaks panel** — GTK/icon/cursor themes, fonts with antialiasing &
  hinting, titlebar buttons, clock format, animations, workspaces, and pointer
  speed (Settings).
- **Simple mode** — one toggle hides every developer tab for a
  monitoring-and-settings dashboard aimed at non-technical users.

### Cross-distro & desktop
- Package management now works across **apt / dnf / pacman / zypper**
  (auto-detected) plus **snap** and **flatpak** when present.
- `/api/caps` reports the platform (native PM, snap, flatpak, GNOME, battery,
  Wayland) and the UI hides settings/panels that don't apply.
- The `.deb` ships a **polkit policy** so package actions show one branded,
  session-cached password prompt.

### Robustness & security
- The URL token is exchanged for an **`HttpOnly`, `SameSite=Strict` cookie** on
  first visit and the URL is cleaned; repeated bad tokens are locked out.
- Every subprocess call has a **default timeout** so no request can hang.
- Config files are written **atomically**; a new unauthenticated `/api/health`
  endpoint and systemd `Type=notify` + watchdog keep the service alive.
- A **test suite** (unit + HTTP smoke) runs in CI on Python 3.8 and 3.12, and
  `pip install .` now builds a real package (declarative `setup.cfg`).

### UI
- **Glass / vibrant refresh** — translucent blurred surfaces over an
  accent-tinted gradient backdrop, glowing accent active states, hover lifts,
  focus rings; light + dark. A **Reduce effects** toggle (Settings) turns off
  blur, the gradient, glows and animations for low-powered machines.

### Earlier in this line
- **Outbound alert channels** — when a Monitor rule (or a log watcher) fires,
  Perch can notify **ntfy / Slack / Discord / a generic webhook** in addition
  to the desktop, so alerts reach you when you're away from the machine.
  Config in `~/.config/perch/notify.json` (chmod 600); "Test all" button.
- **Log-pattern watchers** — define regex rules against the system / user /
  kernel journal or any file; a matching line fires an alert (polled every
  20 s, 5-minute de-dupe). Managed from the Monitor tab.

## 1.0.0 — final

Adds a full **API client** (collections, environments with `{{vars}}`, request
history, **flows** you can run and export to JSON/YAML, and **import** from
Postman collections/environments, `curl`, or raw HTTP), a **pluggable LLM
provider** (local Claude CLI / Anthropic API / OpenAI-compatible / Ollama) for
the AI tab and health report, universal **runtime/version switching** via
rustup and `update-alternatives`, and a **critical-log panel** on the Overview
that surfaces recent system errors needing attention. The standalone HTTP
tester was folded into the API client.

### Details

First release. Restructured from a single-file prototype into an installable
package with Docker and `.deb` distribution.

### Features
- **System** — live CPU / memory / GPU / disk-I/O / temperature / network
  charts, per-core load, battery health, a hardware panel, process manager
  with a detail inspector, log viewer, kernel tunables, package updates.
- **Storage & files** — disk usage + folder-size analyzer, whole-system file
  search (with regex), in-dashboard preview (images, PDF, video, audio, Word,
  Excel), an in-page text editor with vim mode + sketch canvas, bulk trash,
  one-click cache cleanup.
- **Developer** — listening-ports view with kill-by-port + speed test, Docker
  container control, systemd services, runtime versions, and a toolbox: HTTP
  request tester, JSON/YAML tools, regex tester, text diff, cron explainer,
  color/case converters, secret generator, website preview.
- **Assistant** — chat backed by the local Claude CLI, with an optional live
  system snapshot.
- **Settings** — brightness, volume, Bluetooth, Wi-Fi, theme, wallpaper.
- **Packages** — search and install/remove via apt + snap.
- Command palette (Ctrl+K), grouped sidebar, light/dark theme.
