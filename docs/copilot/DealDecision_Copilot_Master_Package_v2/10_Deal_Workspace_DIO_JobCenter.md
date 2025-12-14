# Copilot Prompt 10 — Deal Workspace: DIO Metadata + Job Center

Web changes:
- Deal Workspace must display:
  - current DIO versionId (if exists)
  - status badge (draft/running/complete/needs_review)
  - lastAnalyzedAt
- Add Job Center panel with polling for active jobs.

Backend changes (if missing):
- GET /api/v1/deals/:deal_id should return deal meta plus DIO metadata pointer.
- POST /api/v1/deals/:deal_id/analyze should create an `analyze_deal` job and enqueue it.

Constraints:
- Deal chat input should be disabled if no DIO exists.
- No reasoning in frontend.
