# Mock Data & Incorrect Text Fix Checklist

**Last Updated**: 2025-12-16
**Status**: Active Audit

---

## CRITICAL ISSUES TO FIX

### 1. DocumentLibrary Mock Data ⚠️ HIGH PRIORITY

**File**: `apps/web/src/components/documents/DocumentLibrary.tsx`  
**Lines**: 56-131  
**Status**: 🔴 NOT FIXED

```
Issue: Contains hardcoded mockDocuments array with 6 fake documents
Location: Line 56 - const mockDocuments: LibraryDoc[] = [
Why it's a problem: Shows fake data even when real documents exist in database

To Fix:
1. Remove the entire mockDocuments array (lines 56-131)
2. Keep only the real data mapping logic that uses initialDocuments prop
3. Verify empty state shows when no documents exist
```

**Testing**: After fix, documents should:
- [ ] Show correct count when documents exist
- [ ] Show empty state when no documents
- [ ] Allow preview to open

---

### 2. DashboardContent Hardcoded Deals ⚠️ HIGH PRIORITY

**File**: `apps/web/src/components/DashboardContent.tsx`  
**Lines**: 78-100+ (and scattered throughout)  
**Status**: 🔴 NOT FIXED

```
Hardcoded deals found:
- CloudScale SaaS (line 78)
- TechVision AI (line 88)  
- FinTech Wallet (line 98)

These should come from API call to apiGetDeals()
```

**To Fix**:
- [ ] Remove hardcoded `activeDealsMock` array
- [ ] Add useEffect that calls `apiGetDeals()`
- [ ] Use real data instead of mock

---

### 3. DueDiligenceReport Hardcoded Vintara Data ⚠️ HIGH PRIORITY

**File**: `apps/web/src/components/pages/DueDiligenceReport.tsx`  
**Lines**: 58-66  
**Status**: 🔴 NOT FIXED

```
Hardcoded check:
- Line 58: const isVintaraDeal = dealId === 'vintara-001';
- Line 64: const dealName = isVintaraDeal ? 'Vintara Group LLC' : 'TechVision AI Platform';
- Line 65-66: Hardcoded dates based on this check

Problem: References 'vintara-001' which doesn't exist in real database
Solution: Should use actual dealInfo data instead of hardcoded string check
```

**To Fix**:
- [ ] Remove `isVintaraDeal` check
- [ ] Use `dealInfo?.name` instead of hardcoded name
- [ ] Use actual dates from API data
- [ ] Update entire content to use real deal data

---

## MEDIUM PRIORITY ISSUES

### 4. RiskMapGrid Hardcoded Risk Data 📊

**File**: `apps/web/src/components/ui/RiskMapGrid.tsx`  
**Lines**: 31-48+  
**Status**: 🔴 NOT FIXED

```
Hardcoded risk data:
- Market Risk (low severity)
- Team Risk (medium severity)
- Financial Risk (medium severity)

Should be generated from actual deal data
```

**To Fix**:
- [ ] Check if this component receives risk data as props
- [ ] Replace hardcoded objects with dynamic calculation
- [ ] Ensure severity levels come from analysis results

---

### 5. DocumentLibrary AIImageGenerator Mock Images 📸

**File**: `apps/web/src/components/editor/AIImageGenerator.tsx`  
**Lines**: 33+  
**Status**: 🔴 NOT FIXED

```
Hardcoded mock images array
Should use actual generated/uploaded images
```

---

### 6. DealWorkspace Hardcoded TechVision Data 🏢

**File**: `apps/web/src/components/pages/DealWorkspace.tsx`  
**Lines**: 809, 867-868, 1023, 1044-1045  
**Status**: 🔴 NOT FIXED

```
Multiple places with TechVision AI hardcoded:
- Line 809: Fallback description (should use dealInfo?.description)
- Line 867-868: Hardcoded company info
- Line 1023, 1044-1045: Hardcoded deal names

These are fallback values that should use actual deal data
```

---

## COMPLETED FIXES ✅

### ✅ DealWorkspace Empty Arrays
- **File**: `apps/web/src/components/pages/DealWorkspace.tsx`
- **Status**: FIXED
- **Lines**: 257, 260
- **What was fixed**: 
  - Removed 233-line dueDiligenceItems mock array
  - Removed 14-line feedbackItems mock array
  - Replaced with empty arrays

### ✅ DealWorkspace Score Display
- **File**: `apps/web/src/components/pages/DealWorkspace.tsx`
- **Status**: FIXED
- **Line**: 133
- **What was fixed**:
  - Changed from: `const displayScore = dealInfo?.score || investorScore;`
  - Changed to: `const displayScore = typeof dealInfo?.score === 'number' ? dealInfo.score : investorScore;`
  - Now correctly shows 0 when no analysis run

### ✅ DealWorkspace Metric Cards
- **File**: `apps/web/src/components/pages/DealWorkspace.tsx`
- **Status**: FIXED
- **What was fixed**:
  - Removed 6 hardcoded metric cards (95%, 88%, 82%, etc.)
  - Replaced Overview tab with dynamic score message card

### ✅ DealWorkspace Report Cards
- **File**: `apps/web/src/components/pages/DealWorkspace.tsx`
- **Status**: FIXED
- **What was fixed**:
  - Removed hardcoded "Vintara Group LLC" and "TechVision AI Platform" report cards
  - Replaced Reports tab with empty state + Generate button

### ✅ React Build Issue
- **File**: `apps/web/src/main.tsx`
- **Status**: FIXED
- **What was fixed**:
  - Removed duplicate `createRoot()` call (was on lines 7-8)
  - Now only called once as intended

---

## DATA VALIDATION CHECKLIST

After each fix, verify:

- [ ] No TypeScript errors: `npm run type-check`
- [ ] No build errors: `npm run build`
- [ ] Component compiles in browser
- [ ] Empty states display when no data
- [ ] Real data displays when data exists
- [ ] No console errors
- [ ] Data matches database values

---

## HOW TO TRACK CHANGES

1. **Identify**: Use this checklist
2. **Fix**: Edit the file with specific line numbers
3. **Verify**: Run tests above
4. **Check Off**: Mark as ✅ in this file
5. **Update Status**: Change from 🔴 to ✅

---

## NEXT STEPS

**Immediate** (do first):
1. Fix DocumentLibrary mockDocuments array
2. Fix DashboardContent hardcoded deals
3. Test that navigation and data display work

**Follow-up**:
4. Fix DueDiligenceReport vintara-001 check
5. Fix RiskMapGrid hardcoded data
6. Verify all fallback text uses real data

---

## Questions to Answer for Each Fix

Before making a change, ask:

1. **Where does the real data come from?**
   - API call? (which endpoint?)
   - Props from parent?
   - Context/state?

2. **What's the current fallback?**
   - Hardcoded string?
   - Empty state?
   - Skeleton loader?

3. **How will we test it?**
   - Browser test?
   - Unit test?
   - Integration test?

4. **What should happen when no data exists?**
   - Show empty state?
   - Show loading?
   - Show error?

