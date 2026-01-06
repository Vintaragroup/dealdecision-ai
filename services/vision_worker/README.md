# vision_worker (FastAPI)

Internal-only microservice for **visual extraction v1** (layout-lite + OCR-lite).

- Stable API contract for extracting per-page visual assets (charts/tables/maps/diagrams/image-text regions).
- **Safe by default**: always returns HTTP 200 with a well-formed response.
- OCR is **optional**: if `pytesseract` or the `tesseract` binary is missing, responses include `quality_flags` and empty OCR fields.
- Table extraction is supported (heuristic) and populates `extraction.structured_json` while preserving the stable API contract.

## Endpoints

- `GET /health` → `{ "status": "ok" }`
- `POST /extract-visuals`

### Request

```json
{
  "document_id": "uuid-string",
  "page_index": 0,
  "image_uri": "/path/to/page.png",
  "extractor_version": "vision_v1"
}
```

### Response (shape)

```json
{
  "document_id": "...",
  "page_index": 0,
  "extractor_version": "vision_v1",
  "assets": [
    {
      "asset_type": "image_text",
      "bbox": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
      "confidence": 0.5,
      "quality_flags": {"layout": "fallback_full_page"},
      "image_uri": null,
      "image_hash": "sha256hex-or-null",
      "extraction": {
        "ocr_text": null,
        "ocr_blocks": [],
        "structured_json": {},
        "units": null,
        "labels": {},
        "model_version": null,
        "confidence": 0.0
      }
    }
  ]
}
```

## Table extraction (v1)

When a page looks like a grid/table, the service:

- Sets `asset_type` to `"table"` (schema stays the same; only the value changes).
- Keeps `extraction.ocr_text` / `extraction.ocr_blocks` the same as before.
- Populates `extraction.structured_json` as:

```json
{
  "table": {
    "rows": [["...", "..."], ["...", "..."]],
    "confidence": 0.0,
    "method": "grid_lines_v1",
    "notes": "optional"
  }
}
```

### Methods

- `grid_lines_v1` (preferred): OpenCV morphology finds horizontal/vertical grid lines and slices cells.
- `ocr_cluster_v1` (fallback): clusters OCR word boxes into row/column buckets.

### Quality flags

Flags are attached to `asset.quality_flags` and are best-effort:

- `table_detected`: `true|false`
- `grid_detected`: `true|false`
- `used_fallback_clustering`: `true|false`
- `time_budget_exceeded`: `true` if table extraction hit the per-request budget
- OCR flags may also appear (existing behavior): `pytesseract_missing`, `tesseract_binary_missing`, `ocr=failed`, etc.

### Time budget

Table extraction has a soft time budget (default ~4s) to avoid blocking the pipeline.

- Env: `TABLE_TIME_BUDGET_S` (default `4.0`)

## Limitations

- v1 runs table detection/extraction on the full page only (no region segmentation yet).
- OCR is optional; without `pytesseract` + `tesseract`, table `rows` may be empty or sparsely filled.
- Heuristic detection can miss borderless tables or dense non-tabular grids.

## Bar chart extraction (v1)

When a page looks like a **simple vertical bar chart** (single series), the service:

- Sets `asset_type` to `"chart"`.
- Keeps OCR fields the same.
- Populates `extraction.structured_json` as:

```json
{
  "chart": {
    "type": "bar",
    "title": "optional",
    "x_labels": ["..."],
    "series": [
      { "name": "Series 1", "values": [0.1, 0.2], "unit": "optional", "values_are_normalized": true }
    ],
    "y_unit": "optional",
    "confidence": 0.0,
    "method": "bar_pixels_v1",
    "notes": "optional"
  }
}
```

### Notes

- If numeric axis mapping is not reliable, the extractor returns **normalized** values (`0..1`) and sets `values_are_normalized=true`.
- `x_labels` are best-effort and may be empty.

### Time budget

- Env: `CHART_TIME_BUDGET_S` (default `4.0`)

### Limitations

- MVP assumes a single series (multiple colors/stacked bars are not handled yet).
- Tables take precedence: if a page is detected as a table, it will not be classified as a chart.

## Run locally

From repo root:

```bash
cd services/vision_worker
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check:

```bash
curl -s http://localhost:8000/health
```

Extract:

```bash
curl -s http://localhost:8000/extract-visuals \
  -H 'Content-Type: application/json' \
  -d '{"document_id":"00000000-0000-0000-0000-000000000000","page_index":0,"image_uri":"/tmp/page.png"}'
```

## Run in Docker

From repo root:

```bash
docker build -t dealdecision-vision-worker services/vision_worker
docker run --rm -p 8000:8000 dealdecision-vision-worker
```

If port `8000` is already in use:

```bash
docker run --rm -p 18000:8000 dealdecision-vision-worker
curl -s http://localhost:18000/health
```

Health check:

```bash
curl -s http://localhost:8000/health
```

```bash
cd services/vision_worker
docker build -t ddai-vision-worker:latest .
docker run --rm -p 8000:8000 ddai-vision-worker:latest
```

## Optional OCR

To enable OCR, install `pytesseract` **and** the `tesseract` binary.

- Python package: add `pytesseract` to `requirements.txt`
- System binary (Debian/Ubuntu): `apt-get update && apt-get install -y tesseract-ocr`

If OCR deps are missing, the service returns empty OCR fields and sets `quality_flags` like:
- `{"ocr":"pytesseract_missing"}`
- `{"ocr":"tesseract_binary_missing"}`
- `{"ocr":"failed","ocr_error":"..."}`
