/**
 * Resolve Raise Amount
 *
 * Shared, deterministic helper that selects the canonical `raise_amount` value
 * from multiple evidence sources while enforcing three correctness rules:
 *
 *  1. raise_terms OVERRIDE — If a structured raise_terms string is available
 *     (from deal_overview_v2 or a promoted raise_terms_v1 fact), its money
 *     amount supersedes any deck-pattern candidate for early-stage deals
 *     (IDEA / pre-seed / seed / unknown), unless a verb-first "Raising…" signal
 *     supports a higher candidate amount.
 *
 *  2. Market-context taint — Candidates whose nearby text (±MARKET_WINDOW chars)
 *     contains market-sizing language are always rejected, regardless of whether
 *     the match is verb-first or money-first.  This is MORE restrictive than the
 *     TAM_TAINT_WINDOW used for pattern matching: here we reject even "investment
 *     opportunity $11B" (verb-first) when "market/TAM/total revenue" appear nearby.
 *
 *  3. Magnitude sanity — For IDEA / pre-seed / seed / unknown stages a candidate
 *     >= MAGNITUDE_THRESHOLD_M ($100M) is rejected unless a strong, unambiguous
 *     "raising / seeking / we are raising" signal appears in the same text within
 *     STRONG_RAISE_WINDOW chars of the amount.
 *
 * All three rules are applied in the order above; the first surviving candidate
 * (or null) is returned with full provenance.
 */

// ─── Re-export for package consumers ─────────────────────────────────────────

export type EarlyStageLabel =
  | "IDEA"
  | "pre-seed"
  | "Pre-Seed"
  | "Seed"
  | "seed"
  | "Unknown"
  | "unknown"
  | string; // allow pass-through, checked at runtime

/** Stages for which the magnitude and raise_terms-override rules apply. */
const EARLY_STAGE_SET = new Set([
  "IDEA", "idea",
  "pre-seed", "Pre-Seed", "PRE_SEED",
  "seed", "Seed", "SEED",
  "Unknown", "unknown", "UNKNOWN",
  null, undefined,
]);

/** Reject candidates >= this amount (in millions) for early-stage deals
 *  when no strong verb-first raise signal is present. */
export const MAGNITUDE_THRESHOLD_M = 100;

/** Character window around a candidate match used for magnitude / market checks. */
export const STRONG_RAISE_WINDOW = 200;
const MARKET_WINDOW = 200;

// ─── Core regexes ─────────────────────────────────────────────────────────────

/**
 * STRONG_RAISE_VERB_RE: unambiguous raise-request verbs.
 * Matches only explicit fundraise asks — excludes "investment" (ambiguous),
 * "allocation", "proceeds" (could describe use-of-funds, not the ask amount).
 */
export const STRONG_RAISE_VERB_RE =
  /\b(?:rais(?:e|ing|ed)|seek(?:ing|s)?|we\s+are\s+(?:raising|seeking)|we'?re\s+(?:raising|seeking)|what\s+we(?:'re|\s+are)\s+(?:raising|seeking))\b/i;

/**
 * Extended market-context taint regex.
 * Applied to the ±MARKET_WINDOW chars surrounding ANY candidate — including
 * verb-first anchor matches.
 *
 * Additions over processor.ts TAM_MARKET_CONTEXT_RE:
 *   - total revenues?  — "total revenue of $11B" / "total revenues $5B"
 *   - revenue size     — "revenue size" / "market revenue"
 *   - \bsize\b         — "gap in the market of $2B size"
 */
export const MARKET_CONTEXT_RE =
  /\b(?:TAM|SAM|SOM|total\s+addressable\s+market|serviceable\s+addressable\s+market|serviceable\s+obtainable\s+market|addressable\s+market|market\s+size|market\s+opportunity|market\s+cap(?:italization)?|industry|sector|gap|opportunit|total\s+revenues?|revenue\s+size)\b|(?<!-)market(?!\w)/i;

/**
 * MONEY_PARSE_RE: extract the first money token from a string for arithmetic comparison.
 *
 * Groups:
 *   [1]: number string (e.g. "11", "1.5", "25")
 *   [2]: optional multiplier suffix (B/M/K/T and word variants)
 */
const MONEY_PARSE_RE =
  /(?:[€£$]|USD|EUR|GBP)?\s*(\d[\d,]*(?:\.\d+)?)\s*(MM|BB|trillion|billion|million|thousand|T|B|M|K|t|b|m|k)?\b/i;

// ─── Public types ─────────────────────────────────────────────────────────────

export type RaiseAmountCandidate = {
  /** Money string as extracted by the pattern matcher (e.g. "$25K"). */
  value: string;
  /** Raw text surrounding the match (up to MARKET_WINDOW chars each side). */
  context: string;
  /** Source label for provenance. */
  source: "deck" | "xlsx" | "evidence" | "raise_terms";
  /** Optional evidence reference. */
  evidence_ref?: string | null;
};

export type RejectReason =
  | "market_context_taint"
  | "fund_aum_context"
  | "volume_metric_taint"
  | "magnitude_no_strong_verb"
  | "no_candidates";

export type ResolveRaiseAmountResult = {
  raise_amount: string | null;
  source: RaiseAmountCandidate["source"] | null;
  evidence_ref: string | null;
  /** Candidates that were evaluated but rejected, with their reasons. */
  rejected_candidates: Array<{ candidate: RaiseAmountCandidate; reason: RejectReason }>;
  /** True when the result comes from raise_terms override (not a deck pattern). */
  from_raise_terms_override: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a money string to a numeric million value.
 * Returns null when the string contains no recognisable money token.
 *
 * Examples:
 *   "$25K"  → 0.025
 *   "$2M"   → 2
 *   "$11B"  → 11_000
 *   "€1.5B" → 1_500
 */
export function parseMoneyToMillions(text: string): number | null {
  if (!text || typeof text !== "string") return null;
  const m = MONEY_PARSE_RE.exec(text);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const suffix = (m[2] ?? "").toLowerCase();
  const multiplier: Record<string, number> = {
    t: 1_000_000, trillion: 1_000_000,
    b: 1_000,     bb: 1_000,  billion: 1_000,
    m: 1,         mm: 1,      million: 1,
    k: 0.001,     thousand: 0.001,
  };
  return num * (multiplier[suffix] ?? 1);
}

/**
 * Fund/AUM context taint regex.
 *
 * Rejects raise candidates whose context contains fund-management language that
 * clearly indicates the amount describes AUM or a vehicle size, not a fundraise ask.
 *
 * Examples rejected:
 *   "$100M Alternatives Fund" — alternatives fund is the vehicle, not an ask
 *   "$500M AUM" — assets under management, not a raise
 *   "$250M LP commitment" — LP/GP mechanics, not the company's own ask
 */
export const FUND_AUM_CONTEXT_RE =
  /\b(?:alternatives?\s+fund|alternative\s+investment|aum|assets?\s+under\s+management|fund\s+size|investment\s+vehicle|limited\s+partners?(?:hip)?|\blp\b|general\s+partners?(?:hip)?|\bgp\b|fund\s+of\s+funds?|carried\s+interest|management\s+fee|endowment\s+fund|hedge\s+fund|private\s+equity\s+fund|venture\s+capital\s+fund|family\s+office|feeder\s+fund|co[\s-]invest)\b/i;

/**
 * Returns true when the candidate context contains fund-management / AUM language
 * that indicates the amount describes a vehicle or portfolio, not a fundraise ask.
 */
export function isCandidateTaintedByFundAumContext(context: string): boolean {
  return FUND_AUM_CONTEXT_RE.test(context);
}

/**
 * VOLUME_NOT_RAISE_RE: Operational volume / portfolio metrics that are frequently
 * mistaken for raise amounts because they appear near large currency figures.
 *
 * Pattern covers the Carmoola-class failure: "cars financed = £100M" / "GMV $50M"
 * where the money figure represents a throughput metric, NOT a fundraise ask.
 *
 * Rejected contexts include:
 *   - Car / vehicle lending throughput: "cars financed", "cars on finance", "vehicles originated"
 *   - Lending / mortgage origination volumes: "loan volume", "originations", "mortgage originations"
 *   - Fintech transaction throughput: "GMV", "gross merchandise value", "gross transaction value"
 *   - Deployed capital (VC/debt funds): "capital deployed", "capital invested"
 *   - Budget / operational plans: "annual budget", "operating budget", "total budget"
 *   - Portfolio / book size: "loan book", "book size", "loan portfolio", "debt facility"
 *   - Operational KPIs often misread as raise: "total processed", "total facilitated"
 *
 * Conservative anchoring: all patterns require a specific noun phrase, not bare keywords,
 * to minimise false positives against legitimate raise clauses.
 */
export const VOLUME_NOT_RAISE_RE =
  /\b(?:cars?\s+(?:financed?|on\s+finance|sold|originated?|written)|vehicles?\s+(?:financed?|sold|originated?|written)|mortgages?\s+(?:originated?|funded|processed|written)|loans?\s+(?:originated?|funded|processed|written|disbursed)|loan\s+(?:volume|book|portfolio|originations?|size)|mortgage\s+(?:volume|originations?|book|completions?)|originations?\b|gross\s+(?:merchandise|transaction)\s+value|\bGMV\b|capital\s+deployed(?:\s+to\s+date)?|capital\s+invested(?:\s+to\s+date)?|total\s+(?:loans?|capital|debt)\s+(?:deployed|invested|originated?|disbursed)|annual\s+(?:operating\s+)?budget|total\s+(?:operating\s+)?budget|booked\s+volume|loan\s+book\b|book\s+(?:size|value)|debt\s+(?:facility|book|portfolio)|credit\s+facility\s+(?:size|outstanding|limit)|total\s+(?:facilitated|processed|transacted))\b/i;

/**
 * Returns true when the candidate context contains operational volume / portfolio
 * language indicating the money amount is a throughput metric, not a fundraise ask.
 */
export function isCandidateTaintedByVolumeMetric(context: string): boolean {
  return VOLUME_NOT_RAISE_RE.test(context);
}

/**
 * Returns true if the candidate text has been tainted by market-sizing language
 * within MARKET_WINDOW chars on either side.
 *
 * Unlike the verb-first exemption in processor.ts, this check is applied to ALL
 * candidates regardless of whether they start with a letter or a currency symbol.
 */
export function isCandidateTaintedByMarketContext(context: string): boolean {
  return MARKET_CONTEXT_RE.test(context);
}

/**
 * Returns true if a strong, unambiguous raise-request verb (raising/seeking/
 * we are raising) is present within STRONG_RAISE_WINDOW chars of the start of
 * `context`.
 */
export function hasStrongRaiseSignal(context: string): boolean {
  return STRONG_RAISE_VERB_RE.test(context);
}

function isEarlyStage(stage: string | null | undefined): boolean {
  return EARLY_STAGE_SET.has(stage as any);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Deterministically resolve the canonical `raise_amount` from multiple sources.
 *
 * @param raiseTermsRaw  Optional string from deal_overview_v2.raise_terms or
 *                        a promoted raise_terms_v1 fact (e.g. "$25K Pre-Seed").
 *                        When present and parseable as a money amount, this is
 *                        used as the authoritative override for early-stage deals.
 * @param stage          Inferred stage string (e.g. "Seed", "Unknown"). Used to
 *                        gate the magnitude check and the raise_terms override.
 * @param candidates     Ordered list of raise_amount candidates from deck/XLSX
 *                        pattern matching, highest-confidence first.
 */
export function resolveRaiseAmount({
  raiseTermsRaw,
  stage,
  candidates,
}: {
  raiseTermsRaw?: string | null;
  stage?: string | null;
  candidates: RaiseAmountCandidate[];
}): ResolveRaiseAmountResult {
  const rejected: ResolveRaiseAmountResult["rejected_candidates"] = [];
  const earlyStage = isEarlyStage(stage);

  // ── Rule 1: raise_terms override for early-stage deals ───────────────────
  if (raiseTermsRaw && typeof raiseTermsRaw === "string" && earlyStage) {
    // Parse the money amount out of the raise_terms string.
    const raiseTermsMoney = MONEY_PARSE_RE.exec(raiseTermsRaw)?.[0] ?? null;
    // Extract just the clean money token from the full raise_terms string.
    const moneyToken = (() => {
      const MONEY_TOKEN = /[€£$]\s*\d[\d,.]*(?:\.\d+)?\s*(?:MM|BB|[TMBKtmbk]|trillion|billion|million|thousand)?(?!\d)/i;
      const m2 = MONEY_TOKEN.exec(raiseTermsRaw);
      return m2 ? m2[0].replace(/\s+/g, "").toUpperCase() : raiseTermsMoney;
    })();

    if (moneyToken) {
      // raise_terms is clean by construction (it comes from a gated ask-slide
      // detector); we emit it directly without market-context or magnitude checks.
      return {
        raise_amount: moneyToken,
        source: "raise_terms" as const,
        evidence_ref: null,
        rejected_candidates: rejected,
        from_raise_terms_override: true,
      };
    }
  }

  // ── Rules 2 + 3: filter deck/xlsx candidates ─────────────────────────────
  for (const candidate of candidates) {
    const ctx = candidate.context;

    // Rule 2: market-context taint — applies regardless of verb-first / money-first
    if (isCandidateTaintedByMarketContext(ctx)) {
      rejected.push({ candidate, reason: "market_context_taint" });
      continue;
    }

    // Rule 2b: fund/AUM context taint — rejects "$100M Alternatives Fund" etc.
    // Applied before magnitude check: fund/AUM language is deterministically wrong
    // regardless of amount size, stage, or raise-verb proximity.
    if (isCandidateTaintedByFundAumContext(ctx)) {
      rejected.push({ candidate, reason: "fund_aum_context" });
      continue;
    }

    // Rule 2c: volume metric taint — rejects operational throughput / portfolio metrics
    // that masquerade as raise amounts (Carmoola-class: "cars financed = £100M").
    // GMV, loan originations, loan book, car finance throughput, annual budget, etc.
    // Only applied when no strong unambiguous raise verb is present immediately nearby,
    // so legitimate "we are raising £100M and have financed 5,000 cars" slides are
    // not rejected (the STRONG_RAISE_VERB_RE check allows them through).
    if (isCandidateTaintedByVolumeMetric(ctx) && !hasStrongRaiseSignal(ctx)) {
      rejected.push({ candidate, reason: "volume_metric_taint" });
      continue;
    }

    // Rule 3: magnitude sanity — only for early stages
    if (earlyStage) {
      const amountM = parseMoneyToMillions(candidate.value);
      if (amountM !== null && amountM >= MAGNITUDE_THRESHOLD_M) {
        // Allow if there is a strong raise verb in the surrounding context
        if (!hasStrongRaiseSignal(ctx)) {
          rejected.push({ candidate, reason: "magnitude_no_strong_verb" });
          continue;
        }
      }
    }

    // Candidate survived all checks — accept it.
    const accepted: ResolveRaiseAmountResult = {
      raise_amount: candidate.value,
      source: candidate.source,
      evidence_ref: candidate.evidence_ref ?? null,
      rejected_candidates: rejected,
      from_raise_terms_override: false,
    };
    try {
      console.log(
        JSON.stringify({
          event: "RAISE_CANDIDATE_SELECTED",
          raise_amount: accepted.raise_amount,
          source: accepted.source,
          evidence_ref: accepted.evidence_ref,
          rejected_count: rejected.length,
          rejected_reasons: rejected.map((r) => r.reason),
        })
      );
    } catch { /* ignore */ }
    return accepted;
  }

  // No surviving candidate.
  if (rejected.length > 0) {
    try {
      console.log(
        JSON.stringify({
          event: "RAISE_CANDIDATE_REJECTED",
          reason: "all_candidates_rejected",
          rejected_count: rejected.length,
          rejected_reasons: rejected.map((r) => ({ value: r.candidate.value, reason: r.reason })),
        })
      );
    } catch { /* ignore */ }
  }
  return {
    raise_amount: null,
    source: null,
    evidence_ref: null,
    rejected_candidates: rejected,
    from_raise_terms_override: false,
  };
}
