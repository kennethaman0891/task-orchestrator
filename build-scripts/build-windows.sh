#!/usr/bin/env bash
# tto — Windows Build Script (GitHub Actions compatible)
# This script is called by .github/workflows/build-windows.yml

set -euo pipefail

echo "============================================================"
echo "  tto — Windows Build Script"
echo "============================================================"
echo ""

# Check for required tools
echo "[1/5] Checking prerequisites..."
for tool in cargo node npm git; do
    if ! command -v "$tool" &>/dev/null; then
        echo "  ERROR: $tool not found. Install it first."
        exit 1
    fi
    echo "  Found: $(command -v $tool)"
done

echo ""
echo "[2/5] Installing frontend dependencies..."
cd "$(dirname "$0")/../frontend"
npm ci --no-audit --no-fund
echo "  Dependencies installed."

echo ""
echo "[3/5] Building frontend..."
npm run build
echo "  Frontend built."

echo ""
echo "[4/5] Building Tauri Windows app..."
cd src-tauri
cargo tauri build --target x86_64-pc-windows-msvc
echo "  Windows app built."

echo ""
echo "[5/5] Build complete!"
echo ""
echo "Output locations:"
echo "  - MSI Installer: ../../../../target/release/bundle/msi/tto_0.1.0_x64-setup.exe"
echo "  - NSIS Installer: ../../../../target/release/bundle/nsis/tto_0.1.0_x64/tto.exe"
echo ""
echo "To sign the installer (recommended):"
echo '  signtool sign /fd SHA256 /tr http://timestamp.sectigo.com /td SHA256 \\'
echo '    "../../../../target/release/bundle/msi/tto_0.1.0_x64-setup.exe"'
echo ""
