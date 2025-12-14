# Copilot Prompt 05 — Minimal Postgres Schema + Migration Runner

Goal: Add minimal DB persistence to support Deals, Jobs, DIO versions, Documents, Evidence.

Tasks:
1) Add DB helper using `pg` in `apps/api`.
2) Implement a simple migration runner (node script) in `apps/api` (or in `infra`).
3) Create SQL migrations (ordered) for:
- deals
- jobs
- dio_versions (JSONB payload, immutable versions)
- documents
- evidence
- deal_evidence link table

Constraints:
- Keep it minimal; no ORM.
- Enforce immutability by policy (no UPDATE for DIO versions).
- Add basic indexes and foreign keys.
- Provide `pnpm db:migrate` command.
