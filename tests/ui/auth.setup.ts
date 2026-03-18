import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Auth setup for DealDecision.
 *
 * This spec logs in via the Clerk-powered /sign-in page and saves the resulting
 * browser storage state to playwright/.auth/user.json.
 *
 * Other specs in playwright.config.ts load this file as `storageState`, so they
 * skip the login step entirely and land directly on authenticated pages.
 *
 * HOW TO RUN (one time, or whenever your session expires):
 *   pnpm test:ui:login
 *
 * CREDENTIALS — supply via environment variables. Never hardcode here.
 *   PLAYWRIGHT_EMAIL    your DealDecision account email
 *   PLAYWRIGHT_PASSWORD your DealDecision account password
 *
 * If you use SSO/social login instead of email+password, replace the
 * fill/click block below with a page.pause() and log in manually.
 */

const AUTH_FILE = path.resolve(__dirname, '../../playwright/.auth/user.json');

setup('authenticate with Clerk', async ({ page }) => {
  // ── 0. Guard: check credentials are set ──────────────────────────────────
  const email = process.env.PLAYWRIGHT_EMAIL;
  const password = process.env.PLAYWRIGHT_PASSWORD;

  if (!email || !password) {
    // If no credentials are provided, open the browser so you can log in manually.
    console.warn(
      '\n[auth] PLAYWRIGHT_EMAIL and/or PLAYWRIGHT_PASSWORD not set.\n' +
        '       Opening the browser so you can log in manually.\n' +
        '       After logging in, close the browser to save your session.\n',
    );
    await page.goto('/sign-in');
    // page.pause() lets you log in interactively — Playwright saves state when done.
    await page.pause();
  } else {
    // ── 1. Navigate to sign-in ──────────────────────────────────────────────
    await page.goto('/sign-in');

    // ── 2. Fill Clerk email/password form ──────────────────────────────────
    // TODO: Validate these selectors against the actual Clerk form rendered
    // at /sign-in. Clerk component class names can vary by version.
    //
    // If the sign-in page uses a multi-step flow (email → then password),
    // you may need to click "Continue" between the two fills.
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);

    // TODO: Adjust this selector if the button text differs in your Clerk UI.
    await page.getByRole('button', { name: /sign in|continue|log in/i }).click();

    // ── 3. Wait for redirect to authenticated app ──────────────────────────
    // After login, Clerk redirects to /app (or /app/select-org for multi-org).
    // TODO: Update this URL if your post-login redirect differs.
    await page.waitForURL(/\/app/);
    console.log('[auth] Login successful — session saved');
  }

  // ── 4. Save storage state ─────────────────────────────────────────────────
  const dir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await page.context().storageState({ path: AUTH_FILE });
  console.log(`[auth] Storage state saved → ${AUTH_FILE}`);

  // ── 5. Verify we're genuinely authenticated ───────────────────────────────
  // This asserts the page isn't sitting on the sign-in page, meaning auth worked.
  expect(page.url()).not.toContain('/sign-in');
});
