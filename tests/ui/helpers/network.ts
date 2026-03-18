import type { Page, Request, Response } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface CapturedRequest {
  url: string;
  method: string;
  postData: string | null;
  headers: Record<string, string>;
  timestamp: number;
}

export interface CapturedResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  timestamp: number;
}

export interface NetworkLog {
  requests: CapturedRequest[];
  responses: CapturedResponse[];
  failures: { url: string; errorText: string; timestamp: number }[];
}

/**
 * Attaches network listeners to a Playwright page and returns a log object
 * that accumulates all requests, responses, and failures.
 *
 * Call this before navigating to ensure nothing is missed.
 *
 * @example
 *   const network = attachNetworkLogger(page);
 *   await page.goto('/app');
 *   console.log(network.responses); // all responses captured
 */
export function attachNetworkLogger(
  page: Page,
  options: {
    /** Only capture requests whose URL contains one of these strings. Pass empty array to capture all. */
    urlFilters?: string[];
    /** Whether to log each request/response to stdout as it arrives. Default: true. */
    verbose?: boolean;
  } = {},
): NetworkLog {
  const { urlFilters = [], verbose = true } = options;
  const log: NetworkLog = { requests: [], responses: [], failures: [] };

  const matches = (url: string) =>
    urlFilters.length === 0 || urlFilters.some((f) => url.includes(f));

  page.on('request', (req: Request) => {
    if (!matches(req.url())) return;
    const entry: CapturedRequest = {
      url: req.url(),
      method: req.method(),
      postData: req.postData(),
      headers: req.headers(),
      timestamp: Date.now(),
    };
    log.requests.push(entry);
    if (verbose) {
      console.log(`[network] → ${req.method()} ${req.url()}`);
    }
  });

  page.on('response', async (res: Response) => {
    if (!matches(res.url())) return;
    let body: unknown = null;
    try {
      const ct = res.headers()['content-type'] ?? '';
      if (ct.includes('application/json')) {
        body = await res.json();
      } else if (ct.includes('text/')) {
        body = await res.text();
      }
    } catch {
      // Body already consumed or non-parseable — leave as null
    }
    const entry: CapturedResponse = {
      url: res.url(),
      status: res.status(),
      statusText: res.statusText(),
      headers: res.headers(),
      body,
      timestamp: Date.now(),
    };
    log.responses.push(entry);
    if (verbose) {
      const indicator = res.ok() ? '✓' : '✗';
      console.log(`[network] ${indicator} ${res.status()} ${res.url()}`);
    }
  });

  page.on('requestfailed', (req: Request) => {
    if (!matches(req.url())) return;
    const failure = req.failure();
    log.failures.push({
      url: req.url(),
      errorText: failure?.errorText ?? 'unknown',
      timestamp: Date.now(),
    });
    console.warn(`[network] FAILED ${req.url()} — ${failure?.errorText}`);
  });

  return log;
}

/**
 * Saves a network log to disk as JSON for post-run inspection.
 */
export function saveNetworkLog(log: NetworkLog, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(log, null, 2), 'utf-8');
  console.log(`[network] Log saved → ${outputPath}`);
}

/**
 * Finds all responses from API calls (requests to the API base URL).
 * Useful for quickly seeing what data populated the dashboard.
 *
 * @param log   The NetworkLog returned by attachNetworkLogger
 * @param apiBase  e.g. 'http://localhost:9000' or '/api'
 */
export function filterApiResponses(
  log: NetworkLog,
  apiBase: string,
): CapturedResponse[] {
  return log.responses.filter((r) => r.url.startsWith(apiBase));
}

/**
 * Prints a human-readable summary of captured API responses to stdout.
 */
export function printApiSummary(log: NetworkLog, apiBase: string): void {
  const apiResponses = filterApiResponses(log, apiBase);
  console.log('\n──────────────── API Response Summary ────────────────');
  if (apiResponses.length === 0) {
    console.log('  (no API responses captured — check urlFilters or baseURL)');
  }
  for (const r of apiResponses) {
    const path_ = r.url.replace(apiBase, '');
    const ok = r.status >= 200 && r.status < 300 ? '✓' : '✗';
    console.log(`  ${ok} [${r.status}] ${path_}`);
    if (r.body && typeof r.body === 'object') {
      // Print top-level keys only to avoid flooding the console
      const keys = Object.keys(r.body as object);
      console.log(`       keys: ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '…' : ''}`);
    }
  }
  console.log('──────────────────────────────────────────────────────\n');
}
