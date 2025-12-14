# Copilot Prompt — Generate DealDecision AI Monorepo Foundation

You are setting up the **foundation of the DealDecision AI monorepo**.

This step is **foundational only**.  
⚠️ Do NOT implement application logic.  
⚠️ Do NOT scaffold frontend UI code.  
⚠️ Do NOT add business rules yet.

---

## Objective

Create the **base folder structure, configuration files, and placeholders** for a pnpm monorepo that will later contain:

- `apps/web` (frontend UI — will be added manually later)
- `apps/api` (Fastify backend)
- `apps/worker` (BullMQ workers)
- `packages/contracts` (shared TypeScript contracts)
- `packages/core` (HRM rules + report compiler)
- `infra` (docker + migrations)
- `docs` (architecture + Copilot instructions)

---

## Constraints (Non-Negotiable)

- API must run on **localhost:9000**
- pnpm workspaces must be used
- TypeScript everywhere
- No ORMs yet
- No frontend UI scaffolding
- No LLM logic
- No business logic
- No mock data
- No cloud IaC

This is **structure and config only**.

---

## Tasks

### 1️⃣ Create folder structure

```
dealdecision-ai/
  apps/
    api/
    worker/
    web/               # empty placeholder only
  packages/
    contracts/
    core/
  infra/
    migrations/
  docs/
    copilot/
  .vscode/
```

---

### 2️⃣ Create root config files

#### `pnpm-workspace.yaml`
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

#### `package.json`
- private repo
- pnpm as package manager
- scripts:
  - `dev`
  - `typecheck`
  - `infra:up`
  - `infra:down`

#### `tsconfig.base.json`
- strict TypeScript
- ES2022 target
- shared across all packages

#### `.env.example`
```bash
API_PORT=9000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dealdecision
REDIS_URL=redis://localhost:6379
VITE_API_BASE_URL=http://localhost:9000
VITE_BACKEND_MODE=live
```

---

### 3️⃣ Scaffold apps/api (NO logic)

Create:
- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/src/index.ts`

`index.ts` should:
- start a Fastify server
- listen on `process.env.API_PORT || 9000`
- expose `GET /api/v1/health` returning `{ ok: true }`

No DB usage yet.

---

### 4️⃣ Scaffold apps/worker (NO logic)

Create:
- `apps/worker/package.json`
- `apps/worker/tsconfig.json`
- `apps/worker/src/index.ts`

`index.ts` should just log:
```ts
console.log("DealDecision worker started");
```

---

### 5️⃣ Scaffold packages/contracts (types only)

Create:
- `packages/contracts/package.json`
- `packages/contracts/tsconfig.json`
- `packages/contracts/src/index.ts`

Add placeholder export:
```ts
export type Placeholder = {};
```

---

### 6️⃣ Scaffold packages/core (empty logic container)

Create:
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/index.ts`

Export an empty object.

---

### 7️⃣ Infra: Docker base services only

Create `infra/docker-compose.yml` with:
- postgres (5432)
- redis (6379)

No api/web/worker containers yet.

---

### 8️⃣ VS Code settings

Create `.vscode/settings.json`:
- workspace TypeScript
- eslint workspace awareness

---

### 9️⃣ Docs placeholders

Create empty or stub files in `/docs`:
- `01_System_Foundations.md`
- `07_Backend_Requirements_and_Architecture.md`
- `08_Frontend_Update_Instructions_for_Copilot.md`
- `04_Rules.mdc`

---

## Output Requirements

At the end, output:
1) A list of all created files  
2) Commands to run:
```bash
pnpm install
pnpm infra:up
pnpm dev
```
3) Confirmation that:
- API responds at `http://localhost:9000/api/v1/health`
- `apps/web` is empty and ready for UI drop-in

---

Once complete:
- I will manually copy the existing frontend UI into `apps/web`
- Then proceed with the Sequential Copilot Prompts (v2)
