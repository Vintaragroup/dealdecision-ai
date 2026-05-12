import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for DealDecision UI debugging.
 *
 * Defaults are tuned for LOCAL debugging (headless: false, trace: on).
 * Flip HEADLESS=1 env var for CI-style runs without a visible browser.
 *
 * Dev server must be running before tests execute:
 *   pnpm --filter web dev       → http://localhost:5173
 *
 * Auth: Playwright uses a saved browser storage state (cookies + localStorage)
 * so it can skip the Clerk login flow on every test run.
 * Run `pnpm test:ui:login` once to generate playwright/.auth/user.json.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const HEADLESS = process.env.HEADLESS === '1';

export default defineConfig({
  outputDir: 'playwright-artifacts',
  testDir: './tests/ui',
  fullyParallel: false, // Keep sequential for debugging — easier trace inspection
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker: simpler trace files, easier to follow
  timeout: 60_000, // Give pages time to load auth + data

  expect: {
    timeout: 10_000,
  },

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: process.env.CI ? 'never' : 'on-failure' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    headless: HEADLESS,

    // Tracing: captures DOM snapshots, screenshots, network, and console on every run
    trace: process.env.PW_TRACE === '1' ? 'on' : 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',

    // Make network timeline useful
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    // Load saved Clerk session when present; gracefully absent before first login.
    storageState: require('fs').existsSync('playwright/.auth/user.json')
      ? 'playwright/.auth/user.json'
      : undefined,
  },

  projects: [
    // ── Auth setup (run once: pnpm test:ui:login) ───────────────────────────
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], headless: false, storageState: undefined },
    },
    // ── Main Chromium project — uses saved auth when available ──────────────
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
