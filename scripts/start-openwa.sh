#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Start OpenWA (external WhatsApp gateway) — https://github.com/rmyndharis/OpenWA
# Usage:  ./scripts/start-openwa.sh [path-to-openwa]
# The OpenWA project is a SEPARATE repo; this script only runs it locally.
# ─────────────────────────────────────────────────────────────────────────────
set -u
OPENWA_DIR="${1:-}"
PORT=2785
# Accept either casing of the install dir (macOS filesystems are usually case-insensitive).
if [ -z "$OPENWA_DIR" ]; then
  for cand in "$HOME/OpenWA" "$HOME/openwa"; do
    if [ -d "$cand" ]; then OPENWA_DIR="$cand"; break; fi
  done
fi
if [ -z "$OPENWA_DIR" ]; then
  echo "❌ OpenWA not found. Pass the path: ./scripts/start-openwa.sh /path/to/OpenWA"
  exit 1
fi

if lsof -i :$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ OpenWA already listening on :$PORT"
  exit 0
fi

if [ ! -d "$OPENWA_DIR" ]; then
  echo "❌ OpenWA not found at $OPENWA_DIR"
  echo "   Clone it first:  git clone https://github.com/rmyndharis/OpenWA \"$OPENWA_DIR\""
  exit 1
fi

echo "▶️ Starting OpenWA from $OPENWA_DIR (port $PORT)..."
cd "$OPENWA_DIR"
if [ -f package.json ]; then
  if [ ! -d node_modules ]; then
    echo "   Installing dependencies (first run)..."
    npm install
  fi
  if grep -q '"start:dev"' package.json; then
    nohup npm run start:dev > /tmp/openwa.log 2>&1 &
  else
    nohup npm start > /tmp/openwa.log 2>&1 &
  fi
elif [ -f docker-compose.yml ]; then
  nohup docker compose up -d > /tmp/openwa.log 2>&1 &
else
  echo "❌ No known start method in $OPENWA_DIR"
  exit 1
fi

for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "✅ OpenWA ready on http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 1
done
echo "⚠️ OpenWA did not report healthy in 30s — check /tmp/openwa.log"
exit 1
