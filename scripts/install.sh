#!/usr/bin/env bash
# Per-user install (no root): editable package + systemd user service + launcher.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pip install --user -e "$ROOT" || pip install --user "$ROOT"

mkdir -p ~/.config/systemd/user \
         ~/.local/share/applications \
         ~/.local/share/icons/hicolor/scalable/apps

# service points at the module via the current python
cat > ~/.config/systemd/user/perch.service <<EOF
[Unit]
Description=Perch dashboard (http://127.0.0.1:8090)

[Service]
ExecStart=$(command -v python3) -m perch
Restart=on-failure

[Install]
WantedBy=default.target
EOF

cp "$ROOT/packaging/perch.desktop" ~/.local/share/applications/perch.desktop
cp "$ROOT/packaging/perch.svg" \
   ~/.local/share/icons/hicolor/scalable/apps/perch.svg
update-desktop-database ~/.local/share/applications 2>/dev/null || true

systemctl --user daemon-reload
systemctl --user enable --now perch
echo "Perch installed for $USER. Open it from your app menu, or:  perch-desktop"
