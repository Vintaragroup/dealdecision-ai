# DealDecision AI — Monorepo Scaffold Plan (pnpm workspaces)

This is a minimal, cost-effective monorepo scaffold to run:
- `apps/web` (Vite + React + TS)
- `apps/api` (Fastify + TS)
- `apps/worker` (BullMQ workers + TS)
- `packages/contracts` (shared TS types)
- `packages/core` (HRM rules + report compiler + shared utils)

---

## 1) Target repo structure

```
dealdecision-ai/
  apps/
    web/
    api/
    worker/
  packages/
    contracts/
    core/
  docs/
  infra/
  .vscode/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  .env.example
```

---

## 2) Package manager & tooling

### pnpm workspace file: `pnpm-workspace.yaml`
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Root `package.json` (scripts)
```json
{
  "name": "dealdecision-ai",
  "private": true,
  "packageManager": "pnpm@9",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "format": "pnpm -r format",
    "infra:up": "docker compose -f infra/docker-compose.yml up -d",
    "infra:down": "docker compose -f infra/docker-compose.yml down",
    "db:migrate": "pnpm --filter @dealdecision/api db:migrate"
  }
}
```

### `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

---

## 3) apps/api (Fastify) minimum skeleton

### `apps/api/package.json`
```json
{
  "name": "@dealdecision/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "db:migrate": "node ./src/db/migrate.js"
  },
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/cors": "^9.0.0",
    "@fastify/rate-limit": "^9.1.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

### API responsibilities (v1)
- Auth validation (optional stub)
- Deals CRUD
- Documents upload + list
- Jobs status
- Analyze trigger
- DIO fetch
- Report DTO fetch
- Evidence search/fetch/read
- Chat endpoints (workspace + deal) **returning actions, evidence IDs only**

---

## 4) apps/worker (BullMQ) minimum skeleton

### `apps/worker/package.json`
```json
{
  "name": "@dealdecision/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "bullmq": "^5.16.0",
    "ioredis": "^5.4.1"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

### Worker responsibilities (v1 jobs)
- `ingest_document` (store blob, extract text placeholder)
- `fetch_evidence` (fetch + normalize placeholder)
- `analyze_deal` (create DIO placeholder)
- update job progress + status in DB

---

## 5) packages/contracts (shared types)

### `packages/contracts/package.json`
```json
{
  "name": "@dealdecision/contracts",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

Must include:
- Deal, Document, Job, Evidence, DIO, ReportDTO, ChatAction, ChatResponse

---

## 6) packages/core (HRM rules + report compiler)

This is a pure library used by API + worker:
- deterministic report compiler: `DIO -> ReportDTO`
- HRM rubric + stop conditions (v1 simple)
- evidence scoring helpers (non-LLM)

---

## 7) infra/docker-compose.yml (local dev)

Create `infra/docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_USER: postgres
      POSTGRES_DB: dealdecision
    ports: ["5432:5432"]
    volumes:
      - dd_pg:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports: ["6379:6379"]
    volumes:
      - dd_redis:/data

volumes:
  dd_pg:
  dd_redis:
```

Optional later: MinIO for S3-compatible object storage.

---

## 8) Environment variables (root `.env.example`)

```bash
# API
API_PORT=8080
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dealdecision
REDIS_URL=redis://localhost:6379

# Web
VITE_API_BASE_URL=http://localhost:8080
VITE_BACKEND_MODE=live
```

---

## 9) VS Code workspace settings (optional)
`.vscode/settings.json`:
```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "eslint.workingDirectories": [{ "mode": "auto" }]
}
```

---

## 10) Recommended bootstrap order
1) Create workspace + folders
2) Add root pnpm config + tsconfig.base.json
3) Create `packages/contracts` types
4) Create `apps/api` minimal endpoints (mock in-memory -> DB later)
5) Create `apps/worker` queue processors
6) Wire `apps/web` to API client + live mode
7) Add migrations + DB persistence

This scaffold is intentionally minimal; we will evolve it with the sequential Copilot prompt package.
