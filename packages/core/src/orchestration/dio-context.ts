import { DIOContextSchema, type DIOContext } from "../types/dio";

export type DIOContextBuilderInput = {
  filename?: string;
  headings?: string[];
  full_text?: string;
  page_count?: number;
  total_words?: number;
  headings_count?: number;
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

function classifyPrimaryDocType(input: Required<DIOContextBuilderInput>): { value: PrimaryDocType; confidence: number; score_margin: number } {
  const title = normalizeText(input.filename);
  const headingsText = normalizeText(input.headings.join(" \n "));
  const fullText = normalizeText(input.full_text);
  const combined = `${title}\n${headingsText}\n${fullText}`;
  const pageCount = input.page_count;
  const totalWords = input.total_words;
  const headingsCount = input.headings_count;

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

  // Strong IM/business-plan keyword cues often present in long-form PDFs.
  const imKeywordSignals = keywordScore(combined, [
    "confidential",
    "prepared for",
    "strategy",
    "investment overview",
    "revenue streams",
    "go-to-market architecture",
    "go to market architecture",
    "appendix",
    "disclaimer",
  ]);

  // Long-form section headings common in IMs (penalize pitch if present without classic pitch headings).
  const longFormSectionSignals = keywordScore(combined, [
    "revenue streams",
    "go-to-market architecture",
    "go to market architecture",
    "marketing hub cities",
    "retail chain programs",
    "inventory",
    "credit facility",
    "cultural relevance",
    "high-margin",
    "high velocity",
  ]);
  const classicPitchHeadingSignals = keywordScore(combined, [
    "problem",
    "solution",
    "traction",
    "the ask",
    "ask",
    "team",
    "market",
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

  // Strong business_plan_im structure/length signals.
  // These are intentionally high impact to prevent long IM/business-plan PDFs from being misclassified as pitch decks.
  if (pageCount >= 25) scores.business_plan_im += 6;
  if (totalWords >= 4000) scores.business_plan_im += 6;
  if (headingsCount >= 8 && pageCount >= 15) scores.business_plan_im += 4;

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
  scores.business_plan_im += Math.min(imKeywordSignals, 8);

  // Pitch deck penalties for IM-like documents.
  if (pageCount >= 25) scores.pitch_deck -= 3;
  if (longFormSectionSignals >= 2 && classicPitchHeadingSignals <= 1) {
    scores.pitch_deck -= 3;
  }

  // Tie-breakers
  if (scores.one_pager >= 4 && pageCount <= 2) scores.one_pager += 2;
  if (scores.exec_summary >= 3 && pageCount <= 5) scores.exec_summary += 1;

  const best = pickBest(scores);
  const sortedScores = Object.values(scores).slice().sort((a, b) => b - a);
  const secondBest = sortedScores[1] ?? 0;
  const score_margin = best.score - secondBest;

  const maxPossible = 12; // calibrated to rules above (confidence saturates)
  const confidence = confidenceFromBestScore(best.score, maxPossible);

  // If nothing triggered, explicitly return other with low confidence
  if (best.max <= 0) return { value: "other", confidence: 0, score_margin: 0 };

  return { value: best.label, confidence, score_margin };
}

function classifyDealType(input: Required<DIOContextBuilderInput>, primaryDocType: PrimaryDocType): { value: DealType; confidence: number } {
  const title = normalizeText(input.filename);
  const headingsText = normalizeText(input.headings.join(" \n "));
  const fullText = normalizeText(input.full_text);
  const combined = `${title}\n${headingsText}\n${fullText}`;

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
    full_text: typeof input.full_text === "string" ? input.full_text : "",
    page_count: typeof input.page_count === "number" && input.page_count > 0 ? input.page_count : 0,
    total_words: typeof input.total_words === "number" && input.total_words > 0 ? input.total_words : 0,
    headings_count: typeof input.headings_count === "number" && input.headings_count > 0
      ? input.headings_count
      : (Array.isArray(input.headings) ? input.headings.length : 0),
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

  type DocDocType = PrimaryDocType;
  type DocClassification = {
    doc_doc_type: DocDocType;
    confidence: number;
    page_count: number;
    score_margin: number;
    support: {
      fund_spv: boolean;
      startup_raise: boolean;
    };
  };

  function getDocTitle(doc: any): string {
    return typeof doc?.title === "string" ? doc.title : "";
  }

  function getDocFilename(doc: any): string {
    return typeof doc?.filename === "string"
      ? doc.filename
      : typeof doc?.fileName === "string"
        ? doc.fileName
        : typeof doc?.name === "string"
          ? doc.name
          : "";
  }

  function getDocContentType(doc: any): string {
    return typeof doc?.contentType === "string"
      ? doc.contentType
      : typeof doc?.content_type === "string"
        ? doc.content_type
        : "";
  }

  function getDocHeadings(doc: any): string[] {
    if (Array.isArray(doc?.mainHeadings)) return doc.mainHeadings.filter((h: any) => typeof h === "string");
    if (Array.isArray(doc?.headings)) return doc.headings.filter((h: any) => typeof h === "string");
    if (Array.isArray(doc?.outlineHeadings)) return doc.outlineHeadings.filter((h: any) => typeof h === "string");
    if (Array.isArray(doc?.structuredData?.mainHeadings)) return doc.structuredData.mainHeadings.filter((h: any) => typeof h === "string");
    if (Array.isArray(doc?.structured_data?.mainHeadings)) return doc.structured_data.mainHeadings.filter((h: any) => typeof h === "string");
    return [];
  }

  function getDocFullText(doc: any): string {
    const candidates: unknown[] = [
      doc?.full_text,
      doc?.fullText,
      doc?.fulltext,
      doc?.text_summary,
      doc?.textSummary,
      doc?.summary,
      doc?.structuredData?.textSummary,
      doc?.structured_data?.textSummary,
      doc?.structuredData?.summary,
      doc?.structured_data?.summary,
      doc?.text,
    ];
    for (const v of candidates) {
      if (typeof v === "string") {
        const s = v.trim();
        if (s.length > 0) return s;
      }
    }
    return "";
  }

  function getDocPageCount(doc: any): number {
    const n =
      typeof doc?.page_count === "number"
        ? doc.page_count
        : typeof doc?.pageCount === "number"
          ? doc.pageCount
          : typeof doc?.totalPages === "number"
            ? doc.totalPages
            : typeof doc?.page_count_estimate === "number"
              ? doc.page_count_estimate
              : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getDocTotalWords(doc: any): number {
    const n =
      typeof doc?.total_words === "number"
        ? doc.total_words
        : typeof doc?.totalWords === "number"
          ? doc.totalWords
          : typeof doc?.word_count === "number"
            ? doc.word_count
            : typeof doc?.wordCount === "number"
              ? doc.wordCount
              : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getDocHeadingsCount(doc: any): number {
    const n =
      typeof doc?.headings_count === "number"
        ? doc.headings_count
        : typeof doc?.headingsCount === "number"
          ? doc.headingsCount
          : 0;
    if (Number.isFinite(n) && n > 0) return n;
    const headings = getDocHeadings(doc);
    return headings.length;
  }

  function buildDocBuilderInput(doc: any): Required<DIOContextBuilderInput> {
    const title = getDocTitle(doc);
    const filename = getDocFilename(doc);
    const contentType = getDocContentType(doc);
    const ext = normalizeText(filename).split("?")[0];

    // Include contentType + extension in the string fed to heuristics.
    const combinedName = [title, filename, contentType, ext].filter(Boolean).join(" ");
    const fullText = getDocFullText(doc);
    const boundedFullText = fullText.length > 12000 ? fullText.slice(0, 12000) : fullText;
    return {
      filename: combinedName,
      headings: getDocHeadings(doc),
      full_text: boundedFullText,
      page_count: getDocPageCount(doc),
      total_words: getDocTotalWords(doc),
      headings_count: getDocHeadingsCount(doc),
    };
  }

  function isFinancialAttachment(doc: any): boolean {
    const name = normalizeText([getDocTitle(doc), getDocFilename(doc), getDocContentType(doc)].filter(Boolean).join(" "));
    return (
      name.includes(".xls") ||
      name.includes(".xlsx") ||
      name.includes(".csv") ||
      name.includes("excel") ||
      name.includes("spreadsheet") ||
      name.includes("application/vnd.ms-excel") ||
      name.includes("application/vnd.openxmlformats-officedocument.spreadsheetml")
    );
  }

  function fundSpvSignals(doc: any): boolean {
    const title = normalizeText(getDocTitle(doc));
    const filename = normalizeText(getDocFilename(doc));
    const headingsText = normalizeText(getDocHeadings(doc).join(" \n "));
    const fullText = normalizeText(getDocFullText(doc));
    const combined = `${title}\n${filename}\n${headingsText}\n${fullText}`;
    return (
      keywordScore(combined, [
        "spv",
        "special purpose vehicle",
        "fund",
        "fund i",
        "fund ii",
        "limited partner",
        "limited partners",
        "lp",
        "general partner",
        "gp",
        "subscription agreement",
        "private placement",
        "ppm",
        "capital call",
        "carry",
        "management fee",
      ]) > 0
    );
  }

  function startupRaiseSignals(doc: any): boolean {
    const title = normalizeText(getDocTitle(doc));
    const filename = normalizeText(getDocFilename(doc));
    const headingsText = normalizeText(getDocHeadings(doc).join(" \n "));
    const fullText = normalizeText(getDocFullText(doc));
    const combined = `${title}\n${filename}\n${headingsText}\n${fullText}`;
    return (
      keywordScore(combined, [
        "raising",
        "fundraise",
        "fundraising",
        "seed",
        "pre-seed",
        "pre seed",
        "series a",
        "series b",
        "series c",
        "round",
        "investment",
        "use of funds",
        "terms",
        "valuation",
      ]) > 0
    );
  }

  const perDoc: DocClassification[] = documents.map((doc) => {
    const builderInput = buildDocBuilderInput(doc);
    const docType = classifyPrimaryDocType(builderInput);
    const pageCount = getDocPageCount(doc);

    // If it's clearly a spreadsheet/financial attachment, bias toward financials.
    const boostedType: DocDocType =
      isFinancialAttachment(doc) && docType.value === "other" ? "financials" : docType.value;
    const boostedConfidence =
      boostedType === "financials" && isFinancialAttachment(doc) ? Math.max(docType.confidence, 0.7) : docType.confidence;

    return {
      doc_doc_type: boostedType,
      confidence: boostedConfidence,
      page_count: pageCount,
      score_margin: docType.score_margin,
      support: {
        fund_spv: fundSpvSignals(doc),
        startup_raise: startupRaiseSignals(doc),
      },
    };
  });

  const totalDocs = perDoc.length;

  // Deal-level primary_doc_type via summed support across docs.
  // - Support is primarily driven by each doc's doc_type confidence, scaled by page_count.
  // - This avoids a hard precedence rule where a small pitch attachment can override a strong IM/business plan.
  const totalPages = perDoc.reduce((sum, d) => sum + (Number.isFinite(d.page_count) ? d.page_count : 0), 0);
  const totalSupportByType: Record<PrimaryDocType, number> = {
    pitch_deck: 0,
    business_plan_im: 0,
    exec_summary: 0,
    one_pager: 0,
    financials: 0,
    other: 0,
  };
  const docsByType: Record<PrimaryDocType, number> = {
    pitch_deck: 0,
    business_plan_im: 0,
    exec_summary: 0,
    one_pager: 0,
    financials: 0,
    other: 0,
  };
  const pagesByType: Record<PrimaryDocType, number> = {
    pitch_deck: 0,
    business_plan_im: 0,
    exec_summary: 0,
    one_pager: 0,
    financials: 0,
    other: 0,
  };

  function docSupportWeight(pageCount: number): number {
    // Keep this intentionally simple and monotonic.
    // - 0 pages (spreadsheets/images/unknown): weight 1
    // - 1..10 pages: weight 1
    // - 11..20 pages: weight 2
    // - 21+ pages: weight 3
    if (!Number.isFinite(pageCount) || pageCount <= 10) return 1;
    if (pageCount <= 20) return 2;
    return 3;
  }

  for (const d of perDoc) {
    const t = d.doc_doc_type;
    docsByType[t] += 1;
    pagesByType[t] += Number.isFinite(d.page_count) ? d.page_count : 0;
    totalSupportByType[t] += clamp01(d.confidence) * docSupportWeight(d.page_count);
  }

  const maxSupport = (Object.values(totalSupportByType).reduce((m, v) => (v > m ? v : m), 0)) || 0;

  let primary_doc_type: PrimaryDocType = "other";
  if (maxSupport > 0) {
    const EPS = 1e-9;
    const candidates = (Object.keys(totalSupportByType) as PrimaryDocType[])
      .filter((t) => totalSupportByType[t] >= maxSupport - EPS);

    if (candidates.length === 1) {
      primary_doc_type = candidates[0];
    } else {
      // Tie-breaker: prefer pitch_deck ONLY if it is the majority of docs OR the majority of pages.
      if (candidates.includes("pitch_deck")) {
        const pitchIsMajorityDocs = docsByType.pitch_deck > totalDocs / 2;
        const pitchIsMajorityPages = totalPages > 0 ? pagesByType.pitch_deck > totalPages / 2 : false;
        if (pitchIsMajorityDocs || pitchIsMajorityPages) {
          primary_doc_type = "pitch_deck";
        }
      }

      if (primary_doc_type === "other") {
        const pruned = candidates.filter((t) => t !== "pitch_deck");

        // Deterministic fallback ordering (only used in true ties).
        const fallbackOrder: PrimaryDocType[] = [
          "business_plan_im",
          "exec_summary",
          "one_pager",
          "financials",
          "pitch_deck",
          "other",
        ];

        // Prefer the tied candidate with most pages, then most docs, then fallback order.
        primary_doc_type = pruned
          .slice()
          .sort((a, b) => {
            const pagesDiff = pagesByType[b] - pagesByType[a];
            if (pagesDiff !== 0) return pagesDiff;
            const docsDiff = docsByType[b] - docsByType[a];
            if (docsDiff !== 0) return docsDiff;
            return fallbackOrder.indexOf(a) - fallbackOrder.indexOf(b);
          })[0] ?? "other";
      }
    }
  }

  // Guardrail: don't declare the deal as pitch_deck unless pitch support is clearly strong.
  // This prevents long IM/business-plan PDFs (with some pitch-y keywords) from being treated as pitch decks.
  if (primary_doc_type === "pitch_deck") {
    const PITCH_MIN_CONF = 0.75;
    const PITCH_MIN_MARGIN = 3;
    const PITCH_MIN_SUPPORT_GAP = 0.75;

    const hasStrongPitchDeck = perDoc.some(
      (d) => d.doc_doc_type === "pitch_deck" && d.confidence >= PITCH_MIN_CONF && d.score_margin >= PITCH_MIN_MARGIN
    );

    const sortedBySupport = (Object.keys(totalSupportByType) as PrimaryDocType[])
      .slice()
      .sort((a, b) => {
        const diff = totalSupportByType[b] - totalSupportByType[a];
        if (diff !== 0) return diff;
        return (a < b ? -1 : a > b ? 1 : 0);
      });
    const runnerUp = sortedBySupport.find((t) => t !== "pitch_deck") ?? "other";
    const supportGap = totalSupportByType.pitch_deck - (totalSupportByType[runnerUp] ?? 0);

    if (!hasStrongPitchDeck || supportGap < PITCH_MIN_SUPPORT_GAP) {
      primary_doc_type = runnerUp;
    }
  }

  const hasPitchDeck = docsByType.pitch_deck > 0;
  const anyFundSpv = perDoc.some((d) => d.support.fund_spv);
  const anyStartupRaise = perDoc.some((d) => d.support.startup_raise);

  // Deal-level deal_type using all docs.
  // Rule 1: If fund/LP/SPV language exists and NO pitch deck exists => fund_spv
  // Rule 2: If pitch deck exists and language indicates a company raise => startup_raise
  let deal_type: DealType;
  let dealTypeConfidenceFromRules: number | null = null;

  if (anyFundSpv && !hasPitchDeck) {
    deal_type = "fund_spv";
    dealTypeConfidenceFromRules = totalDocs > 0 ? perDoc.filter((d) => d.support.fund_spv).length / totalDocs : 0;
  } else if (hasPitchDeck && anyStartupRaise) {
    deal_type = "startup_raise";
    // Count pitch deck OR explicit raise language as support.
    dealTypeConfidenceFromRules = totalDocs > 0
      ? perDoc.filter((d) => d.doc_doc_type === "pitch_deck" || d.support.startup_raise).length / totalDocs
      : 0;
  } else {
    // Fallback to existing heuristic deal-type classifier, but on combined content.
    const combinedTitles = documents.map(getDocTitle).filter(Boolean);
    const combinedHeadings = uniqStrings(documents.flatMap(getDocHeadings));
    const combinedFullText = documents
      .map(getDocFullText)
      .filter((t) => typeof t === "string" && t.trim().length > 0)
      .join("\n\n---\n\n");
    const boundedCombinedFullText = combinedFullText.length > 24000 ? combinedFullText.slice(0, 24000) : combinedFullText;
    const combinedInput: Required<DIOContextBuilderInput> = {
      filename: combinedTitles.join(" | "),
      headings: combinedHeadings,
      full_text: boundedCombinedFullText,
      page_count: totalPages,
      total_words: 0,
      headings_count: combinedHeadings.length,
    };
    const inferred = classifyDealType(combinedInput, primary_doc_type);
    deal_type = inferred.value;
    dealTypeConfidenceFromRules = inferred.confidence;
  }

  // Vertical/stage computed using all docs (existing heuristics).
  const combinedTitles = documents.map(getDocTitle).filter(Boolean);
  const combinedHeadings = uniqStrings(documents.flatMap(getDocHeadings));
  const combinedFullText = documents
    .map(getDocFullText)
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .join("\n\n---\n\n");
  const boundedCombinedFullText = combinedFullText.length > 24000 ? combinedFullText.slice(0, 24000) : combinedFullText;
  const combinedInput: Required<DIOContextBuilderInput> = {
    filename: combinedTitles.join(" | "),
    headings: combinedHeadings,
    full_text: boundedCombinedFullText,
    page_count: totalPages,
    total_words: 0,
    headings_count: combinedHeadings.length,
  };

  const vertical = classifyVertical(combinedInput, deal_type);
  const stage = classifyStage(combinedInput, deal_type);

  // Deterministic real-asset routing (preferred equity offering memo)
  // Mapped to existing enums: vertical=other, deal_type=fund_spv, primary_doc_type=business_plan_im.
  // This prevents real-estate offering memoranda from being misclassified as startup raises.
  const combinedTextForOverride = normalizeText(
    `${combinedInput.filename}\n${combinedInput.headings.join("\n")}\n${combinedInput.full_text}`
  );
  const realEstateSignal = keywordScore(combinedTextForOverride, [
    "real estate",
    "property",
    "multifamily",
    "apartment",
    "noi",
    "cap rate",
    "rent roll",
    "ltv",
    "dscr",
    "debt service",
  ]);
  const prefEquitySignal = keywordScore(combinedTextForOverride, [
    "preferred equity",
    "pref equity",
    "mezzanine",
    "capital stack",
    "offering memorandum",
    "private placement",
    "subscription agreement",
    "ppm",
  ]);
  const hasStrongRealAsset = realEstateSignal >= 2 && prefEquitySignal >= 2;

  if (hasStrongRealAsset) {
    primary_doc_type = "business_plan_im";
    deal_type = "fund_spv";
    (vertical as any).value = "other";
    (stage as any).value = "fund_ops";
  }

  // Confidence based on agreement across docs (simple % support).
  const primarySupport = totalDocs > 0 ? perDoc.filter((d) => d.doc_doc_type === primary_doc_type).length / totalDocs : 0;
  const primaryStrength = totalDocs > 0
    ? (() => {
        const matches = perDoc.filter((d) => d.doc_doc_type === primary_doc_type);
        if (matches.length === 0) return 0;
        return matches.reduce((sum, d) => sum + d.confidence, 0) / matches.length;
      })()
    : 0;

  const dealSupport = clamp01(typeof dealTypeConfidenceFromRules === "number" ? dealTypeConfidenceFromRules : 0);
  const confidence = clamp01(primarySupport * 0.45 + primaryStrength * 0.25 + dealSupport * 0.30);

  const boostedConfidence = hasStrongRealAsset ? Math.max(confidence, 0.8) : confidence;

  const heuristic: DIOContext = {
    primary_doc_type,
    deal_type,
    vertical: (vertical as any).value,
    stage: (stage as any).value,
    confidence: boostedConfidence,
  };

  // Preserve existing LLM fallback behavior (deterministic by default).
  if (heuristic.confidence < 0.7) {
    const enhanced = await maybeEnhanceWithGPT52({ input: combinedInput, heuristic });
    if (enhanced) return enhanced;
  }

  return heuristic;
}
