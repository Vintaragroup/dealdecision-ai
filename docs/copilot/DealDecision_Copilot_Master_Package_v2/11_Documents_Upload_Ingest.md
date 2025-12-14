# Copilot Prompt 11 — Documents: Upload + Ingest Pipeline

Backend:
- POST /api/v1/deals/:deal_id/documents (multipart upload)
  - store blob to disk or object storage placeholder
  - create document row + ingest job row
  - enqueue ingest_document
- GET /api/v1/deals/:deal_id/documents (list with statuses)

Worker:
- ingest_document stub:
  - mark job running → complete
  - mark document status extracted/ready (simulate extraction)

Web:
- Wire DocumentUpload to backend.
- Show document statuses and allow retry.

Constraints:
- Keep extraction simple; just prove the pipeline.
