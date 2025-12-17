# Testing the Smart Document Batch Upload System

## Quick Start Test

### Prerequisites
- Docker containers running (`docker compose up -d` in infra/)
- Web app at http://localhost:5199
- API at http://localhost:9000
- 9 deals already created (from previous session)

### Test Scenario 1: Basic Grouping

**Files to Upload:**
```
PD - WebMax Investor Deck 2026.pdf
PD - WebMax Investor Deck 2026 v2 edits.pdf
Financials - WebMax Valuation and Allocation of funds.xlsx
```

**Expected Result:**
- 1 group: "WebMax"
- 3 files detected
- Duplicate detected: 2 versions of Pitch Deck
- Should match to existing "WebMax" deal
- User can choose to upload all or only latest version

### Test Scenario 2: New Deal Creation

**Files to Upload:**
```
PD - Magarian Fund.pdf
Financials - Magarian Fund.pdf
```

**Expected Result:**
- 1 group: "Magarian Fund"
- 2 files detected
- No match to existing deal (not created earlier)
- Status: "new"
- Offers option to create new deal automatically

### Test Scenario 3: Complex Batch

**Files to Upload (all 22 files from the documents folder)**

**Expected Groupings:**
1. Vintara Group (1)
2. 3ICE (1)
3. Bar Capital (2) - with Excel variant
4. Carmoola (1)
5. Cino (1)
6. OFT Toxycreen (1)
7. Palm Capital (2) - PDF + PPT
8. Probility AI (2) - PDF + PNG ← duplicate
9. Qredible (2) - PDF versions ← duplicate
10. Rapid Mining (1)
11. Verse (1)
12. WebMax (3) - 2 PDFs + Excel ← duplicate
13. Magarian Fund (2) - NEW
14. BrandPoint Services (1) - NEW
15. Scrubber (1) - UNCLEAR

**Expected Summary:**
- 22 total files
- 15 groups
- 12 matched to existing deals
- 2 new deals needed
- 1 unclear/manual review
- 3 duplicate version groups

### Test Scenario 4: Duplicate Version Selection

**Files with duplicates:**
```
PD - Qredible Future of Compliance.pdf
PD - Qredible Future of Compliance V6 (v2).pdf
```

**Steps:**
1. System detects duplicates
2. Warns user in group expansion
3. User can see both file sizes and dates
4. User selects which version to upload
5. Skip older version

## Manual API Testing

### Test 1: File Analysis Only

```bash
curl -X POST http://localhost:9000/api/v1/documents/analyze-batch \
  -H "Content-Type: application/json" \
  -d '{
    "filenames": [
      "PD - WebMax Investor Deck 2026.pdf",
      "PD - WebMax Investor Deck 2026 v2 edits.pdf",
      "Financials - WebMax Valuation and Allocation of funds.xlsx"
    ]
  }'
```

**Expected Response:**
```json
{
  "analysis": {
    "groups": [
      {
        "company": "WebMax",
        "files": [...],
        "fileCount": 3,
        "status": "matched",
        "confidence": 1.0,
        "dealId": "existing-uuid",
        "dealName": "WebMax"
      }
    ],
    "summary": {
      "totalFiles": 3,
      "totalGroups": 1,
      "matched": 1,
      "new": 0
    }
  }
}
```

### Test 2: Assign and Create Deal

```bash
curl -X POST http://localhost:9000/api/v1/documents/bulk-assign \
  -H "Content-Type: application/json" \
  -d '{
    "assignments": [
      {
        "filename": "PD - WebMax Investor Deck 2026.pdf",
        "dealId": "existing-deal-uuid",
        "type": "pitch_deck"
      }
    ],
    "newDeals": [
      {
        "filename": "PD - Magarian Fund.pdf",
        "dealName": "Magarian Fund",
        "type": "pitch_deck"
      }
    ]
  }'
```

**Expected Response:**
```json
{
  "assignments": [
    {
      "filename": "PD - WebMax Investor Deck 2026.pdf",
      "dealId": "deal-uuid",
      "status": "assigned"
    },
    {
      "filename": "PD - Magarian Fund.pdf",
      "dealId": "new-uuid",
      "dealName": "Magarian Fund",
      "status": "deal_created",
      "message": "New deal \"Magarian Fund\" created"
    }
  ]
}
```

## UI Testing Steps

### Step 1: Navigate to Documents Page
1. Go to http://localhost:5199
2. Click "Deal Pipeline" → verify 27 deals visible
3. Click "Documents" in sidebar
4. Verify "Batch Upload" button appears

### Step 2: Click Batch Upload
1. Click "Batch Upload" button
2. Modal should open with drag-drop area
3. Click "drop files here" or drag files

### Step 3: Select Files from Filesystem
1. Navigate to `/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/docs/Deals/Client Pitch Decks - Whitepapers/`
2. Select all 22 files (Cmd+A)
3. Click "Open" to import

### Step 4: Review Analysis
1. Modal should show "Analyzing..." briefly
2. Then show analysis summary:
   - 22 files
   - ~15 groups
   - ~12 matched
   - ~2-3 new
3. Groups should be collapsible
4. Expand a group to see:
   - List of files
   - Company name
   - Deal it matches to (if any)
   - Duplicate warnings (if applicable)

### Step 5: Confirm Assignments
1. For matched deals: "✓ Add to [DealName]" button should be selected
2. For new deals: "+ Create Deal" button should be selected
3. For duplicates: Expand to see versions and manually select
4. Can toggle buttons to change decisions
5. Summary at bottom should update: "X confirmed, Y new deals"

### Step 6: Upload
1. Click "Upload Documents" button
2. Should show progress
3. Backend should:
   - Create any new deals
   - Upload files to appropriate deal endpoints
   - Queue document processing jobs
4. Modal should close on success
5. Deal Pipeline should refresh with new deals (if created)

## Validation Checklist

### File Extraction ✓
- [ ] Company names extracted correctly
- [ ] Document types detected (pitch_deck, financials, etc)
- [ ] Variants captured (v2, v6, edits, etc)
- [ ] Unknown files fallback to full filename

### Grouping ✓
- [ ] Files grouped by company
- [ ] Grouping case-insensitive ("WebMax" == "webmax")
- [ ] Duplicates detected (same company + same type)
- [ ] Groups sorted by confidence (matched first)

### Matching ✓
- [ ] Exact name matches = 1.0 confidence
- [ ] Partial matches handled correctly
- [ ] Non-matching companies = status "new"
- [ ] Confidence scores reasonable (0-1)

### UI ✓
- [ ] File selection works (drag and click)
- [ ] Group expansion/collapse works
- [ ] Action buttons update correctly
- [ ] Summary numbers accurate
- [ ] Modal closes after upload

### API ✓
- [ ] analyze-batch returns correct structure
- [ ] bulk-assign creates deals correctly
- [ ] Files upload to correct deals
- [ ] Processing jobs queued
- [ ] Error handling for failed uploads

### Integration ✓
- [ ] New deals appear in Deal Pipeline
- [ ] Documents appear in deal's document list
- [ ] Processing status shows in UI
- [ ] No breaking changes to existing upload flow

## Debug Commands

### Check if API endpoints exist
```bash
curl -X POST http://localhost:9000/api/v1/documents/analyze-batch \
  -H "Content-Type: application/json" \
  -d '{"filenames": ["test.pdf"]}'
# Should return 400 (expected) not 404 (not found)
```

### View Docker logs
```bash
cd infra/
docker compose logs -f api      # API logs
docker compose logs -f web      # Web logs
docker compose logs -f worker   # Job processing logs
```

### Test file listing
```bash
ls -lah "/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/docs/Deals/Client Pitch Decks - Whitepapers/"
# Should show 22 files
```

### Verify deals in database
```bash
curl http://localhost:9000/api/v1/deals | jq '.[] | {name, stage}'
# Should show 27+ deals including WebMax, Vintara, etc
```

## Troubleshooting

### Modal doesn't appear
- Check browser console for JS errors
- Verify DocumentBatchUploadModal component imported in Documents.tsx
- Verify build succeeded without errors

### File analysis returns empty groups
- Check API is running on port 9000
- Verify filenames are being sent correctly
- Check API logs for parsing errors

### Duplicate detection not working
- Check DocumentType enum values match API
- Verify same company extraction for all files
- Check file type detection logic

### New deal creation fails
- Verify database migrations ran (`migrate` container)
- Check deal name formatting
- Check PostgreSQL connection in API logs

### Files don't upload
- Verify deal ID is valid
- Check file buffer encoding
- Verify document table has correct schema

## Expected Improvements After Implementation

✅ **Before:** Manually upload one document at a time, manually select deal
✅ **After:** 
- Upload 22 documents at once
- System automatically groups by company
- System automatically matches to existing deals
- System offers to create new deals
- System warns about duplicate versions
- Single click confirmation for entire batch

✅ **Time Savings:** ~30 minutes → ~2 minutes (15x faster)
✅ **Error Reduction:** Manual matching errors eliminated
✅ **User Experience:** Intuitive modal flow with clear feedback
