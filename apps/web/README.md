
  # Design DealDecision AI Dashboard

  This is a code bundle for Design DealDecision AI Dashboard. The original project is available at https://www.figma.com/design/afpjvsgj74SZGILLrzIVDA/Design-DealDecision-AI-Dashboard.

  ## Running the code

  - Install deps: `pnpm install`
  - Dev server: `pnpm dev`
  - Typecheck: `pnpm typecheck`
  - Tests (Vitest + RTL, jsdom): `pnpm test`

  Notes:
  - The package uses `"type": "module"` to avoid Vite CJS API warnings during tests.
  - Env: ensure `apps/web/.env` sets `VITE_API_BASE_URL` and `VITE_BACKEND_MODE` (e.g., `live` for real API).
  