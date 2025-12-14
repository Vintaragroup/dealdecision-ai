# Copilot Prompt 13 — Evidence Service Minimal + Evidence UI

Backend:
- POST /api/v1/evidence/search (stub provider ok)
- POST /api/v1/evidence/fetch (enqueue fetch_evidence job)
- GET /api/v1/evidence/:evidence_id
- POST /api/v1/deals/:deal_id/evidence/attach (attach evidence to deal)

Worker:
- fetch_evidence stub:
  - fetch URL (or simulate)
  - canonicalize + hash + excerpt
  - assign basic quality/relevance scores
  - write evidence row
  - update job status

Security:
- Add SSRF protections (block private IPs, enforce http/https).

Web:
- Create EvidenceChip + EvidenceDrawer
- Render citations using evidence_id only (no raw URLs in UI state).

Constraints:
- Evidence must exist before it can be cited.
