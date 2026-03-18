import type { Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A captured network response, matching the shape produced by the network
 * logger in helpers/network.ts.
 */
export type NetworkResponseRecord = {
  url: string;
  status: number;
  statusText?: string;
  method?: string;
  body?: unknown;
  contentType?: string | null;
  timestamp?: number;
};

/**
 * Configuration for tracing a single dashboard widget.
 *
 * TODO: Replace testId and endpointFragments values with the real values
 * from the DealDecision app once data-testid attributes are added to widgets.
 */
export type TraceWidgetOptions = {
  /** Human-readable widget name used in terminal output. */
  name: string;

  /**
   * The data-testid attribute value of the widget's root element.
   * e.g. 'deals-list', 'risk-score-panel'
   *
   * TODO: Add data-testid attributes to major dashboard widgets in the React
   * source under apps/web/src/components/. Without these, visibility checks
   * will time out and tracing will be skipped.
   */
  testId: string;

  /**
   * One or more URL substring fragments used to find matching API responses.
   * e.g. ['/deals', '/api/pipeline']
   *
   * If multiple fragments are provided, responses matching ANY fragment are included.
   *
   * TODO: Update these to match actual DealDecision API route paths.
   */
  endpointFragments: string[];

  /**
   * Optional API base URL to strip from displayed URLs for cleaner output.
   * Defaults to the value of PLAYWRIGHT_API_BASE env var or 'http://localhost:9000'.
   */
  apiBase?: string;

  /** Whether to also capture the widget's raw innerHTML. Default: false. */
  includeHtml?: boolean;

  /** Max characters for response body preview. Default: 400. */
  maxBodyChars?: number;

  /**
   * How long to wait (ms) after the widget becomes visible before reading
   * its content. Allows React to finish rendering data. Default: 300.
   */
  settleMs?: number;

  /**
   * Timeout (ms) to wait for the widget to become visible.
   * If the element is not found within this time, the widget is skipped
   * with a warning rather than failing the test. Default: 5000.
   */
  visibilityTimeoutMs?: number;
};

/** A single matched response entry in the trace result. */
export type MatchedResponse = {
  url: string;
  status: number;
  bodyPreview: string;
};

/** The structured result returned by traceWidgetToResponses. */
export type TraceWidgetResult = {
  name: string;
  testId: string;
  /** Whether the widget element was found and visible. */
  found: boolean;
  /** Rendered text content of the widget. Empty string if not found. */
  text: string;
  /** Rendered innerHTML of the widget (only if includeHtml: true). */
  html?: string;
  /** All responses whose URLs matched at least one endpointFragment. */
  matchedResponses: MatchedResponse[];
  /**
   * The single best response candidate:
   * - prefer 2xx status
   * - prefer most recent (highest timestamp)
   * null if no responses matched.
   */
  bestResponse: MatchedResponse | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Body preview helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a response body to a readable, truncated string safe for printing.
 * Handles objects, arrays, strings, nulls, and unserializable values.
 */
export function previewBody(body: unknown, maxChars = 400): string {
  if (body == null) return '(empty)';
  let str: string;
  try {
    str = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  } catch {
    str = String(body);
  }
  if (str.length > maxChars) {
    return str.slice(0, maxChars) + `… [+${str.length - maxChars} chars]`;
  }
  return str;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core tracer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traces a single dashboard widget to its likely API response(s).
 *
 * Steps:
 *  1. Locate the widget by data-testid
 *  2. Wait for it to become visible (skips gracefully if not found)
 *  3. Wait a settle period for React to finish rendering data
 *  4. Read rendered text (and optionally innerHTML)
 *  5. Filter network responses by endpointFragments
 *  6. Pick the best candidate (2xx preferred, then most recent)
 *  7. Print a terminal report
 *  8. Return a structured TraceWidgetResult
 *
 * @example
 *   const result = await traceWidgetToResponses(page, network.responses, {
 *     name: 'Deals List',
 *     testId: 'deals-list',
 *     endpointFragments: ['/deals'],
 *   });
 */
export async function traceWidgetToResponses(
  page: Page,
  responses: NetworkResponseRecord[],
  options: TraceWidgetOptions,
): Promise<TraceWidgetResult> {
  const {
    name,
    testId,
    endpointFragments,
    apiBase = process.env.PLAYWRIGHT_API_BASE ?? 'http://localhost:9000',
    includeHtml = false,
    maxBodyChars = 400,
    settleMs = 300,
    visibilityTimeoutMs = 5000,
  } = options;

  const DIVIDER = '='.repeat(50);
  const label = `Widget Trace: ${name}`;
  console.log(`\n${DIVIDER}`);
  console.log(`  ${label}`);
  console.log(`${DIVIDER}`);
  console.log(`  testId: ${testId}`);

  // ── 1. Locate element ──────────────────────────────────────────────────────
  const locator = page.getByTestId(testId);
  let found = false;
  let text = '';
  let html: string | undefined;

  try {
    await locator.waitFor({ state: 'visible', timeout: visibilityTimeoutMs });
    found = true;
  } catch {
    console.warn(
      `  ⚠ Widget not found or not visible within ${visibilityTimeoutMs}ms.\n` +
        `    Add data-testid="${testId}" to the widget's root element in the React source.\n` +
        `    Skipping DOM read — network match will still run.`,
    );
  }

  // ── 2. Settle + read DOM ───────────────────────────────────────────────────
  if (found) {
    if (settleMs > 0) {
      await page.waitForTimeout(settleMs);
    }
    text = (await locator.innerText().catch(() => '')) ?? '';
    if (includeHtml) {
      html = (await locator.innerHTML().catch(() => '')) ?? '';
    }

    console.log(`  rendered text:`);
    const preview = text.slice(0, 300) + (text.length > 300 ? '…' : '');
    for (const line of preview.split('\n').slice(0, 8)) {
      console.log(`    ${line}`);
    }
  }

  // ── 3. Match responses ─────────────────────────────────────────────────────
  const matched = responses.filter((r) =>
    endpointFragments.some((fragment) => r.url.includes(fragment)),
  );

  // Sort: 2xx first, then by timestamp descending (most recent first)
  const sorted = [...matched].sort((a, b) => {
    const aOk = a.status >= 200 && a.status < 300 ? 1 : 0;
    const bOk = b.status >= 200 && b.status < 300 ? 1 : 0;
    if (bOk !== aOk) return bOk - aOk;
    return (b.timestamp ?? 0) - (a.timestamp ?? 0);
  });

  const matchedResponses: MatchedResponse[] = sorted.map((r) => ({
    url: r.url,
    status: r.status,
    bodyPreview: previewBody(r.body, maxBodyChars),
  }));

  const bestResponse = matchedResponses[0] ?? null;

  // ── 4. Print response report ───────────────────────────────────────────────
  console.log(`  matched responses: ${matched.length}`);

  if (matched.length === 0) {
    console.log(
      `  ⚠ No responses matched fragments: ${endpointFragments.join(', ')}\n` +
        `    Check that endpointFragments match the actual API paths called by this widget.`,
    );
  }

  for (const r of matchedResponses) {
    const ok = r.status >= 200 && r.status < 300 ? '✓' : '✗';
    const displayUrl = r.url.startsWith(apiBase) ? r.url.slice(apiBase.length) : r.url;
    console.log(`  ${ok} ${r.status} ${displayUrl}`);
    console.log(`     ${r.bodyPreview.split('\n').slice(0, 6).join('\n     ')}`);
  }

  if (bestResponse) {
    const displayUrl = bestResponse.url.startsWith(apiBase)
      ? bestResponse.url.slice(apiBase.length)
      : bestResponse.url;
    console.log(`\n  → best candidate: [${bestResponse.status}] ${displayUrl}`);
  }

  console.log(`${DIVIDER}\n`);

  return { name, testId, found, text, html, matchedResponses, bestResponse };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch tracer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs traceWidgetToResponses for each entry in a widget config array and
 * returns all results.
 *
 * @example
 *   const results = await traceAllWidgets(page, network.responses, WIDGETS);
 */
export async function traceAllWidgets(
  page: Page,
  responses: NetworkResponseRecord[],
  widgets: TraceWidgetOptions[],
): Promise<TraceWidgetResult[]> {
  const results: TraceWidgetResult[] = [];
  for (const widget of widgets) {
    const result = await traceWidgetToResponses(page, responses, widget);
    results.push(result);
  }
  return results;
}
