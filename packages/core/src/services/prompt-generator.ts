/**
 * Prompt Generator Service
 * Generates system and user prompts for LLM analysis
 * Implements citation discipline and paraphrase testing
 */

import type {
  PlannerState,
  FactRow,
  Hypothesis,
  Uncertainty,
  BindingConstraint,
} from "../types/hrmdd";
import type { CycleType, PromptVariables } from "../types/analysis";

/**
 * Cycle 1 system prompt: Broad Scan
 */
export function generateCycle1SystemPrompt(): string {
  return `You are conducting the first cycle of a systematic investment due diligence analysis using Hierarchical Reasoning Method (HRM).

OBJECTIVE: Broad scan to identify key investment hypotheses and major uncertainties.

INSTRUCTIONS:

1. REVIEW MATERIALS
   - Read pitch deck and supporting documents carefully
   - Note key claims about market, product, traction, team

2. GENERATE HYPOTHESES
   - Identify 5-7 high-level hypotheses about investment viability
   - Frame as testable statements (e.g., "Market is large enough to support $100M+ outcome")

3. FLAG UNCERTAINTIES
   - Note information gaps that need investigation
   - Prioritize by importance to investment decision

4. CITE ALL CLAIMS
   - Every factual statement must reference source or be marked "uncertain"
   - Format: state claim and immediately provide source
   - NEVER quote exact text, always paraphrase

5. CALCULATE DEPTH DELTA
   - Have key questions been identified? YES/NO
   - Is uncertainty sufficiently mapped? YES/NO
   - If NO to either: DepthΔ ≥ 2 (continue to Cycle 2)
   - If YES to both: DepthΔ < 2 (sufficient for now)

OUTPUT FORMAT (JSON):
{
  "hypotheses": [
    {
      "hypothesis": "...",
      "supporting_evidence": "...",
      "citations": [{"claim": "...", "source": "...", "page": "..."}]
    }
  ],
  "uncertainties": [
    {
      "question": "...",
      "importance": "critical|high|medium|low",
      "investigation_path": "..."
    }
  ],
  "initial_binding_constraints": ["..."],
  "depth_delta": 0.XX,
  "reasoning_for_depth": "..."
}`;
}

/**
 * Cycle 2 system prompt: Deep Dive
 */
export function generateCycle2SystemPrompt(): string {
  return `You are conducting the second cycle of systematic due diligence analysis.

CONTEXT FROM CYCLE 1:
[Prior cycle output will be inserted here]

OBJECTIVE: Deep dive on flagged uncertainties and pressure-test hypotheses.

INSTRUCTIONS:

1. ADDRESS UNCERTAINTIES
   - For each high-priority uncertainty from Cycle 1
   - Gather supporting or contradicting evidence from deal materials
   - Make determination: supportive / concerning / inconclusive

2. PRESSURE-TEST HYPOTHESES
   - For each Cycle 1 hypothesis
   - Look for contradicting or limiting evidence
   - Assess: Does evidence hold up under scrutiny?

3. IDENTIFY BINDING CONSTRAINTS
   - What MUST be true for this investment to succeed?
   - List 3-5 binding constraints
   - Example: "Company must achieve <$50 CAC to hit target margins"

4. CITATION DISCIPLINE
   - Maintain strict deck-facts-only approach
   - Every claim cited with source, or marked "uncertain"

5. CALCULATE DEPTH DELTA
   - Are binding constraints clearly identified? YES/NO
   - Is evidence coverage adequate for decision? YES/NO
   - If NO: DepthΔ ≥ 2 (need Cycle 3)
   - If YES: DepthΔ < 2 (ready for synthesis)

OUTPUT FORMAT (JSON):
{
  "uncertainty_resolution": [
    {
      "uncertainty": "...",
      "evidence_gathered": "...",
      "determination": "supportive|concerning|inconclusive",
      "citations": [{"claim": "...", "source": "...", "page": "..."}]
    }
  ],
  "hypothesis_testing": [
    {
      "hypothesis": "...",
      "test_result": "supported|contradicted|inconclusive",
      "evidence": "..."
    }
  ],
  "binding_constraints": [
    {
      "constraint": "...",
      "evidence_for": "...",
      "evidence_against": "...",
      "assessment": "..."
    }
  ],
  "depth_delta": 0.XX,
  "reasoning_for_depth": "..."
}`;
}

/**
 * Cycle 3 system prompt: Synthesis
 */
export function generateCycle3SystemPrompt(): string {
  return `You are conducting final synthesis cycle of due diligence analysis.

CONTEXT FROM CYCLES 1-2:
[Prior cycles output will be inserted here]

OBJECTIVE: Synthesize findings into investment recommendation with gating plan.

INSTRUCTIONS:

1. EXECUTIVE SUMMARY
   - Concise 1-page summary of analysis
   - Highlight key findings, risks, opportunities

2. GO/NO-GO RECOMMENDATION
   - Decide: GO, NO-GO, or CONDITIONAL
   - Rationale tied to binding constraints and risks

3. TRANCHE PLAN
   - Define T0 (initial investment) + M1/M2/M3 gates
   - Each gate: clear condition + trigger

4. RISK ASSESSMENT
   - List major risks identified (critical/high/medium/low)
   - For each: mitigation approach

5. NEXT STEPS
   - What must be verified before investment?
   - Recommended actions for investor

6. FINAL CITATIONS
   - All claims tied to evidence with sources
   - No "uncertain" claims in final recommendation

OUTPUT FORMAT (JSON):
{
  "executive_summary": "...",
  "go_no_go_recommendation": "GO|NO-GO|CONDITIONAL",
  "tranche_plan": [
    {
      "tranche": "T0|M1|M2|M3",
      "condition": "...",
      "trigger": "..."
    }
  ],
  "risk_map": [
    {
      "risk": "...",
      "severity": "critical|high|medium|low",
      "mitigation": "..."
    }
  ],
  "what_to_verify": ["...", "..."],
  "calibration_metrics": {
    "citation_compliance": 0.XX,
    "confidence_average": 0.XX
  }
}`;
}

/**
 * Generate user prompt for Cycle 1
 */
export function generateCycle1UserPrompt(
  dealName: string,
  deckText: string,
  supportingDocs: string[]
): string {
  const docsContext =
    supportingDocs.length > 0
      ? `\n\nSUPPORTING DOCUMENTS:\n${supportingDocs.join("\n---\n")}`
      : "";

  return `DEAL: ${dealName}

PITCH DECK:
${deckText}
${docsContext}

Please conduct Cycle 1 analysis as specified in the system prompt. Output valid JSON.`;
}

/**
 * Generate user prompt for Cycle 2
 */
export function generateCycle2UserPrompt(
  dealName: string,
  cycle1Output: string,
  deckText: string
): string {
  return `DEAL: ${dealName}

CYCLE 1 ANALYSIS:
${cycle1Output}

DEAL MATERIALS (for reference):
${deckText}

Please conduct Cycle 2 deep dive analysis as specified in the system prompt. Focus on the uncertainties and hypotheses from Cycle 1. Output valid JSON.`;
}

/**
 * Generate user prompt for Cycle 3
 */
export function generateCycle3UserPrompt(
  dealName: string,
  cycle1Output: string,
  cycle2Output: string,
  allFacts: FactRow[]
): string {
  const factsSummary = allFacts
    .map((f) => `- "${f.claim}" (${f.source}, confidence: ${f.confidence})`)
    .join("\n");

  return `DEAL: ${dealName}

CYCLE 1 ANALYSIS:
${cycle1Output}

CYCLE 2 ANALYSIS:
${cycle2Output}

ALL EXTRACTED FACTS:
${factsSummary}

Please conduct Cycle 3 synthesis as specified in the system prompt. Produce final investment recommendation. Output valid JSON.`;
}

/**
 * Generate paraphrase test prompts
 */
export function generateParaphraseTests(
  question: string,
  count: number = 3
): string[] {
  const paraphrases: string[] = [question];

  if (count >= 2) {
    paraphrases.push(rephrase(question, "formal"));
  }

  if (count >= 3) {
    paraphrases.push(rephrase(question, "casual"));
  }

  return paraphrases;
}

/**
 * Rephrase a question in different style
 */
function rephrase(question: string, style: "formal" | "casual"): string {
  // Simple rephrasing logic - could be more sophisticated
  if (style === "formal") {
    return question
      .replace(/What is/, "Please specify")
      .replace(/How can/, "In what manner might")
      .replace(/Does/, "To what extent does");
  } else {
    return question
      .replace(/Please specify/, "What is")
      .replace(/In what manner might/, "How can")
      .replace(/To what extent does/, "Does");
  }
}

/**
 * Generate citation validation prompt
 */
export function generateCitationValidationPrompt(
  claim: string,
  proposedSource: string
): string {
  return `CLAIM: "${claim}"
PROPOSED SOURCE: "${proposedSource}"

Is this claim accurately cited? The source should be:
- "deck.pdf" for claims from the pitch deck
- A specific document name for claims from supporting documents
- "uncertain" if the claim cannot be verified in provided materials

Respond with: VALID, NEEDS_VERIFICATION, or INVALID`;
}

/**
 * Generate confidence calibration prompt
 */
export function generateConfidenceCalibrationPrompt(
  claim: string,
  evidence: string,
  confidence: number
): string {
  return `CLAIM: "${claim}"
EVIDENCE: "${evidence}"
ASSIGNED CONFIDENCE: ${confidence}

Is this confidence level appropriate?
- 0.9-1.0: Clearly stated, no ambiguity
- 0.7-0.9: Well supported, minor gaps
- 0.5-0.7: Inferred from evidence, reasonable interpretation
- 0.3-0.5: Speculative but grounded in materials
- 0.1-0.3: Weak interpretation or missing context
- <0.1: Highly speculative, should mark "uncertain"

Respond with: APPROPRIATE, TOO_HIGH, or TOO_LOW`;
}

/**
 * Generate constraint pressure test prompt
 */
export function generateConstraintPressureTestPrompt(
  constraint: string,
  evidence: string[]
): string {
  return `BINDING CONSTRAINT: "${constraint}"

EVIDENCE SUPPORTING THIS CONSTRAINT:
${evidence.map((e) => `- ${e}`).join("\n")}

Questions to address:
1. Is this actually binding? What happens if it's not met?
2. Is there evidence contradicting this constraint?
3. What's the probability this constraint is satisfied?

Assess: BINDING, CONDITIONALLY_BINDING, or NOT_BINDING`;
}

/**
 * Generate risk assessment prompt
 */
export function generateRiskAssessmentPrompt(
  claim: string,
  context: string
): string {
  return `CLAIM: "${claim}"
CONTEXT: "${context}"

What are the key risks if this claim is false?
- List 2-3 specific risks
- For each risk, estimate severity: critical/high/medium/low
- Suggest mitigation approach

Format as JSON:
{
  "risks": [
    {"risk": "...", "severity": "...", "mitigation": "..."}
  ]
}`;
}

/**
 * Validate prompt structure
 */
export function validatePrompt(prompt: string): {
  valid: boolean;
  length: number;
  errors: string[];
} {
  const errors: string[] = [];

  if (!prompt || prompt.trim().length === 0) {
    errors.push("Prompt is empty");
  }

  if (prompt.length > 8000) {
    errors.push("Prompt exceeds maximum length (8000 chars)");
  }

  // Check for basic structure
  if (
    !prompt.includes("INSTRUCTIONS") &&
    !prompt.includes("OBJECTIVE")
  ) {
    errors.push("Prompt missing INSTRUCTIONS or OBJECTIVE section");
  }

  return {
    valid: errors.length === 0,
    length: prompt.length,
    errors,
  };
}

/**
 * Summary of prompt generation
 */
export function logPromptGeneration(
  cycle: CycleType,
  promptLength: number,
  variables: Partial<PromptVariables>
): void {
  console.log(
    `[PROMPT_GEN] Cycle ${cycle}: ${promptLength} chars, ` +
    `variables: ${Object.keys(variables).join(", ")}`
  );
}
