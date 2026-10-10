#!/bin/bash
# Check OpenWA + TTO remote status.
# Usage:  ./scripts/check-openwa.sh
set -u
PORT=2785
TTO_PORT=8765

echo "── OpenWA ──"
if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "✅ OpenWA reachable on :$PORT"
  SESSIONS=$(curl -sf "http://127.0.0.1:$PORT/api/sessions" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else len(d.get('sessions',d.get('data',[]))))" 2>/dev/null || echo "?")
  echo "   Sessions: $SESSIONS"
else
  echo "❌ OpenWA NOT reachable on :$PORT (remote control unavailable — TTO still works)"
fi

echo
echo "── TTO sidecar ──"
if curl -sf "http://127.0.0.1:$TTO_PORT/api/health" >/dev/null 2>&1; then
  echo "✅ TTO sidecar healthy on :$TTO_PORT"
else
  echo "❌ TTO sidecar NOT running"
fi

echo
echo "── TTO remote subsystem ──"
curl -sf "http://127.0.0.1:$TTO_PORT/api/remote/status" 2>/dev/null | python3 -m json.tool 2>/dev/null \
  || echo "Remote endpoint not responding (TTO_REMOTE_ENABLED=false or sidecar down)."
