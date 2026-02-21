/**
 * TopSection V1 Deterministic Builder
 *
 * Answers "Why is the score X?" — never "What does the company do?".
 * That separation is intentional and load-bearing:
 *   - Overview tab = governed/LLM company summary (non-authoritative, additive)
 *   - TopSection    = deterministic score-driver summary (authoritative, always computable)
 *
 * All fields come from ScoreExplanation (computed from analyzer results + DIO).
 * Never reads governed overlay output.
 */
import type { ScoreExplanation, ScoreUnderstandingItemV1 } from './score-explanation.js';

// ── Public type ────────────────────────────────────────────────────────────

export type TopSectionV1 = {
  schema_version: 'topsection_v1';
  /**
   * 1 sentence explaining why the score is high/low, naming the top 2 score drivers.
   * Never a company description. Never uses internal score-mechanic language.
   */
  score_driver_one_liner: string;
  /** 2–4 bullets from positive score contributors (from understanding_v1.strengths). */
  strengths: string[];
  /** 2–6 bullets from open diligence items (from understanding_v1.diligence_open_items). */
  weaknesses: string[];
  /** 2–6 bullets from execution dependencies / coverage gaps (from understanding_v1.execution_dependencies). */
  actions_to_improve: string[];
};

// ── Component label lookup ─────────────────────────────────────────────────

/** Human-readable labels for the 6 core score components. */
const COMPONENT_LABELS: Readonly<Record<string, string>> = {
  slide_sequence: 'slide structure',
  metric_benchmark: 'business metrics',
  visual_design: 'visual presentation',
  narrative_arc: 'narrative arc',
  financial_health: 'financial health',
  risk_assessment: 'risk profile',
};

// ── Guardrails ─────────────────────────────────────────────────────────────

/**
 * Phrases that expose internal score mechanics — never surfaced to users.
 * Intentionally broad so newly generated reason strings that leak internals are filtered.
 */
const SCORE_MECHANIC_RE =
  /pacing score|score computed|narrative pacing|computed.*score|score.*mechanic|analyzer.*scored|weighting|component scoring|rubric score/i;

/**
 * Rejects raw snake_case internal identifiers that were never meant for display
 * (e.g. "business_model", "key_risks_detected", "unit_economics_v1").
 * Requires at least 3 segments (x_y_z) to avoid blocking common 2-word phrases.
 */
const SNAKE_CASE_KEY_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+){2,}$/;

/** Maximum characters allowed per bullet. Longer strings are OCR or description noise. */
const MAX_BULLET_CHARS = 250;

/** Minimum characters for a bullet to be meaningful. */
const MIN_BULLET_CHARS = 10;

/**
 * Minimum ratio of letter-characters to total non-whitespace characters (0–1).
 * OCR noise and symbol-heavy strings fail this.  0.55 allows abbreviations like
 * "$1.2M ARR" (5 letters / 8 non-ws = 0.625) while rejecting pure symbol strings.
 */
const MIN_LETTER_RATIO = 0.55;

/**
 * Minimum number of distinct space-separated words required in a bullet.
 * Single-word strings are always noise.
 */
const MIN_WORD_COUNT = 2;

/** Count letters (a–z, A–Z) in a string. */
const countLetters = (s: string): number => (s.match(/[a-zA-Z]/g) ?? []).length;

/** Count non-whitespace characters. */
const countNonWs = (s: string): number => (s.match(/\S/g) ?? []).length;

/**
 * Returns true when `text` should be suppressed from user-facing TopSection copy.
 * Combines mechanic-phrase detection, snake_case key rejection, and structural quality heuristics.
 */
const isInternalPhrase = (text: string): boolean => {
  const t = text.trim();
  if (!t) return true;
  if (t.length < MIN_BULLET_CHARS) return true;
  if (t.length > MAX_BULLET_CHARS) return true;
  if (SCORE_MECHANIC_RE.test(t)) return true;
  if (SNAKE_CASE_KEY_RE.test(t)) return true;

  // Word-count check — single-word strings are always noise.
  const words = t.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < MIN_WORD_COUNT) return true;

  // Letter-ratio check — rejects OCR noise and symbol-heavy strings.
  const nonWs = countNonWs(t);
  if (nonWs > 0 && countLetters(t) / nonWs < MIN_LETTER_RATIO) return true;

  return false;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Extract text strings from ScoreUnderstandingItemV1[], filtering internal phrases. */
const safeTexts = (items: ScoreUnderstandingItemV1[] | undefined): string[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => (i && typeof i.text === 'string' ? i.text.trim() : ''))
    .filter((t) => t.length > 0 && !isInternalPhrase(t));
};

const dedupe = (xs: string[]): string[] => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// ── Public builder ─────────────────────────────────────────────────────────

/**
 * TopSection V1 is score-driver summary, not company summary.
 * Overview tab is company summary (governed overlay).
 *
 * Build the TopSection V1 object from a ScoreExplanation.
 * Exported for direct test usage and report compiler embedding.
 */
export function buildTopSectionV1FromScoreExplanation(
  scoreExplanation: ScoreExplanation,
): TopSectionV1 {
  const totals = scoreExplanation.totals;
  const components = scoreExplanation.components as Record<string, any>;
  const weights =
    (scoreExplanation.aggregation?.weights as Record<string, number> | undefined) ?? {};

  const overall = isFiniteNum(totals.overall_score)
    ? Math.round(totals.overall_score)
    : null;
  const unadjustedPinned = Boolean((totals as any).unadjusted_pinned);

  const score_driver_one_liner = buildScoreDriverOneLiner({
    overall,
    unadjustedPinned,
    components,
    weights,
  });

  const u1 = scoreExplanation.understanding_v1;
  const strengths = dedupe(safeTexts(u1?.strengths)).slice(0, 4);
  const weaknesses = dedupe(safeTexts(u1?.diligence_open_items)).slice(0, 6);
  const actions_to_improve = dedupe(safeTexts(u1?.execution_dependencies)).slice(0, 6);

  return {
    schema_version: 'topsection_v1',
    score_driver_one_liner,
    strengths,
    weaknesses,
    actions_to_improve,
  };
}

// ── Internal: score driver one-liner ──────────────────────────────────────

type DriverInfo = {
  label: string;
  eff: number;
  delta: number;
  wDelta: number;
};

function buildScoreDriverOneLiner(params: {
  overall: number | null;
  unadjustedPinned: boolean;
  components: Record<string, any>;
  weights: Record<string, number>;
}): string {
  const { overall, unadjustedPinned, components, weights } = params;

  if (unadjustedPinned) {
    return (
      'Score held at 50 (neutral baseline) — insufficient evidence to differentiate dimensions.'
    );
  }

  if (overall === null) {
    return 'Score not yet available — provide analysis materials to generate a score.';
  }

  // Build driver info for every component with status "ok".
  const drivers: DriverInfo[] = [];
  for (const [key, comp] of Object.entries(components)) {
    if (!comp || typeof comp !== 'object') continue;
    if (comp.status !== 'ok') continue;

    const used = isFiniteNum(comp.used_score) ? comp.used_score : null;
    const penalty = isFiniteNum(comp.penalty) ? comp.penalty : 0;
    if (used === null) continue;

    const eff = Math.max(0, Math.min(100, used - penalty));
    const w = isFiniteNum(weights[key]) ? weights[key] : 1;
    const label = COMPONENT_LABELS[key] ?? key.replace(/_/g, ' ');
    const delta = Math.round(eff - 50);
    const wDelta = Math.round(delta * w);
    drivers.push({ label, eff, delta, wDelta });
  }

  if (drivers.length === 0) {
    return `Score of ${overall} — based on limited evidence; more materials needed for meaningful signal.`;
  }

  // Sort by largest weighted-delta magnitude (most impactful first).
  const sorted = [...drivers].sort((a, b) => Math.abs(b.wDelta) - Math.abs(a.wDelta));
  const top2 = sorted.slice(0, 2);
  const positives = top2.filter((d) => d.delta >= 0);
  const negatives = top2.filter((d) => d.delta < 0);

  const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

  if (positives.length === 2) {
    return (
      `Score of ${overall} — led by ${positives[0].label} (${sign(positives[0].delta)} pts) ` +
      `and ${positives[1].label} (${sign(positives[1].delta)} pts).`
    );
  }
  if (negatives.length === 2) {
    return (
      `Score of ${overall} — held back by ${negatives[0].label} (${sign(negatives[0].delta)} pts) ` +
      `and ${negatives[1].label} (${sign(negatives[1].delta)} pts).`
    );
  }
  if (positives.length === 1 && negatives.length === 1) {
    return (
      `Score of ${overall} — ${positives[0].label} was a strength (${sign(positives[0].delta)} pts), ` +
      `while ${negatives[0].label} needs improvement (${sign(negatives[0].delta)} pts).`
    );
  }
  if (top2.length === 1) {
    const d = top2[0];
    return `Score of ${overall} — primary driver: ${d.label} (${sign(d.delta)} pts vs neutral).`;
  }

  return `Score of ${overall} — derived from ${drivers.length} analyzed dimensions.`;
}
