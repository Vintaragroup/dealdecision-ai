#!/usr/bin/env node
/**
 * scripts/screenshot-workspace.mjs
 *
 * Take a full-page screenshot of the Deal Workspace (or any page) and save
 * it to playwright-artifacts/workspace-<timestamp>.png.
 *
 * The script uses page.setViewportSize() to expand the browser to the full
 * content height before screenshotting, bypassing the app shell's inner scroll
 * container constraint (h-screen overflow-hidden + overflow-auto on <main>).
 *
 * USAGE
 * -----
 *   node scripts/screenshot-workspace.mjs
 *   node scripts/screenshot-workspace.mjs --url http://localhost:4174/app/deals/abc123
 *   node scripts/screenshot-workspace.mjs --out my-screenshot.png
 *
 * FLAGS
 *   --url   Full URL to screenshot (default: http://localhost:4174/app)
 *   --out   Output file path       (default: playwright-artifacts/workspace-<ts>.png)
 *
 * REQUIREMENTS
 * ------------
 *   - Dev server running: pnpm --filter web dev   (port 4174 or 5173)
 *   - Auth session saved: pnpm test:ui:login       (creates playwright/.auth/user.json)
 *   - Playwright installed: npx playwright install chromium
 */

import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const TARGET_URL = getArg('--url') ?? 'http://localhost:4174/app';
// --deal "Climatic" — click this deal name on the dashboard to open its workspace
const DEAL_NAME = getArg('--deal') ?? null;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const DEFAULT_OUT = path.join(ROOT, 'playwright-artifacts', `workspace-${timestamp}.png`);
const OUT_PATH = getArg('--out') ?? DEFAULT_OUT;

// ── Auth state ───────────────────────────────────────────────────────────────
const AUTH_FILE = path.join(ROOT, 'playwright/.auth/user.json');
const hasAuth = fs.existsSync(AUTH_FILE);

if (!hasAuth) {
  console.error(
    '\n[screenshot] ERROR: No saved auth session found.\n' +
    '  Run this once to log in and save your session:\n\n' +
    '    PLAYWRIGHT_BASE_URL=http://localhost:4174 npx playwright test tests/ui/auth.setup.ts --project=setup\n\n' +
    '  Then re-run this script.\n',
  );
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`[screenshot] Target : ${TARGET_URL}`);
console.log(`[screenshot] Auth   : ${AUTH_FILE}`);
console.log(`[screenshot] Output : ${OUT_PATH}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: AUTH_FILE,
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

try {
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30_000 });

  // Detect auth redirect
  const url = page.url();
  if (url.includes('sign-in') || url.includes('login') || url.includes('clerk.')) {
    console.error(
      `\n[screenshot] Auth session expired — page redirected to: ${url}\n` +
      '  Re-run: PLAYWRIGHT_BASE_URL=http://localhost:4174 npx playwright test tests/ui/auth.setup.ts --project=setup\n',
    );
    await browser.close();
    process.exit(1);
  }

  console.log(`[screenshot] Landed : ${page.url()}`);

  // If --deal was specified, navigate to the Deal Pipeline list then click the deal row
  if (DEAL_NAME) {
    console.log(`[screenshot] Navigating to Deal Pipeline…`);
    // Click the "Deal Pipeline" sidebar nav item
    const pipelineNav = page.getByRole('button', { name: /deal pipeline/i });
    await pipelineNav.click({ timeout: 8000 });
    await page.waitForTimeout(2000);

    console.log(`[screenshot] Clicking deal: "${DEAL_NAME}"`);
    // Deal rows are <tr> elements with cursor-pointer and the deal name in a <span>
    const dealNameEscaped = DEAL_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dealRow = page.locator('tr').filter({ hasText: new RegExp(dealNameEscaped, 'i') }).first();
    // Fallback to grid card view
    const dealCard = page.locator('[class*="backdrop-blur"]').filter({ hasText: new RegExp(dealNameEscaped, 'i') }).first();

    const rowCount = await dealRow.count();
    const found = rowCount > 0 ? dealRow : dealCard;
    await found.click({ timeout: 10000 });
    console.log(`[screenshot] Clicked. Waiting for workspace to load…`);
    await page.waitForTimeout(4000);
  }

  // Measure full content height from the inner scroll container
  const metrics = await page.evaluate(() => {
    const candidates = [
      document.querySelector('.app-shell-main'),
      document.querySelector('main'),
    ];
    const heights = candidates.filter(Boolean).map((el) => el.scrollHeight);
    return {
      contentHeight: Math.max(...heights, document.documentElement.scrollHeight, document.body.scrollHeight),
      mainScrollHeight: document.querySelector('.app-shell-main')?.scrollHeight ?? null,
      vpHeight: window.innerHeight,
    };
  });

  console.log(`[screenshot] Viewport height      : ${metrics.vpHeight}px`);
  console.log(`[screenshot] app-shell-main height : ${metrics.mainScrollHeight ?? 'not found'}px`);
  console.log(`[screenshot] Expanding viewport to : ${metrics.contentHeight}px`);

  // Suppress fixed/sticky headers from overlapping in the tall screenshot
  await page.evaluate(() => {
    document.documentElement.classList.add('capture-mode');
    document.body.classList.add('capture-mode');
  });

  // Expand viewport to full content height
  await page.setViewportSize({ width: 1280, height: metrics.contentHeight });

  // Wait for re-layout
  await page.evaluate(() =>
    new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 400))),
  );

  // Take screenshot
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  await page.screenshot({ path: OUT_PATH });

  // Verify PNG dimensions
  const buf = fs.readFileSync(OUT_PATH);
  const pngWidth = buf.readUInt32BE(16);
  const pngHeight = buf.readUInt32BE(20);

  console.log(`\n[screenshot] ✓ Saved: ${OUT_PATH}`);
  console.log(`[screenshot] PNG dimensions: ${pngWidth} × ${pngHeight}px`);
  console.log(`[screenshot] File size: ${(buf.length / 1024).toFixed(1)} KB`);

  if (pngHeight < metrics.contentHeight) {
    console.warn(
      `[screenshot] WARNING: PNG height (${pngHeight}px) < expected content height (${metrics.contentHeight}px)`,
    );
  }

  // Open the file
  const { execSync } = await import('child_process');
  execSync(`open "${OUT_PATH}"`);
} finally {
  await browser.close();
}
