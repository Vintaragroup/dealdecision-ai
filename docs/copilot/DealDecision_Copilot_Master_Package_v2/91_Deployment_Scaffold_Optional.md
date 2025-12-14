# Optional — Deployment Scaffold

Goal: Add Dockerfiles and deployment scripts for:
- apps/api
- apps/worker

Requirements:
- Use environment variables for DATABASE_URL and REDIS_URL
- Ensure migrations run before API starts (or via separate release step)
- Keep web deployed separately (static host or node)

Do not add cloud-specific IaC unless requested.
