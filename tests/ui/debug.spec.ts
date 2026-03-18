import { test } from '@playwright/test';

/**
 * Minimal interactive debug spec.
 *
 * Opens the app in a visible browser and pauses so you can inspect
 * the DOM, network traffic, and UI state manually using Playwright Inspector.
 *
 * Run with:
 *   pnpm test:ui:debug
 *
 * The browser will open, navigate to /app, then pause.
 * Use the Playwright Inspector to click elements, inspect selectors,
 * step through actions, or resume.
 *
 * NOTE: If the app redirects to /sign-in, you can log in manually
 * inside the paused browser session.
 */
test('open dashboard for inspection', async ({ page }) => {
  await page.goto('/app');
  await page.waitForTimeout(2000);
  await page.pause();
});
