#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# tto Remote Mode — keep the orchestrator running & reachable from your phone
# Usage:  ./remote.sh            (start/verify everything, print phone URL)
#         ./remote.sh --awake    (also prevent macOS sleep, until Ctrl+C)
#         ./remote.sh --stop     (stop the keep-awake loop + sidecar)
# ─────────────────────────────────────────────────────────────────────────────
set -u
TTO_WEB="${TTO_WEB_HOME:-$HOME/tto-web}"
PORT=8765

log() { printf '\033[1;36m[tto]\033[0m %s\n' "$*"; }

# ── Stop mode: kill the sidecar + any orphaned TTO ports ──────────────────
if [[ "${1:-}" == "--stop" ]]; then
  log "stopping all tto sidecar processes on port $PORT..."
  # Kill any sidecar (python main.py) listening on the TTO port
  PIDS=$(lsof -ti :$PORT -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$PIDS" ]]; then
    echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
    sleep 2
    # Force-kill stragglers
    PIDS=$(lsof -ti :$PORT -sTCP:LISTEN 2>/dev/null || true)
    if [[ -n "$PIDS" ]]; then
      echo "$PIDS" | xargs kill -9 2>/dev/null || true
    fi
    log "sidecar stopped"
  else
    log "no sidecar running on port $PORT"
  fi
  exit 0
fi

# ── Start mode ─────────────────────────────────────────────────────────────

# 0) Kill orphaned sidecar processes from previous runs to avoid port conflicts
STALE_PIDS=$(lsof -ti :$PORT -sTCP:LISTEN 2>/dev/null || true)
if [[ -n "$STALE_PIDS" ]]; then
  log "killing stale sidecar process(es) on port $PORT: $STALE_PIDS"
  echo "$STALE_PIDS" | xargs kill -TERM 2>/dev/null || true
  sleep 2
  # Force-kill if still alive
  STALE_PIDS=$(lsof -ti :$PORT -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$STALE_PIDS" ]]; then
    echo "$STALE_PIDS" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
fi

# 1) Sidecar (FastAPI on 127.0.0.1:8765 — serves the web UI + API + WS state)
if lsof -i :$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  log "sidecar already listening on :$PORT"
else
  log "starting sidecar (python main.py → 127.0.0.1:$PORT)"
  (cd "$TTO_WEB/backend" && nohup "$TTO_WEB/venv/bin/python" main.py > /tmp/sidecar.log 2>&1 &)
  sleep 3
fi
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && log "sidecar healthy" || { log "sidecar FAILED — see /tmp/sidecar.log"; exit 1; }

# 2) Desktop app (holds the native PTY sessions + delivers tasks via the watcher)
APP="$TTO_WEB/frontend/src-tauri/target/release/bundle/macos/Task Orchestrator.app"
if pgrep -f "Task Orchestrator.app/Contents/MacOS/tto" >/dev/null 2>&1; then
  log "desktop app already running"
else
  log "launching desktop app (keeps agent sessions alive)"
  open "$APP"
fi

# 3) LAN address to open from your phone
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "?")
log "OPEN THIS FROM YOUR PHONE (same Wi-Fi):  http://$IP:$PORT"
log "  → Workspace / Task Center / Tables / Tokens — full remote control."

# 4) Optional keep-awake
if [[ "${1:-}" == "--awake" ]]; then
  log "preventing sleep (caffeinate) — Ctrl+C to stop"
  caffeinate -dims
fi
