# Copilot Prompt 06 — Jobs + Queues Wiring (BullMQ)

Goal: Wire API ↔ Worker using BullMQ.

Tasks:
- In API:
  - queue producer for `ingest_document`, `fetch_evidence`, `analyze_deal`
  - create a `jobs` row when enqueuing
- In Worker:
  - processors for those 3 jobs (stubs OK)
  - update `jobs` row status: queued → running → complete/error
  - update progressPct/message where possible

Constraints:
- Store BullMQ jobId in DB as `job_id`.
- API request handlers must be fast; do not do heavy work inline.
