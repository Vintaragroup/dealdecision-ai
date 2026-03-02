/**
 * Answer Policy V1 — Deterministic answer quality enforcement for Deal Assistant.
 *
 * Pure module: no LLM calls, no I/O, fully unit-testable.
 *
 * Provides:
 *   - classifyQuestionIntent(message) → QuestionIntent
 *   - buildPromptPolicyBlock(intent, productProfile?, orchReport?) → string
 *   - enforceAnswerSanity(opts) → SanityCheckResult
 */

import type { ProductProfileV1 } from "../orchestrator/types";
import type { OrchestratorReportV1 } from "../orchestrator/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuestionIntent =
  | "product"
  | "ai"
  | "financial"
  | "traction"
  | "risk"
  | "team"
  | "terms"
  | "general";

export type AnswerBasis =
  | "product_profile_v1"
  | "orchestrator_report"
  | "evidence_only"
  | "insufficient_data";

export interface SanityCheckResult {
  /** Final message text — may be rewritten to a safe template */
  message: string;
  /** Final confidence — may be downgraded */
  confidence: "high" | "medium" | "low";
  /** Whether deterministic rules changed the LLM output */
  downgraded: boolean;
  /** Human-readable reason for downgrade (for logging) */
  reason?: string;
}

export interface EnforceAnswerSanityOpts {
  intent: QuestionIntent;
  productProfile: ProductProfileV1 | null | undefined;
  orchReport: OrchestratorReportV1 | null | undefined;
  message: string;
  confidence: "high" | "medium" | "low";
  /** Evidence excerpt text blocks (for numeric grounding checks) */
  evidenceTexts?: string[];
  cited_evidence_ids?: string[];
}

// ─── Intent Classification ────────────────────────────────────────────────────

/**
 * Ordered keyword sets checked highest-priority first.
 * First match wins. "general" always matches at the end.
 *
 * Trailing \b is intentionally omitted after each group so that plural
 * forms (customers, risks, flags, models) still match.
 */
const INTENT_PATTERNS: Array<{ intent: QuestionIntent; re: RegExp }> = [
  {
    intent: "ai",
    re: /\b(ai\s|ai$|ai\?|machine\s*learning|ml\s|ml\?|llm\b|gpt\b|chatgpt|artificial\s+intelligence|language\s+model|trained\s+on|fine[\s-]?tun|vector\s+database|rag\b|embedding|neural\s+network|generative\s+ai|deep\s+learning|predictive\s+model)/i,
  },
  {
    intent: "product",
    re: /\b(product|feature|platform|tool|software\b|app\b|saas\b|api\b|marketplace|delivery\s+model|workflow|use\s+case|solution|value\s+prop|differentiat|mvp\b|integration|roadmap|tech\s+stack|how\s+does\s+it\s+work|what\s+does\s+it\s+do)/i,
  },
  {
    intent: "financial",
    re: /\b(arr\b|mrr\b|revenue|burn[\s_]rate|burn\b|runway|cash\b|profit|loss\b|ebitda|valuation|financials?|unit[\s_]economics|cap[\s_]table|equity\b|gross[\s_]margin|cogs\b|income[\s_]statement|balance[\s_]sheet|cash[\s_]flow|p&l\b|forecast|projection\b|budget\b|ltv\b|cac\b|payback|net[\s_]income|operating[\s_]expense)/i,
  },
  {
    intent: "traction",
    re: /\b(customer|user\b|client\b|traction|retention|churn|cohort|nps\b|engagement|dau\b|mau\b|acquisition|sales\s+pipeline|paying\s+customer|logo\b)/i,
  },
  {
    intent: "risk",
    re: /\b(risk|concern|flag\b|flags\b|warning|weakness|challenge|threat|downside|gap\b|red\s+flags?|worry|problem|issue)/i,
  },
  {
    intent: "team",
    re: /\b(team\b|founder|ceo\b|cto\b|hire\b|employee|headcount|executive|background|experience|expertise|staff\b|talent\b|leadership)/i,
  },
  {
    intent: "terms",
    re: /\b(deal\s+terms|raise\s+amount|funding\s+round|pre[\s-]?money|post[\s-]?money|dilution|priced\s+round|safe\b|convertible\s+note|warrants?|share\s+price)/i,
  },
  { intent: "general", re: /.*/ },
];

/**
 * Classifies the user's question into one of the product knowledge domains.
 * Deterministic keyword match — checked in priority order; first wins.
 */
export function classifyQuestionIntent(message: string): QuestionIntent {
  const normalized = message.toLowerCase().trim();
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(normalized)) return intent;
  }
  return "general";
}

// ─── Prompt Policy Block ──────────────────────────────────────────────────────

/**
 * Returns a short block of hard behavioural rules to inject near the top of
 * the system prompt.  The content is keyed to the detected intent so the
 * model receives a concise, targeted directive rather than a wall of generic
 * rules.
 */
export function buildPromptPolicyBlock(
  intent: QuestionIntent,
  productProfile?: ProductProfileV1 | null,
  orchReport?: OrchestratorReportV1 | null
): string {
  const lines: string[] = [];

  lines.push(`ANSWER POLICY (strictly enforced):`);

  // ── Universal rules ──
  lines.push(
    `- Answer conversationally in 2–6 sentences or 1–2 short paragraphs. No bullet lists unless the user explicitly requests them.`,
    `- NEVER assert a number (dollar amount, percentage, count) that does not appear verbatim in the ORCHESTRATOR DATA or EVIDENCE sections below.`,
    `- If a detail is genuinely unknown, say so plainly. "Unknown" is preferred over a plausible-sounding guess.`,
    `- You are allowed to say "The materials don't specify that." — this is honest and correct.`
  );

  // ── Intent-specific rules ──
  if (intent === "ai" || intent === "product") {
    lines.push(``, `PRODUCT / AI QUESTIONS — additional rules:`);
    lines.push(`- Use PRODUCT PROFILE as the PRIMARY source. Do not invent product details from the company name or generic domain knowledge.`);

    const aiStrength = productProfile?.ai_evidence_strength ?? null;
    const aiClaims = productProfile?.ai_claims_present ?? false;

    if (!aiClaims || aiStrength === "none") {
      lines.push(`- AI: The materials make NO verified AI claims for this company. Do not state or imply the product uses AI.`);
    } else if (aiStrength === "marketing_only" || aiStrength === "weak") {
      lines.push(
        `- AI: The materials mention AI but provide no technical explanation. Do NOT speculate on model type, training data, fine-tuning, RAG, vector databases, or generation mechanisms.`,
        `- Explicitly state: "The deck mentions AI but doesn't explain how it's implemented." Suggest OPEN_FULL_REPORT or REGENERATE_INSIGHTS.`
      );
    } else if (aiStrength === "strong") {
      lines.push(`- AI: Use ai_usage_summary from PRODUCT PROFILE. Do not add implementation details beyond what is stated there.`);
    }

    if (!productProfile?.company_description && !productProfile?.solution_summary) {
      lines.push(`- Product profile is empty. Tell the user analysis must be run before product details are available. Suggest RUN_ANALYZE or REGENERATE_INSIGHTS.`);
    }
  }

  if (intent === "financial") {
    const fhStatus = orchReport?.scores.financial_health_score.status ?? null;
    lines.push(``, `FINANCIAL QUESTIONS — additional rules:`);
    lines.push(`- Only cite figures from ORCHESTRATOR DATA (canonical fields, scores) or EVIDENCE excerpts.`);
    lines.push(`- For financial questions, prefer the FINANCIAL INTELLIGENCE block + cited evidence. Do not guess or extrapolate missing numbers.`);
    if (fhStatus === "insufficient_data") {
      lines.push(`- Financial data is marked INSUFFICIENT. Do not invent numbers. Say the materials lack sufficient financial data.`);
    }
  }

  if (intent === "risk") {
    lines.push(``, `RISK QUESTIONS — additional rules:`);
    lines.push(`- Lead with VERIFICATION REQUESTS (P0 then P1) from ORCHESTRATOR DATA if they exist — these are the highest-priority confirmed risks.`);
    lines.push(`- Do not invent risks not present in orchestrator data.`);
  }

  if (intent === "traction") {
    lines.push(``, `TRACTION QUESTIONS — additional rules:`);
    lines.push(`- Only cite customer/revenue/retention figures from ORCHESTRATOR DATA canonical fields or EVIDENCE excerpts.`);
    lines.push(`- If no traction data is present, say so honestly.`);
  }

  lines.push(``);
  return lines.join("\n");
}

// ─── Speculative AI Pattern Detection ────────────────────────────────────────

/** Patterns that indicate the model is speculating about AI implementation */
const SPECULATIVE_AI_PATTERNS: RegExp[] = [
  /trained?\s+(on|with)\b/i,
  /fine[\s-]?tuned?\b/i,
  /llm\s+generates?\b/i,
  /vector\s+database\b/i,
  /\bRAG\b/,
  /retrieval[\s-]augmented/i,
  /\bembedding(s)?\b/i,
  /\bGPT[\s-]?\d/i,
  /language\s+models?\b/i,
  /neural\s+network\b/i,
  /transformer\s+model\b/i,
  /in[\s-]?context\s+learning\b/i,
  /prompt[\s-]?engineer\b/i,
];

const NUMERIC_PATTERN = /(?:\$[\d,.]+[BMK]?|\d+(?:\.\d+)?%|\b\d[\d,]*\s*(?:users?|customers?|ARR|MRR|months?|years?))/gi;

const SAFE_REWRITE_TEMPLATE =
  "Based on the materials I have, I can't confirm that detail. The deck doesn't describe it explicitly. " +
  "If you want, I can point to what it does say and suggest follow-up questions.";

/**
 * Deterministic post-processing guard applied to the LLM response.
 *
 * Enforces:
 * 1. Speculative AI claims are blocked when evidence strength is too low.
 * 2. Numeric assertions are checked against known grounded text.
 *
 * Returns the (possibly rewritten) message + adjusted confidence.
 */
export function enforceAnswerSanity(opts: EnforceAnswerSanityOpts): SanityCheckResult {
  const {
    intent,
    productProfile,
    message,
    confidence,
    evidenceTexts = [],
    orchReport,
  } = opts;

  // ── 1. AI speculation check ──
  if (intent === "ai" || intent === "product") {
    const aiStrength = productProfile?.ai_evidence_strength ?? "none";
    const aiClaims = productProfile?.ai_claims_present ?? false;

    const shouldBlockSpeculation =
      !aiClaims || aiStrength === "none" || aiStrength === "marketing_only";

    if (shouldBlockSpeculation) {
      const speculativeMatch = SPECULATIVE_AI_PATTERNS.find((re) => re.test(message));
      if (speculativeMatch) {
        const reason = `Speculative AI pattern blocked: "${speculativeMatch.source}" (ai_evidence_strength=${aiStrength})`;
        return {
          message: SAFE_REWRITE_TEMPLATE,
          confidence: "low",
          downgraded: true,
          reason,
        };
      }
    }
  }

  // ── 2. Numeric grounding check ──
  const numericMatches = message.match(NUMERIC_PATTERN);
  if (numericMatches && numericMatches.length > 0) {
    // Build a grounded corpus: orchestrator structured fields + evidence excerpts
    const groundedCorpus: string[] = [...evidenceTexts];

// Canonical fields from orchestrator segments
      if (orchReport) {
        const sc = orchReport.stage_context;
        if (sc.raise_amount) groundedCorpus.push(sc.raise_amount);
        if (sc.valuation_pre) groundedCorpus.push(sc.valuation_pre);
        // Scores as strings
        groundedCorpus.push(
          String(orchReport.scores.overall_recommendation_score),
          String(orchReport.scores.risk_severity_score)
        );
        // Canonical field snapshots from segments.deal_terms
        const dealTerms = orchReport.segments?.deal_terms;
        if (dealTerms?.canonical_fields_snapshot) {
          for (const cf of dealTerms.canonical_fields_snapshot) {
            if (cf.value) groundedCorpus.push(cf.value);
          }
      }
    }

    const groundedText = groundedCorpus.join(" ").toLowerCase();

    const ungrounded = numericMatches.filter((m) => {
      // Strip common symbols for comparison
      const bare = m.replace(/[$,%]/g, "").trim().split(/\s+/)[0];
      return !groundedText.includes(bare.toLowerCase());
    });

    if (ungrounded.length > 0) {
      // Downgrade confidence but don't rewrite (may still be plausible rounding)
      if (confidence === "high") {
        return {
          message,
          confidence: "medium",
          downgraded: true,
          reason: `Numeric assertions not fully grounded in evidence: ${ungrounded.slice(0, 3).join(", ")}`,
        };
      }
      // Already medium or low — leave message but flag
      return { message, confidence, downgraded: false };
    }
  }

  return { message, confidence, downgraded: false };
}
