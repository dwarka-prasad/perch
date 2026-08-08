# Changelog

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
