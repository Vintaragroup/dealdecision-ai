#!/usr/bin/env bash
# ingest-climatic-docs.sh
# Bulk-ingest all 28 Climatic PDFs into the DealDecisionAI API.
# Usage: bash scripts/ingest-climatic-docs.sh

set -euo pipefail

DEAL_ID="53a9dc16-e08b-4848-8c75-944e15e320ca"
API_BASE="http://localhost:9001"
DOC_DIR="/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/docs/reference-deal-docs/Climatic"

COUNT=0
SKIP=0
FAIL=0

echo "=== Climatic Document Ingestion ==="
echo "Deal: $DEAL_ID"
echo "Source: $DOC_DIR"
echo ""

while IFS= read -r -d $'\0' FILE; do
  NAME=$(basename "$FILE")

  # Base64-encode the file
  B64=$(base64 < "$FILE" | tr -d '\n')

  # Write payload to a temp file to avoid ARG_MAX limits on large PDFs
  TMPFILE=$(mktemp /tmp/climatic-ingest-XXXXXX.json)
  printf '{"file_buffer":"%s","file_name":"%s","duplicate_policy":"skip"}' "$B64" "$NAME" > "$TMPFILE"

  RESPONSE=$(curl -s -w "\n__HTTP_CODE__%{http_code}__" -X POST \
    "$API_BASE/api/v1/deals/$DEAL_ID/documents/upload" \
    -H "Content-Type: application/json" \
    -d "@$TMPFILE")

  rm -f "$TMPFILE"

  HTTP_CODE=$(echo "$RESPONSE" | grep -o '__HTTP_CODE__[0-9]*__' | sed 's/__HTTP_CODE__//g; s/__//g')
  BODY=$(echo "$RESPONSE" | sed 's/__HTTP_CODE__[0-9]*__//')

  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" || "$HTTP_CODE" == "202" ]]; then
    echo "✅ [$HTTP_CODE] $NAME"
    COUNT=$((COUNT + 1))
  elif [[ "$HTTP_CODE" == "409" ]]; then
    echo "⏭️  [409 skip] $NAME (already exists)"
    SKIP=$((SKIP + 1))
  else
    echo "❌ [$HTTP_CODE] $NAME"
    echo "   Response: $BODY"
    FAIL=$((FAIL + 1))
  fi

done < <(find "$DOC_DIR" -name "*.pdf" -print0 | sort -z)

echo ""
echo "=== Done ==="
echo "  Ingested : $COUNT"
echo "  Skipped  : $SKIP"
echo "  Failed   : $FAIL"
echo "  Total    : $((COUNT + SKIP + FAIL))"

TOTAL=$((COUNT + SKIP + FAIL))
if [[ $TOTAL -gt 0 ]]; then
  SKIP_PCT=$(( (SKIP + FAIL) * 100 / TOTAL ))
  if [[ $SKIP_PCT -gt 20 ]]; then
    echo ""
    echo "⚠️  WARNING: >20% of documents were skipped or failed ($SKIP_PCT%)."
    exit 1
  fi
fi
