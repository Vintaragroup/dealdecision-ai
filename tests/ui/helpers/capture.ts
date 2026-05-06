import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * capture.ts — Playwright-side helper for full-page screenshots.
 *
 * The DealDecision app shell uses `h-screen overflow-hidden` on its outer
 * wrapper and `overflow-auto` on the inner <main>.  This means the *document*
 * scroll height is always ≈ 100vh, so `page.screenshot({ fullPage: true })`
 * only captures the visible viewport.
 *
 * This helper activates `capture-mode` on the page before taking the screenshot,
 * which lifts the height/overflow constraints via the CSS rules in
 * apps/web/src/tailwind.input.css, then restores normal layout afterwards.
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

/**
 * Enable capture mode on the page.
 * Exported so you can call it manually in custom flows (pair with disableCaptureMode).
 */
export async function enableCaptureMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.classList.add('capture-mode');
    document.body.classList.add('capture-mode');
  });
}

/**
 * Disable capture mode on the page.
 * Always call this in a finally block if you used enableCaptureMode directly.
 */
export async function disableCaptureMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.classList.remove('capture-mode');
    document.body.classList.remove('capture-mode');
  });
}

/**
 * Take a full-page screenshot of the Deal Workspace (or any page) with
 * capture mode active, then restore normal layout.
 *
 * Returns the raw PNG buffer (same as `page.screenshot()`).
 */
export async function takeFullPageScreenshot(
  page: Page,
  options: FullPageScreenshotOptions = {},
): Promise<Buffer> {
  const { path: filePath, extraSettleMs = 0 } = options;

  await enableCaptureMode(page);

  try {
    // Allow browser to re-layout after the class change.
    // One rAF + 300 ms is the baseline; add extraSettleMs for slower pages.
    await page.evaluate(
      (settleMs) =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 300 + settleMs));
        }),
      extraSettleMs,
    );

    const screenshotOptions: Parameters<typeof page.screenshot>[0] = {
      fullPage: true,
    };
    if (filePath) {
      screenshotOptions.path = filePath;
    }

    return await page.screenshot(screenshotOptions);
  } finally {
    // Always restore — even if the screenshot throws.
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
