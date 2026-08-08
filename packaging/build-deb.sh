#!/usr/bin/env bash
# Build a Perch .deb without external tooling (uses dpkg-deb).
#   ./packaging/build-deb.sh   ->   dist/perch_<version>_all.deb
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/^Version: //p' "$ROOT/packaging/debian/control")"
STAGE="$(mktemp -d)"
OUT="$ROOT/dist"
mkdir -p "$OUT"

# --- filesystem layout -----------------------------------------------------
install -d "$STAGE/DEBIAN" \
           "$STAGE/usr/lib/perch/perch" \
           "$STAGE/usr/bin" \
           "$STAGE/usr/share/applications" \
           "$STAGE/usr/share/icons/hicolor/scalable/apps"

cp -r "$ROOT/src/perch/." "$STAGE/usr/lib/perch/perch/"
find "$STAGE/usr/lib/perch" -name __pycache__ -type d -prune -exec rm -rf {} +
cp "$ROOT/packaging/debian/control" "$STAGE/DEBIAN/control"
install -m 0755 "$ROOT/packaging/debian/postinst" "$STAGE/DEBIAN/postinst"
install -m 0755 "$ROOT/packaging/debian/prerm"    "$STAGE/DEBIAN/prerm"
cp "$ROOT/packaging/perch.desktop" "$STAGE/usr/share/applications/perch.desktop"
cp "$ROOT/packaging/perch.svg" \
   "$STAGE/usr/share/icons/hicolor/scalable/apps/perch.svg"

# --- console-script wrappers ----------------------------------------------
cat > "$STAGE/usr/bin/perch" <<'EOF'
#!/bin/sh
exec env PYTHONPATH=/usr/lib/perch python3 -m perch "$@"
EOF
cat > "$STAGE/usr/bin/perch-desktop" <<'EOF'
#!/bin/sh
exec env PYTHONPATH=/usr/lib/perch python3 -m perch.desktop "$@"
EOF
chmod 0755 "$STAGE/usr/bin/perch" "$STAGE/usr/bin/perch-desktop"

# --- build -----------------------------------------------------------------
DEB="$OUT/perch_${VERSION}_all.deb"
dpkg-deb --root-owner-group --build "$STAGE" "$DEB"
rm -rf "$STAGE"
echo "Built $DEB"
dpkg-deb --info "$DEB" | sed -n '1,20p'
