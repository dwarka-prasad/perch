# Changelog

## 1.0.0

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
