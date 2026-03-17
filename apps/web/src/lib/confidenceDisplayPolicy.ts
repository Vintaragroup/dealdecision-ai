/**
 * confidenceDisplayPolicy.ts — PR36.7
 *
 * Shared, deterministic UI display policy for evidence confidence levels.
 *
 * Maps the confidence= token serialised by stage-2-deterministic.ts (PR36.6)
 * to rendering decisions for every investor-facing surface in Deal Workspace.
 *
 * Design contract:
 *  - Pure module: no React, no imports, no side effects.
 *  - Unit-testable in isolation.
 *  - Single source of truth for confidence-aware rendering decisions.
 *
 * Surface hierarchy (from most to least restricted):
 *   hero          — top-level overview cards (raise amount, valuation, ARR, market size)
 *   summary       — governed_summary / report narrative blocks
 *   detail        — investor_insights, display_facts, DealTermsCard
 *   dataTab       — Data tab / diagnostic tables — most permissive
 */

// ─── Confidence level type ────────────────────────────────────────────────────

/**
 * The six evidence confidence levels from PR36.6.
 * String values match what is serialised into canonical_fields KV lines.
 */
export type ConfidenceLevel =
  | 'VERIFIED'
  | 'STRONG_EVIDENCE'
  | 'WEAK_EVIDENCE'
  | 'CONFLICTING'
  | 'PROVISIONAL'
  | 'SUPPRESSED';

// ─── Display policy types ─────────────────────────────────────────────────────

/**
 * Visual treatment to apply to a row or fact block.
 *
 * 'normal'     — standard rendering, no caution.
 * 'caution'    — amber tint, qualifying label visible.
 * 'conflict'   — red/amber tint, shown as conflict not settled fact.
 * 'provisional'— gray/muted, labeled as inferred.
 * 'suppressed' — further muted, diagnostic display only.
 */
export type ConfidenceVisualTreatment =
  | 'normal'
  | 'caution'
  | 'conflict'
  | 'provisional'
  | 'suppressed';

/**
 * Badge variant that maps to a Tailwind color scheme in the component layer.
 *
 * 'verified'    — emerald / green
 * 'strong'      — teal / blue-green
 * 'weak'        — amber / yellow
 * 'conflict'    — red / orange-red
 * 'provisional' — gray / slate
 * 'suppressed'  — very muted gray
 * 'unknown'     — no badge (legacy lines without confidence token)
 */
export type ConfidenceBadgeVariant =
  | 'verified'
  | 'strong'
  | 'weak'
  | 'conflict'
  | 'provisional'
  | 'suppressed'
  | 'unknown';

/**
 * Full display policy for a single confidence level.
 */
export interface ConfidenceDisplayPolicy {
  /**
   * The resolved confidence level.  `null` means the token was absent (legacy
   * pre-PR36.6 line) and no surface routing decision can be made.
   */
  level: ConfidenceLevel | null;

  /**
   * Allowed in hero / top-level overview summary cards.
   * Only VERIFIED and STRONG_EVIDENCE are hero-promotable.
   */
  heroAllowed: boolean;

  /**
   * Allowed in governed summaries and report narrative blocks.
   * VERIFIED, STRONG_EVIDENCE, and WEAK_EVIDENCE (with label) are allowed.
   * CONFLICTING, PROVISIONAL, SUPPRESSED are excluded.
   */
  summaryAllowed: boolean;

  /**
   * Allowed in Investor Insights detail surfaces and DealTermsCard tables.
   * All non-suppressed levels are allowed. CONFLICTING shows as conflict row.
   * PROVISIONAL shows with "inferred" label.
   */
  detailAllowed: boolean;

  /**
   * Allowed in the Data tab / diagnostic surfaces.
   * All levels except SUPPRESSED are shown (with appropriate labels).
   */
  dataTabAllowed: boolean;

  /**
   * Visual treatment to apply in a rendering context.
   */
  visualTreatment: ConfidenceVisualTreatment;

  /**
   * Badge variant for the confidence chip / pill.
   */
  badgeVariant: ConfidenceBadgeVariant;

  /**
   * Short qualifying text to show alongside the value.  `null` when the level
   * needs no qualification (VERIFIED, STRONG_EVIDENCE, or unknown/legacy).
   *
   * Examples: "limited evidence" | "conflicting signals" | "inferred"
   */
  qualifyingLabel: string | null;

  /**
   * True when the field should be rendered as an explicit conflict rather than a
   * singular settled value.  Only true for CONFLICTING.
   */
  showAsConflict: boolean;

  /**
   * Human-readable badge label for use in the confidence column of tables.
   * `null` for UNKNOWN (legacy lines) — no badge rendered.
   */
  badgeLabel: string | null;
}

// ─── Policy table ─────────────────────────────────────────────────────────────

const POLICY_TABLE: Readonly<Record<ConfidenceLevel, Omit<ConfidenceDisplayPolicy, 'level'>>> = {
  VERIFIED: {
    heroAllowed:    true,
    summaryAllowed: true,
    detailAllowed:  true,
    dataTabAllowed: true,
    visualTreatment: 'normal',
    badgeVariant:   'verified',
    qualifyingLabel: null,
    showAsConflict: false,
    badgeLabel:     'Verified',
  },
  STRONG_EVIDENCE: {
    heroAllowed:    true,
    summaryAllowed: true,
    detailAllowed:  true,
    dataTabAllowed: true,
    visualTreatment: 'normal',
    badgeVariant:   'strong',
    qualifyingLabel: null,
    showAsConflict: false,
    badgeLabel:     'Strong',
  },
  WEAK_EVIDENCE: {
    heroAllowed:    false,
    summaryAllowed: false,
    detailAllowed:  true,
    dataTabAllowed: true,
    visualTreatment: 'caution',
    badgeVariant:   'weak',
    qualifyingLabel: 'limited evidence',
    showAsConflict: false,
    badgeLabel:     'Weak',
  },
  CONFLICTING: {
    heroAllowed:    false,
    summaryAllowed: false,
    detailAllowed:  false,
    dataTabAllowed: true,
    visualTreatment: 'conflict',
    badgeVariant:   'conflict',
    qualifyingLabel: 'conflicting signals',
    showAsConflict: true,
    badgeLabel:     'Conflicting',
  },
  PROVISIONAL: {
    heroAllowed:    false,
    summaryAllowed: false,
    detailAllowed:  false,
    dataTabAllowed: true,
    visualTreatment: 'provisional',
    badgeVariant:   'provisional',
    qualifyingLabel: 'inferred',
    showAsConflict: false,
    badgeLabel:     'Provisional',
  },
  SUPPRESSED: {
    heroAllowed:    false,
    summaryAllowed: false,
    detailAllowed:  false,
    dataTabAllowed: false,
    visualTreatment: 'suppressed',
    badgeVariant:   'suppressed',
    qualifyingLabel: null,
    showAsConflict: false,
    badgeLabel:     'Suppressed',
  },
};

/**
 * Fallback policy — used when the confidence token is absent (legacy lines).
 * Does not restrict any surface to maintain full backward compatibility.
 */
const UNKNOWN_POLICY: ConfidenceDisplayPolicy = {
  level:          null,
  heroAllowed:    true,
  summaryAllowed: true,
  detailAllowed:  true,
  dataTabAllowed: true,
  visualTreatment: 'normal',
  badgeVariant:   'unknown',
  qualifyingLabel: null,
  showAsConflict: false,
  badgeLabel:     null,
};

// ─── Valid level set ──────────────────────────────────────────────────────────

const VALID_LEVELS = new Set<string>([
  'VERIFIED',
  'STRONG_EVIDENCE',
  'WEAK_EVIDENCE',
  'CONFLICTING',
  'PROVISIONAL',
  'SUPPRESSED',
]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a raw confidence string into a typed `ConfidenceLevel` or `null`.
 *
 * Returns `null` when the value is absent, empty, or not one of the six
 * recognised levels (e.g. legacy `UNKNOWN` placeholder).
 */
export function parseConfidenceLevel(raw: string | null | undefined): ConfidenceLevel | null {
  if (!raw || !VALID_LEVELS.has(raw)) return null;
  return raw as ConfidenceLevel;
}

/**
 * Resolve the full display policy for a raw confidence token.
 *
 * Safe for any input — returns the UNKNOWN fallback for absent / legacy values.
 *
 * @example
 * ```ts
 * const policy = getConfidenceDisplayPolicy('WEAK_EVIDENCE');
 * if (!policy.heroAllowed) return null; // suppress in hero surface
 * ```
 */
export function getConfidenceDisplayPolicy(
  raw: string | null | undefined,
): ConfidenceDisplayPolicy {
  const level = parseConfidenceLevel(raw);
  if (!level) return UNKNOWN_POLICY;
  return { level, ...POLICY_TABLE[level] };
}

/**
 * Whether a fact is safe to promote to hero / top-level summary cards.
 *
 * Returns `true` for VERIFIED, STRONG_EVIDENCE, and legacy (unknown) facts.
 * Returns `false` for WEAK_EVIDENCE, CONFLICTING, PROVISIONAL, SUPPRESSED.
 */
export function isHeroPromotable(raw: string | null | undefined): boolean {
  return getConfidenceDisplayPolicy(raw).heroAllowed;
}

/**
 * Whether a fact can be shown in investor-facing detail surfaces (not hero).
 * Includes Investor Insights, DealTermsCard visible rows, display_facts.
 */
export function isDetailAllowed(raw: string | null | undefined): boolean {
  return getConfidenceDisplayPolicy(raw).detailAllowed;
}

/**
 * Whether a fact should be silently excluded from the raise-terms synthesis
 * (used by extractRaiseTermFields to prevent conflicting/suppressed values from
 * flowing into the deal terms analysis).
 */
export function isRaiseTermExcluded(raw: string | null | undefined): boolean {
  const level = parseConfidenceLevel(raw);
  return level === 'CONFLICTING' || level === 'SUPPRESSED';
}
