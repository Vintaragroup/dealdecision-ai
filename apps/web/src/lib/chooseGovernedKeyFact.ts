/**
 * chooseGovernedKeyFact — pure utility for selecting a governed key-fact value.
 *
 * Extracted from the `chooseGovernedFirst` closure in DealWorkspace.tsx so it
 * can be unit-tested in isolation.
 *
 * ### Selection rules (in priority order)
 *
 * When `preferDeterministic` is false (default — used for product / market):
 *   1. Governed overlay value (`overlaySource === 'governed'`) → Governed chip
 *   2. Deterministic displayable value                         → Deterministic chip
 *   3. Any non-empty overlay value (OCR-soup fallback)         → Deterministic chip
 *   4. Deterministic value even if not display-safe           → Deterministic chip
 *   5. Neither present                                        → Missing
 *
 * When `preferDeterministic` is true (used for raise / business_model when
 * the report is ready):
 *   1. Deterministic value that is BOTH displayable AND not a sentinel
 *      placeholder ("Unknown", "n/a", etc.)                   → Deterministic chip
 *      ^^^ PR25 fix: a PR22 fallback string like "Unknown" (display-safe
 *          but semantically empty) must NOT silence a valid governed value.
 *          Real authoritative values like "Usage-based SaaS (kpi)" still win.
 *   2. Governed overlay value (`overlaySource === 'governed'`) → Governed chip
 *   3. Any remaining overlay value                            → Governed chip
 *   4. Deterministic even if non-displayable / sentinel       → Deterministic chip (last resort)
 *   5. Neither present                                        → Missing
 */

export type GovernedKeyFactOverlayInput = {
  value: string | null;
  quality?: string;
  source?: 'governed' | 'deterministic' | 'missing';
} | null;

export type GovernedKeyFactResult = {
  value: string;
  provenance: {
    source: 'deterministic' | 'governed' | 'missing';
    needsReview?: boolean;
  };
  fromOverlay: boolean;
};

export function chooseGovernedKeyFact(opts: {
  deterministic: string;
  overlay?: GovernedKeyFactOverlayInput;
  preferDeterministic?: boolean;
  suppressNeedsReview?: boolean;
  missingText?: string;
  isDisplayable?: (val: string) => boolean;
}): GovernedKeyFactResult {
  const asClean = (v: unknown): string => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s && s !== '—' ? s : '';
  };

  const overlayVal = asClean(opts.overlay?.value);
  const overlaySource = opts.overlay?.source;
  const overlayQuality = opts.overlay?.quality;
  const suppressNeedsReview = opts.suppressNeedsReview ?? false;
  const missingText = opts.missingText ?? 'Not extracted from evidence';
  const isDisplayable = opts.isDisplayable ?? (() => true);

  const needsReviewForOverlay =
    overlayQuality === 'fallback' && !suppressNeedsReview;

  const detVal = asClean(opts.deterministic);

  // ── preferDeterministic path ──────────────────────────────────────────────
  // Used for raise_terms / business_model when the investor report is ready.
  //
  // PR25 fix: deterministic must be BOTH display-safe AND not a sentinel
  // placeholder to win.  A PR22 fallback like "Unknown" (passes display-safe
  // checks but carries no real meaning) must not shadow a valid governed value.
  // Real authoritative strings like "Usage-based SaaS (kpi)" still win.
  if (opts.preferDeterministic) {
    const SENTINEL_PLACEHOLDERS = new Set([
      'unknown', 'n/a', 'not available', 'none', 'n/a.', 'unknown.',
    ]);
    const detIsAuthoritative =
      Boolean(detVal) &&
      isDisplayable(detVal) &&
      !SENTINEL_PLACEHOLDERS.has(detVal.toLowerCase());

    if (detIsAuthoritative) {
      return { value: detVal, provenance: { source: 'deterministic' }, fromOverlay: false };
    }
    if (overlayVal && overlaySource === 'governed') {
      return {
        value: overlayVal,
        provenance: { source: 'governed', needsReview: needsReviewForOverlay || undefined },
        fromOverlay: true,
      };
    }
    if (overlayVal) {
      return {
        value: overlayVal,
        provenance: { source: 'governed', needsReview: needsReviewForOverlay || undefined },
        fromOverlay: true,
      };
    }
    // Last resort: show deterministic even if non-displayable or a sentinel.
    if (detVal) {
      return { value: detVal, provenance: { source: 'deterministic' }, fromOverlay: false };
    }
    return { value: missingText, provenance: { source: 'missing' }, fromOverlay: false };
  }

  // ── governed-first path ───────────────────────────────────────────────────
  if (overlayVal && overlaySource === 'governed') {
    return {
      value: overlayVal,
      provenance: { source: 'governed', needsReview: needsReviewForOverlay || undefined },
      fromOverlay: true,
    };
  }

  const detDisplayable = detVal ? isDisplayable(detVal) : false;

  if (detVal && detDisplayable) {
    return { value: detVal, provenance: { source: 'deterministic' }, fromOverlay: false };
  }

  if (overlayVal) {
    // Overlay phrasing preferred when deterministic looks like OCR soup / slide dump.
    return {
      value: overlayVal,
      provenance: { source: 'deterministic', needsReview: needsReviewForOverlay || undefined },
      fromOverlay: true,
    };
  }

  // Deterministic present but not display-safe, no overlay — fall back anyway.
  if (detVal) {
    return { value: detVal, provenance: { source: 'deterministic' }, fromOverlay: false };
  }

  return { value: missingText, provenance: { source: 'missing' }, fromOverlay: false };
}
