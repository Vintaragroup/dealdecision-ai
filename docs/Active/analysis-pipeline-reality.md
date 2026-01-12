# Analysis Pipeline Reality (Current Contract)

This document is the **canonical source of truth** for how the DealDecisionAI pipeline behaves today.
It describes **what the system actually does** (not what we intend it to do).

If behavior differs from this document, the code is considered incorrect **or** this document is outdated and must be updated alongside the change.

---

## Scope

Covers:

- Upload → document row creation
- Ingest job enqueue and extraction persistence
- Supported file types (current)
- Multi-document behavior (current)
- Phase B visual extraction and storage
- Whether Phase 1 scoring consumes Phase B outputs (current answer)
- DB “truth queries” used to verify reality

---

## Definitions

- **Deal**: canonical investment opportunity record.
- **Document**: uploaded file linked to a deal.
- **Ingest**: extraction pass that persists text/structured artifacts to DB.
- **Phase 1**: first-pass analysis/scoring using extracted text/structured artifacts.
- **Phase B**: visual pipeline (rendered pages → visual assets → extractions → diagnostics/features runs).

---

## 1. Upload → Ingest enqueue (per-document)

### Current behavior

- Each upload creates exactly one `documents` row.
- Each upload enqueues exactly one `ingest_documents` job for that document.

### Important constraint

- The multipart upload route overwrites the file buffer on each file part.
- Only the *last file* in a multipart request is retained unless the client loops.

### Implication

- Multi-document correctness depends on the client completing a loop of single-file uploads.
- There is no server-side reconciliation unless explicitly implemented.

---

## 2. Supported file types (routing reality)

Supported today:

- PDF
- XLS / XLSX
- PPT / PPTX
- DOC / DOCX
- PNG / JPG / JPEG / GIF

Unsupported / treated as unknown:

- CSV
- TXT
- HTML
- MD
- Other arbitrary formats

**Contract**

Unsupported types must fail open and persist diagnostics rather than crash the pipeline.

---

## 3. Extraction persistence contract

Ingest persists the following fields on `documents`:

- `structured_data` (JSONB)
- `extraction_metadata` (JSONB)
- `full_content` (JSONB)
- `full_text` (TEXT)
- `full_text_absent_reason` (TEXT)
- `page_count` (INTEGER)

These are **persisted artifacts**, not runtime-only values.

---

## 4. Multi-document iteration behavior

### Ingest

- One job processes one document.

### Phase 1 analyze

- Loads all eligible extracted documents for the deal.
- Eligibility is determined by status and extraction metadata presence.

### Phase B visual extraction

- Can iterate across all documents in a deal when invoked with `deal_id`.

---

## 5. Phase B visuals (current invariant)

- Rendered page images are guaranteed only for PDFs.
- Non-PDF documents may not produce page images today.

**Consequence**

Phase B may appear empty for deals without PDFs even when extraction succeeded.

---

## 6. Phase B storage contract

### Visual lane tables

- `visual_assets`
- `visual_extractions`

Key persisted fields:

- `visual_extractions.structured_json` (JSONB)
- `visual_extractions.ocr_blocks` (JSONB, if present)
- `visual_extractions.ocr_text` (may be absent due to schema drift)

### Phase B runs

- `deal_phase_b_runs.phase_b_features` (JSONB)
- `deal_phase_b_runs.phase_b_result` (JSONB)

Phase B must fail open and emit explicit diagnostics.

---

## 7. Phase 1 consumption of Phase B

**Current answer: No**

- Phase 1 does not consume Phase B outputs.
- Phase B is computed after Phase 1 and persisted separately.

Any integration must be explicitly implemented and documented.

---

## 8. Known gaps (intentionally recorded)

- No server-side ingest reconciliation.
- Visual pipeline is PDF-first.
- Schema drift risk around `documents.id` and OCR columns.
- Phase B does not enrich Phase 1 today.

---

## 9. Truth queries (Postgres)

### Documents table reality

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='documents'
ORDER BY ordinal_position;
```

### Multi-document extraction completeness

```sql
SELECT deal_id,
       COUNT(*) AS total_docs,
       SUM((extraction_metadata IS NOT NULL)::int) AS extracted_docs
FROM documents
GROUP BY deal_id
ORDER BY total_docs DESC;
```

### Visual coverage per deal

```sql
SELECT d.deal_id, COUNT(*) AS assets
FROM visual_assets va
JOIN documents d ON d.id = va.document_id
GROUP BY d.deal_id
ORDER BY assets DESC;
```

### Phase B run presence

```sql
SELECT deal_id, COUNT(*) AS runs, MAX(created_at)
FROM deal_phase_b_runs
GROUP BY deal_id;
```