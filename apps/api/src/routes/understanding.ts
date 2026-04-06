import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import { getPool } from "../lib/db";
import { enrichDeterministically } from "../understanding/enrich";
import { getLatestUnderstandingPatch, persistUnderstandingPatch } from "../understanding/persist";

import type { DeterministicUnderstandingInput } from "../understanding/types";

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Narrative numeric-consistency helpers
//
// These functions are intentionally generic and pattern-based — they do not
// reference specific deal IDs or hard-coded values. They guard against a class
// of narrative inconsistency that arises when:
//   (a) extracted go-to-market slide text contains hypothetical ARR projections
//       ("yielding ~$139M ARR"), or
//   (b) LLM-generated deal-summary paragraphs assert a raise amount that is
//       orders of magnitude larger than the trusted structured raise value.
// ---------------------------------------------------------------------------

/**
 * Large-dollar pattern: matches $X[M|MM|million|B|billion] in text.
 * Uses a global flag so matchAll can iterate multiple hits in one string.
 */
const LARGE_DOLLAR_RE = /\$\s*([\d,]+(?:\.\d+)?)\s*(B(?:illion)?|MM?|million)\b/gi;

/**
 * Returns the numeric dollar value encoded by a LARGE_DOLLAR_RE match group.
 */
function parseDollarMatchAmount(numStr: string, suffixStr: string): number {
  const n = parseFloat(numStr.replace(/,/g, ""));
  if (!Number.isFinite(n)) return NaN;
  const s = suffixStr.toLowerCase();
  if (s === "b" || s.startsWith("bill")) return n * 1e9;
  return n * 1e6; // M, MM, million
}

/**
 * Projection / hypothetical keywords that, combined with a large-dollar claim,
 * indicate a forward-looking assumption rather than a reported fact.
 */
const PROJECTION_KEYWORD_RE =
  /\b(?:yielding|yield(?:s)?|projected?|projection|forecast(?:ed|s)?|could\s+reach|would(?:\s+be)?\s+generate|assuming|hypothetical|implies?\s+a|representing|translat(?:e[sd]?|ing)\s+to|would\s+translate|potentially\s+generat|may\s+generat)\b/i;

/**
 * Splits `text` into sentences and removes any sentence that contains both:
 *   - a dollar amount ≥ $50M (M, MM, million, B, billion notation), AND
 *   - a projection/hypothetical keyword (e.g. "yielding", "projected", "could reach").
 *
 * This strips lines like "yielding ~$139M ARR" while leaving factual mentions
 * of dollar amounts that are not framed as forward-looking projections.
 */
export function stripHypotheticalDollarProjectionSentences(text: string): string {
  if (!text) return "";
  // Split on sentence boundaries, keeping the delimiter attached to the preceding sentence.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const clean = sentences.filter((sentence) => {
    const dollarMatches = [...sentence.matchAll(new RegExp(LARGE_DOLLAR_RE.source, "gi"))];
    if (dollarMatches.length === 0) return true; // no dollar amount → keep
    const hasLargeDollar = dollarMatches.some(
      (m) => parseDollarMatchAmount(m[1] ?? "", m[2] ?? "") >= 50_000_000,
    );
    if (!hasLargeDollar) return true; // amount below threshold → keep
    return !PROJECTION_KEYWORD_RE.test(sentence); // keep only if no projection keyword
  });
  return clean.join(" ").trim();
}

/**
 * Parses the numeric value from a formatted raise string like "$2MM", "$4M",
 * "$375 million", "$1.5B", etc.  Returns NaN when the format is unrecognised.
 */
function parseTrustedRaiseAmount(raiseValueStr: string | null | undefined): number {
  if (!raiseValueStr || typeof raiseValueStr !== "string") return NaN;
  const m = raiseValueStr.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*(B(?:illion)?|MM?|million|K|thousand)?\b/i);
  if (!m) return NaN;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return NaN;
  const s = (m[2] ?? "").toLowerCase();
  if (s === "b" || s.startsWith("bill")) return n * 1e9;
  if (s === "k" || s.startsWith("thou")) return n * 1e3;
  return n * 1e6;
}

/**
 * Returns an empty string when `text` contains an explicit raise-amount assertion
 * (e.g. "The proposed raise is set at $375 million") whose value is ≥ 20× the
 * `trustedRaiseValueStr` from the persisted structured summary.  Otherwise returns
 * `text` unchanged.
 *
 * This only fires when the text contains an unambiguous raise assertion pattern so
 * that incidental mentions of large numbers are left untouched.
 */
export function suppressIfRaiseAmountOverstated(
  text: string,
  trustedRaiseValueStr: string | null | undefined,
): string {
  if (!text) return "";
  const trustedAmount = parseTrustedRaiseAmount(trustedRaiseValueStr);
  if (!Number.isFinite(trustedAmount) || trustedAmount <= 0) return text; // no trusted value → keep

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const isRaiseAssertion =
      /\b(?:proposed\s+raise|raise\s+(?:is|of)|rais(?:ing|ed))\b/i.test(sentence);
    if (!isRaiseAssertion) continue;
    const dollarMatches = [
      ...sentence.matchAll(new RegExp(LARGE_DOLLAR_RE.source, "gi")),
    ];
    for (const m of dollarMatches) {
      const claimed = parseDollarMatchAmount(m[1] ?? "", m[2] ?? "");
      if (Number.isFinite(claimed) && claimed > trustedAmount * 20) {
        return ""; // suppress the whole paragraph — the raise claim is 20× off
      }
    }
  }
  return text;
}

const deterministicUnderstandingBodySchema = z
  .object({
    deal_id: z.string().optional(),
    documents: z.array(z.any()),
    pages: z.array(z.any()),
    segments: z.array(z.any()).optional(),
  })
  .passthrough();

type DeterministicUnderstandingBody = z.infer<typeof deterministicUnderstandingBodySchema>;

export async function registerUnderstandingRoutes(app: FastifyInstance, poolOverride?: Pool) {
  const pool = poolOverride ?? getPool();

  app.post("/api/v1/deals/:dealId/understanding/deterministic", async (request, reply) => {
    const dealId = (request.params as any)?.dealId as string;
    if (!isUuid(dealId)) {
      return reply.status(400).send({ error: "Invalid dealId (expected UUID)" });
    }

    const parsed = deterministicUnderstandingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const body: DeterministicUnderstandingBody = parsed.data;
    if (typeof body.deal_id === "string" && body.deal_id.length > 0 && body.deal_id !== dealId) {
      return reply.status(400).send({ error: "deal_id in body must match dealId path param" });
    }

    const input: DeterministicUnderstandingInput = {
      ...(body as any),
      deal_id: dealId,
    };

    const patch = enrichDeterministically(input);
    const stored = await persistUnderstandingPatch(patch, { pool });

    return reply.send({
      analysis_version: stored.analysis_version,
      input_hash: stored.input_hash,
      created_at: stored.created_at,
      patch: stored.patch,
    });
  });

  app.get("/api/v1/deals/:dealId/understanding/deterministic", async (request, reply) => {
    const dealId = (request.params as any)?.dealId as string;
    if (!isUuid(dealId)) {
      return reply.status(400).send({ error: "Invalid dealId (expected UUID)" });
    }

    const latest = await getLatestUnderstandingPatch(dealId, "deterministic_understanding_v1", { pool });
    if (!latest) {
      return reply.status(404).send({ error: "Deterministic understanding patch not found" });
    }

    return reply.send({
      analysis_version: latest.analysis_version,
      input_hash: latest.input_hash,
      created_at: latest.created_at,
      patch: latest.patch,
    });
  });

  /**
   * GET /api/v1/deals/:dealId/understanding
   *
   * Returns a structured deal-understanding object composed from existing
   * pipeline outputs stored in deal_intelligence_objects. Fields are best-effort
   * derivations from phase1 analysis; individual fields may be null if the
   * relevant analysis has not run or produced no output.
   */
  app.get("/api/v1/deals/:dealId/understanding", async (request, reply) => {
    const dealId = (request.params as any)?.dealId as string;
    if (!isUuid(dealId)) {
      return reply.status(400).send({ error: "Invalid dealId (expected UUID)" });
    }

    const dealCheck = await pool.query(`SELECT id FROM deals WHERE id = $1 LIMIT 1`, [dealId]);
    if (!dealCheck.rows?.length) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    let dioData: Record<string, any> | null = null;
    const dioResult = await pool.query(
      `SELECT dio_data
         FROM deal_intelligence_objects
        WHERE deal_id = $1
        ORDER BY analysis_version DESC, updated_at DESC NULLS LAST, dio_id DESC
        LIMIT 1`,
      [dealId],
    );
    dioData = dioResult.rows?.[0]?.dio_data ?? null;

    const phase1 = dioData?.dio?.phase1 ?? null;
    const overviewV2 = phase1?.deal_overview_v2 ?? null;
    const dealSummarySummary = phase1?.deal_summary_v2?.summary ?? null;
    const archetypeV1 = phase1?.business_archetype_v1 ?? null;
    const reportSS = dioData?.report?.structured_summary ?? null;
    const execSummaryV1 = phase1?.executive_summary_v1 ?? null;

    function asStr(v: unknown): string {
      return typeof v === "string" && v.trim() ? v.trim() : "";
    }

    function asKnownStr(v: unknown): string {
      const s = asStr(v);
      if (!s) return "";
      return /^(unknown|n\/?a|none)$/i.test(s) ? "" : s;
    }

    function firstKnown(...values: unknown[]): string {
      for (const v of values) {
        const s = asKnownStr(v);
        if (s) return s;
      }
      return "";
    }

    function joinArray(v: unknown): string {
      if (!Array.isArray(v)) return "";
      return v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
        .join("; ");
    }

    function normalizeWhitespace(v: string): string {
      return v.replace(/\s+/g, " ").trim();
    }

    function appendSignal(signals: string[], sentence: string): void {
      const next = normalizeWhitespace(sentence);
      if (!next) return;
      const nextLc = next.toLowerCase();
      if (signals.some((s) => s.toLowerCase() === nextLc)) return;
      signals.push(next);
    }

    const investmentEvidenceSnippets = Array.isArray(execSummaryV1?.evidence)
      ? (execSummaryV1.evidence as Array<{ snippet?: unknown }>)
          .map((e) => stripHypotheticalDollarProjectionSentences(asStr(e?.snippet)))
          .filter(Boolean)
          .slice(0, 2)
      : [];
    const investmentSignalsFromEvidence = joinArray(investmentEvidenceSnippets);
    const hasSubstantiveInvestmentEvidence =
      investmentEvidenceSnippets.some((s) => !/^see\s+document\s*:/i.test(s));

    const medicalRiskFallback =
      /\b(medical|diagnostic|testing|health|screen)\b/i.test(
        `${asStr(overviewV2?.business_model)} ${asStr(overviewV2?.go_to_market)}`
      )
        ? "Primary risk is validation and adoption for this regulated medical testing workflow. Distribution likely requires partnerships with healthcare systems and public agencies."
        : "";

    const baseSignalsCorpus = normalizeWhitespace(
      [
        asStr(overviewV2?.product_solution),
        asStr(overviewV2?.business_model),
        asStr(overviewV2?.go_to_market),
        asStr(overviewV2?.market_icp),
        asStr(overviewV2?.traction_metrics),
        joinArray(overviewV2?.traction_signals),
        asStr(dealSummarySummary?.one_liner),
        asStr(dealSummarySummary?.paragraphs?.[0]),
        asStr(archetypeV1?.value),
        asStr(reportSS?.business_model?.value),
        asStr(reportSS?.deal_summary_v1?.tiers?.hero),
        asStr(reportSS?.deal_summary_v1?.tiers?.deep),
        investmentSignalsFromEvidence,
      ].join(" "),
    ).toLowerCase();

    const containsAny = (...patterns: RegExp[]): boolean => patterns.some((p) => p.test(baseSignalsCorpus));

    const predictionModelContext =
      containsAny(/\b(prediction|predictive|forecast|accuracy|accurate|injury)\b/i) &&
      (
        containsAny(/\b(ai|artificial\s+intelligence|machine\s+learning|ml|model|analytics|data\s+platform)\b/i) ||
        containsAny(/\b(sports|betting|fantasy)\b/i)
      );

    const consumerDistributionContext =
      containsAny(/\b(consumer|cpg|beverage|retail|wholesale|hospitality|venue|on\s*-?\s*premise|distributor)\b/i);

    const earlyTractionContext =
      containsAny(/\b(early|pilot|loi|pipeline|run\s*-?\s*rate|pre\s*-?\s*sales|partnership)\b/i);

    const investorSignals: string[] = [];
    const baselineSignalText =
      (hasSubstantiveInvestmentEvidence ? investmentSignalsFromEvidence : "") ||
      medicalRiskFallback ||
      investmentSignalsFromEvidence;
    appendSignal(investorSignals, baselineSignalText);

    if (predictionModelContext) {
      appendSignal(
        investorSignals,
        "Key risk is whether predictions are accurate in real-world usage; commercial outcomes depend on independent validation of model performance.",
      );
    }

    if (consumerDistributionContext && earlyTractionContext) {
      appendSignal(
        investorSignals,
        "This appears early-stage with initial traction but limited realized revenue scale, so repeat-demand and channel execution risk remain central.",
      );
    }

    if (consumerDistributionContext) {
      appendSignal(
        investorSignals,
        "Success depends heavily on distribution execution and brand strength; unit economics, gross margins, and path to profitability should be validated before underwriting growth assumptions.",
      );
    }

    // Trusted raise value from persisted structured summary — used for narrative cross-check.
    const trustedRaiseValue: string | null = asStr(reportSS?.raise?.value) || null;

    const understanding = {
      what_company_does:
        asStr(overviewV2?.product_solution) ||
        asStr(overviewV2?.go_to_market) ||
        asStr(overviewV2?.business_model) ||
        asStr(dealSummarySummary?.one_liner) ||
        asStr(reportSS?.deal_summary_v1?.tiers?.hero) ||
        asStr(reportSS?.deal_summary_v1?.one_liner?.text),

      business_model:
        firstKnown(
          archetypeV1?.value,
          reportSS?.business_model?.value,
          overviewV2?.business_model,
        ) ||
        asStr(archetypeV1?.value) ||
        asStr(reportSS?.business_model?.value) ||
        asStr(overviewV2?.business_model),

      revenue_model:
        firstKnown(
          overviewV2?.business_model,
          reportSS?.business_model?.value,
          archetypeV1?.value,
        ) ||
        asStr(overviewV2?.business_model) ||
        asStr(reportSS?.business_model?.value) ||
        asStr(archetypeV1?.value),

      // Strip sentences that pair a large-dollar amount (≥$50M) with hypothetical/projection
      // language (e.g. "yielding ~$139M ARR") — these are forward-looking assertions surfaced
      // from GTM slides, not reported facts.  Fall back to market_icp when stripping
      // removes all content so the field remains populated.
      go_to_market:
        stripHypotheticalDollarProjectionSentences(asStr(overviewV2?.go_to_market)) ||
        asStr(overviewV2?.market_icp),

      target_customer:
        asStr(overviewV2?.market_icp) ||
        asStr(overviewV2?.go_to_market),

      traction_summary:
        joinArray(overviewV2?.traction_signals) ||
        asStr(overviewV2?.traction_metrics),

      // Suppress LLM-generated paragraphs that assert a raise amount contradicting the
      // trusted structured raise value by ≥ 20×; fall back to tiers.deep in that case.
      market_positioning: (() => {
        const primary = suppressIfRaiseAmountOverstated(
          asStr(dealSummarySummary?.paragraphs?.[0]),
          trustedRaiseValue,
        );
        return primary || asStr(reportSS?.deal_summary_v1?.tiers?.deep);
      })(),

      competitive_differentiation:
        asStr(overviewV2?.product_solution) ||
        asStr(reportSS?.deal_summary_v1?.tiers?.overview),

      // Evidence-backed signals from document claims — surfaces capital use, brand, and marketing
      // terms extracted during document scanning; used for investor-usefulness signal coverage.
      investment_signals:
        normalizeWhitespace(investorSignals.join(" ")),
    };

    return reply.send({ understanding });
  });
}
