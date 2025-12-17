# Frontend API Reference and Data Needs

This document maps the current frontend (apps/web) to the backend APIs required to fully populate the UI, and lists gaps the backend must fill.

## Environment switches
- `VITE_BACKEND_MODE=live` (otherwise the UI uses mock data for many surfaces)
- `VITE_API_BASE_URL=http://localhost:9000` (default if unset)

## Core endpoints in use
| Area | Endpoint | Method | Request (fields used) | Response fields the UI reads |
| --- | --- | --- | --- | --- |
| Deals list | `/api/v1/deals` | GET | none | `id`, `name`, `stage`, `priority`, `trend?`, `score?`, `owner?`, `lastUpdated?` *(UI also renders documents/completeness/views/fundingTarget but those are currently mock-only)* |
| Deal detail | `/api/v1/deals/:deal_id` | GET | path `deal_id` | Base deal fields above + `dioVersionId?`, `dioStatus?`, `lastAnalyzedAt?` |
| Create deal | `/api/v1/deals` | POST | `{ name, stage ('idea'|'progress'|'ready'|'pitched'), priority ('high'|'medium'|'low'), trend?, score?, owner? }` | Deal object (id, fields above) |
| Update deal | `/api/v1/deals/:deal_id` | PUT | partial of create payload | Deal object |
| Delete deal | `/api/v1/deals/:deal_id` | DELETE | path `deal_id` | Deal object |
| Analyze | `/api/v1/deals/:deal_id/analyze` | POST | path `deal_id` | `{ job_id, status }` |
| Jobs | `/api/v1/jobs/:job_id` | GET | path `job_id` | `{ job_id, status, progress_pct?, message?, updated_at? }` |
| Events (SSE) | `/api/v1/events?deal_id=...&cursor=` | GET (SSE) | query `deal_id`, optional `cursor` (Last-Event-ID supported) | `job.updated` events: `{ job_id, status, progress_pct?, message?, deal_id?, type?, updated_at? }` |
| Documents list | `/api/v1/deals/:deal_id/documents` | GET | path `deal_id` | `{ documents: [{ document_id, deal_id, title, type, status, uploaded_at? }] }` |
| Upload document | `/api/v1/deals/:deal_id/documents` | POST (multipart) | FormData: `file`, `type`, optional `title` | `{ document, job_status }` |
| Retry document | `/api/v1/deals/:deal_id/documents/:document_id/retry` | POST | path `deal_id`, `document_id` | status payload (not strongly typed in UI) |
| Evidence list | `/api/v1/deals/:deal_id/evidence` | GET | path `deal_id` | `{ evidence: [{ evidence_id, deal_id, document_id?, source, kind, text, excerpt?, created_at? }] }` |
| Fetch evidence | `/api/v1/evidence/fetch` | POST | `{ deal_id, filter? }` | `{ job_id, status }` |
| Chat (workspace) | `/api/v1/chat/workspace` | POST | `{ message }` | `WorkspaceChatResponse` (UI expects text + citations) |
| Chat (deal) | `/api/v1/chat/deal` | POST | `{ message, deal_id, dio_version_id? }` | `DealChatResponse` |

## Frontend surfaces and required data
- DealsList (live mode): needs `id, name, stage, priority, trend, score?, owner?, lastUpdated?`. UI also renders `documents, completeness, fundingTarget, views` — currently mock-only; add these to deals payload or a companion stats endpoint.
- NewDealModal: creates deals via POST; uses company as `owner`, stage mapping (`mvp→progress`, `growth→ready`, `scale→pitched` fallback to `idea`).
- DealWorkspace: fetches deal detail (for DIO meta), triggers analyze, polls jobs, listens to SSE events, loads evidence. Content sections (description, metrics, revenue, team size) are mostly static fallbacks today; would come from enriched deal detail if provided.
- DocumentsTab: lists documents, uploads files, retries processing. Expects document `type` and `status` enums to match contracts.
- Evidence panel: reads evidence array; refreshes via fetch-evidence job.
- Chat (workspace/deal assistants): uses chat endpoints; requires text and citation payloads from backend responses.
- Dashboard/summary tiles: currently mock; would need aggregates (total deals, by stage, avg score, views per week) to go live.

## Missing / to add for full data coverage
- Swagger/OpenAPI docs/UI (none configured yet).
- Deal metrics in list/detail: `documents`, `completeness %`, `views`, `fundingTarget`, `description`, `type`, `revenue`, `team size`, `growth`, etc.
- Aggregates for dashboard: counts by stage, avg scores, weekly views.
- Export/templates/gamification/report comparison endpoints (UI buttons are present but mock/static).

## Suggested backend additions
1) Add Swagger (`@fastify/swagger` + UI at `/docs`) with schemas.
2) Enrich deal query/DTO to include the metrics the UI renders (documents count, completeness, views, funding target, description/owner display) or add a `/api/v1/deals/:id/summary`/`/stats` endpoint.
3) Provide dashboard aggregates endpoint.
4) Define response shapes for chat and evidence jobs in the spec so the UI can rely on them.
