#!/bin/bash

# Quick Fix Reference Guide
# Use this to quickly identify and fix specific issues

cat << 'EOF'

╔════════════════════════════════════════════════════════════════════════════╗
║                  MOCK DATA & TEXT FIX QUICK REFERENCE                     ║
╚════════════════════════════════════════════════════════════════════════════╝

📋 CRITICAL ISSUES (Fix these first)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. DOCUMENTLIBRARY MOCK DATA
   ├─ File: apps/web/src/components/documents/DocumentLibrary.tsx
   ├─ Issue: Lines 56-131 have hardcoded mockDocuments array
   ├─ Impact: Shows fake documents even when real ones exist
   └─ Fix Action: Remove mockDocuments array, keep real data mapping
   
   Quick Command:
   $ grep -n "const mockDocuments" apps/web/src/components/documents/DocumentLibrary.tsx

2. DASHBOARDCONTENT HARDCODED DEALS
   ├─ File: apps/web/src/components/DashboardContent.tsx
   ├─ Issue: Lines 78+ have hardcoded deal names (CloudScale, TechVision, etc)
   ├─ Impact: Shows fake deals in dashboard
   └─ Fix Action: Replace with apiGetDeals() call
   
   Quick Command:
   $ grep -n "CloudScale\|TechVision\|FinTech Wallet" apps/web/src/components/DashboardContent.tsx | head -5

3. DUEDILIGENCEREPORT VINTARA CHECK
   ├─ File: apps/web/src/components/pages/DueDiligenceReport.tsx
   ├─ Issue: Line 58 checks dealId === 'vintara-001' (doesn't exist in DB)
   ├─ Impact: Shows hardcoded Vintara data for non-existent deal
   └─ Fix Action: Remove vintara check, use real dealInfo data
   
   Quick Command:
   $ grep -n "vintara-001" apps/web/src/components/pages/DueDiligenceReport.tsx

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 HOW TO USE THIS GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: FIND THE ISSUE
   $ # Run one of the Quick Commands above to find line numbers

Step 2: EXAMINE THE CODE
   $ # Open the file and look at the context around that line

Step 3: IDENTIFY THE PATTERN
   ├─ Is it a const array? (mock data)
   ├─ Is it a hardcoded string? (incorrect text)
   ├─ Is it a fallback value? (should be dynamic)
   └─ Is it missing an API call? (integration gap)

Step 4: MAKE THE FIX
   ├─ For mock data: Remove array, use props/API instead
   ├─ For text: Replace with dynamic value from dealInfo/API
   ├─ For fallback: Change to use real data with null coalescing
   └─ For missing API: Add useEffect with apiGet* call

Step 5: VERIFY THE FIX
   $ npm run type-check
   $ npm run build
   # Test in browser

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 FINDING PATTERNS IN CODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Search for mock data:
   $ grep -rn "const.*= \[" apps/web/src/components --include="*.tsx" | grep -i "mock\|fake\|sample"

Search for hardcoded company names:
   $ grep -rn "TechVision\|CloudScale\|Vintara\|FinTech" apps/web/src --include="*.tsx"

Search for placeholder text:
   $ grep -rn "@example\|555-\|TBD\|TODO\|placeholder" apps/web/src --include="*.tsx"

Search for suspicious fallback values:
   $ grep -rn "|| 'TechVision\||| 'Vintara\||| 'CloudScale" apps/web/src --include="*.tsx"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ VERIFICATION CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After each fix:

   [ ] Run npm run type-check - no TS errors
   [ ] Run npm run build - compiles successfully
   [ ] Check browser console - no errors or warnings
   [ ] Test empty state - shows when no data
   [ ] Test with data - shows real values from API
   [ ] Check database - values match DB records
   [ ] Look for "TechVision", "CloudScale", "Vintara", "555" - should be gone
   [ ] Verify API calls are being made in Network tab

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 AUDIT WORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Generate fresh audit:
   $ ./scripts/audit-mock-data.sh

2. Review AUDIT_REPORT.md:
   $ cat AUDIT_REPORT.md

3. Update AUDIT_FIXES.md:
   - Mark issue as "IN PROGRESS"
   - Add notes about the fix

4. Make code changes:
   - Edit the file
   - Run verification checklist
   
5. Mark as complete:
   - Change status from 🔴 to ✅
   - Add "Fixed: [date]" note

6. Re-run audit:
   $ ./scripts/audit-mock-data.sh
   $ diff AUDIT_REPORT.md AUDIT_REPORT_OLD.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 COMMON PATTERNS TO LOOK FOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATTERN 1: Hardcoded Array
   ❌ const mockDeals = [{ id: '1', name: 'TechVision', ... }];
   ✅ const [deals, setDeals] = useState([]);
      useEffect(() => { 
        apiGetDeals().then(setDeals);
      }, []);

PATTERN 2: Hardcoded Fallback
   ❌ const name = dealData?.name || 'TechVision AI Platform';
   ✅ const name = dealData?.name || 'Unnamed Deal';  // generic fallback

PATTERN 3: String Check for Mock Data
   ❌ const isMock = dealId === 'vintara-001';
   ✅ // Always use real data from dealInfo

PATTERN 4: Conditional Based on Hardcoded Value
   ❌ if (dealId === 'vintara-001') { ... show vintara content ... }
   ✅ // Always show content based on dealInfo data

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 FILES TO CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Priority Order:
1. apps/web/src/components/documents/DocumentLibrary.tsx
2. apps/web/src/components/DashboardContent.tsx  
3. apps/web/src/components/pages/DueDiligenceReport.tsx
4. apps/web/src/components/pages/DealWorkspace.tsx
5. apps/web/src/components/ui/RiskMapGrid.tsx
6. apps/web/src/components/pages/ReportsGenerated.tsx

Run this to check all at once:
   $ for file in apps/web/src/components/documents/DocumentLibrary.tsx \
                  apps/web/src/components/DashboardContent.tsx \
                  apps/web/src/components/pages/DueDiligenceReport.tsx; do
       echo "=== $file ==="; 
       grep -n "TechVision\|CloudScale\|const.*= \[" "$file" | head -10;
     done

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 TIPS FOR SUCCESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Use grep to find issues quickly
• Make ONE fix at a time
• Test after each fix
• Update the checklist as you go
• Run audit script periodically to track progress
• Use git diff to see what changed
• Commit fixes in logical groups

╔════════════════════════════════════════════════════════════════════════════╗
║                      Ready to start fixing? Pick one!                      ║
║                                                                            ║
║  1️⃣  DocumentLibrary mock data (Line 56-131)                             ║
║  2️⃣  DashboardContent hardcoded deals (Line 78+)                         ║
║  3️⃣  DueDiligenceReport vintara check (Line 58)                          ║
╚════════════════════════════════════════════════════════════════════════════╝

EOF
