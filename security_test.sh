#!/bin/bash
# Loopback security gate for a sidecar started from this tree.
# Usage: TTO_SESSION_TOKEN=... ./security_test.sh
# The token must be the one that process was started with.
set -euo pipefail

BASE="${TTO_BASE:-http://127.0.0.1:8765}"
TOKEN="${TTO_SESSION_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "TTO_SESSION_TOKEN is not set" >&2
  exit 1
fi

code() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

echo "=== Security verification ==="

echo "1. Health without a token"
test "$(code "$BASE/api/health")" = "200"

echo "2. /api/run without a token"
test "$(code -X POST "$BASE/api/run" -H 'Content-Type: application/json' -d '{"command":"echo test"}')" = "401"

echo "3. /api/run with the session token"
run_code="$(code -X POST "$BASE/api/run" -H "X-Task-Orchestrator-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"command":"echo test"}')"
test "$run_code" != "401"

echo "4. /api/serve/start rejects /"
test "$(code -X POST "$BASE/api/serve/start" -H "X-Task-Orchestrator-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"path":"/","port":18920}')" = "403"

echo "5. /api/serve/start rejects \$HOME"
home_json="$(python3 -c 'import json,os; print(json.dumps({"path": os.path.expanduser("~"), "port": 18921}))')"
test "$(code -X POST "$BASE/api/serve/start" -H "X-Task-Orchestrator-Token: $TOKEN" -H 'Content-Type: application/json' -d "$home_json")" = "403"

echo "6. Host header evil.example is rejected"
test "$(code -H 'Host: evil.example' "$BASE/api/health")" = "400"

echo "OK"
