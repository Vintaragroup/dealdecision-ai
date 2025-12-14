# Copilot Bootstrap Prompt — Understand System + Start Work

You are working in a pnpm monorepo for DealDecision AI with these components:
- `apps/web`: React/Vite/TypeScript dashboard UI (renderer + controller)
- `apps/api`: Fastify/TypeScript API (source of truth + orchestration)
- `apps/worker`: BullMQ workers (async ingestion, evidence fetch, analysis)
- `packages/contracts`: shared TypeScript contracts (Deal, Document, Evidence, Job, DIO, ReportDTO, ChatAction)
- `packages/core`: deterministic report compiler and HRM rules (no LLM required for v1)

Non-negotiables:
- DIO is the source of truth. UI renders DIO versions.
- No hallucinated citations: citations must reference stored `evidence_id` objects only.
- Chat proposes actions; it does not mutate decisions or scores directly.
- Heavy tasks are async jobs with status.

Task:
1) Read `docs/01_System_Foundations.md`, `docs/07_Backend_Requirements_and_Architecture.md`, and `docs/08_Frontend_Update_Instructions_for_Copilot.md`.
2) Scan the repo and identify missing pieces vs the sequential plan.
3) Start with the smallest working slice:
   - API health endpoint
   - Deals CRUD
   - Job status endpoint
   - Web reads deals from API in live mode

Output:
- A short implementation plan (checklist)
- The first PR-sized set of changes (files + summary)
- Include commands to run locally and validate (pnpm dev, typecheck).
