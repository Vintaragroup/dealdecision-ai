#!/bin/bash

# Mock Data & Incorrect Text Audit Script
# Generates a systematic report of:
# 1. Hardcoded mock data
# 2. Incorrect/placeholder text
# 3. API integration gaps
# 4. Data discrepancies

OUTPUT_FILE="AUDIT_REPORT.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

cat > "$OUTPUT_FILE" << 'EOF'
# Mock Data & Incorrect Text Audit Report

**Generated:** _TIMESTAMP_

---

## Summary

This report identifies:
- **Hardcoded mock data** that should come from APIs
- **Incorrect/placeholder text** that needs correction
- **API integration gaps** where data should be fetched but isn't
- **Data discrepancies** between different parts of the app

Use this report to systematically fix issues with clear line numbers and file paths.

---

## 1. HARDCODED MOCK DATA

### 1.1 Mock Arrays in Components

EOF

echo "Searching for hardcoded mock data arrays..." >> "$OUTPUT_FILE"

# Search for common mock data patterns
grep -rn "const.*= \[" apps/web/src/components --include="*.tsx" --include="*.ts" | \
  grep -E "(mock|sample|fake|dummy|hardcoded|test)" >> "$OUTPUT_FILE" 2>/dev/null || echo "No matches found" >> "$OUTPUT_FILE"

# Search for specific hardcoded object arrays
echo -e "\n### 1.2 Hardcoded Object Literals" >> "$OUTPUT_FILE"
grep -rn "^\s*{$" apps/web/src/components --include="*.tsx" -A 5 | \
  grep -B 2 "id.*:" | head -20 >> "$OUTPUT_FILE" 2>/dev/null || echo "No matches found" >> "$OUTPUT_FILE"

# Search for specific companies/names that might be hardcoded
echo -e "\n### 1.3 Hardcoded Company Names" >> "$OUTPUT_FILE"
echo "Looking for company names that should come from API..." >> "$OUTPUT_FILE"
grep -rn "CloudScale\|TechVision\|Vintara\|FinTech Wallet" apps/web/src --include="*.tsx" | \
  grep -v "// \|import\|export" >> "$OUTPUT_FILE" 2>/dev/null || echo "No matches found" >> "$OUTPUT_FILE"

cat >> "$OUTPUT_FILE" << 'EOF'

---

## 2. INCORRECT/PLACEHOLDER TEXT

### 2.1 Email Addresses

EOF

echo "Searching for placeholder email addresses..." >> "$OUTPUT_FILE"
grep -rn "@example\|@test\|@dummy\|example@\|test@" apps/web/src --include="*.tsx" --include="*.ts" >> "$OUTPUT_FILE" 2>/dev/null || echo "No placeholder emails found" >> "$OUTPUT_FILE"

echo -e "\n### 2.2 Fake Phone Numbers" >> "$OUTPUT_FILE"
grep -rn "555-\|000-\|111-\|+1 (555)" apps/web/src --include="*.tsx" >> "$OUTPUT_FILE" 2>/dev/null || echo "No fake phone numbers found" >> "$OUTPUT_FILE"

echo -e "\n### 2.3 Lorem Ipsum / Placeholder Text" >> "$OUTPUT_FILE"
grep -rn "Lorem ipsum\|TBD\|TODO\|FIXME\|placeholder" apps/web/src --include="*.tsx" --include="*.ts" | \
  head -20 >> "$OUTPUT_FILE" 2>/dev/null || echo "No Lorem ipsum found" >> "$OUTPUT_FILE"

echo -e "\n### 2.4 Hardcoded Status Values" >> "$OUTPUT_FILE"
echo "Checking for hardcoded status values instead of dynamic ones..." >> "$OUTPUT_FILE"
grep -rn '"GO"\|"HOLD"\|"Review"\|"Analysis"' apps/web/src/components --include="*.tsx" | \
  grep -v "api\|response\|deal\." | head -20 >> "$OUTPUT_FILE" 2>/dev/null || echo "No matches found" >> "$OUTPUT_FILE"

cat >> "$OUTPUT_FILE" << 'EOF'

---

## 3. API INTEGRATION GAPS

### 3.1 Components With No API Calls

EOF

echo "Finding components that render data without API calls..." >> "$OUTPUT_FILE"
for file in $(find apps/web/src/components -name "*.tsx" -type f); do
  if ! grep -q "api" "$file" && grep -q "useState\|props\." "$file"; then
    if grep -q "map\|\.length" "$file"; then
      echo "**${file#apps/web/src/components/}** - May have hardcoded data rendered" >> "$OUTPUT_FILE"
    fi
  fi
done

echo -e "\n### 3.2 Components With Both Mock and Real Data" >> "$OUTPUT_FILE"
grep -rn "const.*mock\|const.*hardcoded" apps/web/src/components --include="*.tsx" -l | while read file; do
  if grep -q "apiGet\|useEffect" "$file"; then
    echo "**${file#apps/web/src/components/}** - Has both mock and API data" >> "$OUTPUT_FILE"
  fi
done

cat >> "$OUTPUT_FILE" << 'EOF'

---

## 4. DATA DISCREPANCIES

### 4.1 Known Discrepancies

EOF

echo "Recording known issues for tracking..." >> "$OUTPUT_FILE"

cat >> "$OUTPUT_FILE" << 'EOF'

#### DocumentsTab Document Count Mismatch
- **File**: `apps/web/src/components/documents/DocumentsTab.tsx`
- **Issue**: Document count showing 0 even when documents exist in database
- **Expected**: Should show actual count from `apiGetDocuments(dealId)`
- **Status**: NEEDS INVESTIGATION

#### DealWorkspace Investment Score
- **File**: `apps/web/src/components/pages/DealWorkspace.tsx` (Line 133)
- **Issue**: Score showing 82 instead of 0 when no analysis run
- **Expected**: Should show 0 when `dealInfo?.score` is undefined
- **Status**: FIXED - Now uses typeof check
- **Fix Applied**: `const displayScore = typeof dealInfo?.score === 'number' ? dealInfo.score : investorScore;`

#### DealWorkspace Empty States
- **File**: `apps/web/src/components/pages/DealWorkspace.tsx`
- **Issue**: Mock data arrays for dueDiligence and feedback
- **Status**: FIXED - Replaced with empty arrays
- **Files**: Lines 257 (dueDiligence), Line 260 (feedback)

---

## 5. PRIORITY FIXES CHECKLIST

### HIGH PRIORITY

- [ ] **DocumentLibrary Mock Data** (Line 60-131)
  - File: `apps/web/src/components/documents/DocumentLibrary.tsx`
  - Issue: Contains hardcoded `mockDocuments` array
  - Action: Keep only the real data mapping logic
  - Command: Review lines 60-131 and remove mock array

- [ ] **Verify All Empty States Display**
  - Files: DealWorkspace.tsx (all tabs)
  - Action: Test that empty state messages appear when no data
  - Status: Needs browser testing

- [ ] **Document Count Display Bug**
  - File: `apps/web/src/components/documents/DocumentsTab.tsx`
  - Issue: Count shows 0 instead of actual number
  - Action: Debug apiGetDocuments response
  - Expected: Should match database count

### MEDIUM PRIORITY

- [ ] **DashboardContent Hardcoded Deals**
  - File: `apps/web/src/components/DashboardContent.tsx`
  - Issue: May have hardcoded "Active Deals" section
  - Action: Scan for hardcoded deal names/data
  
- [ ] **Report Cards**
  - File: `apps/web/src/components/pages/DealWorkspace.tsx`
  - Issue: Reports tab had hardcoded cards
  - Status: FIXED - Replaced with empty state

### LOW PRIORITY

- [ ] **Review all display values** for consistency with API

---

## 6. HOW TO USE THIS REPORT

### For Each Item:

1. **Identify**: Use file path and line numbers
2. **Categorize**: Is it mock data, text, or API gap?
3. **Document**: Add specific line numbers and context
4. **Fix**: Replace with API call or correct value
5. **Verify**: Test in browser that it displays correctly

### Workflow:

```bash
# 1. Find the issue in this report
# 2. Open the file mentioned
# 3. Look at the specific line numbers
# 4. Make the fix
# 5. Re-run this audit to verify:
./scripts/audit-mock-data.sh
# 6. Compare with previous report
```

---

**Next Steps**: Run specific audits for each component area using the patterns above.

EOF

# Replace timestamp
sed -i '' "s/_TIMESTAMP_/$TIMESTAMP/g" "$OUTPUT_FILE"

echo "✅ Audit complete! Report saved to: $OUTPUT_FILE"
echo "📋 Run 'cat $OUTPUT_FILE' to view the full report"
