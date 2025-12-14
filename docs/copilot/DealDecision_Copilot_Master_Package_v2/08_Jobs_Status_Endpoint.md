# Copilot Prompt 08 — Jobs Status Endpoint

Implement:
- GET /api/v1/jobs/:job_id

Requirements:
- Return JobStatus from DB (not from BullMQ directly).
- Include error info when status=error.
- This endpoint will power frontend polling and Job Center.
