/**
 * product-profile-v1.ts
 *
 * Governed LLM synthesis for the Product Profile segment.
 *
 * Produces a structured ProductProfileV1 JSON from pitch-deck/DPU text.
 *
 * Design contract:
 *  - LLM may ONLY restate facts present in the canonical input corpus.
 *  - ai_claims_present MUST be false unless "AI", "ML", "machine learning",
 *    or "artificial intelligence" appears explicitly in the corpus.
 *  - ai_evidence_strength MUST be "marketing_only" when AI is mentioned but
 *    no mechanism, architecture, or data moat is described.
 *  - product_type / delivery_model / product_maturity / ai_usage_type MUST
 *    come from the allowed enum values only; use "Unknown" when unclear.
 *  - evidence IDs cited in output MUST be a subset of the provided
 *    evidence_snippets ids.
 *  - Output persisted in render_package sections body as JSON string.
 */

import type { ProductProfileV1, ProductType, DeliveryModel, ProductMaturity, AiUsageType, AiEvidenceStrength } from "@dealdecision/core";
import { OpenAIGPT4oProvider } from "../../lib/llm/providers/openai-provider";
import type { ProviderConfig } from "../../lib/llm/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProductProfileEvidenceSnippet {
  id: string;
  text: string;
}

export interface GenerateProductProfileArgs {
  /** Product-keyword-filtered excerpt from DPU pages. */
  productNarrativeBody: string | null;
  /** Canonical fields summary (raise, stage, market signals). */
  canonicalFieldsBody: string | null;
  /** Bounded evidence snippets with IDs (up to 8). */
  evidenceSnippets: ProductProfileEvidenceSnippet[];
  dealName?: string;
}

export type GenerateProductProfileResult =
  | { ok: true; value: ProductProfileV1 }
  | { ok: false; reason: string };

// ─── Allowed enum values (for coercion + validation) ────────────────────────

const PRODUCT_TYPES = new Set<ProductType>(["SaaS", "Marketplace", "API", "Services", "Hardware", "Hybrid", "Unknown"]);
const DELIVERY_MODELS = new Set<DeliveryModel>(["B2B SaaS", "PLG", "Enterprise", "Services", "Unknown"]);
const PRODUCT_MATURITIES = new Set<ProductMaturity>(["Concept", "MVP", "Beta", "Live", "Scaling", "Unknown"]);
const AI_USAGE_TYPES = new Set<AiUsageType>(["Generative", "Predictive", "Recommender", "Automation", "Other", "Unknown", "None"]);
const AI_EVIDENCE_STRENGTHS = new Set<AiEvidenceStrength>(["strong", "weak", "marketing_only", "none"]);

const AI_MENTION_RE = /\b(?:ai|ml|a\.i\.|machine[\s-]+learning|artificial[\s-]+intelligence|deep[\s-]+learning|neural[\s-]+net|llm|large[\s-]+language|nlp|computer[\s-]+vision|generative)\b/i;

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI investment analyst extracting a structured product profile from pitch materials.

GOVERNANCE RULES — MUST FOLLOW:
1. Only state facts explicitly present in the provided corpus. Do not invent features, customers, or claims.
2. ai_claims_present MUST be false unless the words "AI", "ML", "machine learning", "artificial intelligence", or similar appear explicitly.
3. If AI is mentioned but NO mechanism, architecture, data moat, or technical explanation is provided: set ai_evidence_strength = "marketing_only".
4. All enum fields MUST use the exact allowed values:
   - product_type: "SaaS" | "Marketplace" | "API" | "Services" | "Hardware" | "Hybrid" | "Unknown"
   - delivery_model: "B2B SaaS" | "PLG" | "Enterprise" | "Services" | "Unknown"
   - product_maturity: "Concept" | "MVP" | "Beta" | "Live" | "Scaling" | "Unknown"
   - ai_usage_type: "Generative" | "Predictive" | "Recommender" | "Automation" | "Other" | "Unknown" | "None"
   - ai_evidence_strength: "strong" | "weak" | "marketing_only" | "none"
5. cited_evidence_ids MUST only include IDs from the EVIDENCE section below.
6. Return exactly this JSON schema — no extra keys:

{
  "company_description": "<1-2 sentences>",
  "problem_statement": "<1-2 sentences>",
  "solution_summary": "<1-2 sentences>",
  "product_type": "<enum>",
  "delivery_model": "<enum>",
  "target_customer": "<string>",
  "buyer_persona": "<string or null>",
  "core_workflow": ["<step1>", ...],
  "core_features": ["<feature1>", ...],
  "differentiation_claims": ["<claim1>", ...],
  "integrations_or_dependencies": ["<integration1>", ...],
  "product_maturity": "<enum>",
  "ai_claims_present": <boolean>,
  "ai_usage_summary": "<string or null>",
  "ai_usage_type": "<enum>",
  "ai_defensibility_notes": "<string or null>",
  "ai_evidence_strength": "<enum>",
  "company_description_evidence": ["<evidence_id>", ...],
  "problem_statement_evidence": ["<evidence_id>", ...],
  "ai_usage_summary_evidence": ["<evidence_id>", ...],
  "cited_evidence_ids": ["<evidence_id>", ...]
}`;

// ─── Generator ───────────────────────────────────────────────────────────────

export async function generateProductProfileV1(
  args: GenerateProductProfileArgs
): Promise<GenerateProductProfileResult> {
  const { productNarrativeBody, canonicalFieldsBody, evidenceSnippets, dealName } = args;

  // Require at least some product text
  if (!productNarrativeBody || productNarrativeBody.trim().length < 30) {
    return { ok: false, reason: "no_product_narrative" };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "missing_openai_api_key" };
  }

  // Build corpus
  const corpusParts: string[] = [];
  if (dealName) corpusParts.push(`## Company\n${dealName}`);
  corpusParts.push(`## Product Narrative\n${productNarrativeBody.slice(0, 2000)}`);
  if (canonicalFieldsBody) {
    corpusParts.push(`## Context (Stage / Market / Raise)\n${canonicalFieldsBody.slice(0, 800)}`);
  }
  if (evidenceSnippets.length > 0) {
    const evidenceLines = evidenceSnippets
      .slice(0, 8)
      .map((s) => `[${s.id}] ${s.text.slice(0, 300)}`)
      .join("\n");
    corpusParts.push(`## Evidence (cite by ID only)\n${evidenceLines}`);
  }

  const corpus = corpusParts.join("\n\n");

  const providerConfig: ProviderConfig = {
    type: "openai",
    enabled: true,
    priority: 1,
    apiKey,
    timeout: 45_000,
    retries: 2,
  };

  const provider = new OpenAIGPT4oProvider(providerConfig);

  let response: Awaited<ReturnType<typeof provider.complete>>;
  try {
    response = await provider.complete({
      task: "synthesis",
      model: "gpt-4o-mini" as any,
      temperature: 0,
      max_tokens: 1400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: corpus },
      ],
      metadata: { kind: "product_profile_v1" },
    });
  } catch {
    return { ok: false, reason: "llm_call_failed" };
  }

  if (!response?.content) {
    return { ok: false, reason: "llm_empty_response" };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.content.trim());
  } catch {
    const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
    if (!jsonMatch) return { ok: false, reason: "llm_output_not_json" };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return { ok: false, reason: "llm_output_not_json" };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "llm_output_not_object" };
  }

  const p = parsed as Record<string, unknown>;

  // Coercion helpers
  const str = (v: unknown, max = 300, fallback = ""): string =>
    typeof v === "string" ? v.trim().slice(0, max) : fallback;
  const strOrNull = (v: unknown, max = 300): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const strArr = (v: unknown, itemMax: number, arrMax: number): string[] =>
    Array.isArray(v)
      ? (v as unknown[])
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((s) => s.trim().slice(0, itemMax))
          .slice(0, arrMax)
      : [];
  const enumVal = <T extends string>(v: unknown, allowed: Set<T>, fallback: T): T =>
    typeof v === "string" && (allowed as Set<string>).has(v) ? (v as T) : fallback;

  // Valid evidence ID whitelist (cited IDs must be in inputs)
  const validIds = new Set(evidenceSnippets.map((s) => s.id));
  const filteredIds = (v: unknown): string[] =>
    strArr(v, 64, 8).filter((id) => validIds.has(id));

  // AI claims: deterministic override — if corpus contains no AI keyword, force false
  const corpusHasAi = AI_MENTION_RE.test(corpus);
  const ai_claims_present = corpusHasAi
    ? (typeof p.ai_claims_present === "boolean" ? p.ai_claims_present : false)
    : false;

  // ai_evidence_strength: if no AI in corpus, force "none"
  const rawAiStrength = enumVal(p.ai_evidence_strength, AI_EVIDENCE_STRENGTHS, "none");
  const ai_evidence_strength: AiEvidenceStrength = !ai_claims_present ? "none" : rawAiStrength;

  const profile: ProductProfileV1 = {
    schema_version: "product_profile_v1",
    company_description: str(p.company_description, 300, "Not described in provided materials."),
    problem_statement: str(p.problem_statement, 300, "Problem not described in provided materials."),
    solution_summary: str(p.solution_summary, 300, "Solution not described in provided materials."),
    product_type: enumVal(p.product_type, PRODUCT_TYPES, "Unknown"),
    delivery_model: enumVal(p.delivery_model, DELIVERY_MODELS, "Unknown"),
    target_customer: str(p.target_customer, 200, "Not specified"),
    buyer_persona: strOrNull(p.buyer_persona, 200),
    core_workflow: strArr(p.core_workflow, 150, 6),
    core_features: strArr(p.core_features, 150, 10),
    differentiation_claims: strArr(p.differentiation_claims, 150, 8),
    integrations_or_dependencies: strArr(p.integrations_or_dependencies, 100, 10),
    product_maturity: enumVal(p.product_maturity, PRODUCT_MATURITIES, "Unknown"),
    ai_claims_present,
    ai_usage_summary: ai_claims_present ? strOrNull(p.ai_usage_summary, 300) : null,
    ai_usage_type: ai_claims_present
      ? enumVal(p.ai_usage_type, AI_USAGE_TYPES, "Unknown")
      : "None",
    ai_defensibility_notes: ai_claims_present ? strOrNull(p.ai_defensibility_notes, 300) : null,
    ai_evidence_strength,
    evidence: {
      company_description: filteredIds(p.company_description_evidence),
      problem_statement: filteredIds(p.problem_statement_evidence),
      ai_usage_summary: ai_claims_present ? filteredIds(p.ai_usage_summary_evidence) : [],
    },
    sources: filteredIds(p.cited_evidence_ids),
  };

  return { ok: true, value: profile };
}

// ─── Section body serializer ──────────────────────────────────────────────────

/** Serialize a ProductProfileV1 to a compact JSON string for render_package storage. */
export function serializeProductProfileBody(profile: ProductProfileV1): string {
  return JSON.stringify(profile);
}

/** Default empty profile used as fallback when section is absent. */
export function defaultProductProfile(): ProductProfileV1 {
  return {
    schema_version: "product_profile_v1",
    company_description: "",
    problem_statement: "",
    solution_summary: "",
    product_type: "Unknown",
    delivery_model: "Unknown",
    target_customer: "",
    buyer_persona: null,
    core_workflow: [],
    core_features: [],
    differentiation_claims: [],
    integrations_or_dependencies: [],
    product_maturity: "Unknown",
    ai_claims_present: false,
    ai_usage_summary: null,
    ai_usage_type: "None",
    ai_defensibility_notes: null,
    ai_evidence_strength: "none",
    evidence: {},
    sources: [],
  };
}
