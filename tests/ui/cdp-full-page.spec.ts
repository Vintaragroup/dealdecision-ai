import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { takeFullPageScreenshot } from './helpers/capture';

/**
 * cdp-full-page.spec.ts
 *
 * Smoke test: navigate to the Deal Workspace, take a full-page screenshot via
 * the CDP viewport-expansion strategy, and save it to playwright-artifacts/.
 *
 * Run with:
 *   pnpm test:ui -- cdp-full-page
 *
 * The saved PNG is written to:
 *   playwright-artifacts/cdp-full-page-<timestamp>.png
 *
 * Open it to confirm the entire Deal Workspace is captured, not just the
 * visible viewport.
 */

const DASHBOARD_ROUTE = '/app';
const OUT_DIR = path.resolve(__dirname, '../../playwright-artifacts');

test.describe('CDP full-page screenshot', () => {
  test('captures Deal Workspace beyond the visible viewport', async ({ page }) => {
    await page.goto(DASHBOARD_ROUTE);
    await page.waitForLoadState('networkidle');

    // If the page redirected to sign-in, the app shell won't be present.
    // Detect this early and skip with a clear message rather than a cryptic failure.
    const url = page.url();
    if (url.includes('sign-in') || url.includes('login') || url.includes('clerk')) {
      test.skip(true, `Page redirected to auth: ${url} — run auth setup first (pnpm test:ui:login)`);
    }

    // Measure the inner scroll container height BEFORE capture.
    const beforeMetrics = await page.evaluate(() => ({
      docScrollHeight: document.documentElement.scrollHeight,
      mainScrollHeight: (document.querySelector('.app-shell-main') as HTMLElement | null)?.scrollHeight ?? null,
      vpHeight: window.innerHeight,
      landedUrl: location.href,
    }));

    console.log('[cdp-full-page] before metrics:', beforeMetrics);

    // Take the full-page screenshot via CDP viewport expansion.
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(OUT_DIR, `cdp-full-page-${timestamp}.png`);
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const buf = await takeFullPageScreenshot(page, { path: outPath });

    console.log(`[cdp-full-page] screenshot saved → ${outPath}`);
    console.log(`[cdp-full-page] buffer size: ${buf.byteLength} bytes`);

    // ── Assertions ──────────────────────────────────────────────────────────

    // 1. Buffer is non-empty.
    expect(buf.byteLength).toBeGreaterThan(0);

    // 2. File was written.
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.statSync(outPath).size).toBeGreaterThan(0);

    // 3. capture-mode was cleaned up.
    const afterClasses = await page.evaluate(() => ({
      html: document.documentElement.classList.contains('capture-mode'),
      body: document.body.classList.contains('capture-mode'),
    }));
    expect(afterClasses.html, 'capture-mode must be removed from <html>').toBe(false);
    expect(afterClasses.body, 'capture-mode must be removed from <body>').toBe(false);

    // 4. Viewport was restored to original height.
    const afterVpHeight = await page.evaluate(() => window.innerHeight);
    expect(afterVpHeight).toBeCloseTo(beforeMetrics.vpHeight, -1);

    // 5. The screenshot height should be >= the content height (key assertion).
    //    We check via the PNG dimensions from the buffer.
    //    PNG header: bytes 16-19 = width, bytes 20-23 = height (big-endian).
    const pngHeight = buf.readUInt32BE(20);
    const pngWidth = buf.readUInt32BE(16);
    console.log(`[cdp-full-page] PNG dimensions: ${pngWidth} × ${pngHeight}`);

    if (beforeMetrics.mainScrollHeight !== null) {
      expect(
        pngHeight,
        `PNG height (${pngHeight}px) should be >= app-shell-main scrollHeight (${beforeMetrics.mainScrollHeight}px)`,
      ).toBeGreaterThanOrEqual(beforeMetrics.mainScrollHeight);
    }
  });
});
