# Copilot Prompt 03 — Implement @dealdecision/contracts (Types-First)

Goal: Create shared TS types in `packages/contracts` and consume them from web/api/worker.

Create minimal types:
- Deal, DealListItem, DealStage, DealPriority, DealTrend
- Document, DocumentType, DocumentStatus
- JobStatus, JobType
- Evidence (keyed by evidence_id)
- DIO metadata + payload
- ReportDTO (TSX-ready)
- ChatMessage, ChatAction, ChatResponse

Rules:
- Any claim/bullet that can be cited must carry `evidence_ids?: string[]`.
- Evidence must be referenced by `evidence_id` only.

Then:
- Export all via `packages/contracts/src/index.ts`
- Wire path imports in web/api/worker
- Ensure `pnpm -r typecheck` passes.
