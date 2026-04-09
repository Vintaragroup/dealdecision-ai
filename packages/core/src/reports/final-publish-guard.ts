/**
 * Final Publish Guard
 *
 * Output-phase null-enforcement for the structured_summary, applied AFTER
 * `buildStructuredSummary` completes.
 *
 * WHY THIS EXISTS — two DIO phase-1 "leak paths" survive the pre-guard:
 *
 * 1. RAISE LEAK:   `deal_overview_v2.raise = "$1 Series A Convertible Note"`
 *    After the field-authority guard blocks the `raise_terms_v1` promoted fact,
 *    `structured.raise.value` is null.  The overview fallback then fires inside
 *    `buildStructuredSummary` and fills `structured.raise` with the LLM-generated
 *    deal_overview_v2 string — which for de-SPAC deals often contains "$1" amounts
 *    (per-liquidation-preference pricing from the SPAC model).
 *
 * 2. BUSINESS MODEL LEAK:  `business_model_arbitration_v1.business_model = "Wholesale/Retail"`
 *    The arbitration block in `buildStructuredSummary` UNCONDITIONALLY overwrites
 *    `structured.business_model` whenever arbitrationV1.business_model is truthy.
 *    For medtech/healthcare deals this often produces a generic accounting-segment
 *    descriptor ("Wholesale/Retail") instead of the go-to-market model language from
 *    the pitch deck.
 *
 * 3. REVENUE LEAK (defense-in-depth):
 *    Revenue sourced from a `financial_pro_forma` or SPAC-entity document should
 *    be blocked by the pre-guard, but this guard provides a final safety net.
 *
 * The guard MUTATES `structuredSummary` in-place and returns a full audit log.
 *
 * Pure function — no DB, no LLM, no side effects other than mutation of the
 * passed `structuredSummary` object.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PublishGuardAction = 'nulled' | 'replaced' | 'kept';

export type PublishGuardLogEntry = {
  field: string;
  action: PublishGuardAction;
  rule: string;
  original_value: string | null;
  replacement_value: string | null;
  reason: string;
};

export type FinalPublishGuardResult = {
  fields_nulled: string[];
  fields_replaced: string[];
  log: PublishGuardLogEntry[];
};

export type FinalPublishGuardContext = {
  deal_type?: string | null;
  dio?: any;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function asStr(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function getNestedStr(obj: any, ...keys: string[]): string | null {
  let cur: any = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return asStr(cur);
}

function getDioPhase1(dio: any): any {
  return (dio as any)?.dio?.phase1 ?? null;
}

function getGovernedUiCopyV1(dio: any): any {
  return getDioPhase1(dio)?.governed_ui_copy_v1 ?? null;
}

/** Check if a text contains medtech / healthcare product signals. */
function hasMedtechProductSignals(text: string | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    /\bmedical\b/.test(t) ||
    /\bdevice\b/.test(t) ||
    /\bhealthcare\b/.test(t) ||
    /\bhealth\s+care\b/.test(t) ||
    /\bclinical\b/.test(t) ||
    /\b(hcp|physician|clinician|doctor|hospital)\b/.test(t) ||
    /\bprocedure\b/.test(t) ||
    /\btherapeutic\b/.test(t) ||
    /\bimplant\b/.test(t) ||
    /\bballoon\b/.test(t) ||
    /\bbariatric\b/.test(t) ||
    /\bsurgical\b/.test(t)
  );
}

/** Return true if raise value looks like a per-share / liquidation-preference reference. */
function isPerShareOrLiquidationRaise(value: string): boolean {
  const v = value.toLowerCase();
  return (
    /liquidation\s+preference/.test(v) ||
    /\bper[- ]share\b/.test(v) ||
    /\bper[- ]unit\b/.test(v) ||
    /\/sh(are)?\b/.test(v)
  );
}

/**
 * Return true if raise value looks like a $1-placeholder artifact.
 *
 * This pattern appears when an LLM is given per-share pricing data
 * from a SPAC liquidation preference model and produces e.g.
 * "$1 Series A Convertible Note" — which is not a real transaction amount.
 */
function isDollar1Placeholder(value: string): boolean {
  const v = value.trim();
  // Exact patterns: "$1 Series ...", "$1 Preferred ...", "$1 Convertible ..."
  if (/^\$?\s*1\s+(series|preferred|convertible|note)/i.test(v)) return true;
  // Value JSON amount is $1 exactly (or any subunit < $1,000 in a de-SPAC context)
  return false; // numeric check is done separately via amount
}

/** Extract raise amount from structured.raise. */
function getRaiseAmount(structuredRaise: any): number | null {
  const a =
    structuredRaise?.value_json?.amount?.amount ??
    structuredRaise?.value_json?.amount;
  if (typeof a === 'number' && Number.isFinite(a)) return a;
  return null;
}

/** True if value.sources all point to phase1 LLM paths (no promoted-fact doc citation). */
function raiseSourcingIsPhase1Only(structuredRaise: any): boolean {
  const sources: any[] = Array.isArray(structuredRaise?.sources) ? structuredRaise.sources : [];
  if (sources.length === 0) return true; // no sources → unverified
  return sources.every((s: any) => {
    const kind = String(s?.kind ?? '').toLowerCase();
    return kind.startsWith('phase1.') || kind.startsWith('llm_') || kind === '';
  });
}

/** True if business model sources don't include any pitch_deck documents. */
function businessModelSourcesNoPitchDeck(structuredBM: any, documents: any[] | null): boolean {
  const sources: any[] = Array.isArray(structuredBM?.sources) ? structuredBM.sources : [];
  if (sources.length === 0) return true;

  // sources from arbitration_v1 have kind = 'phase1.business_model_arbitration_v1'
  // and no document_id → they're phase1 only
  for (const s of sources) {
    const docId = asStr(s?.document_id ?? s?.source_document_id);
    if (docId) {
      // Has a real document ID — check if it's a pitch deck
      const doc = documents?.find((d: any) => d.document_id === docId);
      const kind = String(doc?.kind ?? '').toLowerCase();
      const filename = String(doc?.filename ?? '').toLowerCase();
      if (
        kind.includes('pitch') || kind.includes('deck') ||
        filename.includes('pitch') || filename.includes('deck') ||
        filename.endsWith('.pptx') || filename.endsWith('.ppt') || filename.endsWith('.key')
      ) {
        return false; // Has pitch deck source → do NOT flag
      }
    }
  }

  // All sources are either phase1-only or non-pitch-deck
  return true;
}

// ─── Rule: Raise output guard ─────────────────────────────────────────────────

function applyRaiseGuard(
  structuredSummary: Record<string, any>,
  context: FinalPublishGuardContext,
  log: PublishGuardLogEntry[],
): void {
  const raise = structuredSummary?.raise;
  if (!raise) return;

  const value = asStr(raise?.value);
  if (!value) return; // Already null — nothing to do

  const dealType = String(context?.deal_type ?? '').toLowerCase().replace(/[-_ ]/g, '');
  const isDeSpac = dealType === 'despac';
  const amount = getRaiseAmount(raise);
  const isPhase1Only = raiseSourcingIsPhase1Only(raise);

  let triggerRule: string | null = null;
  let reason: string | null = null;

  if (isPerShareOrLiquidationRaise(value)) {
    triggerRule = 'raise.per_share_or_liquidation';
    reason = `Raise value "${value}" matches per-share / liquidation-preference pattern — not a transaction amount`;
  } else if (isDollar1Placeholder(value)) {
    triggerRule = 'raise.dollar1_placeholder';
    reason = `Raise value "${value}" matches $1 series/preferred/convertible placeholder pattern`;
  } else if (
    isDeSpac &&
    amount !== null &&
    amount < 100_000 &&
    isPhase1Only
  ) {
    // de-SPAC raises must be ≥ $100K; anything smaller is per-share pricing
    triggerRule = 'raise.despac_implausible_tiny_amount';
    reason = `de-SPAC raise amount ${amount} < $100K sourced from phase1-only (no doc citation) — likely per-share pricing, not transaction amount`;
  }

  if (triggerRule) {
    log.push({
      field: 'raise',
      action: 'nulled',
      rule: triggerRule,
      original_value: value,
      replacement_value: null,
      reason: reason ?? triggerRule,
    });

    // Null the raise in-place, preserving provenance
    structuredSummary.raise = {
      value: null,
      value_json: null,
      round_label: null,
      confidence: 0,
      sources: Array.isArray(raise.sources) ? raise.sources : [],
      nulled_by: 'final_publish_guard',
      null_rule: triggerRule,
      null_reason: reason,
    };
  } else {
    log.push({
      field: 'raise',
      action: 'kept',
      rule: 'raise.no_violation',
      original_value: value,
      replacement_value: null,
      reason: 'No raise guard rule triggered',
    });
  }
}

// ─── Rule: Business model output guard ───────────────────────────────────────

/**
 * Detect generic accounting-segment language (e.g. "Wholesale/Retail") incorrectly
 * used as a business model descriptor for a medtech/healthcare product.
 *
 * When fired: null the value and attempt to replace from governed_ui_copy_v1.business_model
 * (which tends to use correct B2B → HCP channel language for these deals).
 */
function applyBusinessModelGuard(
  structuredSummary: Record<string, any>,
  context: FinalPublishGuardContext,
  documents: any[] | null,
  log: PublishGuardLogEntry[],
): void {
  const bm = structuredSummary?.business_model;
  if (!bm) return;

  const value = asStr(bm?.value);
  if (!value) return;

  // Check for generic wholesale/retail distribution channel language
  const isGenericDistributionTerm =
    /^wholesale\s*\/?\s*retail$/i.test(value) ||
    /^wholesale$/i.test(value) ||
    (/\bwholesale\b/i.test(value) && !/\bB2B\b/.test(value) && !/hcp|healthcare|medical/i.test(value));

  if (!isGenericDistributionTerm) {
    log.push({
      field: 'business_model',
      action: 'kept',
      rule: 'business_model.no_generic_term',
      original_value: value,
      replacement_value: null,
      reason: 'Value does not match generic wholesale/retail distribution term',
    });
    return;
  }

  // Check whether the BM sources include any pitch deck — if so, do not overrule
  const hasPitchDeckSource = !businessModelSourcesNoPitchDeck(bm, documents);
  if (hasPitchDeckSource) {
    log.push({
      field: 'business_model',
      action: 'kept',
      rule: 'business_model.pitch_deck_source_present',
      original_value: value,
      replacement_value: null,
      reason: 'Generic term found but sourced from pitch deck — preserving deck language (may be correct distributor channel)',
    });
    return;
  }

  // Check for medtech / healthcare product signals in DIO context
  const guidedCopy = getGovernedUiCopyV1(context.dio);
  const productSolution =
    getNestedStr(guidedCopy, 'product_solution') ??
    getNestedStr(getDioPhase1(context.dio), 'deal_overview_v2', 'product_solution') ??
    getNestedStr(getDioPhase1(context.dio), 'executive_summary_v1', 'product_description');

  const hasMedtech = hasMedtechProductSignals(productSolution);

  if (!hasMedtech) {
    log.push({
      field: 'business_model',
      action: 'kept',
      rule: 'business_model.no_medtech_context',
      original_value: value,
      replacement_value: null,
      reason: 'Generic wholesale term found but no medtech product signals detected — preserving value',
    });
    return;
  }

  // Both conditions met: generic wholesale term + medtech context + no pitch deck source
  // → attempt to replace from governed_ui_copy_v1.business_model
  const govBM = asStr(guidedCopy?.business_model);
  const hasGoodReplacement = govBM !== null && govBM.length >= 20;

  const triggerRule = 'business_model.generic_wholesale_medtech_mismatch';

  if (hasGoodReplacement) {
    log.push({
      field: 'business_model',
      action: 'replaced',
      rule: triggerRule,
      original_value: value,
      replacement_value: govBM,
      reason: `Generic wholesale/retail term with medtech product context — replaced from governed_ui_copy_v1.business_model`,
    });

    structuredSummary.business_model = {
      value: govBM,
      confidence: 0.6, // Lower than deck-sourced; governed_ui_copy is LLM synthesis
      sources: [
        {
          kind: 'final_publish_guard.governed_ui_copy_v1',
          replaced_from: value,
          null_rule: triggerRule,
        },
      ],
      label: 'GovernedUiCopyFallback',
      replaced_by: 'final_publish_guard',
    };
  } else {
    log.push({
      field: 'business_model',
      action: 'nulled',
      rule: triggerRule,
      original_value: value,
      replacement_value: null,
      reason: `Generic wholesale/retail term with medtech product context; no governed_ui_copy_v1.business_model available (length ${govBM?.length ?? 0})`,
    });

    structuredSummary.business_model = {
      value: null,
      confidence: 0,
      sources: Array.isArray(bm.sources) ? bm.sources : [],
      nulled_by: 'final_publish_guard',
      null_rule: triggerRule,
    };
  }
}

// ─── Rule: Revenue defense-in-depth ──────────────────────────────────────────

/**
 * Belt-and-suspenders revenue guard.
 *
 * The pre-guard (field-authority-guard.ts) already blocks pro_forma revenue facts.
 * This guard handles the rare case where pro_forma revenue leaked through DIO phase1
 * fallback paths rather than through the promoted-fact channel.
 */
function applyRevenueGuard(
  structuredSummary: Record<string, any>,
  log: PublishGuardLogEntry[],
): void {
  const rev = structuredSummary?.revenue;
  if (!rev) return;

  const value = asStr(rev?.value?.raw ?? rev?.value);
  if (!value) return;

  const sources: any[] = Array.isArray(rev?.sources) ? rev.sources : [];
  const hasProFormaSource = sources.some((s: any) => {
    const kind = String(s?.kind ?? '').toLowerCase();
    const doc_kind = String(s?.document_kind ?? s?.doc_kind ?? '').toLowerCase();
    return (
      kind.includes('pro_forma') || kind.includes('proforma') ||
      doc_kind.includes('pro_forma') || doc_kind.includes('proforma') ||
      (typeof s?.doc_family === 'string' &&
        (s.doc_family === 'financial_pro_forma' || s.doc_family === 'spac_financials' || s.doc_family === 'spac_mda'))
    );
  });

  if (hasProFormaSource) {
    log.push({
      field: 'revenue',
      action: 'nulled',
      rule: 'revenue.pro_forma_source',
      original_value: value,
      replacement_value: null,
      reason: 'Revenue sourced from pro_forma/SPAC document — not operating company revenue',
    });

    structuredSummary.revenue = {
      value: null,
      confidence: 0,
      sources: sources,
      nulled_by: 'final_publish_guard',
      null_rule: 'revenue.pro_forma_source',
    };
  } else {
    log.push({
      field: 'revenue',
      action: 'kept',
      rule: 'revenue.no_pro_forma_source',
      original_value: value,
      replacement_value: null,
      reason: 'No pro_forma source detected',
    });
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Apply the final publish guard to a structured_summary that has already been
 * built by `buildStructuredSummary` + `applyStructuredSummaryFillIns`.
 *
 * Mutates `structuredSummary` in-place.
 *
 * @param structuredSummary  The output of buildStructuredSummary — will be mutated.
 * @param context            Deal type + raw DIO (for governed_ui_copy_v1 access).
 * @param documents          Optional document metadata (for source audit).
 */
export function applyFinalPublishGuard(
  structuredSummary: Record<string, any>,
  context: FinalPublishGuardContext,
  documents?: any[] | null,
): FinalPublishGuardResult {
  const log: PublishGuardLogEntry[] = [];

  applyRaiseGuard(structuredSummary, context, log);
  applyBusinessModelGuard(structuredSummary, context, documents ?? null, log);
  applyRevenueGuard(structuredSummary, log);

  const fields_nulled = log.filter((e) => e.action === 'nulled').map((e) => e.field);
  const fields_replaced = log.filter((e) => e.action === 'replaced').map((e) => e.field);

  return { fields_nulled, fields_replaced, log };
}
