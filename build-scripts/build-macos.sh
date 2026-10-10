#!/bin/bash
# tto — macOS Build Script
# Run this on macOS to build the DMG installer.

set -euo pipefail

echo "============================================================"
echo "  tto — macOS Build Script"
echo "============================================================"
echo ""

# Check for required tools
echo "[1/4] Checking prerequisites..."
for tool in cargo node npm git; do
    if ! command -v "$tool" &>/dev/null; then
        echo "  ERROR: $tool not found."
        exit 1
    fi
done
echo "  All tools found."

echo ""
echo "[2/4] Installing frontend dependencies..."
cd "$(dirname "$0")/../frontend"
npm ci --no-audit --no-fund
echo "  Dependencies installed."

echo ""
echo "[3/4] Building frontend..."
npm run build
echo "  Frontend built."

echo ""
echo "[4/4] Building Tauri macOS app..."
cd src-tauri
cargo tauri build
echo "  macOS app built."

echo ""
echo "============================================================"
echo "  Build complete!"
echo "============================================================"
echo ""
echo "Output:"
echo "  DMG: target/release/bundle/dmg/tto_0.1.0_aarch64.dmg"
echo "  APP: target/release/bundle/macos/Task Orchestrator.app"
echo ""
echo "To notarize the DMG (required for distribution):"
echo '  xcrun notarytool submit target/release/bundle/dmg/tto_0.1.0_aarch64.dmg \\'
echo '    --apple-id "your@apple.id" \\'
echo '    --password "@env:NOTARY_PASSWORD" \\'
echo '    --team-id "YOUR_TEAM_ID" \\'
echo '    --wait'
echo ""
echo "To staple the notarization ticket:"
echo 'xcrun stapler staple target/release/bundle/macos/Task Orchestrator.app'
echo ""
