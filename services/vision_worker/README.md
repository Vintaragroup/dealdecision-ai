# vision_worker (FastAPI)

Internal-only microservice for **visual extraction v1** (layout-lite + OCR-lite).

- Stable API contract for extracting per-page visual assets (charts/tables/maps/diagrams/image-text regions).
- **Safe by default**: always returns HTTP 200 with a well-formed response.
- OCR is **optional**: if `pytesseract` or the `tesseract` binary is missing, responses include `quality_flags` and empty OCR fields.

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
