# Roadmap

Perch 1.5 covers monitoring, security, storage, a developer toolbox, the desktop and an AI assistant on a single Linux machine.
This is what comes next. Each item is a GitHub issue; **help wanted** ones are open to anyone and **good first issue** marks small, well-scoped starts. Comment on an issue to claim it.

Milestones: [1.6 Reach](https://github.com/dwarka-prasad/perch/milestone/1) · [1.7 Observe more](https://github.com/dwarka-prasad/perch/milestone/2) · [2.0 Extend](https://github.com/dwarka-prasad/perch/milestone/3)

## 1.6 Reach

_Install anywhere: PyPI, rpm/AUR/Flatpak, KDE support, docs site, CI with browser tests._ Target: 2026-10-31.

| # | Task | Open to |
|---|---|---|
| [#5](https://github.com/dwarka-prasad/perch/issues/5) | Publish to PyPI so `pipx install perch-dashboard` works | help wanted |
| [#6](https://github.com/dwarka-prasad/perch/issues/6) | Build .rpm and an AUR package in the release workflow | help wanted |
| [#7](https://github.com/dwarka-prasad/perch/issues/7) | Flatpak or AppImage for the native desktop window | maintainer |
| [#8](https://github.com/dwarka-prasad/perch/issues/8) | KDE Plasma support for Settings and Tweaks | help wanted |
| [#9](https://github.com/dwarka-prasad/perch/issues/9) | Run the headless-Chrome frontend suite in CI | good first issue, help wanted |
| [#10](https://github.com/dwarka-prasad/perch/issues/10) | Docs site: keep screenshots current automatically | help wanted |
| [#11](https://github.com/dwarka-prasad/perch/issues/11) | Read-only sharing tokens and multiple tokens | maintainer |
| [#22](https://github.com/dwarka-prasad/perch/issues/22) | Accessibility audit of the dashboard | good first issue, help wanted |

## 1.7 Observe more

_Deeper monitoring: more GPUs, SMART history, Prometheus endpoint, fleet alerts, more channels._ Target: 2026-12-31.

| # | Task | Open to |
|---|---|---|
| [#12](https://github.com/dwarka-prasad/perch/issues/12) | GPU metrics for AMD (amdgpu sysfs) and Intel (i915) | help wanted |
| [#13](https://github.com/dwarka-prasad/perch/issues/13) | SMART history and disk failure prediction | maintainer |
| [#14](https://github.com/dwarka-prasad/perch/issues/14) | Prometheus /metrics endpoint | help wanted |
| [#15](https://github.com/dwarka-prasad/perch/issues/15) | Fleet: aggregate alerts and a fleet-wide digest | maintainer |
| [#16](https://github.com/dwarka-prasad/perch/issues/16) | More notification channels: Telegram, Matrix, email (SMTP), Gotify | good first issue, help wanted |
| [#17](https://github.com/dwarka-prasad/perch/issues/17) | Process detail: per-process history and CPU/memory sparklines | maintainer |

## 2.0 Extend

_Widget plugin system, read-only sharing tokens, mobile layout, i18n, macOS._ Target: 2027-03-31.

| # | Task | Open to |
|---|---|---|
| [#18](https://github.com/dwarka-prasad/perch/issues/18) | Widget plugin system: drop a folder in ~/.config/perch/widgets | help wanted |
| [#19](https://github.com/dwarka-prasad/perch/issues/19) | Mobile-friendly layout and PWA manifest | help wanted |
| [#20](https://github.com/dwarka-prasad/perch/issues/20) | Internationalisation of the UI | maintainer |
| [#21](https://github.com/dwarka-prasad/perch/issues/21) | macOS support for the monitoring core | maintainer |

## Principles that do not change

- Runs as you, binds to 127.0.0.1, needs a token. Privileged actions go through `pkexec`.
- Python stdlib + psutil on the backend; framework-free HTML/CSS/JS with no build step on the front.
- Integrations that are not installed hide themselves. Nothing phones home.

## Not planned

- Windows support.
- A hosted or cloud version. Perch is for your own machines.
