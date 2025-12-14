# Copilot Prompt 12 — Analyze Job → DIO Version → ReportDTO

Worker:
- analyze_deal stub:
  - create a new immutable dio_versions row with JSONB payload
  - include: overall_score, section_scores, recommendation fields (placeholder ok)
  - include empty evidence_ids arrays in claims/bullets

API:
- GET /api/v1/deals/:deal_id/dio (latest)
- GET /api/v1/deals/:deal_id/report/tsx
  - compile deterministic ReportDTO from DIO (in packages/core)

Web:
- Wire report view to GET /report/tsx
- Empty state: “Run analysis to generate report.”

Constraints:
- No LLM required for v1.
- Deterministic compilation only.
