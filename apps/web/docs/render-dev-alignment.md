# Render ↔ Dev Alignment

Explains how to ensure Render deploys the exact same branch/commit as your local dev session, and how to verify it.

---

## (a) Ensuring Render deploys the same branch/commit as dev

### 1. Check which branch Render is tracking

1. Open **Render Dashboard → [service name] → Settings → Deploy**
2. Under **"Auto-Deploy"** / **"Branch"**, confirm the branch matches what you have checked out locally.
3. If Render shows `main` but you are working on `feature/execution-ready-v1`, you either need to:
   - Merge/cherry-pick your branch to `main`, **or**
   - Change the Render service to track your feature branch (Settings → Branch)

### 2. Trigger a manual deploy from the correct commit

If Render last deployed an older commit (even on the right branch):

1. Push your latest commit: `git push origin <branch>`
2. In Render Dashboard → **Manual Deploy** → **Deploy latest commit**

### 3. Confirm the commit in Render deploy logs

Every Render deploy prints the commit SHA near the top of its build logs:

```
==> Cloning from https://github.com/…
==> Checking out commit a1b2c3d in branch feature/execution-ready-v1
```

Compare that SHA to your local branch tip:

```bash
git rev-parse --short HEAD
# → a1b2c3d  ✅ matches
```

---

## (b) Verifying the deployed commit SHA

### Option 1 — Render build logs (most reliable)

No code changes needed. In the Render Dashboard:

- **Deploys → [most recent deploy] → Logs**
- Search for `Checking out commit` — the short SHA printed there is ground truth.

### Option 2 — API `/health` endpoint

The API `/health` endpoint returns the commit SHA that Render injected when the **API** container was built:

```bash
curl -s https://<your-api-host>/health | jq '{sha, build_time}'
# → { "sha": "a1b2c3d", "build_time": "unknown" }
```

`sha` is populated from `RENDER_GIT_COMMIT` which Render automatically injects for every service. `build_time` defaults to `"unknown"` unless `API_BUILD_TIME` is set as a Render env var.

### Option 3 — Debug console log (gated, dev-friendly)

The web bundle includes a `buildFingerprint` object populated from `VITE_BUILD_SHA` (set at build time from `RENDER_GIT_COMMIT`). It is **not** logged automatically. To inspect it:

**Method A — DevTools helper (any environment):**
```js
// In browser DevTools console:
window.__ddaiBuildFingerprint()
// → { sha: 'a1b2c3d', time: 'unknown', env: 'production' }
```

**Method B — Workspace debug mode:**
Enable `?debug=1` in the URL or run `localStorage.setItem('ddai:debugDealWorkspace', '1')` in the console, then look for `[DDAI][build_fingerprint]` in any workspace-level debug log.

> **Note:** `time` will be `'unknown'` unless `VITE_BUILD_TIME` is set as a Render env var. The `sha` is the only field that matters for commit alignment.

---

## Quick checklist

```
[ ] git log --oneline -1                           → your expected SHA
[ ] Render build logs → "Checking out commit ..."  → must match
[ ] curl /health | jq .sha                         → API SHA
[ ] window.__ddaiBuildFingerprint()                → web bundle SHA
[ ] All three match?  →  ✅ dev and Render are aligned
```
