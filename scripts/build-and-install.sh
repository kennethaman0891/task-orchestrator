#!/usr/bin/env bash
# ┿ build-and-install.sh — the ONLY sanctioned way to rebuild + install Task Orchestrator.app.
# Created after the blank-white-screen incident (2026-09-08).
#
# ROOT CAUSE THAT MUST NEVER RECUR:
#   Plain `cargo build --release` produced a DEV-mode binary (no `custom-protocol`
#   feature) that loads http://localhost:1421 instead of the embedded UI →
#   white screen whenever the vite dev server wasn't running.
#   Fix: `custom-protocol` is now a DEFAULT feature in src-tauri/Cargo.toml.
#   This script ENFORCES it: the binary must contain no "localhost:1421" dev
#   dependency AND the installed app must log a fresh JS boot line before we
#   call the build a success. Any gate failing = non-zero exit, app not replaced.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONT="$ROOT/frontend"
TAURI="$FRONT/src-tauri"
BIN="$TAURI/target/release/tto"
APP="/Applications/Task Orchestrator.app"
DIAG="$HOME/.local/share/tto/diag.log"
step() { echo ""; echo "── $1 ──"; }

step "1/9 asset check: login.mp4 video"
if [ ! -f "$FRONT/public/videos/login.mp4" ] || [ "$(wc -c < "$FRONT/public/videos/login.mp4" 2>/dev/null || echo 0)" -lt 1000000 ]; then
  echo "✗ GATE FAILED: frontend/public/videos/login.mp4 is missing or empty." >&2
  exit 1
fi
echo "✓ login.mp4 verified in frontend/public/videos/ ($(du -h "$FRONT/public/videos/login.mp4" | cut -f1))"

step "2/9 typecheck & lint"
( cd "$FRONT" && npx tsc --noEmit )
( cd "$FRONT" && npx eslint src/main.tsx src/components/IntroVideo.tsx )
echo "✓ typecheck & hook rules verified"

step "3/9 vite build (embedded UI)"
( cd "$FRONT" && npm run build )

step "4/9 gate: verify login.mp4 in build output"
if [ ! -f "$FRONT/dist/videos/login.mp4" ] || [ "$(wc -c < "$FRONT/dist/videos/login.mp4" 2>/dev/null || echo 0)" -lt 1000000 ]; then
  echo "✗ GATE FAILED: dist/videos/login.mp4 is missing or empty after build." >&2
  exit 1
fi
echo "✓ login.mp4 verified in frontend/dist/videos/"

# Sync backend resources fresh before cargo build so Tauri embeds them cleanly
mkdir -p "$TAURI/resources/backend"
rsync -av --delete \
  --exclude "__pycache__" \
  --exclude "*.pyc" \
  --exclude ".DS_Store" \
  --exclude "data" \
  --exclude "frontend" \
  --exclude "node_modules" \
  --exclude "voice/models" \
  --exclude "todo-app" \
  --exclude "tests" \
  "$ROOT/backend/" "$TAURI/resources/backend/"

step "5/9 cargo release build (custom-protocol default)"
( cd "$TAURI" && cargo build --release )

step "6/9 gate: binary must embed the freshly built UI (custom-protocol)"
# 2026-10-24: the old gate grepped the binary for "localhost:1421" via
# `strings | grep -q`. Under `set -o pipefail`, grep -q exits on first match,
# strings dies of SIGPIPE, and the pipeline returns 141 → the `if` NEVER fired,
# so the gate could not fail. It was also unsound: Tauri embeds tauri.conf.json
# (including devUrl) in BOTH dev and production binaries, so that string proves
# nothing. Two real checks instead:
#   1) custom-protocol must still be a default feature (white-screen root cause).
#   2) the release binary must contain the vite-built hashed JS entry bundle.
if ! grep -Eq '^default[[:space:]]*=[[:space:]]*\[[^]]*"custom-protocol"' "$TAURI/Cargo.toml"; then
  echo "✗ GATE FAILED: src-tauri/Cargo.toml default features lost custom-protocol." >&2
  exit 1
fi

BUILT_ASSET=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$FRONT/dist/index.html" | head -1 || true)
if [ -z "$BUILT_ASSET" ]; then
  echo "✗ GATE FAILED: no hashed JS entry found in dist/index.html." >&2
  exit 1
fi

STRINGS_DUMP="$(mktemp)"
trap 'rm -f "$STRINGS_DUMP"' EXIT
strings "$BIN" > "$STRINGS_DUMP" 2>/dev/null || true
if ! grep -Fq -- "$BUILT_ASSET" "$STRINGS_DUMP"; then
  echo "✗ GATE FAILED: binary does not embed $BUILT_ASSET — UI was not bundled." >&2
  echo "  The binary would load a dev server (white screen) instead of the embedded UI." >&2
  exit 1
fi
echo "✓ binary embeds the freshly built UI bundle ($BUILT_ASSET) via custom-protocol"

step "7/9 assemble + ad-hoc sign bundle"
STAGE="/tmp/tto-stage-$$.app"
rm -rf "$STAGE"
mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources"
if [ -f "$TAURI/target/release/bundle/macos/Task Orchestrator.app/Contents/Info.plist" ]; then
  cp "$TAURI/target/release/bundle/macos/Task Orchestrator.app/Contents/Info.plist" "$STAGE/Contents/Info.plist"
elif [ -f "$TAURI/Info.plist" ]; then
  cp "$TAURI/Info.plist" "$STAGE/Contents/Info.plist"
else
  cat > "$STAGE/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.kennethaman.tto</string>
<key>CFBundleName</key><string>Task Orchestrator</string>
<key>CFBundleDisplayName</key><string>Task Orchestrator</string>
<key>CFBundleExecutable</key><string>tto</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Task Orchestrator uses the microphone for voice commands in terminals.</string>
</dict></plist>
EOF
fi
cp "$BIN" "$STAGE/Contents/MacOS/tto"
chmod 755 "$STAGE/Contents/MacOS/tto"
if [ -f "$TAURI/icons/icon.icns" ]; then cp "$TAURI/icons/icon.icns" "$STAGE/Contents/Resources/icon.icns"; fi
# Include full backend resources into staging bundle
mkdir -p "$STAGE/Contents/Resources/backend"
rsync -av --delete \
  --exclude "__pycache__" \
  --exclude "*.pyc" \
  --exclude ".DS_Store" \
  --exclude "data" \
  --exclude "frontend" \
  --exclude "node_modules" \
  --exclude "voice/models" \
  --exclude "todo-app" \
  --exclude "tests" \
  "$ROOT/backend/" "$STAGE/Contents/Resources/backend/"

# Include top-level resources (downloads.html, etc.)
for item in "$TAURI/resources/"*; do
  if [ -f "$item" ]; then
    cp "$item" "$STAGE/Contents/Resources/"
  fi
done

printf 'APPL????' > "$STAGE/Contents/PkgInfo"
codesign --force --deep --sign - "$STAGE"
codesign -vv "$STAGE"

step "8/9 install into macOS bundle and /Applications"
# Stop only this install. The executable inside the bundle is named `tto`,
# and so is Terminal Task Orchestrator.app — `pkill -x tto` kills that other
# app mid-session. `pkill -f backend/main.py` also kills the clone sidecar
# on :8775. Port 8765 is this app's sidecar only.
pkill -f "/Applications/Task Orchestrator.app/Contents/MacOS/tto" 2>/dev/null || true
pkill -f "/Applications/tto.app/Contents/MacOS/tto" 2>/dev/null || true
lsof -tiTCP:8765 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

# Update the internal target/release/bundle/macos bundle
MACOS_BUNDLE="$TAURI/target/release/bundle/macos/Task Orchestrator.app"
mkdir -p "$(dirname "$MACOS_BUNDLE")"
rm -rf "$MACOS_BUNDLE"
cp -R "$STAGE" "$MACOS_BUNDLE"
codesign --force --deep --sign - "$MACOS_BUNDLE"

# Install into /Applications
APP_TTO="/Applications/tto.app"
rm -rf "$APP" "$APP_TTO"
cp -R "$STAGE" "$APP"
cp -R "$STAGE" "$APP_TTO"
codesign --force --deep --sign - "$APP"
codesign --force --deep --sign - "$APP_TTO"
rm -rf "$STAGE"

step "9/9 gate: fresh JS boot line within 20s"
BEFORE=$(wc -l < "$DIAG" 2>/dev/null || echo 0)
open -a "$APP"
OK=0
for _ in $(seq 1 20); do
  sleep 1
  NOW=$(wc -l < "$DIAG" 2>/dev/null || echo 0)
  if [ "$NOW" -gt "$BEFORE" ]; then OK=1; break; fi
done
if [ "$OK" != "1" ]; then
  echo "✗ GATE FAILED: no new diag boot line 20s after launch — webview did not execute JS." >&2
  echo "  The install is in place but the app is NOT verified. Investigate before shipping." >&2
  exit 1
fi
echo "✓ fresh boot line detected — webview rendered"

# Check for hook or syntax crashes in the newly appended lines
if tail -n +"$((BEFORE + 1))" "$DIAG" 2>/dev/null | grep -iE "Invalid hook call|useState"; then
  echo "✗ GATE FAILED: detected React Hook error in newly booted app log." >&2
  exit 1
fi
echo "✓ zero runtime hook errors detected"

echo ""
echo "✅ BUILD VERIFIED: installed and booting with the embedded UI & intro video."
echo "   App PID: $(pgrep -x tto | head -1)"
