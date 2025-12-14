# Copilot Prompt 07 — Deals CRUD Endpoints (DB-backed)

Implement:
- POST /api/v1/deals
- GET /api/v1/deals
- GET /api/v1/deals/:deal_id
- PUT /api/v1/deals/:deal_id
- DELETE /api/v1/deals/:deal_id (soft delete)

Requirements:
- Validate inputs with zod
- Use @dealdecision/contracts response shapes
- Return ISO dates
- Include minimal filtering params in list if easy; otherwise accept and ignore with TODO.

Keep implementation straightforward and testable.
