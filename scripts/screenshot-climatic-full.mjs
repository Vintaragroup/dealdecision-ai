import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });
await page.goto('http://localhost:4174/app', { waitUntil: 'networkidle' });

// Navigate to Climatic deal
await page.waitForTimeout(1500);

// Click "Deal Pipeline" in nav
const dealPipelineBtn = page.locator('button:has-text("Deal Pipeline")');
await dealPipelineBtn.click();
await page.waitForTimeout(1000);

// Click Climatic row
const climaticRow = page.locator('text=Climatic').first();
await climaticRow.click();
await page.waitForTimeout(2000);

// Expand all accordion sections by clicking elements with cursor:pointer that are collapse headers
// Click Major Concerns
const majorConcerns = page.locator('text=Major Concerns').first();
if (await majorConcerns.count() > 0) await majorConcerns.click();
await page.waitForTimeout(300);

// Click Contradictions Detected
const contradictions = page.locator('text=Contradictions Detected').first();
if (await contradictions.count() > 0) await contradictions.click();
await page.waitForTimeout(300);

// Click Source notes and diagnostics
const sourceNotes = page.locator('text=Source notes and diagnostics').first();
if (await sourceNotes.count() > 0) await sourceNotes.click();
await page.waitForTimeout(300);

// Scroll to top
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);

// Take full page screenshot
await page.screenshot({
  path: 'artifacts/climatic-workspace-all-expanded.png',
  fullPage: true,
  type: 'png'
});

console.log('Screenshot saved to artifacts/climatic-workspace-all-expanded.png');
await browser.close();
