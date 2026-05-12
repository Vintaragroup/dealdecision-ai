import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * capture.ts — Full-page screenshot helper for the Deal Workspace.
 *
 * WHY THE NAIVE APPROACH FAILS
 * ----------------------------
 * The app shell uses `h-screen overflow-hidden` on the outer wrapper and
 * `overflow-auto` on the inner <main class="app-shell-main">.  All page
 * scrolling therefore happens inside that inner div.  The *document* body
 * stays clipped to 100 vh, so `page.screenshot({ fullPage: true })` —
 * which measures document.documentElement.scrollHeight — only captures
 * the visible viewport.
 *
 * THE FIX: page.setViewportSize() expansion
 * ------------------------------------------
 * We call `page.setViewportSize()` to physically expand the Playwright viewport
 * to the full content height before taking the screenshot.  This bypasses all
 * CSS overflow constraints because the browser is literally rendering a taller
 * window.  After the screenshot we reset the viewport to its original dimensions.
 *
 * Note: CDP `Emulation.setDeviceMetricsOverride` does NOT work here — Playwright
 * overrides it internally.  `page.setViewportSize()` is the correct API.
 *
 * Usage
 * -----
 *   import { takeFullPageScreenshot } from './helpers/capture';
 *
 *   const buf = await takeFullPageScreenshot(page);
 *   fs.writeFileSync('screenshot.png', buf);
 *
 *   // or save directly:
 *   await takeFullPageScreenshot(page, { path: 'my-screenshot.png' });
 */

export interface FullPageScreenshotOptions {
  /** Destination file path. When omitted the Buffer is returned but not saved. */
  path?: string;
  /**
   * Extra milliseconds to wait after layout settles (on top of the built-in
   * rAF + 300 ms already baked into the browser-side helper).
   * Default: 0
   */
  extraSettleMs?: number;
}

/** Add capture-mode class to <html> and <body>. */
export async function enableCaptureMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.classList.add('capture-mode');
    document.body.classList.add('capture-mode');
  });
}

/** Remove capture-mode class from <html> and <body>. */
export async function disableCaptureMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.classList.remove('capture-mode');
    document.body.classList.remove('capture-mode');
  });
}

/**
 * Take a full-page screenshot by expanding Playwright's viewport to the full
 * content height, taking a regular screenshot, then restoring.
 *
 * Steps:
 *   1. Record original viewport size.
 *   2. Measure full content height from .app-shell-main (inner scroll container).
 *   3. Apply CSS capture-mode to suppress fixed/sticky chrome.
 *   4. Call page.setViewportSize() to expand to the full content height.
 *      (This is what page.screenshot() respects — CDP overrides are not.)
 *   5. Take a regular screenshot — the viewport IS the full page.
 *   6. Always reset the viewport and remove capture-mode in finally.
 *
 * Returns the raw PNG buffer.
 */
export async function takeFullPageScreenshot(
  page: Page,
  options: FullPageScreenshotOptions = {},
): Promise<Buffer> {
  const { path: filePath, extraSettleMs = 0 } = options;

  // Record the original viewport so we can restore it.
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };

  // Measure the true content height — try the inner scroll container first,
  // then walk all scrollable elements, then fall back to document.
  const contentHeight = await page.evaluate((): number => {
    const candidates = [
      document.querySelector('.app-shell-main'),
      document.querySelector('main'),
      document.querySelector('[class*="overflow-auto"]'),
      document.querySelector('[class*="overflow-y-auto"]'),
    ];
    const fromContainers = candidates
      .filter(Boolean)
      .map((el) => (el as HTMLElement).scrollHeight);
    const maxContainer = fromContainers.length ? Math.max(...fromContainers) : 0;
    return Math.max(
      maxContainer,
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
  });

  const expandedHeight = Math.max(originalViewport.height, contentHeight);

  // Apply CSS capture-mode to suppress fixed/sticky elements that would
  // overlap or duplicate in the expanded view.
  await enableCaptureMode(page);

  try {
    // Expand Playwright's viewport to the full content height.
    // page.setViewportSize() is what page.screenshot() actually respects —
    // CDP Emulation.setDeviceMetricsOverride is overridden by Playwright internally.
    await page.setViewportSize({ width: originalViewport.width, height: expandedHeight });

    // Allow browser to re-layout after the viewport change.
    await page.evaluate(
      (settleMs) =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 300 + settleMs));
        }),
      extraSettleMs,
    );

    // Regular screenshot — the viewport now covers everything.
    const screenshotOptions: Parameters<typeof page.screenshot>[0] = {};
    if (filePath) {
      screenshotOptions.path = filePath;
    }

    return await page.screenshot(screenshotOptions);
  } finally {
    // Always restore viewport and remove capture-mode.
    await page.setViewportSize(originalViewport);
    await disableCaptureMode(page);
  }
}

/**
 * Convenience wrapper: take a full-page screenshot and save it to `dir/<name>.png`.
 * Creates the directory if it does not exist.
 *
 * Returns the absolute path of the saved file.
 */
export async function saveFullPageScreenshot(
  page: Page,
  dir: string,
  name: string,
  options: Omit<FullPageScreenshotOptions, 'path'> = {},
): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.png`);
  await takeFullPageScreenshot(page, { ...options, path: filePath });
  return filePath;
}
