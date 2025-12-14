# Optional — SSE Events

Backend:
- GET /api/v1/events?deal_id=...
  - emit job.updated, document.updated, dio.created

Web:
- Subscribe in Deal Workspace
- Update job/document/DIO states live

Fallback:
- Keep polling if SSE fails.
