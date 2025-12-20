import { DIOContextSchema, type DIOContext } from "../types/dio";

export type DIOContextBuilderInput = {
  filename?: string;
  headings?: string[];
  page_count?: number;
};

type PrimaryDocType = DIOContext["primary_doc_type"];
type DealType = DIOContext["deal_type"];
type Vertical = DIOContext["vertical"];
type Stage = DIOContext["stage"];

function normalizeText(value: string | undefined | null): string {
  return (value || "").toLowerCase();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function keywordScore(haystack: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    const needle = kw.toLowerCase();
    // Prevent substring false positives for short tokens (e.g. "im" in "mining")
    const isShortToken = needle.length <= 3 && /^[a-z0-9]+$/.test(needle) && !needle.includes(" ");
    if (isShortToken) {
      const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(haystack)) score += 1;
    } else {
      if (haystack.includes(needle)) score += 1;
    }
  }
  return score;
}

function pickBest<T extends string>(scores: Record<T, number>): { label: T; score: number; max: number } {
  let bestLabel = Object.keys(scores)[0] as T;
  let bestScore = -Infinity;
  let max = 0;

  for (const [label, score] of Object.entries(scores) as Array<[T, number]>) {
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
    max = Math.max(max, score);
  }

  return { label: bestLabel, score: bestScore, max };
}

function confidenceFromBestScore(bestScore: number, maxPossible: number): number {
  if (maxPossible <= 0) return 0;
  // Gentle saturation (avoid needing perfect match to exceed 0.7)
  return clamp01(bestScore / maxPossible);
}

function classifyPrimaryDocType(input: Required<DIOContextBuilderInput>): { value: PrimaryDocType; confidence: number } {
  const title = normalizeText(input.filename);
  const headingsText = normalizeText(input.headings.join(" \n "));
  const combined = `${title}\n${headingsText}`;
  const pageCount = input.page_count;

  const titleExec = keywordScore(title, ["executive summary", "exec summary"]);
  const titleOnePager = keywordScore(title, ["one pager", "one-pager", "one page", "one-page"]);
  const titlePitch = keywordScore(title, ["pitch deck", "pitch", "deck"]);
  const titleFinancials = keywordScore(title, ["financial", "model", "projections", "forecast", "cap table"]);
  const titleIM = keywordScore(title, [
    "investment memorandum",
    "information memorandum",
    "investment memo",
    "information memo",
    "memorandum",
    "memo",
    "cim",
    "im",
    "business plan",
  ]);

  const pitchSignals = keywordScore(combined, [
    "pitch",
    "deck",
    "problem",
    "solution",
    "traction",
    "team",
    "market",
    "ask",
    "go-to-market",
    "go to market",
    "use of funds",
  ]);

  const imStructureSignals = keywordScore(combined, [
    "terms",
    "term sheet",
    "risk factors",
    "private placement",
    "subscription agreement",
    "offering",
  ]);

  const financialSignals = keywordScore(combined, [
    "financial",
    "model",
    "projections",
    "forecast",
    "p&l",
    "income statement",
    "balance sheet",
    "cash flow",
    "cap table",
  ]);

  const execSignals = keywordScore(combined, ["executive summary", "exec summary", "summary"]);
  const onePagerSignals = keywordScore(combined, ["one pager", "one-pager", "one page", "one-page"]);
  const imSignals = keywordScore(combined, [
    "information memorandum",
    "investment memorandum",
    "investment memo",
    "information memo",
    "memorandum",
    "memo",
    "im",
    "cim",
    "business plan",
  ]);

  const scores: Record<PrimaryDocType, number> = {
    pitch_deck: 0,
    exec_summary: 0,
    one_pager: 0,
    business_plan_im: 0,
    financials: 0,
    other: 0,
  };

  // Page count priors
  if (pageCount >= 8 && pageCount <= 25) scores.pitch_deck += 2;
  if (pageCount <= 3) scores.exec_summary += 1;
  if (pageCount <= 2) scores.one_pager += 2;
  if (pageCount >= 15) scores.business_plan_im += 1;

  // Filename priors (strong)
  if (titleExec > 0) scores.exec_summary += 6;
  if (titleOnePager > 0) scores.one_pager += 6;
  if (titlePitch > 0) scores.pitch_deck += 5;
  if (titleFinancials > 0) scores.financials += 4;
  if (titleIM > 0) scores.business_plan_im += 6;

  // Title/headings signals
  scores.pitch_deck += Math.min(pitchSignals, 6);
  scores.financials += Math.min(financialSignals, 6);
  scores.exec_summary += Math.min(execSignals, 3);
  scores.one_pager += Math.min(onePagerSignals, 3);
  scores.business_plan_im += Math.min(imSignals, 4);
  scores.business_plan_im += Math.min(imStructureSignals, 4);

  // Tie-breakers
  if (scores.one_pager >= 4 && pageCount <= 2) scores.one_pager += 2;
  if (scores.exec_summary >= 3 && pageCount <= 5) scores.exec_summary += 1;

  const best = pickBest(scores);
  const maxPossible = 12; // calibrated to rules above
  const confidence = confidenceFromBestScore(best.score, maxPossible);

  // If nothing triggered, explicitly return other with low confidence
  if (best.max <= 0) return { value: "other", confidence: 0 };

  return { value: best.label, confidence };
}

function classifyDealType(input: Required<DIOContextBuilderInput>, primaryDocType: PrimaryDocType): { value: DealType; confidence: number } {
  const title = normalizeText(input.filename);
  const headingsText = normalizeText(input.headings.join(" \n "));
  const combined = `${title}\n${headingsText}`;

  const fundSignals = keywordScore(combined, [
    "spv",
    "special purpose vehicle",
    "fund",
    "limited partners",
    "lp",
    "general partner",
    "gp",
    "subscription agreement",
    "private placement",
  ]);

  const holdcoSignals = keywordScore(combined, ["holdco", "holding company", "platform", "roll-up", "roll up", "buy and build", "acquisition"]);
  const servicesSignals = keywordScore(combined, ["services", "agency", "consulting", "managed services", "implementation"]);
  const consumerSignals = keywordScore(combined, ["consumer", "cpg", "brand", "retail", "d2c", "direct-to-consumer", "direct to consumer"]);
  const cryptoMiningSignals = keywordScore(combined, ["mining", "hashrate", "hash rate", "asic", "btc", "bitcoin", "hosting", "miners", "power cost"]);

  const scores: Record<DealType, number> = {
    startup_raise: 0,
    fund_spv: 0,
    holdco_platform: 0,
    services: 0,
    consumer_product: 0,
    crypto_mining: 0,
    other: 0,
  };

  scores.fund_spv += Math.min(fundSignals, 6);
  scores.holdco_platform += Math.min(holdcoSignals, 5);
  scores.services += Math.min(servicesSignals, 5);
  scores.consumer_product += Math.min(consumerSignals, 5);
  scores.crypto_mining += Math.min(cryptoMiningSignals, 6);

  // Priors
  if (primaryDocType === "pitch_deck") scores.startup_raise += 2;
  if (primaryDocType === "business_plan_im") scores.holdco_platform += 1;

  const best = pickBest(scores);
  const maxPossible = 8;
  const confidence = confidenceFromBestScore(best.score, maxPossible);

  if (best.max <= 0) {
    // If we have a pitch-ish doc but no strong signals, assume startup raise.
    if (primaryDocType === "pitch_deck" || primaryDocType === "exec_summary" || primaryDocType === "one_pager") {
      return { value: "startup_raise", confidence: 0.55 };
    }
    return { value: "other", confidence: 0 };
  }

  return { value: best.label, confidence };
}

function classifyVertical(input: Required<DIOContextBuilderInput>, dealType: DealType): { value: Vertical; confidence: number } {
  const title = normalizeText(input.filename);
  const headingsText = normalizeText(input.headings.join(" \n "));
  const combined = `${title}\n${headingsText}`;

  const saasSignals = keywordScore(combined, ["saas", "arr", "mrr", "subscription", "platform", "api"]);
  const fintechSignals = keywordScore(combined, ["fintech", "payments", "lending", "bank", "credit", "underwriting", "card"]);
  const healthcareSignals = keywordScore(combined, ["healthcare", "clinical", "patient", "hipaa", "provider", "medical"]);
  const consumerSignals = keywordScore(combined, ["consumer", "cpg", "brand", "retail", "d2c", "direct-to-consumer", "direct to consumer"]);
  const energySignals = keywordScore(combined, ["energy", "solar", "wind", "battery", "grid", "oil", "gas"]);
  const servicesSignals = keywordScore(combined, ["services", "agency", "consulting", "managed services"]);
  const cryptoSignals = keywordScore(combined, ["crypto", "bitcoin", "btc", "ethereum", "hashrate", "mining", "defi"]);

  const scores: Record<Vertical, number> = {
    saas: 0,
    fintech: 0,
    healthcare: 0,
    consumer: 0,
    energy: 0,
    services: 0,
    crypto: 0,
    other: 0,
  };

  scores.saas += Math.min(saasSignals, 6);
  if (combined.includes("arr") || combined.includes("mrr")) scores.saas += 2;
  scores.fintech += Math.min(fintechSignals, 6);
  scores.healthcare += Math.min(healthcareSignals, 6);
  scores.consumer += Math.min(consumerSignals, 6);
  scores.energy += Math.min(energySignals, 6);
  scores.services += Math.min(servicesSignals, 6);
  scores.crypto += Math.min(cryptoSignals, 6);
  if (combined.includes("hashrate") || combined.includes("asic") || combined.includes("bitcoin") || combined.includes("btc")) {
    scores.crypto += 2;
  }

  // Priors based on deal type
  if (dealType === "services") scores.services += 2;
  if (dealType === "consumer_product") scores.consumer += 2;
  if (dealType === "crypto_mining") scores.crypto += 3;

  const best = pickBest(scores);
  const maxPossible = 9;
  const confidence = confidenceFromBestScore(best.score, maxPossible);

  if (best.max <= 0) return { value: "other", confidence: 0 };

  return { value: best.label, confidence };
}

function classifyStage(input: Required<DIOContextBuilderInput>, dealType: DealType): { value: Stage; confidence: number } {
  const title = normalizeText(input.filename);
  const headingsText = normalizeText(input.headings.join(" \n "));
  const combined = `${title}\n${headingsText}`;

  if (dealType === "fund_spv") {
    return { value: "fund_ops", confidence: 0.9 };
  }

  const ideaSignals = keywordScore(combined, ["idea", "concept", "pre-product", "pre product", "stealth"]);
  const preSeedSignals = keywordScore(combined, ["pre-seed", "pre seed"]);
  const seedSignals = keywordScore(combined, ["seed", "seed round"]);
  const growthSignals = keywordScore(combined, ["series a", "series b", "series c", "growth stage", "scale", "scaling", "expansion"]);
  const matureSignals = keywordScore(combined, ["profitable", "profitability", "ebitda", "mature", "ipo"]);

  const scores: Record<Stage, number> = {
    idea: 0,
    pre_seed: 0,
    seed: 0,
    growth: 0,
    mature: 0,
    fund_ops: 0,
    unknown: 0,
  };

  scores.idea += Math.min(ideaSignals, 3);
  scores.pre_seed += Math.min(preSeedSignals, 3) + (preSeedSignals > 0 ? 2 : 0);
  scores.seed += Math.min(seedSignals, 3) + (seedSignals > 0 ? 2 : 0);
  scores.growth += Math.min(growthSignals, 4) + (growthSignals > 0 ? 2 : 0);
  scores.mature += Math.min(matureSignals, 4) + (matureSignals > 0 ? 2 : 0);

  const best = pickBest(scores);
  const maxPossible = 6;
  const confidence = confidenceFromBestScore(best.score, maxPossible);

  if (best.max <= 0) return { value: "unknown", confidence: 0 };

  return { value: best.label, confidence };
}

async function maybeEnhanceWithGPT52(args: {
  input: Required<DIOContextBuilderInput>;
  heuristic: DIOContext;
}): Promise<DIOContext | null> {
  const enabled = process.env.DIO_CONTEXT_LLM_ENABLED === "true";
  const apiKey = process.env.OPENAI_API_KEY;
  const llmGloballyEnabled = process.env.LLM_ENABLED !== "false";

  if (!enabled || !llmGloballyEnabled || !apiKey) return null;
  if (typeof fetch !== "function") return null;

  try {
    const model = process.env.DIO_CONTEXT_LLM_MODEL || "gpt-5.2";

    const headings = uniqStrings(args.input.headings).slice(0, 60);

    const system =
      "You classify investment docs. Output ONLY valid JSON with keys: " +
      "primary_doc_type, deal_type, vertical, stage, confidence. " +
      "Values must be from the allowed enums. confidence must be 0-1.";

    const user = {
      filename: args.input.filename,
      page_count: args.input.page_count,
      headings,
      allowed: {
        primary_doc_type: ["pitch_deck", "exec_summary", "one_pager", "business_plan_im", "financials", "other"],
        deal_type: ["startup_raise", "fund_spv", "holdco_platform", "services", "consumer_product", "crypto_mining", "other"],
        vertical: ["saas", "fintech", "healthcare", "consumer", "energy", "services", "crypto", "other"],
        stage: ["idea", "pre_seed", "seed", "growth", "mature", "fund_ops", "unknown"],
      },
      heuristic_guess: args.heuristic,
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) },
        ],
      }),
    });

    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;

    const parsed = JSON.parse(content);
    const validated = DIOContextSchema.safeParse(parsed);
    if (!validated.success) return null;

    return validated.data;
  } catch {
    return null;
  }
}

export async function buildDIOContext(input: DIOContextBuilderInput): Promise<DIOContext> {
  const normalized: Required<DIOContextBuilderInput> = {
    filename: input.filename || "",
    headings: Array.isArray(input.headings) ? input.headings : [],
    page_count: typeof input.page_count === "number" && input.page_count > 0 ? input.page_count : 0,
  };

  const docType = classifyPrimaryDocType(normalized);
  const dealType = classifyDealType(normalized, docType.value);
  const vertical = classifyVertical(normalized, dealType.value);
  const stage = classifyStage(normalized, dealType.value);

  // Overall confidence: prioritize doc type (most detectable via filename/page_count),
  // but still require some support from other dimensions.
  const support = (dealType.confidence + vertical.confidence + stage.confidence) / 3;
  const confidence = clamp01(docType.confidence * 0.75 + support * 0.25);

  const heuristic: DIOContext = {
    primary_doc_type: docType.value,
    deal_type: dealType.value,
    vertical: vertical.value,
    stage: stage.value,
    confidence,
  };

  if (heuristic.confidence < 0.7) {
    const enhanced = await maybeEnhanceWithGPT52({ input: normalized, heuristic });
    if (enhanced) return enhanced;
  }

  return heuristic;
}

export async function buildDIOContextFromInputData(input_data: Record<string, unknown>): Promise<DIOContext> {
  const documents = (input_data.documents as any[]) || [];

  const titles: string[] = [];
  const headings: string[] = [];
  let totalPages = 0;

  for (const doc of documents) {
    if (typeof doc?.title === "string") titles.push(doc.title);
    if (Array.isArray(doc?.mainHeadings)) headings.push(...doc.mainHeadings);
    if (typeof doc?.totalPages === "number") totalPages += doc.totalPages;
  }

  const filename = titles[0] || "";

  return buildDIOContext({
    filename,
    headings: uniqStrings(headings),
    page_count: totalPages,
  });
}
