# Deploy Fingerprint — Verification Checklist

> **Purpose:** Prove which commit and runtime config the Render-deployed web UI is serving, and whether it matches local dev or the expected branch.

---

## 1. What Was Added

| Artifact | Location | What it does |
|---|---|---|
| `VITE_BUILD_SHA` define | `apps/web/vite.config.ts` | Bakes the git SHA into the bundle at compile time |
| `VITE_BUILD_TIME` define | `apps/web/vite.config.ts` | Bakes the ISO-8601 UTC build timestamp |
| `VITE_APP_ENV` define | `apps/web/vite.config.ts` | Bakes the environment label |
| `buildFingerprint.ts` | `apps/web/src/lib/buildFingerprint.ts` | Exports `{ sha, time, env }`; fires `[DDAI][build_fingerprint]` console log on import |
| `BuildFingerprintBadge` | `apps/web/src/components/BuildFingerprintBadge.tsx` | Fixed bottom-right badge in the UI (click SHA to copy full JSON) |
| `/health` `sha` + `build_time` | `apps/api/src/routes/health.ts` | Returns API commit SHA (from `RENDER_GIT_COMMIT`) and build time |
| `dealdecision-web` service | `render.yaml` | Render Static Site — `buildCommand` uses `pnpm --filter web build` |

### How the SHA is resolved (priority order)

**Web UI (`vite.config.ts`):**
1. `VITE_BUILD_SHA` env var (explicit override — useful for local CI tests)
2. `RENDER_GIT_COMMIT` — injected automatically by Render for every build
3. `git rev-parse --short HEAD` via `execSync` — works on any dev machine with git
4. `'unknown'` — final fallback (e.g. Docker build without git)

**API (`/health`):**
1. `RENDER_GIT_COMMIT` — injected automatically by Render
2. `API_BUILD_SHA` env var — manual override
3. `'unknown'`

---

## 2. Step-by-Step Verification

### Step 1 — Identify the expected commit

```bash
# On your local machine (or CI):
git log --oneline -5
# Pick the commit you believe Render deployed. Example: a1b2c3d "fix: score contract"
```

### Step 2 — Check Render deploy logs for the web service

1. Open **Render Dashboard → dealdecision-web → Deploys**
2. Click the most recent deploy
3. In the **Build Logs**, search for: `RENDER_GIT_COMMIT`
   - Render prints it near the top of every build. It should match the commit you expect.
4. Also look for the Vite build output line — it won't print the SHA directly, but you can confirm the build succeeded at the right commit.

### Step 3 — Compare SHA in the UI badge

1. Open the deployed web UI in a browser
2. Look at the **bottom-right corner** — you'll see a pill like:  
   `production · a1b2c3d · 2026-02-20`
3. The `a1b2c3d` part must match the commit SHA from Step 1 and Step 2
4. Click the pill to copy the full fingerprint JSON to clipboard:
   ```json
   {
     "sha": "a1b2c3d",
     "time": "2026-02-20T18:05:32.000Z",
     "env": "production"
   }
   ```

### Step 4 — Check via browser console

1. Open DevTools → Console
2. Search for `[DDAI][build_fingerprint]`
3. You should see an object like:
   ```
   [DDAI][build_fingerprint] { sha: 'a1b2c3d', time: '2026-02-20T18:05:32.000Z', env: 'production' }
   ```
4. This fires once on every fresh page load — no refresh needed if DevTools was open.

### Step 5 — Compare web SHA vs API SHA

```bash
# Fetch the API health endpoint (replace with your Render API URL):
curl -s https://dealdecision-api.onrender.com/health | jq '{sha, build_time}'
```

Expected output:
```json
{
  "sha": "a1b2c3d",
  "build_time": "unknown"
}
```

> **Note:** `build_time` will be `"unknown"` on the API until `API_BUILD_TIME` is set as a Render env var. The `sha` is the important field — it should match the web UI badge.

If the web SHA ≠ API SHA, one of these services deployed from a different commit — proceed to Step 7.

---

## 3. Hard-Refresh and CDN Cache Invalidation

Render Static Sites are served via their CDN. A stale CDN cache can serve an old bundle even after a successful deploy.

```bash
# 1. Hard refresh (bypasses browser cache, but NOT the CDN):
#    macOS Chrome: Cmd+Shift+R
#    macOS Firefox: Cmd+Shift+R

# 2. Open in a Private/Incognito window to rule out local cache entirely.

# 3. Append a cache-buster query string (forces CDN miss):
#    https://app.dealdecision.ai/?_bust=1

# 4. Check the response headers for Cache-Control and Age:
curl -sI https://app.dealdecision.ai/ | grep -Ei "cache-control|age|x-render"
```

The `render.yaml` for `dealdecision-web` sets:
```
Cache-Control: public, max-age=0, must-revalidate   (for index.html and all routes)
Cache-Control: public, max-age=31536000, immutable  (for /assets/* — content-hashed filenames)
```

This means:
- `index.html` should **always** be re-fetched (max-age=0)
- `/assets/index-[hash].js` is cached forever but the filename changes with each build
- If you still see an old SHA after a hard refresh, the CDN layer may need a manual purge from the Render dashboard

---

## 4. Confirm Which Branch Render Is Tracking

1. **Render Dashboard → dealdecision-web → Settings → Deploy**
2. Under **"Auto-Deploy"**, confirm the branch shown matches your expected branch (e.g. `main` or `feature/execution-ready-v1`)
3. If Render is tracking a branch that diverged from your expected commit, the deployed SHA will differ

```bash
# Locally: check which commit is at the tip of the Render-tracked branch:
git log --oneline origin/main | head -1
# or:
git log --oneline origin/feature/execution-ready-v1 | head -1
```

---

## 5. Render-Specific Gotchas

| Symptom | Likely cause | Fix |
|---|---|---|
| Badge shows `unknown` for SHA | Build ran without `RENDER_GIT_COMMIT` (shouldn't happen on Render; means local build) | Set `VITE_BUILD_SHA=$(git rev-parse --short HEAD)` locally or use `pnpm build:ci` |
| Badge shows `dev` for SHA | Running local dev server (`vite dev`), not a production build | Expected — dev server does not have a baked SHA |
| Badge shows old SHA after redeploy | CDN caching `index.html` | Hard-refresh, check Cache-Control headers, purge CDN from Render dashboard |
| API `/health` sha = `unknown` | Render API service not yet redeployed, or `RENDER_GIT_COMMIT` not populated | Trigger a manual redeploy of `dealdecision-api`; check Render build logs |
| Web SHA ≠ API SHA | Services deployed from different commits | Check both deploy timestamps in Render dashboard and redeploy from the same commit |
| Badge not visible | AppShell not mounted (e.g. sign-in page) | Sign in — badge only renders inside the authenticated `AppShell` |

---

## 6. Local Build Verification

To produce a fingerprinted build locally (without deploying):

```bash
# Option A: use the build:ci script (injects SHA + timestamp via shell):
pnpm --filter web build:ci

# Option B: set vars manually:
VITE_BUILD_SHA=$(git rev-parse --short HEAD) \
VITE_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
VITE_APP_ENV=staging \
pnpm --filter web build

# Preview the built output locally:
pnpm --filter web preview
# Then open http://localhost:4173 — badge should show the SHA you just computed.
```

---

## 7. Quick URL Summary

| Endpoint | What to check |
|---|---|
| `GET /health` | `sha` (API commit) + `db` (connectivity) |
| `GET /api/v1/health` | `{ ok: true }` — lightweight liveness |
| Web UI bottom-right badge | `sha` · `env` · build date |
| Browser console `[DDAI][build_fingerprint]` | Full `{ sha, time, env }` object |
