# Playwright UI Debugging — DealDecision

Playwright is configured as a **UI observability layer** for the DealDecision dashboard. It captures network traffic, console errors, browser storage, and full traces so you can pinpoint exactly where dashboard data comes from, what the API returned, and whether the frontend rendered it correctly.

---

## Quick start

### 1. Install Playwright browsers (one time)

```bash
pnpm playwright:install
```

This installs the Chromium browser binary used by all specs.

---

### 2. Log in and save your session (one time)

Playwright needs a cached Clerk session so it doesn't have to log in on every run.

**Option A — with email/password credentials:**

```bash
PLAYWRIGHT_EMAIL=you@example.com PLAYWRIGHT_PASSWORD=yourpassword pnpm test:ui:login
```

**Option B — log in manually (SSO, magic link, etc.):**

```bash
pnpm test:ui:login
# A browser window will open at /sign-in.
# Log in normally, then close the browser.
# Playwright saves the session automatically.
```

This creates `playwright/.auth/user.json` (gitignored). Re-run this step if you get logged-out errors.

---

### 3. Start the dev server

The frontend must be running before tests execute.

```bash
pnpm --filter web dev
# → http://localhost:5173
```

If you're also hitting the API locally:

```bash
docker compose -f docker-compose.local.yml --profile dev up -d
```

---

### 4. Run the dashboard debug spec

```bash
pnpm test:ui
```

This runs all specs under `tests/ui/` against the running dev server.

**Interactive mode** (opens a live browser you can inspect):

```bash
pnpm test:ui:debug
```

In interactive mode the browser pauses at `page.pause()` and opens Playwright Inspector. You can click around, inspect network, and resume from the Inspector UI.

---

### 5. Open and inspect traces

After every run, a trace zip is saved in `playwright-report/`. Open it with:

```bash
pnpm trace:open playwright-report/data/<trace-id>.zip
```

Or pass any trace file directly:

```bash
pnpm trace:open test-results/dashboard-debug-chromium/trace.zip
```

The trace viewer shows:
- **Timeline** of every action and navigation
- **Network panel** — every request/response with timing
- **DOM snapshots** at each point in time — step through the exact state of the page
- **Console log** panel — errors, warnings, log entries

---

## What the dashboard debug spec captures

`tests/ui/dashboard-debug.spec.ts` runs against `/app` and records:

| What | Where it's saved |
|---|---|
| All network requests + responses | `playwright-artifacts/<run-id>/network.json` |
| localStorage + sessionStorage | `playwright-artifacts/<run-id>/storage.json` |
| DOM snapshot (full page HTML) | `playwright-artifacts/<run-id>/dom-snapshot.html` |
| Console errors and warnings | stdout during test run |
| Page (JS) errors | stdout during test run |
| Full browser trace | `playwright-report/` (automatic) |

### API response summary

At the end of each run, the spec prints a table to stdout showing which API endpoints were called and what top-level keys their responses contained:

```
──────── Widget → Endpoint Mapping ────────
  ✓ Deals list widget
       200 /deals
       payload keys: deals, total, page
  ✓ Analysis report / score widget
       200 /report
       payload keys: score, evidence_factor, adjustment_factor, applied
  ...
```

This answers: **which endpoint populated which widget**.

---

## How to use the logs to debug dashboard issues

### "A widget is empty / showing stale data"

1. Open `network.json` from the run — find the endpoint that feeds that widget
2. Check `body` — did the API return the expected fields?
3. If the response has data but the widget is empty, the issue is in the frontend transform
4. Open the trace viewer and step through DOM snapshots to see when the widget changed

### "The page shows an error state"

1. Check stdout — console errors and page errors are printed there
2. Check `network.json` for responses with status ≥ 400
3. Check the `failures` array for requests that never completed

### "Timing / race condition suspected"

1. Open the trace viewer → Network tab
2. Look at the waterfall — what resolved first?
3. Check if a widget rendered before its data fetch completed

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:5173` | Frontend URL to test against |
| `PLAYWRIGHT_API_BASE` | `http://localhost:9000` | API base URL for filtering network logs |
| `PLAYWRIGHT_EMAIL` | _(unset)_ | Clerk login email for auth setup |
| `PLAYWRIGHT_PASSWORD` | _(unset)_ | Clerk login password for auth setup |
| `PLAYWRIGHT_INTERACTIVE` | `0` | Set to `1` to pause at `page.pause()` for manual inspection |
| `HEADLESS` | `0` | Set to `1` for headless mode (CI) |

---

## File structure

```
playwright.config.ts               ← Playwright configuration (base URL, trace, auth)
playwright/.auth/user.json         ← Saved Clerk session (gitignored)
playwright-artifacts/              ← Per-run network/storage/DOM dumps (gitignored)
playwright-report/                 ← HTML report + trace zips (gitignored)
test-results/                      ← Raw test output (gitignored)

tests/ui/
  auth.setup.ts                    ← One-time Clerk login → saves storageState
  dashboard-debug.spec.ts          ← Main dashboard debug spec

tests/ui/helpers/
  network.ts                       ← Request/response capture and logging
  storage.ts                       ← localStorage / sessionStorage dumping
  console.ts                       ← Console message and page error capture
```

---

## Extending to other pages / widgets

To debug a specific deal page:

```typescript
// In a new file: tests/ui/deal-workspace-debug.spec.ts
import { test } from '@playwright/test';
import { attachNetworkLogger, printApiSummary } from './helpers/network';

test('deal workspace data flow', async ({ page }) => {
  const network = attachNetworkLogger(page, {
    urlFilters: ['/deals/', '/report', '/insights'],
  });

  // TODO: Replace with a real deal ID from your dev database
  await page.goto('/app'); // then navigate to a deal
  await page.waitForLoadState('networkidle');

  printApiSummary(network, 'http://localhost:9000');
});
```

To test against the production API (read-only inspection):

```bash
PLAYWRIGHT_BASE_URL=https://your-app.onrender.com \
PLAYWRIGHT_API_BASE=https://your-api.onrender.com \
pnpm test:ui
```

---

## TODOs for project-specific customization

- [ ] **Auth selectors** — verify the Clerk email/password field selectors in `auth.setup.ts` match your Clerk component version. If they don't match, use interactive mode to log in once.
- [ ] **Dashboard selectors** — add a `waitForSelector('[data-testid="..."]')` in `dashboard-debug.spec.ts` once you've added `data-testid` attributes to key widgets.
- [ ] **Endpoint map** — update `ENDPOINT_MAP` in `dashboard-debug.spec.ts` to match the actual API paths used by each dashboard widget.
- [ ] **CI integration** — set `HEADLESS=1`, `CI=1`, and supply credentials as repository secrets when wiring into GitHub Actions.
