#!/usr/bin/env bash
# Per-user install (no root, no pip): run Perch from this checkout via a
# systemd user service, and add an app-menu launcher. Edits to the source are
# picked up on the next restart (`systemctl --user restart perch`).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src"
PY="$(command -v python3)"

mkdir -p ~/.config/systemd/user \
         ~/.local/share/applications \
         ~/.local/share/icons/hicolor/scalable/apps

cat > ~/.config/systemd/user/perch.service <<EOF
[Unit]
Description=Perch dashboard (http://127.0.0.1:9080)

[Service]
Environment=PYTHONPATH=$SRC
ExecStart=$PY -m perch
Restart=on-failure

[Install]
WantedBy=default.target
EOF

# launcher runs the native desktop window from this checkout
sed "s|^Exec=.*|Exec=env PYTHONPATH=$SRC $PY -m perch.desktop|" \
    "$ROOT/packaging/perch.desktop" > ~/.local/share/applications/perch.desktop
cp "$ROOT/packaging/perch.svg" \
   ~/.local/share/icons/hicolor/scalable/apps/perch.svg
update-desktop-database ~/.local/share/applications 2>/dev/null || true
gtk-update-icon-cache -qtf ~/.local/share/icons/hicolor 2>/dev/null || true

systemctl --user daemon-reload
systemctl --user enable --now perch
echo "Perch installed for $USER at $ROOT."
echo "Open it from your app menu, or run:  env PYTHONPATH=$SRC $PY -m perch.desktop"
