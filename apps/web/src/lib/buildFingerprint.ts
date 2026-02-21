/**
 * [DDAI][build_fingerprint] — Debug-only diagnostic.
 *
 * Exposes the build-time fingerprint baked in by vite.config.ts via Vite's
 * standard VITE_* env injection. Does NOT log or render anything automatically.
 *
 * To inspect in a browser session:
 *   1. Open DevTools console.
 *   2. Run: window.__ddaiBuildFingerprint()
 *   OR enable workspace debug mode (?debug=1 or localStorage ddai:debugDealWorkspace=1)
 *      and check the [DDAI][build_fingerprint] log that fires during component mount.
 *
 * Never imported for side-effects; never rendered in the UI.
 */

export interface BuildFingerprint {
  /** Short git SHA (or 'unknown' when not available at build time). */
  sha: string;
  /** ISO-8601 UTC build timestamp (or 'unknown'). */
  time: string;
  /** App environment label from VITE_APP_ENV. */
  env: string;
}

export const buildFingerprint: BuildFingerprint = {
  sha: import.meta.env.VITE_BUILD_SHA ?? 'unknown',
  time: import.meta.env.VITE_BUILD_TIME ?? 'unknown',
  env: import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE ?? 'unknown',
};

// Attach a callable helper to window for on-demand inspection in DevTools.
// No automatic logging — does not fire on page load.
if (typeof window !== 'undefined') {
  (window as any).__ddaiBuildFingerprint = () => {
    console.log('[DDAI][build_fingerprint]', buildFingerprint);
    return buildFingerprint;
  };
}
