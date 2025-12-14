# Copilot Prompt 01 — Bootstrap & Repo Scan

You are working in a pnpm monorepo for DealDecision AI.

Components:
- `apps/web`: React/Vite/TS dashboard UI (existing UI moved here)
- `apps/api`: Fastify/TS API
- `apps/worker`: BullMQ/TS worker processors
- `packages/contracts`: shared TS contracts (Deal, Document, Evidence, Job, DIO, ReportDTO, Chat)
- `packages/core`: deterministic report compiler + HRM rules

Local-dev constraint:
- API must be reachable at **http://localhost:9000**.

Non-negotiables:
- DIO is source of truth; UI renders DIO versions.
- Evidence IDs only; no invented citations or URLs.
- Chat proposes actions; cannot mutate decisions/scores directly.
- Heavy work is async jobs with status in DB.

Task:
1) Read docs: `01_System_Foundations.md`, `07_Backend_Requirements_and_Architecture.md`, `08_Frontend_Update_Instructions_for_Copilot.md`.
2) Scan repo folders; list what exists and what is missing vs the above.
3) Produce a short checklist for prompts 02–15, indicating which steps are already complete.

Rules:
- Do not change code yet.
- Output only the checklist + file locations you inspected.
