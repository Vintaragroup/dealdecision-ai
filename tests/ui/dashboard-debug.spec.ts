import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { attachNetworkLogger, printApiSummary, saveNetworkLog } from './helpers/network';
import { attachConsoleLogger, printConsoleSummary } from './helpers/console';
import { dumpBrowserStorage, printStorageSummary } from './helpers/storage';
import { traceAllWidgets, type TraceWidgetOptions } from './helpers/widget-trace';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// Adjust these constants to match the environment you're debugging against.
// ─────────────────────────────────────────────────────────────────────────────

/** Base URL of the DealDecision API. Used to filter network responses. */
const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? 'http://localhost:9000';

/** Route to navigate to. The main dashboard lives at /app. */
const DASHBOARD_ROUTE = '/app';

/**
 * When PLAYWRIGHT_INTERACTIVE=1 the spec will call page.pause() so you can
 * inspect the page interactively with Playwright Inspector.
 * Run with:  PLAYWRIGHT_INTERACTIVE=1 pnpm test:ui:debug
 */
const INTERACTIVE = process.env.PLAYWRIGHT_INTERACTIVE === '1';

/** Directory where per-run artifacts (network logs, DOM snapshots) are saved. */
const ARTIFACTS_DIR = path.resolve(__dirname, '../../playwright-artifacts');

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET CONFIG
//
// Each entry maps a visible dashboard widget (by data-testid) to one or more
// API endpoint URL fragments whose responses likely populated it.
//
// TODO: These are placeholder values. Update them once:
//   1. data-testid attributes are added to the widget root elements in React
//      (apps/web/src/components/ — search for major dashboard cards/tables)
//   2. The real API endpoint paths are confirmed from browser DevTools or
//      the network log printed by this spec.
//
// Widgets without a matching data-testid will be skipped with a warning
// rather than failing the test.
// ─────────────────────────────────────────────────────────────────────────────
const WIDGETS: TraceWidgetOptions[] = [
  {
    // TODO: Add data-testid="deals-list" to the deals list container
    name: 'Deals List',
    testId: 'deals-list',
    endpointFragments: ['/deals'],
  },
  {
    // TODO: Add data-testid="deal-summary-card" to the deal summary card
    name: 'Deal Summary Card',
    testId: 'deal-summary-card',
    endpointFragments: ['/deals/summary', '/deals/'],
  },
  {
    // TODO: Add data-testid="analysis-report" to the analysis score panel
    name: 'Analysis Report / Score',
    testId: 'analysis-report',
    endpointFragments: ['/report'],
  },
  {
    // TODO: Add data-testid="investor-insights" to the insights panel
    name: 'Investor Insights',
    testId: 'investor-insights',
    endpointFragments: ['/insights'],
  },
  {
    // TODO: Add data-testid="fundability-panel" to the fundability widget
    name: 'Fundability Assessment',
    testId: 'fundability-panel',
    endpointFragments: ['/fundability', '/report'],
  },
  {
    // TODO: Add data-testid="evidence-panel" to the evidence/citations widget
    name: 'Evidence Panel',
    testId: 'evidence-panel',
    endpointFragments: ['/evidence'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SPEC
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Dashboard — data flow debug trace', () => {
  test('capture all network traffic and dashboard state', async ({ page }) => {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(ARTIFACTS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    // ── 1. Attach loggers BEFORE navigation ────────────────────────────────
    // Network logger captures every request/response from the moment it's attached.
    const network = attachNetworkLogger(page, {
      // TODO: Add additional URL fragments here to focus on specific endpoints.
      // e.g. urlFilters: ['/api/deals', '/api/reports', '/api/insights']
      urlFilters: [],
      verbose: true,
    });

    // Console logger captures console.error, console.warn, and uncaught page errors.
    const consoleLogs = attachConsoleLogger(page, { verbose: false });

    // ── 2. Navigate to the dashboard ───────────────────────────────────────
    console.log(`\n[debug] Navigating to ${DASHBOARD_ROUTE}`);
    await page.goto(DASHBOARD_ROUTE);

    // ── 3. Wait for the app to stabilize ──────────────────────────────────
    // Waits for network to go idle (no requests for 500ms) or the timeout.
    // Adjust the selector below if the dashboard has a stable "loaded" indicator.
    await page.waitForLoadState('networkidle');

    // TODO: Replace with a more specific selector if the dashboard has a
    // reliable "data loaded" indicator, e.g.:
    //   await page.waitForSelector('[data-testid="deals-list"]', { timeout: 15000 });
    //   await page.waitForSelector('[data-testid="dashboard-ready"]');
    console.log('[debug] Page reached networkidle state');

    // ── 4. Optional: interactive pause ────────────────────────────────────
    // Set PLAYWRIGHT_INTERACTIVE=1 to stop here and inspect manually.
    if (INTERACTIVE) {
      console.log('[debug] Interactive mode — pausing. Close inspector to continue.');
      await page.pause();
    }

    // ── 5. Dump browser storage ───────────────────────────────────────────
    const storage = await dumpBrowserStorage(page);
    printStorageSummary(storage);
    fs.writeFileSync(
      path.join(runDir, 'storage.json'),
      JSON.stringify(storage, null, 2),
      'utf-8',
    );

    // ── 6. Save DOM snapshot ──────────────────────────────────────────────
    const html = await page.content();
    fs.writeFileSync(path.join(runDir, 'dom-snapshot.html'), html, 'utf-8');
    console.log(`[debug] DOM snapshot saved → ${runDir}/dom-snapshot.html`);

    // ── 7. Print and save network log ─────────────────────────────────────
    printApiSummary(network, API_BASE);
    saveNetworkLog(network, path.join(runDir, 'network.json'));

    if (network.failures.length > 0) {
      console.warn(`\n[debug] ${network.failures.length} FAILED request(s):`);
      for (const f of network.failures) {
        console.warn(`  ✗ ${f.url} — ${f.errorText}`);
      }
    }

    // ── 8. Print console summary ──────────────────────────────────────────
    printConsoleSummary(consoleLogs);

    // ── 9. Summarize which endpoints populated dashboard widgets ──────────
    //
    // TODO: Update endpoint fragments below to match DealDecision's API routes.
    // This section helps answer "which endpoint fed which widget".
    //
    // Common DealDecision endpoints to look for:
    //   /report          → main analysis report (overall score, evidence)
    //   /deals           → deals list
    //   /insights        → investor insights / slide summaries
    //   /health          → API health (should always be 200)
    //   /debug-env       → feature flag state
    //
    const ENDPOINT_MAP: Record<string, string> = {
      '/deals': 'Deals list widget',
      '/report': 'Analysis report / score widget',
      '/insights': 'Investor insights panel',
      '/health': 'API health check',
      '/debug-env': 'Feature flag status panel',
      '/fundability': 'Fundability assessment widget',
      '/evidence': 'Evidence items / citations panel',
    };

    console.log('\n──────── Widget → Endpoint Mapping ────────');
    for (const [fragment, widgetName] of Object.entries(ENDPOINT_MAP)) {
      const hits = network.responses.filter((r) => r.url.includes(fragment));
      if (hits.length > 0) {
        for (const h of hits) {
          const ok = h.status >= 200 && h.status < 300 ? '✓' : '✗';
          console.log(`  ${ok} ${widgetName}`);
          console.log(`       ${h.status} ${h.url.replace(API_BASE, '')}`);
          if (h.body && typeof h.body === 'object') {
            const topKeys = Object.keys(h.body as object).slice(0, 6);
            console.log(`       payload keys: ${topKeys.join(', ')}`);
          }
        }
      }
    }
    console.log('────────────────────────────────────────────\n');

    // ── 10. Widget → endpoint tracing ─────────────────────────────────────
    // Locates each widget by data-testid, reads its rendered text, and
    // correlates it to the most likely matching API response.
    //
    // Widgets whose data-testid is not present in the DOM are skipped
    // gracefully with a warning — no test failure.
    //
    // TODO: Add data-testid attributes to dashboard widget root elements
    // and update WIDGETS config above before relying on these results.
    console.log('[debug] Running widget → endpoint trace…');
    const widgetResults = await traceAllWidgets(page, network.responses, WIDGETS);

    // Save widget trace results for post-run inspection
    fs.writeFileSync(
      path.join(runDir, 'widget-trace.json'),
      JSON.stringify(widgetResults, null, 2),
      'utf-8',
    );
    console.log(`[debug] Widget trace saved → ${runDir}/widget-trace.json`);

    console.log(`\n[debug] Artifacts for this run saved to:\n  ${runDir}`);
    console.log('[debug] Trace file will be in playwright-report/ after the run.\n');
  });
});
