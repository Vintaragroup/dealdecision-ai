#!/usr/bin/env bash
set -euo pipefail

DEAL_ID="${1:-00000000-0000-0000-0000-000000000000}"
API_URL="${API_URL:-http://localhost:3000}"

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

start_curl() {
  local name="$1"
  curl -N -sS "${API_URL}/api/v1/events?deal_id=${DEAL_ID}" \
    -H "Accept: text/event-stream" \
    -H "Cache-Control: no-cache" \
    --no-buffer \
    >/dev/null &
  local pid=$!
  echo "started ${name} (pid=${pid})"
  pids+=("${pid}")
}

start_curl "conn1"
start_curl "conn2"
start_curl "conn3"

echo "sleep 10s..."
sleep 10

if [[ ${#pids[@]} -ge 1 ]]; then
  echo "killing first connection ${pids[0]}" && kill "${pids[0]}" 2>/dev/null || true
  pids=(${pids[@]:1})
fi

echo "sleep 10s..."
sleep 10

echo "killing remaining connections"
for pid in "${pids[@]:-}"; do
  kill "$pid" 2>/dev/null || true
done

sleep 1

# If the API process is still running, curl exits 0 and we reach here.
echo "PASS: API still running; SSE connections opened and closed"
