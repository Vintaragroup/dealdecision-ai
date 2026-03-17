# Discovery: Chart-Aware Financial Extraction Capabilities

**Phase:** 10.3 — Discovery & System Mapping  
**Date:** 2026-02-15  
**Status:** Discovery complete. No implementation. Rollout plan documented.  
**Scope:** Can the system extract financial facts from bar charts in investor decks?

---

## 0. TL;DR

The bar chart detector (`chart_bar.py`) **is already active** in the vision worker and has been silently running on every processed deck page. OpenCV 4.13.0 is installed. Chart pixel data lands in `visual_extractions.structured_json`. However, **zero code paths exist** that route that chart data into `financial_facts_v1`. The connection is entirely absent.

Additionally, the existing OCR-text financial extractor fails on EUR-denominated values (`€4.9m GTV`, `€27M revenue`) due to a single missing character class in `tryInlineExtract`. This is a separate, simpler fix.

### Capability Matrix

| Capability | Exists? | Active? | Produces `financial_facts_v1`? |
|---|---|---|---|
| Bar chart pixel detection | ✅ Yes | ✅ Yes (cv2 4.13.0) | ❌ No — data orphaned |
| Bar chart pixel extraction (absolute values) | ✅ Yes | ✅ Yes (when detected) | ❌ No |
| Bar chart pixel extraction (normalized) | ✅ Yes | ✅ Yes (fallback) | ❌ No |
| OCR text KPI tile extraction (USD) | ✅ Yes | ✅ Yes | ✅ Yes |
| OCR text KPI tile extraction (EUR/GBP) | ⚠️ Partial | ✅ Yes (candidate pass) | ❌ Regex gap in `tryInlineExtract` |
| OCR table extraction | ✅ Yes | ✅ Yes | ✅ Yes |
| CLIP semantic page classification | ✅ Yes | ❌ Disabled | N/A |
| Layout region segmentation | ⚠️ Stub | N/A | N/A |
| Line chart extraction | ❌ No | N/A | N/A |
| KPI tile visual detection (non-OCR) | ❌ No | N/A | N/A |

---

## 1. Visual Processing Pipeline — Actual Runtime Behavior

### 1.1 `/extract-visuals` endpoint flow (vision worker `main.py`)

Each invocation processes one page image:

```
1. layout.py:detect_layout_assets()
   └─ STUB → always returns [full-page BBox(0,0,1,1)]
      └─ all detection runs on the full page, never sub-regions

2. For each "asset" (always just one):
   a. ocr.py → PyTesseract 8-step preprocessor → OcrBlock list

   b. table.py:detect_table(img)
      └─ IF detected → table.py:extract_table() → structured_json (table schema)
      └─ asset_type = "table"

   c. ELSE → chart_bar.py:detect_bar_chart(img)  [budget: CHART_TIME_BUDGET_S=4.0s]
      └─ IF detected → chart_bar.py:extract_bar_chart(img, detect, ocr_blocks)
         └─ asset_type = "chart"
         └─ structured_json = { "chart": { ... series.values ... } }

   d. Structured log: {bar_detected, bar_count, axis_mapping_succeeded, values_normalized}

3. INSERT into visual_extractions:
   - asset_type: "image_text" | "table" | "chart"
   - structured_json: null | {table: ...} | {chart: ...}
   - quality_flags: {bar_detected, ...}
```

Key constraint: table and chart detection are **mutually exclusive** (chart runs only in the `else` branch of table detection). A page cannot simultaneously be classified as both.

### 1.2 Chart detection algorithm (`chart_bar.py:detect_bar_chart`)

- Requires `cv2` (OpenCV) — **version 4.13.0 confirmed installed** in `dealdecision-dev-vision_worker-1`
- Algorithm: Otsu binarize → morphological axis-line removal → contour detection → `_filter_bar_candidates()` (area, aspect ratio, width gates) → cluster by X center → baseline alignment check
- Detection threshold: ≥3 bars, ≥70% baseline alignment, width CV ≤ 0.4
- Returns `BarChartDetectResult` with `detected: bool`, `confidence: float`, `bar_bboxes`, `baseline_y`, `bar_count`

### 1.3 Chart extraction algorithm (`chart_bar.py:extract_bar_chart`)

- Computes relative pixel heights vs `baseline_y` for each detected bar
- **Y-axis value mapping**: OCRs a left-strip of the image (width = `bar_bboxes[0].x - padding`) with `pytesseract.image_to_data()`, extracts numeric tokens, fits linear mapping `(y_pixel → actual_value)`
- **If axis mapping succeeds**: `values_are_normalized=False`, absolute values stored
- **If axis mapping fails**: `values_are_normalized=True`, relative 0.0–1.0 heights only
- X-labels: matched from `ocr_blocks` whose centers fall below `baseline_y`
- Confidence formula: `0.45 + 0.45*bar_count_score + 0.18*(axis_ok) - 0.10*(x_labels_missing) - 0.08*(normalized)`

### 1.4 Structured JSON schema stored in `visual_extractions.structured_json`

```json
{
  "chart": {
    "type": "bar",
    "series": [
      {
        "name": "Series 1",
        "values": [4900000.0, 27000000.0, 45000000.0],
        "values_are_normalized": false
      }
    ],
    "x_labels": ["2022", "2023", "2024"],
    "y_unit": null,
    "confidence": 0.72,
    "method": "bar_pixels_v1"
  }
}
```

When axis mapping fails (no readable Y-axis scale):
```json
{
  "chart": {
    "type": "bar",
    "series": [{ "values": [0.18, 0.61, 1.0], "values_are_normalized": true }],
    "x_labels": ["2022", "2023", "2024"],
    "confidence": 0.55
  }
}
```

---

## 2. The Missing Link — Chart Data Never Reaches Financial Registry

### 2.1 Current data flow

```
vision_worker (Python):
  detect_bar_chart() → extract_bar_chart()
  → visual_extractions.structured_json = { "chart": { "series": [...], "x_labels": [...] } }
  → visual_extractions.asset_type = "chart"
  → visual_extractions.quality_flags = { "bar_detected": true, "axis_mapping_succeeded": true, ... }

                           ↓
                  [NO CODE READS THIS]
                           ↓

populate-financial-fact-registry-v1.ts:
  queries document_page_understanding for candidate pages
  fetches OCR text from DPU
  runs extractFinancialTableClaims(text)   ← pure regex on text
  runs extractInlineFinancialClaims(text)  ← pure regex on text
  applies applySlideAwareness()
  reconciles + upserts to financial_facts_v1

                           ↓

financial_facts_v1: [ NO RECORDS FROM CHART DATA ]
```

### 2.2 What would need to exist (but does not)

1. A function `extractChartFactClaims(structuredJson, opts)` that reads `chart.series.values` + `chart.x_labels` and emits `FinancialFactV1[]`
2. A new `source_kind = "chart_pixel"` value in `FinancialFactSourceKind` 
3. A query in the financial registry pipeline that fetches `visual_extractions WHERE asset_type='chart'` for candidate pages
4. A guard: only emit facts when `axis_mapping_succeeded=true` (i.e., `values_are_normalized=false`)
5. A `chart_type` field (optional) on `FinancialFactV1` for traceability

### 2.3 Phase B evidence — charts ARE included (but values not parsed)

`apps/worker/src/lib/phaseb/extract.ts` already queries:
```sql
va.asset_type IN ('table','chart')
quality_flags->>'chart_detected' = 'true'
```
Chart assets surface as phase B evidence items. Their `structured_json` content is passed through as raw evidence. But the evidence consumer does not numerically parse `series.values` into financial facts — it treats the chart asset as a visual attachment, not a financial data source.

### 2.4 `FinancialFactV1` schema gaps for chart integration

Current `FinancialFactSourceKind`:
```typescript
type FinancialFactSourceKind = "xlsx" | "pdf_table" | "pdf_kpi_line" | "deck" | "unknown";
// Missing: "chart_pixel"
```

Current `FinancialFactV1` fields relevant to chart sourcing:
```typescript
{
  source_kind: FinancialFactSourceKind;  // no "chart_pixel"
  source_pointer?: string;               // could encode visual_extraction_id
  excerpt?: string;                      // could encode bar label + value
  // MISSING: chart_type, values_normalized, chart_confidence
}
```

---

## 3. OCR Text KPI Tile Extraction — Current Coverage & EUR Gap

### 3.1 What works today (USD-denominated decks)

`extractInlineFinancialClaims` (P1–P6 patterns) handles:
- `$40K MRR` → `metric_key=mrr, value=40000, unit=currency`
- `ARR: $3M` → `metric_key=arr, value=3000000`
- `330k users` → would match `headcount` if `normalizeMetricKey` maps "users"

`extractFinancialTableClaims` handles pipe/tab/colon formatted tables when `detectFinancialTableCandidate` passes.

### 3.2 EUR gap: detection passes, extraction fails

**`detectFinancialTableCandidate`** correctly recognizes EUR symbols:
```typescript
const currencyMatches = text.match(/[$€£¥₹]|USD|EUR|GBP/g);  // ✅ €  detected
```

**`parseNumericToken`** correctly handles EUR prefixes:
```typescript
const currMatch = s.match(/^[$€£¥₹]?\s*(-?[\d,.]+)\s*([KkMmBbTt]?)$/);  // ✅ €4.9m → 4900000
```

**`tryInlineExtract`** does NOT handle EUR:
```typescript
// ❌ Current — only matches $ prefix or plain digit:
const match = line.match(
  /\b([A-Za-z][\w\s%-]{2,50}?)\s+(?:of\s+|:\s*)?(\$[\d,.]+[KkMmBbTt]?|\d[\d,.]+\s*[KkMmBbTt]?%?)/
);
```

For inline text like `€4.9m GTV` or `Revenue €27M`:
- `€` is not `$`, not `\d`, not a word boundary `\b` anchor
- The value group `(\$[\d,...])` requires a literal `$`
- The fallback group `(\d[\d,...])` requires a digit start
- Result: zero match, fact not extracted

**Fix** (single-line, surgical):
```typescript
// ✅ Fixed — add [$€£¥₹] prefix alternative:
const match = line.match(
  /\b([A-Za-z][\w\s%-]{2,50}?)\s+(?:of\s+|:\s*)?([$€£¥₹][\d,.]+[KkMmBbTt]?|\d[\d,.]+\s*[KkMmBbTt]?%?)/
);
```

This unblocks Cinco-style decks (`€4.9m GTV`, `€27M revenue`) without touching any other logic.

### 3.3 Known KPI tile metric key gaps

`KNOWN_INLINE_METRIC_KEYS` in `extract-inline-financial-claims.ts` may be missing:
- `gmv` / `gross merchandise value` 
- `nrr` / `net revenue retention`
- `ltv` / `cac` / `ltv:cac`
- `users` → `headcount` alias path

These are Phase A improvements, not blocked by chart work.

---

## 4. Dormant Systems

### 4.1 `pdf_v2.py` — DORMANT

- Controlled by `PDF_V2_OCR_MODE=off` (default)
- Implements a smarter page-region classifier that would differentiate text columns, chart regions, table regions before OCR
- Not relevant to current chart extraction work; activating it would change OCR segmentation behavior

### 4.2 `vision_understanding.py` (CLIP classifier) — DISABLED

- Controlled by `ENABLE_VISION_UNDERSTANDING=0` (default)
- Classifies pages into 10 semantic categories: `floor_plan`, `site_plan`, `map`, `org_chart`, `timeline`, `process_diagram`, `architecture_diagram`, `product_screenshot`, `product_photo`, `logo`
- **No financial chart categories exist** — `bar_chart`, `kpi_tile`, `revenue_chart`, `financial_summary` are all absent
- Only runs when `ocr_len < 20 OR ocr_low_quality` AND no structured payload
- Even if enabled, would not help identify financial chart pages
- Adding financial chart categories here is a Phase C enhancement

### 4.3 `layout.py` — STUB

- `detect_layout_assets()` always returns a single full-page BBox asset
- No actual region segmentation implemented
- Chart and table detection always run on the full page image
- Impact: KPI tiles in the top portion of a slide AND a chart in the bottom portion are processed as one region — OCR sees all text mixed together, chart detector operates on the full image
- Real layout segmentation would be a Phase C enhancement

---

## 5. `SOURCE_KIND_RANK` Position for New Chart Source

Current ranking (higher = stronger evidence):
```typescript
const SOURCE_KIND_RANK = {
  pdf_table:    4,   // structured text table
  xlsx:         3,   // spreadsheet cell data
  pdf_kpi_line: 2,   // inline OCR KPI mention
  deck:         1,   // generic deck extraction
  unknown:      0,
};
```

Proposed addition:
```typescript
chart_pixel: 1,   // pixel-derived chart values (between deck and pdf_kpi_line)
```

Rationale: Chart pixel values are lower confidence than OCR text because:
- Pixel height measurement has inherent rounding
- Y-axis mapping relies on OCR of often small axis label text
- Values are only reliable when `axis_mapping_succeeded=true`

When `axis_mapping_succeeded=false`, chart pixel data should not produce `financial_facts_v1` records at all (normalized 0.0–1.0 values have no financial meaning without a scale).

---

## 6. Rollout Plan

### Phase A — EUR Fix + KPI Metric Aliases (OCR path only, zero infrastructure change)

**Files touched:** `extract-financial-table-claims.ts`, `extract-inline-financial-claims.ts`

**Changes:**
1. Fix `tryInlineExtract` regex: `\$` → `[$€£¥₹]` in the value capture group
2. Add metric key aliases: `gmv`, `nrr`, `ltv`, `cac`, `users`
3. Optionally add `GBP` prefix support (same one-line fix covers it)

**Expected impact:** Cinco-class decks (EUR-denominated) should produce financial facts from inline KPI tiles. Zero risk of regression for USD path.

**Test:** Rerun financial fact registry for deal `0fcec035` (Cinco) and verify `financial_facts_v1` populates.

---

### Phase B — Chart Pixel → Financial Facts Integration

**Files touched:** 
- `apps/worker/src/lib/financial-facts/extract-chart-fact-claims.ts` *(new)*
- `apps/worker/src/lib/financial-facts/financial-fact-v1.ts` *(extend type)*
- `apps/worker/src/lib/financial-facts/populate-financial-fact-registry-v1.ts` *(add chart query leg)*

**Changes:**

1. **Extend `FinancialFactSourceKind`:**
   ```typescript
   type FinancialFactSourceKind = 
     "xlsx" | "pdf_table" | "pdf_kpi_line" | "deck" | "chart_pixel" | "unknown";
   ```

2. **New `extractChartFactClaims(structuredJson, opts)`:**
   - Input: `structured_json.chart` from `visual_extractions`
   - Guard: only proceed if `series[0].values_are_normalized === false` (i.e. `axis_mapping_succeeded`)
   - Map: each `(x_labels[i], series[0].values[i])` → attempt `normalizeMetricKey` on the chart title/slide_title
   - If no metric key can be inferred from slide context, skip (no orphan facts)
   - Returns `FinancialFactV1[]` with `source_kind="chart_pixel"`, `confidence="low"` unless bar count ≥ 5

3. **Add query leg in `populate-financial-fact-registry-v1.ts`:**
   ```sql
   SELECT va.structured_json, va.quality_flags, dpu.slide_type, dpu.slide_title
   FROM visual_extractions va
   JOIN document_page_understanding dpu ON ...
   WHERE va.deal_id = $1
     AND va.asset_type = 'chart'
     AND (va.quality_flags->>'axis_mapping_succeeded')::bool = true
   ```

4. **Extend `SOURCE_KIND_RANK`:** add `chart_pixel: 1`

**Confidence guard logic:**
- `axis_mapping_succeeded=true AND bar_count >= 5` → `confidence="medium"`
- `axis_mapping_succeeded=true AND bar_count < 5` → `confidence="low"`
- `axis_mapping_succeeded=false` → **do not emit any fact**

**Expected impact:** Revenue-over-time bar charts (e.g., `[2022, 2023, 2024] × [$4.9M, $27M, $45M]`) produce dated financial facts tagged `source_kind="chart_pixel"`. Lower reconciliation rank than OCR table data — they confirm, not override.

---

### Phase C — Advanced (Future)

1. **Add financial chart categories to CLIP vision understanding** (`vision_understanding.py`):
   - `revenue_chart`, `kpi_tile_grid`, `financial_summary`, `waterfall_chart`
   - Enable `ENABLE_VISION_UNDERSTANDING=1` for financial page pre-screening

2. **Implement real layout segmentation** (`layout.py`):
   - Replace stub with at minimum a 2-zone splitter (e.g., top-40% vs bottom-60%)
   - Allows KPI tiles and chart to be detected from separate regions of the same slide

3. **Line chart / area chart detection** (`extractors/chart_line.py`):
   - Line charts are common for revenue trends; their extraction would use similar Y-axis OCR mapping

4. **Multi-series bar chart support** (`chart_bar.py`):
   - Currently `series` always has `name="Series 1"`; grouped bars not decomposed

---

## 7. File Reference Map

| File | Role | Status |
|---|---|---|
| `services/vision_worker/app/extractors/chart_bar.py` | Bar chart detector + extractor | Active |
| `services/vision_worker/app/extractors/layout.py` | Layout region segmenter | Stub (full-page only) |
| `services/vision_worker/app/extractors/ocr.py` | PyTesseract 8-step OCR | Active |
| `services/vision_worker/app/extractors/table.py` | Table detector + extractor | Active |
| `services/vision_worker/app/extractors/pdf_v2.py` | Advanced PDF OCR | Dormant (`PDF_V2_OCR_MODE=off`) |
| `services/vision_worker/app/extractors/xlsx_structured.py` | XLSX structured extraction | Active |
| `services/vision_worker/app/main.py` | FastAPI `/extract-visuals` endpoint | Active |
| `services/vision_worker/app/vision_understanding.py` | CLIP semantic page classifier | Disabled (`ENABLE_VISION_UNDERSTANDING=0`) |
| `services/vision_worker/app/tests/test_chart_bar_extraction.py` | Unit tests for bar chart | Exists, not CI-gated |
| `apps/worker/src/lib/financial-facts/populate-financial-fact-registry-v1.ts` | Financial fact pipeline orchestrator | Active, OCR-text only |
| `apps/worker/src/lib/financial-facts/extract-financial-table-claims.ts` | Table/inline financial extraction | Active, EUR inline gap |
| `apps/worker/src/lib/financial-facts/extract-inline-financial-claims.ts` | KPI inline pattern extraction | Active |
| `apps/worker/src/lib/financial-facts/financial-fact-v1.ts` | `FinancialFactV1` type + `SOURCE_KIND_RANK` | Missing `chart_pixel` |
| `apps/worker/src/lib/financial-facts/slide-aware-confidence-v1.ts` | Slide-type confidence boosts | Active |
| `apps/worker/src/lib/phaseb/extract.ts` | Phase B evidence queries | Includes `asset_type='chart'` |

---

## 8. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Chart pixel values extracted from axis with unreadable scale | High | Guard on `axis_mapping_succeeded=true`; `confidence="low"` |
| Bar chart false positives (non-financial charts detected as bar charts) | Medium | Reconciliation: chart_pixel rank=1 loses to any OCR-sourced fact for same metric+period |
| EUR fix breaks USD detection | Low | New pattern `[$€£¥₹]` is strictly additive (superset of `\$`) |
| `values_are_normalized=true` facts polluting financial registry | Medium | Hard guard: skip entirely when normalized |
| Phase B adds latency to financial fact registry | Low | Query targets only `asset_type='chart'` rows; typically ≤2 per deal |

---

## 9. Open Questions Before Phase B

1. **How often does `axis_mapping_succeeded=true` occur in practice?** — Check production `visual_extractions.quality_flags` for counts across recent deals. Determines whether Phase B will produce meaningful yield.

2. **What slide_type context is available at chart fact extraction time?** — The chart extractor needs a metric_key inference heuristic. The best signal is `document_page_understanding.slide_type` + `slide_title`. Confirm these are available for the pages where charts are detected.

3. **Is there a reliable chart title or Y-axis label OCRed anywhere?** — If yes, the metric_key could be inferred from it (e.g., "Annual Recurring Revenue" on the chart → `arr`). Check `visual_extractions.extracted_text` or the `ocr_blocks` stored alongside chart detections.

4. **Are EUR facts expected to appear in `extractFinancialTableClaims` (pipe/tab paths) already?** — `parseNumericToken` handles `€` correctly; only `tryInlineExtract` is broken. Confirm whether Cinco deck pages use inline text or structured table layout.
