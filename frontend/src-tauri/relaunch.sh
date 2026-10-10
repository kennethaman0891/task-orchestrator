#!/usr/bin/env bash
# Rebuild + reinstall Task Orchestrator.app reliably.
#
# IMPORTANT: `cargo build --release` only refreshes `target/release/tto`.
# The `.app` bundle under `target/release/bundle/macos/` is a STALE artifact
# from the last `tauri build` — copying it straight to /Applications ships
# yesterday's binary. This script always pushes the FRESH binary into the
# bundle and into /Applications, re-signs ad-hoc, and relaunches the app.
#
# After building, it also copies the bundled backend (Python source) into the
# .app's Contents/Resources/backend/ so the sidecar runs independently of the
# development repository.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # frontend/
TAURI="$ROOT/src-tauri"
APP="/Applications/Task Orchestrator.app"
BUNDLED_BACKEND="$TAURI/resources/backend"

# 1. Frontend bundle (white-screen-safe: no terser, minify off).
echo "── vite build ──"
(cd "$ROOT" && npx vite build)

# 2. Rust release build (re-embeds `dist/` via tauri::generate_context!).
echo "── cargo build --release ──"
(cd "$TAURI" && cargo build --release)

BIN="$TAURI/target/release/tto"
BUNDLE_APP="$TAURI/target/release/bundle/macos/Task Orchestrator.app"

# 3. Refresh the binary in BOTH the internal bundle and /Applications.
echo "── installing binary ──"
mkdir -p "$BUNDLE_APP/Contents/MacOS"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$BUNDLE_APP/Contents/MacOS/tto"
cp "$BIN" "$APP/Contents/MacOS/tto"

# 4. Copy bundled backend into the .app bundle.
#    This makes the app self-contained: the Rust sidecar will find backend/main.py
#    at Contents/Resources/backend/main.py without needing the dev repo on disk.
echo "── bundling backend ──"
BUNDLE_RESOURCES="$BUNDLE_APP/Contents/Resources"
APP_RESOURCES="$APP/Contents/Resources"
mkdir -p "$BUNDLE_RESOURCES/backend"
mkdir -p "$APP_RESOURCES/backend"
rsync -a --delete "$BUNDLED_BACKEND/" "$BUNDLE_RESOURCES/backend/"
rsync -a --delete "$BUNDLED_BACKEND/" "$APP_RESOURCES/backend/"
# Also copy any top-level resources (downloads.html, etc.)
for item in "$TAURI/resources/"*; do
  [ -f "$item" ] && cp "$item" "$BUNDLE_RESOURCES/" && cp "$item" "$APP_RESOURCES/"
done

# 5. Re-sign both internal bundle and /Applications bundles
echo "── codesign ──"
codesign --force --deep --sign - "$BUNDLE_APP"
codesign --force --deep --sign - "$APP"
rm -rf "/Applications/tto.app"
cp -R "$APP" "/Applications/tto.app"
codesign --force --deep --sign - "/Applications/tto.app"

# 6. Restart: kill old app + sidecar, relaunch fresh.
#    Sidecar is killed BY PORT (not process-name) so orphaned sidecars with the
#    wrong TCC attribution (reparented to launchd -> permission-denied on
#    ~/Documents / ~/Desktop) can never survive a relaunch.
echo "── restarting tto ──"
pkill -f "Contents/MacOS/tto" 2>/dev/null || true
pkill -f "backend/main.py" 2>/dev/null || true
lsof -tiTCP:8765 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
sleep 2
open "$APP"

echo "── done. new pid: ──"
sleep 5
ps aux | grep "Task Orchestrator.app/Contents/MacOS/tto" | grep -v grep | awk '{print $2, $9}'

# 7. Post-flight: wait for the sidecar, then verify it can list every
#    workspace folder that lives under a macOS-TCC-protected root
#    (~/Documents, ~/Desktop, ~/Downloads). If any is "Permission denied",
#    clear the stale TCC records for tto and reclaim the port so the app's
#    internal supervisor respawns a correctly-attributed sidecar.
echo "── post-flight permission check ──"
# Use python3 directly since we no longer depend on a specific venv location
PY="python3"
for i in $(seq 1 30); do
  curl -sf -m 2 http://127.0.0.1:8765/api/health >/dev/null 2>&1 && break
  sleep 1
done
"$PY" - <<'PYEOF'
import json, subprocess, sys, time, urllib.parse, urllib.request

BASE = "http://127.0.0.1:8765"
APP_ID = "com.kennethaman.tto"


def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=3) as r:
            return r.read().decode()
    except Exception:
        return None


def tcc_protected(p):
    return any(("/%s/" % d) in p for d in ("Documents", "Desktop", "Downloads"))


def list_denied(ws):
    denied = []
    for w in ws:
        p = (w.get("projectPath") or "").rstrip("/")
        if not tcc_protected(p):
            continue
        body = get("/api/files?path=" + urllib.parse.quote(p))
        if body is None or "Permission denied" in body:
            denied.append(p)
    return denied


try:
    raw = get("/api/workspaces")
    ws = json.loads(raw) if raw else []
    if not isinstance(ws, list):
        ws = ws.get("workspaces", [])
    denied = list_denied(ws)
except Exception as e:
    print("  ! could not reach sidecar: %s" % e)
    sys.exit(1)

if not denied:
    print("  ok: all workspace folders readable by the sidecar")
    sys.exit(0)

print("  ! permission-denied workspace folders found:")
for p in denied:
    print("    - " + p)

# Repair: clear stale TCC records for tto and reclaim the port. The app's
# supervisor respawns a fresh, correctly-attributed sidecar within ~20 s.
for svc in (
    "SystemPolicyAllFiles",
    "SystemPolicyDocumentsFolder",
    "SystemPolicyDesktopFolder",
    "SystemPolicyDownloadsFolder",
):
    subprocess.run(["tccutil", "reset", svc, APP_ID], capture_output=True)
subprocess.run(
    "lsof -tiTCP:8765 -sTCP:LISTEN | xargs kill 2>/dev/null || true",
    shell=True,
)
print("  repaired: cleared TCC records + freed port 8765 — app supervisor will respawn")

# Re-verify up to 40 s.
ok = False
for _ in range(40):
    time.sleep(1)
    raw = get("/api/workspaces")
    if not raw:
        continue
    try:
        ws = json.loads(raw)
        if not isinstance(ws, list):
            ws = ws.get("workspaces", [])
        if not list_denied(ws):
            ok = True
            break
    except Exception:
        continue

print("  ok: workspace folders readable after repair" if ok else
      "  STILL DENIED — open System Settings -> Privacy & Security -> Full Disk Access and add Task Orchestrator.app")
sys.exit(0 if ok else 1)
PYEOF
