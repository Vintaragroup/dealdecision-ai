# Smart Document Batch Upload System - Complete Implementation

## Overview
A full-stack system for intelligently grouping documents by company, detecting relationships, matching to existing deals, and handling bulk uploads with user confirmation.

## Architecture

### 1. Frontend Utility Layer
**File:** `apps/web/src/lib/documentGrouping.ts`

**Key Functions:**
- `extractCompanyName(filename)` - Parses filenames using patterns like "PD - CompanyName"
- `detectDocumentType(filename)` - Identifies document category (pitch_deck, financials, etc.)
- `extractVariant(filename)` - Detects versions (v2, v6, edits, etc.)
- `groupDocumentsByCompany(files)` - Groups File objects by company
- `createDocumentGroups()` - Detects duplicate versions within groups
- `matchGroupsToDealsByName()` - Maps companies to existing deals
- `calculateMatchConfidence()` - Scores match quality (0-1)
- `analyzeBatchDocuments()` - Main orchestration function

**Data Structures:**
```typescript
DocumentFile {
  name: string;
  file: File;
  type: DocumentType;
  companyName: string;
  variant?: string;
}

DocumentGroup {
  companyName: string;
  dealId?: string;
  documents: DocumentFile[];
  status: 'matched' | 'new' | 'unmatched';
  confidence: number;
}

BatchAnalysisResult {
  groups: DocumentGroup[];
  unmatched: DocumentFile[];
  duplicates: DuplicateSet[];
}
```

### 2. Backend API Endpoints
**File:** `apps/api/src/routes/documents.ts`

#### POST `/api/v1/documents/analyze-batch`
Analyzes filenames to detect groupings without uploading files yet.

**Request:**
```json
{
  "filenames": ["PD - WebMax Investor Deck 2026.pdf", "Financials - WebMax Valuation.xlsx", ...],
  "dealId": "optional-filter-by-deal"
}
```

**Response:**
```json
{
  "analysis": {
    "groups": [
      {
        "company": "WebMax",
        "files": ["PD - WebMax Investor Deck 2026.pdf", "Financials - WebMax.xlsx"],
        "fileCount": 2,
        "documentType": "mixed",
        "dealId": "deal-uuid-123",
        "dealName": "WebMax",
        "status": "matched",
        "confidence": 1.0
      }
    ],
    "duplicates": [
      {
        "company": "Qredible",
        "files": ["PD - Qredible Future of Compliance.pdf", "PD - Qredible Future of Compliance V6 (v2).pdf"]
      }
    ],
    "summary": {
      "totalFiles": 22,
      "totalGroups": 12,
      "matched": 10,
      "new": 2,
      "duplicateGroups": 1
    }
  },
  "deals": [{ "id": "...", "name": "WebMax" }, ...]
}
```

#### POST `/api/v1/documents/bulk-assign`
Assigns analyzed documents to deals and creates new deals if needed.

**Request:**
```json
{
  "assignments": [
    {
      "filename": "PD - WebMax Investor Deck 2026.pdf",
      "dealId": "existing-deal-uuid",
      "type": "pitch_deck"
    }
  ],
  "newDeals": [
    {
      "filename": "PD - NewCompany.pdf",
      "dealName": "New Company",
      "type": "pitch_deck"
    }
  ]
}
```

**Response:**
```json
{
  "assignments": [
    {
      "filename": "PD - WebMax Investor Deck 2026.pdf",
      "dealId": "deal-uuid",
      "status": "assigned",
      "message": "File will be uploaded to deal ..."
    },
    {
      "filename": "PD - NewCompany.pdf",
      "dealId": "new-deal-uuid",
      "dealName": "New Company",
      "status": "deal_created",
      "message": "New deal \"New Company\" created"
    }
  ]
}
```

### 3. UI Component
**File:** `apps/web/src/components/documents/DocumentBatchUploadModal.tsx`

A modal-based interface with three steps:

#### Step 1: File Selection
- Drag-and-drop area
- Multi-file picker
- Shows file list

#### Step 2: Review & Confirmation
- Summary cards showing:
  - Total files grouped
  - Matched vs new deals
  - Duplicate warnings
  
- Expandable group cards showing:
  - Company name + file count
  - Status badge (matched/new)
  - List of files in group
  - Duplicate version warnings
  - Action buttons:
    - ✓ Add to [Existing Deal]
    - + Create Deal
    - ✕ Skip

#### Step 3: Upload
- Sends assignments to backend
- Creates new deals as needed
- Uploads actual files to deal endpoints
- Shows progress/completion

### 4. Integration
**File:** `apps/web/src/components/pages/Documents.tsx`

- Imports `DocumentBatchUploadModal`
- Adds "Batch Upload" button in header
- Opens modal on click
- Refreshes deal list on success
- Maintains backward compatibility with single file upload

## Usage Flow

### For User:
1. Navigate to Documents page
2. Click "Batch Upload" button
3. Select multiple document files (drag-drop or file picker)
4. Review AI-detected groupings:
   - See which documents belong together
   - See which deals they match to
   - Review duplicate versions
5. For each group, choose:
   - Add to existing deal (if matched)
   - Create new deal
   - Skip upload
6. Click "Upload Documents"
7. System uploads all files and refreshes UI

### For System:
1. Parse all filenames
2. Extract company names using pattern matching
3. Group by company
4. Detect document types
5. Find duplicate versions
6. Match groups to existing deals (by name)
7. Calculate confidence scores
8. Await user confirmation
9. Create any new deals needed
10. Upload actual files to appropriate deal endpoints

## Document Pattern Examples

### Recognized Patterns:
```
PD - CompanyName.pdf              → Pitch Deck
PD - CompanyName - Subtitle.pdf   → Pitch Deck (subtitle ignored)
BP - CompanyName.pdf              → Business Plan
WP - CompanyName.pdf              → Whitepaper
Financials - CompanyName.xlsx     → Financial Document
CompanyName Deck 2025.pdf         → Detected as Pitch Deck by context
CompanyName Fund.pdf              → Detected by context keywords
```

### Version Detection:
```
PD - WebMax v2 edits.pdf          → Variant: "v2 edits"
PD - Qredible V6 (v2).pdf         → Variant: "V6 (v2)"
PD - Probility AI 2.png           → Variant: "2"
```

### Company Extraction:
```
Input: "PD - 3ICE.pdf"
Output: "3ICE"

Input: "Financials - WebMax Valuation and Allocation of funds.xlsx"
Output: "WebMax"

Input: "PD - Bar Capital NJ Consolidation Strategy - Organic Farms.xlsx"
Output: "Bar Capital NJ Consolidation Strategy"
```

## Duplicate Detection

The system identifies when the same document type appears multiple times in a group:

**Example:**
- Group: "Qredible"
- Files: "PD - Qredible Future of Compliance.pdf", "PD - Qredible Future of Compliance V6 (v2).pdf"
- Type: Both are Pitch Decks (same type = duplicate)
- Action: Warn user and let them choose which to keep

## Edge Cases Handled

1. **Multiple versions of same document**
   - Flags as duplicate
   - Allows user to select which version to upload
   - Shows variant info (v2 edits, v6, etc.)

2. **Companies not matching existing deals**
   - Status: "new"
   - Offers: Create new deal with company name
   - Alternative: Skip upload for this group

3. **Unknown document types**
   - Type: "other"
   - Still grouped and assigned normally
   - No special processing

4. **Unrecognizable filenames**
   - Falls back to entire filename (minus ext)
   - May not group well but won't fail
   - User can manually correct in UI

5. **Duplicate company names in system**
   - Matches to first found deal
   - Could be enhanced with fuzzy matching
   - User can override in confirmation step

## Performance Considerations

- **File analysis**: O(n) where n = number of files
- **Grouping**: O(n log n) with sorting
- **Matching**: O(n*m) where n = groups, m = existing deals (could use indexing)
- **UI rendering**: Groups only expanded on demand

## Future Enhancements

1. **Fuzzy matching** - Use Levenshtein distance for partial company name matches
2. **OCR detection** - Extract company names from document content
3. **Confidence thresholds** - Only auto-match above certain confidence
4. **Duplicate resolution** - Auto-select "latest version" by timestamp
5. **Batch metadata** - Add tags, custom field assignment in batch
6. **Upload progress** - Real-time progress bar for large batches
7. **Undo capability** - Ability to revert batch uploads
8. **Scheduled uploads** - Queue for later processing
9. **Integration templates** - Pre-define grouping rules per fund/workspace
10. **ML enhancement** - Train model on user confirmations to improve matching

## Testing Scenarios

### Test with provided documents:
```
22 files in: /Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/docs/Deals/Client Pitch Decks - Whitepapers

Expected groupings:
- Vintara Group (1 file)
- 3ICE (1 file)
- Bar Capital (2 files - PDF + Excel)
- Carmoola (1 file)
- Cino (1 file)
- OFT Toxycreen (1 file)
- Palm Capital (2 files - PDF + PPT)
- Probility AI (2 files - PDF + PNG)
- Qredible (2 files - PDF versions) ← duplicate detection
- Rapid Mining (1 file)
- Verse (1 file)
- WebMax (3 files - 2 PDFs + Excel) ← duplicate detection
- Magarian Fund (2 files - new deal)
- BrandPoint Services (1 file - new deal)
- Scrubber (1 file - unclear)
```

## API Contract Summary

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/v1/documents/analyze-batch` | POST | Analyze filenames for grouping | ✅ Implemented |
| `/api/v1/documents/bulk-assign` | POST | Assign groups to deals | ✅ Implemented |
| `/api/v1/deals/{id}/documents` | POST | Upload single document | ✅ Existing |
| `/api/v1/deals` | GET | Get all deals for matching | ✅ Existing |

## Code Files Created/Modified

### Created:
1. `apps/web/src/lib/documentGrouping.ts` - Utility functions (310 lines)
2. `apps/web/src/components/documents/DocumentBatchUploadModal.tsx` - UI Modal (380 lines)

### Modified:
1. `apps/api/src/routes/documents.ts` - Added 2 endpoints + 2 helper functions
2. `apps/web/src/components/pages/Documents.tsx` - Added batch upload integration

### Total New Code: ~700 lines
### Build Status: ✅ All containers built successfully
