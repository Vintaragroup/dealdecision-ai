# Copilot Prompt 14 — Chat Endpoints + UI Wiring (Actions, Evidence IDs)

Backend:
- POST /api/v1/chat/workspace
  - returns `{ reply, suggested_actions? }`
- POST /api/v1/chat/deal
  - requires deal_id
  - reads latest DIO (or specified version)
  - returns `{ reply, citations?: [{ evidence_id, excerpt? }], suggested_actions? }`

Rules:
- Do not return citations unless evidence exists in DB.
- Citations must be by evidence_id only.

Web:
- Workspace chat calls /chat/workspace
- Deal chat calls /chat/deal with deal_id + dio_version_id if available
- Render suggested_actions as clickable chips:
  - RUN_ANALYSIS → call analyze → job center
  - FETCH_EVIDENCE → call evidence/fetch → job center
- Render citations as EvidenceChip components.

Constraints:
- Chat cannot mutate DIO directly.
