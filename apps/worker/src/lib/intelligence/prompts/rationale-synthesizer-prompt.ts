/**
 * LLM Decision Rationale Synthesizer — Prompt Templates (Phase 4)
 *
 * Builds system + user prompts for the Decision Rationale Synthesizer.
 *
 * The synthesizer explains the deterministic verdict in investor-grade language.
 * It does NOT compute the verdict — it reads from canonical_decision_v2 / conviction.
 *
 * NON-NEGOTIABLE RULES:
 * - The LLM explains the verdict. It does NOT override or modify it.
 * - No score narration ("47.1/100", "below threshold")
 * - No backend terminology (conviction_v1, ORS, hard_pass, challenge_pass, etc.)
 * - All major claims must map to evidence
 * - Projections must be labeled as projections, never presented as actuals
 * - Rationale reads like an IC memo, not an extraction report
 */

export const RATIONALE_SYNTHESIZER_SYSTEM_PROMPT = `
You are an investment analyst synthesizing a deal verdict rationale for an IC meeting.

Your job is to explain WHY the system reached its verdict in investor-grade language.

## THE VERDICT IS FINAL

You are given the deterministic verdict. You MUST explain it accurately.
You are NOT permitted to suggest the verdict is wrong or should change.

## OUTPUT FORMAT

Respond with ONLY valid JSON (no markdown, no preamble):

{
  "primary_reason": string,
  "why_not_pass": string[],
  "why_not_reject": string[],
  "strongest_signals": string[],
  "gating_risks": string[],
  "missing_evidence": string[],
  "confidence_explanation": string,
  "evidence_refs": string[],
  "source_quality_notes": string[],
  "backend_terms_removed": string[],
  "generation_warnings": string[]
}

## LANGUAGE RULES

DO NOT USE:
- conviction_v1 / conviction_v2
- ORS (Overall Readiness Score)
- challenge_pass
- hard_pass / hard_reject
- deterministic-only mode
- structured_arr / structured_burn
- financial_coverage_v1 / financial_breakdown_v1
- policy IDs or internal routing labels
- "score", "threshold", "band", or any numeric scores

TRANSLATE INSTEAD:
- "conviction_v1 PASS" → "The core investment signals are sufficiently strong for continued consideration"
- "ORS below threshold" → "The current evidence base does not yet support a capital commitment"
- "challenge_pass = false" → "The evidence does not yet resolve key underwriting uncertainties"
- "hard_pass" → "This opportunity does not meet minimum criteria for further consideration"

## VERDICT LANGUAGE GUIDE

INVESTIGATE:
"The current package provides sufficient signal to warrant continued diligence, but does not yet support a capital commitment."

PASS:
"The deal presents a strong investment case with verified evidence across key underwriting dimensions."

REJECT:
"The current package does not provide sufficient evidence to support further consideration at this time."

MONITOR:
"The opportunity shows early-stage signal but requires further development before underwriting is feasible."

## REQUIRED OUTPUT RULES

### primary_reason
One or two sentences. Investment-grade. Explains the verdict.
- Must NOT contain score numbers (e.g. "47.1/100" is PROHIBITED)
- Must NOT contain backend field names
- Must explain why the verdict was reached

### why_not_pass
2-4 items. Explain what would have been needed for a PASS verdict.
- Be specific about missing evidence
- Reference evidence gaps, not score gaps
- Example: "Projected economics not independently verified"
- Example: "No verified customer demand or signed commercial agreements"

### why_not_reject
1-3 items. Explain what prevented outright rejection.
- What credible signals exist that keep the deal alive?
- Example: "Capital structure and deployment strategy are coherent"
- Example: "Clear infrastructure opportunity with defined deployment model"

### strongest_signals
2-4 items. The strongest positive signals present.
- Must map to real evidence, not projections
- Label projections explicitly: "Management-projected $X deployment by Y"

### gating_risks
1-4 items. Conditions that could change the verdict if resolved or deteriorate.
- Example: "Inability to verify commercial offtake commitments"
- Example: "Regulatory approval remains pending and unresolved"

### missing_evidence
2-5 items. Evidence that would materially change conviction if present.
- Example: "Independently verified revenue or customer contracts"
- Example: "Audited financial statements for the operating entity"

### confidence_explanation
1-2 sentences. Describes confidence stability.
- Must NOT say "Fragile" or "Strong" alone — explain WHY
- Example: "The current conclusion remains preliminary because several key underwriting assumptions cannot yet be independently verified, and the evidence base is primarily management-provided."

### evidence_refs
List of evidence IDs that ground the rationale.
Use what is provided — do not fabricate.

### source_quality_notes
Notes on reliability. Example:
- "Financial figures are management-provided and not independently verified"
- "XLSX model is present but projections are not audited"

### backend_terms_removed
List any internal terms you were tempted to use but replaced with investor language.
This field is for audit purposes. Example: ["conviction_v1 PASS → strong investment signals"]

### generation_warnings
List any warnings about the rationale quality. Example:
- "Very few evidence refs available — rationale is partially unsupported"
- "Verdict is INVESTIGATE but available signals are ambiguous"
- Leave empty [] if no warnings.

## PROJECTION SAFETY RULES

NEVER present:
- Projected revenue as current revenue
- Modeled economics as verified actuals
- Deck scenarios as confirmed performance
- "TAM" or market sizing as company revenue

REQUIRED labels for projections:
- "management-projected"
- "modeled"
- "estimated"
- "not independently verified"
- "deck-stated"

Example CORRECT: "Management projects $2B in capital deployment by 2028 — this has not been independently verified."
Example WRONG: "The company has $2B in revenue."

## RATIONALE STYLE GUIDE

Write like a senior investment professional summarizing for an IC.

GOOD:
"Climatic presents a potentially credible infrastructure-scale ammonia and energy deployment strategy supported by a defined capital structure and deployment plan. However, the current package lacks independently verified commercial demand, underwriting-grade financial evidence, and validation of projected economics. The system therefore supports continued investigation but not a capital commitment recommendation at this stage."

BAD:
"Initial analysis warrants further investigation (47.1/100). Score below threshold for PASS verdict. challenge_pass was not achieved."

BAD:
"The deal has strong conviction_v1 signals but ORS was insufficient."
`.trim();

// ─── Input Type ───────────────────────────────────────────────────────────────

export type RationaleSynthesizerInput = {
  deal_id: string;
  company_name: string | null;
  archetype: string | null;
  canonical_verdict: string;
  conviction_summary: string | null;
  financial_coverage_summary: string | null;
  evidence_count: number;
  has_xlsx: boolean;
  has_cap_table: boolean;
  strongest_evidence_items: Array<{
    evidence_id: string;
    fact_type: string;
    summary: string;
    is_projection: boolean;
    source_kind: string;
    confidence: number;
  }>;
  financial_facts_summary: Array<{
    metric: string;
    value: number | null;
    raw_value: string | null;
    period: string | null;
    is_projection: boolean | null;
    source_kind: string | null;
  }>;
  contradiction_summaries: string[];
  missing_evidence_signals: string[];
  accepted_corrections_summary: string[];
  decision_readiness_score: number | null;
  financial_completeness_pct: number | null;
  underwriting_readiness_notes: string[];
  section_health_summary: Record<string, string> | null;
};

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildRationaleSynthesizerUserPrompt(
  input: RationaleSynthesizerInput,
): string {
  const verdictLabel = (() => {
    const v = (input.canonical_verdict ?? '').toUpperCase();
    // canonical_decision_v2 vocabulary (rare here — see processor.ts comment on
    // why this is almost always the score-band vocabulary below instead)
    if (v === 'PASS') return 'PASS — recommend for capital commitment';
    if (v === 'REJECT') return 'REJECT — do not proceed';
    if (v === 'INVESTIGATE') return 'INVESTIGATE — warrants continued diligence but not yet capital commitment';
    if (v === 'MONITOR') return 'MONITOR — track but do not commit capital';
    // ScoreBandV2 vocabulary (score-bands-v2.ts) — the actual verdict input in
    // the normal case, since canonical_decision_v2 isn't computed yet at this
    // point in the pipeline.
    if (v === 'HARD_PASS') return 'HARD PASS — score indicates decline, do not proceed';
    if (v === 'CONSIDER_CAUTION') return 'CONSIDER WITH CAUTION — warrants continued diligence but not yet capital commitment';
    if (v === 'STRONG_CONSIDER') return 'STRONG CONSIDER — promising, but confidence still needs to be established';
    if (v === 'FUND_CAUTION') return 'FUND WITH CAUTION — supportable for capital commitment with noted risks';
    if (v === 'FUND_TRACK') return 'FUND & TRACK — recommend for capital commitment with ongoing monitoring';
    if (v === 'FUND_CONFIDENT') return 'FUND — recommend for capital commitment with high confidence';
    return input.canonical_verdict;
  })();

  const evidenceList = input.strongest_evidence_items
    .slice(0, 12)
    .map(
      (e) =>
        `  - [${e.evidence_id}] ${e.fact_type}: "${e.summary}" (source: ${e.source_kind}, confidence: ${e.confidence.toFixed(2)}, projection: ${e.is_projection})`,
    )
    .join('\n');

  const financialList = input.financial_facts_summary
    .slice(0, 12)
    .map(
      (f) =>
        `  - ${f.metric}: ${f.raw_value ?? f.value ?? 'null'} (period: ${f.period ?? 'unknown'}, source: ${f.source_kind ?? 'unknown'}, projection: ${f.is_projection ?? 'unknown'})`,
    )
    .join('\n');

  const contradictions =
    input.contradiction_summaries.length > 0
      ? input.contradiction_summaries.map((c) => `  - ${c}`).join('\n')
      : '  (none)';

  const missing =
    input.missing_evidence_signals.length > 0
      ? input.missing_evidence_signals.map((m) => `  - ${m}`).join('\n')
      : '  (none detected)';

  const corrections =
    input.accepted_corrections_summary.length > 0
      ? input.accepted_corrections_summary.map((c) => `  - ${c}`).join('\n')
      : '  (none)';

  const sectionHealth = input.section_health_summary
    ? Object.entries(input.section_health_summary)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join('\n')
    : '  (not available)';

  const underwritingNotes =
    input.underwriting_readiness_notes.length > 0
      ? input.underwriting_readiness_notes.map((n) => `  - ${n}`).join('\n')
      : '  (none)';

  return `
## Deal Rationale Synthesis Request

Company: ${input.company_name ?? 'Unknown'}
Archetype: ${input.archetype ?? 'Unknown'}
Deterministic Verdict: ${verdictLabel}

### Evidence Context
- Total evidence items: ${input.evidence_count}
- XLSX financial model present: ${input.has_xlsx}
- Cap table present: ${input.has_cap_table}
- Financial completeness: ${input.financial_completeness_pct != null ? `${input.financial_completeness_pct}%` : 'unknown'}
- Decision readiness score: ${input.decision_readiness_score != null ? input.decision_readiness_score : 'unknown'}

### Conviction Summary
${input.conviction_summary ?? '(not available)'}

### Financial Coverage Summary
${input.financial_coverage_summary ?? '(not available)'}

### Strongest Evidence Items
${evidenceList || '  (none available)'}

### Financial Facts
${financialList || '  (none available)'}

### Contradictions / Reconciliation Issues
${contradictions}

### Missing Evidence Signals
${missing}

### Validator-Accepted Corrections (informational)
${corrections}

### Underwriting Readiness Notes
${underwritingNotes}

### Section Health Summary
${sectionHealth}

---

Synthesize an investor-grade decision rationale for this deal.
Explain the verdict accurately. Do not score-narrate. Do not use backend terminology.
Ground every major claim in evidence. Label all projections as projections.
`.trim();
}
