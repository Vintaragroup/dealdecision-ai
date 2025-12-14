# Copilot Prompt 09 — Web API Client + Live Mode (API on localhost:9000)

In `apps/web`:
1) Create `src/lib/apiClient.ts` with typed helpers (get/post/put/del).
2) Add env vars:
   - `VITE_API_BASE_URL=http://localhost:9000`
   - `VITE_BACKEND_MODE=mock|live`
3) Update Deals list to use API in live mode:
   - GET /api/v1/deals

Constraints:
- Preserve UI layout.
- Add loading/error states.
- Use @dealdecision/contracts types.
