#!/bin/bash
# Stop the locally running OpenWA service (external — TTO keeps working).
set -u
PORT=2785

PID=$(lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null | head -1)
if [ -z "$PID" ]; then
  echo "OpenWA is not running on :$PORT"
  exit 0
fi
echo "Stopping OpenWA (pid $PID)..."
kill -TERM "$PID" 2>/dev/null || true
for _ in $(seq 1 10); do
  lsof -ti tcp:$PORT -sTCP:LISTEN >/dev/null 2>&1 || { echo "✅ OpenWA stopped"; exit 0; }
  sleep 0.5
done
echo "⚠️ OpenWA still running — sending KILL"
kill -9 "$PID" 2>/dev/null || true
