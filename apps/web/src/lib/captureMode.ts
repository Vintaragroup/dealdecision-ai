/**
 * captureMode.ts
 *
 * Temporarily unlocks the app-shell's viewport-constrained layout so that
 * Playwright (or any headless browser) can take a full-page screenshot that
 * captures content below the visible viewport.
 *
 * Root cause
 * ----------
 * AppShell renders:
 *   <div class="app-shell-root  flex h-screen overflow-hidden">
 *     ...
 *     <div class="app-shell-content  flex-1 flex flex-col min-w-0 relative">
 *       <Header />
 *       <main class="app-shell-main  flex-1 overflow-auto">
 *         {page content}
 *       </main>
 *     </div>
 *   </div>
 *
 * The `h-screen overflow-hidden` outer div clips the document height to the
 * viewport. `overflow-auto` on <main> creates an inner scroll container, so
 * Playwright's `fullPage: true` only ever sees a document of 100vh.
 *
 * Capture mode adds `html.capture-mode` which overrides those constraints via
 * the CSS defined in tailwind.input.css, letting the document body expand to
 * its natural content height.
 *
 * Usage (browser context)
 * -----------------------
 *   import { withCaptureMode } from '@/lib/captureMode';
 *
 *   const dataUrl = await withCaptureMode(async () => {
 *     return html2canvas(document.body).then(c => c.toDataURL());
 *   });
 *
 * Usage (Playwright — server side)
 * ---------------------------------
 * See tests/ui/helpers/capture.ts for the Playwright wrapper that calls
 * page.evaluate(enableCaptureMode) / page.evaluate(disableCaptureMode) around
 * page.screenshot({ fullPage: true }).
 */

const CLASS = 'capture-mode';

/** Add capture-mode class to <html> and <body>. */
export function enableCaptureMode(): void {
  document.documentElement.classList.add(CLASS);
  document.body.classList.add(CLASS);
}

/** Remove capture-mode class from <html> and <body>. */
export function disableCaptureMode(): void {
  document.documentElement.classList.remove(CLASS);
  document.body.classList.remove(CLASS);
}

/**
 * Run `callback` with capture mode active, then restore normal layout.
 * Uses try/finally so layout is always restored even if the callback throws.
 *
 * Waits one animation frame + 300 ms after enabling capture mode to allow
 * the browser to re-layout before the callback executes.
 */
export async function withCaptureMode<T>(callback: () => Promise<T>): Promise<T> {
  enableCaptureMode();
  try {
    // One rAF ensures any pending style/layout recalculations are flushed.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // Extra settle time for complex layouts (sticky headers, transitions, etc.)
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    return await callback();
  } finally {
    disableCaptureMode();
  }
}
