/**
 * investorInsightsUtils.ts — Pure utility types, parse functions, and constants
 * for the investor-insights feature.
 *
 * Lives in a dedicated non-component file so that InvestorInsightsTab.tsx only
 * exports React components, letting Vite Fast Refresh work without interruption.
 */

// ── Insight Slots ─────────────────────────────────────────────────────────────

export interface SlotRow {
  slot: string;
  state: 'Computable' | 'NotComputable' | string;
  value: string;
  evidence: string;
  reason: string;
}

export function parseInsightSlotBody(body: string): SlotRow[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): SlotRow[] => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return [];
      const slot = line.slice(0, colonIdx).trim();
      const rest = line.slice(colonIdx + 1).trim();
      // Split on " | " (with spaces) to avoid false splits inside a quoted value like
      // value="Retention ratio / 60.00%". The worker sanitizes | → / in values,
      // but we parse defensively here anyway.
      const parts = rest.split(/ \| /).map((p) => p.trim());
      const state = (parts[0] ?? '').trim();
      const pick = (key: string) => {
        const part = parts.find((p) => p.startsWith(`${key}=`));
        if (!part) return 'none';
        const raw = part.slice(key.length + 1).trim();
        // Strip surrounding double-quotes if present (value="...").
        if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) return raw.slice(1, -1);
        return raw;
      };
      return [{ slot, state, value: pick('value'), evidence: pick('evidence'), reason: pick('reason') }];
    });
}

export function slotLabel(raw: string): string {
  // "raise_terms" → "Raise Terms"
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function displayValue(raw: string): string {
  if (raw === 'none') return '—';
  // Strip surrounding quotes if present
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) return raw.slice(1, -1);
  return raw;
}

// ── Canonical Fields ──────────────────────────────────────────────────────────

export interface CanonicalFieldRow {
  category: string;
  field: string;
  computability: 'Computable' | 'NotComputable' | string;
  value: string | null;
  evidence: string | null;
  reason: string | null;
}

export function parseCanonicalFieldsBody(body: string): CanonicalFieldRow[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): CanonicalFieldRow[] => {
      const tokens = line.split(' | ');
      const pick = (key: string): string => {
        const token = tokens.find((t) => t.startsWith(`${key}=`));
        if (!token) return 'none';
        return token.slice(key.length + 1).trim();
      };
      const category = pick('category');
      const field = pick('field');
      if (!category || category === 'none' || !field || field === 'none') return [];
      const computability = pick('computability');
      const rawValue = pick('value');
      const rawEvidence = pick('evidence');
      const rawReason = pick('reason');

      const parseNullable = (raw: string): string | null => {
        if (raw === 'none' || raw === '') return null;
        // Strip surrounding quotes, then trim trailing whitespace
        if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) {
          return raw.slice(1, -1).trimEnd();
        }
        return raw.trimEnd();
      };

      return [{
        category,
        field,
        computability,
        value: parseNullable(rawValue),
        evidence: parseNullable(rawEvidence),
        reason: parseNullable(rawReason),
      }];
    });
}

export function fieldLabel(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Conflicts ─────────────────────────────────────────────────────────────────

export interface ConflictRow {
  field: string;
  valueA: string;
  evidenceA: string;
  valueB: string;
  evidenceB: string;
}

export function parseConflictsBody(body: string): ConflictRow[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): ConflictRow[] => {
      const tokens = line.split(' | ');
      const pick = (key: string): string => {
        const token = tokens.find((t) => t.startsWith(`${key}=`));
        if (!token) return '';
        const raw = token.slice(key.length + 1).trim();
        if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) return raw.slice(1, -1).trimEnd();
        return raw.trimEnd();
      };
      const field = pick('field');
      if (!field) return [];
      return [{ field, valueA: pick('value_a'), evidenceA: pick('evidence_a'), valueB: pick('value_b'), evidenceB: pick('evidence_b') }];
    });
}

// ── Governed Summary V1 ───────────────────────────────────────────────────────

export interface GovernedSummaryV1 {
  schema_version: 'governed_summary_v1';
  executive_summary: string;
  strengths: string[];
  risks: string[];
  open_questions: string[];
  validated: boolean;
}

export function parseGovernedSummaryBody(body: string): GovernedSummaryV1 | null {
  const delimiter = '---governed_summary_v1_json---\n';
  const idx = body.indexOf(delimiter);
  if (idx === -1) return null;
  try {
    const json = body.slice(idx + delimiter.length).trim();
    const parsed = JSON.parse(json) as GovernedSummaryV1;
    if (parsed?.schema_version !== 'governed_summary_v1') return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Section key sets ──────────────────────────────────────────────────────────

/**
 * Keys of sections that belong in the Data tab rather than the Investor Insights
 * decision surface.  The main InvestorInsightsTab component filters these out
 * so only the true decision-layer sections are rendered there; the Data tab's
 * InsightsDataPanel renders them in grouped subsections.
 */
export const DATA_SECTION_KEYS = new Set([
  // Original core data / debug sections
  'insight_slots',
  'canonical_fields',
  'completeness_summary',
  'conflicts',
  'coverage_snapshot',
  'debug.normalization_diff',
  // Gate / analysis status sections (system output — not investor-facing)
  'gate_state',
  'analysis_status',
  'evidence_quality_gate',
  'g3_remediation',
  // Debug subsections
  'debug.signal_visibility',
  'debug.normalization_summary',
  'debug.dpu_diagnostics',
  'debug.structured_json_diagnostics',
  // Raw financial sections (replaced by LLM interpretation in main tab)
  'financial_statement_v1',
  'financial_health_metrics_v1',
  'financial_layout_classifier_v1',
  'financial_reconciliation_v1',
  'deck_financial_signals_v1',
  'use_of_funds_v1',
  'implied_capital_allocation_v1',
  // Interim / stub sections not yet investor-ready
  'investor_thesis',
  'deal_fusion',
]);

// ── LLM Interpretation V1 (PR34) ─────────────────────────────────────────────

export type LlmInterpretationPosture = 'GO' | 'INVESTIGATE' | 'CAUTION' | 'PASS';

export type LlmInterpretationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface LlmInterpretationV1 {
  schema_version: 'llm_interpretation_v1';
  /** Investment posture: GO | INVESTIGATE | CAUTION | PASS */
  posture: LlmInterpretationPosture;
  /** Confidence level: HIGH | MEDIUM | LOW */
  confidence: LlmInterpretationConfidence;
  executive_summary: string;
  /** 1–3 sentences on product differentiation: what the company builds and what makes it unique. */
  product_differentiation: string;
  /** 1–3 sentences on go-to-market: target buyer, pricing, channels, and distribution signals. */
  go_to_market_strategy: string;
  /** Up to 3 key strengths grounded in extracted evidence. */
  strengths: string[];
  /** Up to 3 key risks or concerns. */
  risks: string[];
  /** Up to 3 targeted follow-up questions. */
  next_questions: string[];
  /** 1–3 sentences on financial profile (revenue, growth, burn, runway). */
  financial_outlook: string;
  /** 1–3 sentences on business quality (model, team, PMF, defensibility). */
  business_quality: string;
  /** 1–3 sentences on market position (TAM/SAM/SOM, competitive dynamics). */
  market_position: string;
  /** 1–3 sentences interpreting the raise (amount, terms, use of funds). */
  capital_and_raise_interpretation: string;
  /** Up to 3 critical unknowns preventing high-confidence assessment. */
  key_unknowns: string[];
  /** Non-null when evidence coverage was limited at time of generation. */
  evidence_caveat: string | null;
  validated: boolean;
}

/**
 * Parse a LlmInterpretationV1 from a section body string created by
 * serializeLlmInterpretationBody on the worker side.  Returns null on failure.
 */
export function parseLlmInterpretationBody(body: string): LlmInterpretationV1 | null {
  const delimiter = '---llm_interpretation_v1_json---\n';
  const idx = body.indexOf(delimiter);
  if (idx === -1) return null;
  try {
    const json = body.slice(idx + delimiter.length).trim();
    const parsed = JSON.parse(json) as LlmInterpretationV1;
    if (parsed?.schema_version !== 'llm_interpretation_v1') return null;
    return parsed;
  } catch {
    return null;
  }
}
// ─── PR35: External Due Diligence V1 ─────────────────────────────────────────

export type ExternalDiligenceBucketKey =
  | 'company_overview'
  | 'competitors'
  | 'market_trends'
  | 'company_news'
  | 'founder_team_signals'
  | 'financial_market_context';

export type ExternalBucketStatus = 'ok' | 'empty' | 'skipped' | 'failed';
export type CorroborationVerdict = 'corroborated' | 'contradicted' | 'not_found';
export type ExternalDiligenceRunStatus = 'succeeded' | 'partial' | 'failed' | 'skipped';

export interface ExternalSearchResult {
  url: string;
  title: string;
  snippet: string;
  score: number;
  published_date: string | null;
  bucket: ExternalDiligenceBucketKey;
}

export interface ExternalDiligenceBucket {
  bucket: ExternalDiligenceBucketKey;
  query_used: string;
  results: ExternalSearchResult[];
  results_count: number;
  status: ExternalBucketStatus;
  error_message?: string;
}

export interface ClaimCorroboration {
  claim_field: string;
  claim_value: string;
  web_signal: string;
  source_url: string;
  verdict: CorroborationVerdict;
}

export interface ExternalDiligenceV1 {
  schema_version: 'external_diligence_v1';
  run_status: ExternalDiligenceRunStatus;
  total_results_fetched: number;
  queries_run: number;
  buckets: ExternalDiligenceBucket[];
  claim_corroborations: ClaimCorroboration[];
  company_name_used: string | null;
  sector_used: string | null;
  ran_at: string;
  tavily_credits_used: number | null;
}

const EXT_DILIGENCE_DELIMITER = '---external_diligence_v1_json---\n';

/**
 * Parse an ExternalDiligenceV1 from a section body string created by
 * serializeExternalDiligenceSectionBody on the worker side.
 */
export function parseExternalDiligenceBody(body: string): ExternalDiligenceV1 | null {
  const idx = body.indexOf(EXT_DILIGENCE_DELIMITER);
  if (idx === -1) return null;
  try {
    const json = body.slice(idx + EXT_DILIGENCE_DELIMITER.length).trim();
    const parsed = JSON.parse(json) as ExternalDiligenceV1;
    if (parsed?.schema_version !== 'external_diligence_v1') return null;
    return parsed;
  } catch {
    return null;
  }
}