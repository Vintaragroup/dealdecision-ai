#!/usr/bin/env bash
##
## promote-admin.sh — Promote a user to platform admin via the bootstrap endpoint.
##
## Usage:
##   ./scripts/promote-admin.sh <clerk_user_id>
##
## Examples:
##   ./scripts/promote-admin.sh user_2abc123
##
## How to find your Clerk user ID:
##   Option A — Clerk dashboard (preferred):
##     1. Go to https://dashboard.clerk.com
##     2. Select your app → Users
##     3. Search for ryan@vintaragroup.com
##     4. Copy the "User ID" (starts with "user_")
##
##   Option B — From an active browser session:
##     1. Log into the app with real Clerk auth
##     2. Open browser DevTools → Application → Cookies → find "__session"
##     3. Copy that cookie value and run:
##          echo "<cookie_value>" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sub',''))"
##     4. The "sub" field is your Clerk user ID
##
##   Option C — From GET /api/v1/me/identity (when real Clerk auth is active):
##     Pass your Clerk session Bearer token to: GET /api/v1/me/identity
##

set -euo pipefail

CLERK_USER_ID="${1:-}"
API_URL="${API_URL:-http://localhost:9001}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"

##
## Validate input
##
if [[ -z "$CLERK_USER_ID" ]]; then
  echo "ERROR: clerk_user_id is required" >&2
  echo ""
  echo "Usage: $0 <clerk_user_id>"
  echo ""
  echo "Find your Clerk user ID at: https://dashboard.clerk.com → Users"
  exit 1
fi

echo "Bootstrapping admin for: $CLERK_USER_ID"
echo "API URL: $API_URL"
echo ""

##
## Build headers — use ADMIN_TOKEN if set, else rely on dev bypass
##
HEADERS=('-H' 'Content-Type: application/json')
if [[ -n "$ADMIN_TOKEN" ]]; then
  HEADERS+=('-H' "x-admin-token: $ADMIN_TOKEN")
  echo "Using ADMIN_TOKEN authentication"
else
  echo "No ADMIN_TOKEN set — relying on dev auth bypass (DISABLE_CLERK_AUTH=1 must be active)"
fi

echo ""

##
## Call bootstrap endpoint
##
RESPONSE=$(curl -sf "${HEADERS[@]}" \
  -X POST \
  -d "{\"clerk_user_id\": \"$CLERK_USER_ID\"}" \
  "${API_URL}/api/v1/admin/bootstrap-first-admin" 2>&1) || {
  echo "ERROR: bootstrap call failed" >&2
  echo "Response: $RESPONSE" >&2
  exit 1
}

echo "Bootstrap response:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

##
## Verify platform_access row
##
echo ""
echo "Verifying via GET /api/v1/admin/platform-access..."
VERIFY=$(curl -sf "${HEADERS[@]}" "${API_URL}/api/v1/admin/platform-access" 2>&1) || {
  echo "WARNING: Could not verify via admin API" >&2
  exit 0
}

MATCH=$(echo "$VERIFY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data.get('records', []):
    if r.get('clerk_user_id') == '$CLERK_USER_ID':
        print(json.dumps(r, indent=2))
" 2>/dev/null)

if [[ -n "$MATCH" ]]; then
  echo ""
  echo "SUCCESS — platform_access row:"
  echo "$MATCH"
  IS_ADMIN=$(echo "$MATCH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('is_admin', False))" 2>/dev/null)
  echo ""
  if [[ "$IS_ADMIN" == "True" ]]; then
    echo "✓ is_admin = true confirmed"
  else
    echo "✗ is_admin is NOT true — check the response above"
    exit 1
  fi
else
  echo "WARNING: Could not find $CLERK_USER_ID in platform-access records"
fi
