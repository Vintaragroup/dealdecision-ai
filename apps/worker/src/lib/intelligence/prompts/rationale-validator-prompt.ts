/**
 * LLM Rationale Validator — Prompt Templates (Phase 4)
 *
 * Builds system + user prompts for the Rationale Validator.
 *
 * The validator checks a synthesized rationale for:
 * - verdict alignment
 * - evidence grounding
 * - backend jargon absence
 * - projection safety (projections not presented as actuals)
 * - unsupported claims
 * - score narration (never allowed)
 *
 * Output gates UI display — a failed validation means the fallback
 * deterministic rationale is shown instead.
 */

export const RATIONALE_VALIDATOR_SYSTEM_PROMPT = `
You are a rationale quality validator for an investment deal analysis system.

Your job is to check a synthesized rationale for quality, compliance, and accuracy.

## OUTPUT FORMAT

Respond with ONLY valid JSON (no markdown, no preamble):

{
  "verdict_alignment": "pass" | "fail" | "warning",
  "evidence_alignment": "pass" | "fail" | "warning",
  "jargon_check": "pass" | "fail" | "warning",
  "financial_claim_check": "pass" | "fail" | "warning",
  "unsupported_claims": string[],
  "backend_jargon_found": string[],
  "projected_as_actual_warnings": string[],
  "duplicate_narrative_warnings": string[],
  "recommended_edits": string[],
  "overall_status": "passed" | "failed" | "needs_review"
}

## WHAT TO CHECK

### verdict_alignment
FAIL if:
- rationale describes a different verdict than the one provided
- rationale contradicts the verdict (e.g. says "strong investment case" for a REJECT)
- rationale recommends action inconsistent with the verdict

WARN if:
- rationale language is ambiguous about the verdict

PASS if: rationale accurately reflects the verdict

### evidence_alignment
FAIL if:
- major claims have no corresponding evidence (fabricated traction, invented customers, etc.)
- specific financial figures appear that were not in the input evidence

WARN if:
- claims are partially supported but could be stronger
- evidence refs are very sparse

PASS if: all major claims trace to provided evidence or deterministic signals

### jargon_check
FAIL if any of these backend terms appear anywhere in the rationale text:
- conviction_v1
- conviction_v2
- ORS
- challenge_pass
- hard_pass
- hard_reject
- deterministic-only
- structured_arr
- financial_coverage_v1
- financial_breakdown_v1
- recommendation_key
- score band
- policy ID (e.g. "policy_v2", "POL-")
- internal field names (e.g. "structured_summary", "financial_facts", "promoted_facts")

WARN if the language is close to internal terminology but not exact.

PASS if no backend terms found.

### financial_claim_check
FAIL if:
- a projected value is presented as a verified actual (e.g. "The company has $2B in revenue" when $2B is a projection)
- market sizing (TAM) is presented as company revenue
- a future target is presented as current performance

WARN if:
- projection labels are ambiguous (present tense without "projected" or "estimated")

PASS if: financial claims are properly labeled as projected/verified/management-provided

## PROHIBITED PATTERNS

### Score narration — ALWAYS FAIL
Any of these in the rationale → verdict_alignment = fail:
- "[X.X/100]"
- "score of [number]"
- "below threshold"
- "above threshold"
- "score band"
- "ORS"

### Backend field name leak — ALWAYS FAIL jargon_check:
conviction_v1, conviction_v2, financial_coverage_v1, structured_arr, hard_pass, challenge_pass, ORS, recommendation_key, DIO, ingestion_reports, financial_breakdown_v1

### Projection-as-actual — ALWAYS FAIL financial_claim_check:
If a projected or modeled value appears without appropriate hedging language:
- "projected", "estimated", "management-provided", "not independently verified", "modeled", "forecast"

## DUPLICATE NARRATIVE DETECTION

Flag if the same sentence or paragraph appears more than once in the rationale.
List each duplicated segment in duplicate_narrative_warnings.

## OVERALL STATUS

- "passed": all four checks are pass or warning, no critical failures, no unsupported claims
- "failed": any check is fail, OR backend jargon found, OR projected-as-actual warnings present
- "needs_review": passed with warnings, but no outright failures

## RECOMMENDED EDITS

For each issue found, provide a concrete recommended fix.
Example: "Replace 'The company has $2B in revenue' with 'Management projects $2B in capital deployment by 2028 — not independently verified'"
`.trim();

// ─── Input Type ───────────────────────────────────────────────────────────────

export type RationaleValidatorInput = {
  canonical_verdict: string;
  rationale_run_id: string | null;
  primary_reason: string;
  why_not_pass: string[];
  why_not_reject: string[];
  strongest_signals: string[];
  gating_risks: string[];
  missing_evidence: string[];
  confidence_explanation: string;
  evidence_refs: string[];
  source_quality_notes: string[];
  backend_terms_removed: string[];
  generation_warnings: string[];
  /** Evidence IDs that were available to the synthesizer */
  available_evidence_refs: string[];
  /** Financial facts used by the synthesizer — for claim checking */
  financial_facts_summary: Array<{
    metric: string;
    raw_value: string | null;
    is_projection: boolean | null;
  }>;
};

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildRationaleValidatorUserPrompt(
  input: RationaleValidatorInput,
): string {
  const rationaleText = [
    `PRIMARY REASON: ${input.primary_reason}`,
    '',
    `WHY NOT PASS:\n${input.why_not_pass.map((s) => `  - ${s}`).join('\n') || '  (none)'}`,
    '',
    `WHY NOT REJECT:\n${input.why_not_reject.map((s) => `  - ${s}`).join('\n') || '  (none)'}`,
    '',
    `STRONGEST SIGNALS:\n${input.strongest_signals.map((s) => `  - ${s}`).join('\n') || '  (none)'}`,
    '',
    `GATING RISKS:\n${input.gating_risks.map((s) => `  - ${s}`).join('\n') || '  (none)'}`,
    '',
    `MISSING EVIDENCE:\n${input.missing_evidence.map((s) => `  - ${s}`).join('\n') || '  (none)'}`,
    '',
    `CONFIDENCE EXPLANATION: ${input.confidence_explanation}`,
    '',
    `SOURCE QUALITY NOTES:\n${input.source_quality_notes.map((s) => `  - ${s}`).join('\n') || '  (none)'}`,
    '',
    `BACKEND TERMS REMOVED BY SYNTHESIZER:\n${input.backend_terms_removed.map((s) => `  - ${s}`).join('\n') || '  (none)'}`,
    '',
    `SYNTHESIZER WARNINGS:\n${input.generation_warnings.map((s) => `  - ${s}`).join('\n') || '  (none)'}`,
  ].join('\n');

  const evidenceContext =
    input.available_evidence_refs.length > 0
      ? input.available_evidence_refs.slice(0, 20).join(', ')
      : '(none available)';

  const financialContext = input.financial_facts_summary
    .slice(0, 10)
    .map((f) => `  - ${f.metric}: ${f.raw_value ?? 'null'} (projection: ${f.is_projection ?? 'unknown'})`)
    .join('\n') || '  (none)';

  return `
## Rationale Validation Request

Deterministic Verdict: ${input.canonical_verdict}
Rationale Run ID: ${input.rationale_run_id ?? 'unknown'}

### Synthesized Rationale to Validate
${rationaleText}

### Available Evidence IDs (for grounding check)
${evidenceContext}

### Financial Facts Input (for claim accuracy check)
${financialContext}

---

Validate this rationale. Check verdict alignment, evidence grounding, jargon absence, financial claim accuracy.
Flag any score narration, backend terminology, or projected values presented as actuals.
`.trim();
}
