type NormBBox = { x: number; y: number; w: number; h: number } | null;

type LineCandidate = {
  raw: string;
  norm: string;
  bbox: NormBBox;
  lineIndex: number;
};

type SlideCandidateScore = {
  text: string;
  rawText: string;
  score: number;
  parts: string[];
  bbox: NormBBox;
  lineIndex: number;
  heading: string | null;
  brandRegionHit: boolean;
  brandOverlap: number;
};

export type OcrBBox = { x: number; y: number; w: number; h: number };

export type OcrBlock = {
  text?: string | null;
  value?: string | null;
  bbox?: OcrBBox | null;
  box?: OcrBBox | null;
  bounding_box?: OcrBBox | null;
  conf?: number | null;
  level?: "word" | "line";
  line_id?: string | number | null;
};

export type PageInput = {
  ocr_blocks?: OcrBlock[] | null;
  ocr_text?: string | null;
  page_width?: number | null;
  page_height?: number | null;
};

export type BrandRegion = { cx: number; cy: number; rx: number; ry: number };

export type BrandModel = {
  phrases: Set<string>;
  regions: BrandRegion[];
};

export type SlideTitleResult = {
  slide_title: string | null;
  slide_title_confidence: number;
  slide_title_source: "ocr_layout_v1" | "ocr_fallback" | "heading_fuzzy_v1" | "brand_fallback" | "none";
  slide_title_warnings?: string[];
  slide_title_debug?: { candidates: Array<{ text: string; score: number; reasons: string[] }> };
};

export type SlideTitleInput = {
  blocks?: OcrBlock[] | null;
  ocr_text?: string | null;
  page_width?: number | null;
  page_height?: number | null;
  brandModel?: BrandModel;
  enableDebug?: boolean;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const DEFAULT_BLACKLIST = new Set<string>([
  "confidential",
  "confidentential",
  "confidential information",
  "draft",
  "internal use only",
  "all rights reserved",
  "pitch deck",
  "deck",
]);

const headingKeywords = [
  "the pivot",
  "overview",
  "company overview",
  "problem",
  "market problem",
  "solution",
  "product",
  "how it works",
  // Common non-startup-doc headings (e.g. real estate / project memos)
  "project breakdown",
  "key considerations",
  "development summary",
  "key market studies",
  "market",
  "market opportunity",
  "traction",
  "business model",
  "pricing",
  "go-to-market",
  "go to market",
  "distribution",
  "team",
  "competition",
  "risks",
  "financials",
  "financial",
  "unit economics",
  "raise",
  "terms",
  "use of funds",
  "exit",
  "exit strategy",
  "acquirers",
  "call to action",
  "investment opportunity",
];

function compactLetters(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function diceCoefficient(a: string, b: string): number {
  // Sørensen–Dice on bigrams; robust to small OCR typos.
  const s1 = compactLetters(a);
  const s2 = compactLetters(b);
  if (s1.length < 2 || s2.length < 2) return 0;
  const bigrams = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
    return out;
  };
  const b1 = bigrams(s1);
  const b2 = bigrams(s2);
  const counts = new Map<string, number>();
  for (const g of b1) counts.set(g, (counts.get(g) ?? 0) + 1);
  let intersection = 0;
  for (const g of b2) {
    const c = counts.get(g) ?? 0;
    if (c <= 0) continue;
    intersection += 1;
    counts.set(g, c - 1);
  }
  return (2 * intersection) / (b1.length + b2.length);
}

function looksGarbled(normText: string): boolean {
  const s = normText.replace(/\s+/g, " ").trim();
  if (!s) return true;
  const alpha = alphaRatio(s);
  if (alpha < 0.45) return true;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const longWeird = words.some((w) => w.length >= 16 && !/[aeiou]/i.test(w));
  if (longWeird) return true;
  const singleCharWords = words.filter((w) => w.length === 1).length;
  if (singleCharWords >= Math.ceil(words.length * 0.6)) return true;
  // Extremely low vowel density is a strong OCR-garble signal.
  const letters = (s.match(/[a-z]/g) ?? []).length;
  const vowels = (s.match(/[aeiou]/g) ?? []).length;
  if (letters >= 10 && vowels / Math.max(1, letters) < 0.18) return true;
  return false;
}

function looksMixedCaseNoVowelToken(rawWord: string): boolean {
  const w = String(rawWord ?? "").replace(/[^A-Za-z]/g, "");
  if (w.length < 4) return false;
  const hasLower = /[a-z]/.test(w);
  const hasUpper = /[A-Z]/.test(w);
  if (!(hasLower && hasUpper)) return false;
  if (/[aeiou]/i.test(w)) return false;
  return true;
}

function countCaseTransitions(rawWord: string): number {
  const w = String(rawWord ?? "").replace(/[^A-Za-z]/g, "");
  if (w.length < 2) return 0;
  let transitions = 0;
  let prevUpper: boolean | null = null;
  for (const ch of w) {
    const isUpper = ch >= "A" && ch <= "Z";
    if (prevUpper !== null && isUpper !== prevUpper) transitions += 1;
    prevUpper = isUpper;
  }
  return transitions;
}

function maxConsonantRun(rawWord: string): number {
  const w = String(rawWord ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!w) return 0;
  const vowels = new Set(["a", "e", "i", "o", "u", "y"]);
  let run = 0;
  let best = 0;
  for (const ch of w) {
    if (vowels.has(ch)) {
      run = 0;
      continue;
    }
    run += 1;
    if (run > best) best = run;
  }
  return best;
}

function looksRandomMixedCaseToken(rawWord: string): boolean {
  const w = String(rawWord ?? "").replace(/[^A-Za-z]/g, "");
  if (w.length < 5) return false;
  const hasLower = /[a-z]/.test(w);
  const hasUpper = /[A-Z]/.test(w);
  if (!(hasLower && hasUpper)) return false;

  // OCR often produces a leading TitleCase pair followed by ALL CAPS (e.g. "PoSOP", "WeBMAX").
  // This is almost never an intentional token in a slide title.
  if (/^[A-Z][a-z][A-Z]{2,}$/.test(w)) return true;

  // Allow normal CamelCase brand/style tokens (e.g. "ToxyScreen", "WebMax").
  if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(w)) return false;

  // Hyphenated Title Case like "Go-to-Market" is common and should not be treated as OCR noise.
  if (/[\-\u2013\u2014]/.test(String(rawWord ?? ""))) {
    const parts = String(rawWord)
      .split(/[\-\u2013\u2014]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (
      parts.length >= 2 &&
      parts.every((p) => {
        const letters = p.replace(/[^A-Za-z0-9]/g, "");
        if (!letters) return true;
        if (isAllCapsShortToken(letters) && isAllowedAcronym(letters)) return true;
        return /^[A-Z][a-z]+$/.test(letters);
      })
    ) {
      return false;
    }
  }

  // TitleCase/CamelCase tokens typically start with an initial cap-to-lower transition.
  // Treat that first transition as "normal" and only flag additional transitions.
  const transitions = countCaseTransitions(w);
  const adjusted = /^[A-Z][a-z]/.test(w) ? Math.max(0, transitions - 1) : transitions;
  return adjusted >= 2;
}

export function isLikelyGarbledSlideTitle(title: string | null | undefined): boolean {
  const raw = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  if (!raw) return true;
  if (looksLikeSlideIndexPlaceholder(raw)) return true;
  const norm = normalizePhrase(raw);
  return looksGarbledTitleCandidate(raw, norm);
}

function looksLikeSlideIndexPlaceholder(text: string): boolean {
  const raw = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!raw) return false;
  const norm = normalizePhrase(raw);
  // Common OCR variants: "Silde 6", "Sllde 6", etc.
  if (/^(slide|silde|sllde|sl1de)\s*\d{1,4}$/.test(norm)) return true;
  if (/^(slide|silde|sllde|sl1de)$/.test(norm)) return true;
  return false;
}

function repairSpacedLetterRuns(rawLine: string): string {
  const raw = typeof rawLine === "string" ? rawLine.replace(/\s+/g, " ").trim() : "";
  if (!raw) return "";
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return raw;

  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 0) {
      out.push(run.join(""));
      run = [];
    }
  };

  for (const tok of tokens) {
    const lettersOnly = tok.replace(/[^A-Za-z]/g, "");
    if (lettersOnly.length === 1) {
      run.push(lettersOnly);
      continue;
    }
    flush();
    out.push(tok);
  }
  flush();

  return out.join(" ").replace(/\s+/g, " ").trim();
}

function repairCommonOcrTypos(rawLine: string): string {
  const raw = typeof rawLine === "string" ? rawLine : "";
  if (!raw) return "";

  // Low-risk, high-frequency OCR confusions we’ve seen in pitch decks.
  // Keep this list small and conservative.
  let s = raw;

  // Example user report: "Susiness Mociel" → "Business Model".
  s = s.replace(/\bSusiness\b/gi, "Business");
  s = s.replace(/\bBusines\b/gi, "Business");
  s = s.replace(/\bMociel\b/gi, "Model");
  s = s.replace(/\bMocl?el\b/gi, "Model");

  return s;
}

function looksUnpronounceableToken(rawWord: string): boolean {
  const w = String(rawWord ?? "").replace(/[^A-Za-z]/g, "");
  if (w.length < 7) return false;
  // Long consonant runs are very rare in meaningful English headings, but common in OCR garbage.
  return maxConsonantRun(w) >= 5;
}

const ALLOWED_SHORT_ACRONYMS = new Set(
  [
    "ai",
    "api",
    "saas",
    "b2b",
    "b2c",
    "cac",
    "ltv",
    "tam",
    "sam",
    "som",
    "kpi",
    "kpis",
    "mrr",
    "arr",
    "cogs",
    "gmv",
    "gaap",
    "ebitda",
    "nps",
    "seo",
    "sem",
    "usa",
    "uk",
    "eu",
    "irr",
    "moic",
    "irf",
    "snf",
  ].map((s) => s.toLowerCase())
);

function isAllCapsShortToken(word: string): boolean {
  const w = String(word ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (w.length < 2 || w.length > 4) return false;
  const hasLetter = /[A-Za-z]/.test(w);
  if (!hasLetter) return false;
  return /^[A-Z0-9]+$/.test(w);
}

function isAllowedAcronym(word: string): boolean {
  const w = String(word ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (!w) return false;
  return ALLOWED_SHORT_ACRONYMS.has(w);
}

function extractHeadingPrefixFromRaw(rawText: string): string | null {
  const raw = String(rawText ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  // Only strip when the heading appears right at the start.
  for (const h of headingKeywords) {
    const parts = h
      .split(/\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (parts.length === 0) continue;
    const re = new RegExp(`^\\s*(${parts.join("[\\s\\-\\u2013\\u2014]+")})(?:\\b|\\s|$)`, "i");
    const m = raw.match(re);
    if (!m || !m[1]) continue;
    const prefix = String(m[1]).trim();
    if (prefix.length >= 3 && prefix.length <= 120) return prefix;
  }

  return null;
}

function looksGarbledTitleCandidate(rawText: string, normText: string): boolean {
  const raw = String(rawText ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const norm = String(normText ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw || !norm) return true;

  if (looksGarbled(norm)) return true;

  const rawNoSpace = raw.replace(/\s/g, "");
  if (!rawNoSpace) return true;
  const letters = (rawNoSpace.match(/[A-Za-z]/g) ?? []).length;
  const digits = (rawNoSpace.match(/[0-9]/g) ?? []).length;
  const other = Math.max(0, rawNoSpace.length - letters - digits);
  const otherRatio = other / rawNoSpace.length;
  const letterRatio = letters / rawNoSpace.length;

  // Symbol soup (common in graphic-heavy slides) should not be used as a title.
  if (rawNoSpace.length >= 10 && otherRatio >= 0.35) return true;
  // If there are hardly any letters, it's almost never a meaningful title.
  if (rawNoSpace.length >= 10 && letterRatio < 0.35) return true;
  // Long repeated runs are usually OCR noise.
  if (/(.)\1{6,}/.test(rawNoSpace)) return true;

  // Many 1-character tokens is usually broken OCR columnar output.
  const words = norm.split(/\s+/).filter(Boolean);
  const singleCharWords = words.filter((w) => w.length === 1).length;
  if (words.length >= 5 && singleCharWords >= Math.ceil(words.length * 0.6)) return true;

  // "Vowel soup" / OCR artifacts often produce titles that are mostly 1–2 letter tokens
  // (e.g. "a oe ia ee"). Allow short titles like "AI" or "IRF" by requiring enough tokens.
  if (words.length >= 5) {
    const shortWords = words.filter((w) => w.length <= 2).length;
    const hasLongWord = words.some((w) => w.length >= 4);
    if (!hasLongWord && shortWords >= Math.ceil(words.length * 0.7)) return true;

    // Longer junk strings with a single "accidental" longer token should still be treated as garbled.
    const longWordCount = words.filter((w) => w.length >= 4).length;
    if (words.length >= 10 && shortWords >= Math.ceil(words.length * 0.7) && longWordCount < 2) return true;
  }

  // If the entire title is 1–2 character tokens, it is almost always OCR junk.
  // (This intentionally allows a single short token like "IRF" or "AI".)
  if (words.length >= 4 && words.every((w) => w.length <= 2)) return true;

  // Mixed-case consonant-only tokens are a common failure mode on graphic-heavy pages
  // (e.g. "SlCr"), and should not become titles.
  const rawWords = raw.split(/\s+/).filter(Boolean);
  if (rawWords.some((w) => looksMixedCaseNoVowelToken(w))) return true;

  // Mixed-case tokens with many case transitions are usually OCR artifacts (e.g. "atewULe").
  if (rawWords.some((w) => looksRandomMixedCaseToken(w))) return true;

  // Detect unpronounceable "token soup" even when the string is alphabetic.
  // This catches headings like "PWN stele UW Wale Wale" that otherwise look "fine" by alpha-ratio alone.
  if (rawWords.length >= 3) {
    const weirdTokens = rawWords.filter((w) => looksUnpronounceableToken(w) || looksMixedCaseNoVowelToken(w) || looksRandomMixedCaseToken(w));
    if (weirdTokens.length >= Math.ceil(rawWords.length * 0.4)) return true;
  }

  // OCR often produces short ALL-CAPS fragments (e.g. "UW", "PWN") that look like acronyms but are not.
  // If a title is dominated by these, treat it as garbled.
  const shortCaps = rawWords.filter((w) => isAllCapsShortToken(w) && !isAllowedAcronym(w));
  const singleChar = rawWords.filter((w) => String(w).trim().length === 1);
  if (rawWords.length >= 4 && (shortCaps.length >= 2 || singleChar.length >= 1)) return true;
  if (rawWords.length === 2) {
    const [a, b] = rawWords;
    const aAllCaps = /^[A-Z0-9]+$/.test(a.replace(/[^A-Za-z0-9]/g, ""));
    const bAllCaps = /^[A-Z0-9]+$/.test(b.replace(/[^A-Za-z0-9]/g, ""));
    const bClean = b.replace(/[^A-Za-z0-9]/g, "");
    if (aAllCaps && bAllCaps && bClean.length <= 4 && !isAllowedAcronym(bClean)) return true;
  }

  return false;
}

function looksReasonableTitleCandidate(rawText: string, normText: string): boolean {
  const raw = String(rawText ?? "").replace(/\s+/g, " ").trim();
  const norm = String(normText ?? "").trim();
  if (!raw || !norm) return false;
  if (looksGarbledTitleCandidate(raw, norm)) return false;

  // Reject low-signal fragments that are likely body copy (e.g. "credit trends, signals, ...").
  if (/^[a-z]/.test(raw) && /,/.test(raw) && raw.length >= 18) return false;

  // Reject truncated headings that end on a dangling stopword (common OCR cut-off).
  // Example user reports: "Significant boost in".
  const lower = raw.toLowerCase();
  if (/\b(in|of|to|and|for|with|by|on|at)\s*$/.test(lower)) {
    const words = norm.split(/\s+/).filter(Boolean);
    if (words.length <= 6) return false;
  }

  // Strong filter for OCR noise that still contains letters.
  const rawNoSpace = raw.replace(/\s+/g, "");
  const letters = (rawNoSpace.match(/[A-Za-z]/g) ?? []).length;
  const alpha = letters / Math.max(1, rawNoSpace.length);
  if (rawNoSpace.length >= 10 && alpha < 0.6) return false;

  // Reject titles with lots of odd punctuation / box-drawing artifacts.
  const weirdChars = (raw.match(/[^a-zA-Z0-9\s\-\/:,.()&+%$]/g) ?? []).length;
  if (raw.length >= 12 && weirdChars >= Math.ceil(raw.length * 0.12)) return false;

  // Reject bracket-heavy or unbalanced bracket titles (common OCR artifacts like "POA) platform.").
  const openBr = (raw.match(/[([{]/g) ?? []).length;
  const closeBr = (raw.match(/[)\]}]/g) ?? []).length;
  if (openBr !== closeBr) return false;
  if (openBr > 0 && raw.length < 22) return false;

  // Reject punctuation-heavy titles even if they pass the weirdChars filter.
  const punctCount = raw.replace(/[A-Za-z0-9\s]/g, "").length;
  const punctRatio = raw.length > 0 ? punctCount / raw.length : 0;
  if (punctRatio > 0.28) return false;

  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const hasHeadingKeyword = headingKeywords.some((h) => norm.includes(normalizePhrase(h)));

  // Deck titles very rarely start with lowercase; treat short lowercase fragments as body copy.
  if (!hasHeadingKeyword && /^[a-z]/.test(raw) && words.length <= 3) return false;

  if (words.length > 12 && !hasHeadingKeyword) return false;

  const longWordCount = words.filter((w) => w.length >= 4).length;
  const rawIsAllCapsToken = /^[A-Z0-9]{3,}$/.test(rawNoSpace);
  if (!hasHeadingKeyword && longWordCount === 0 && !rawIsAllCapsToken) return false;

  return true;
}

function inferTitleFromFuzzyHeading(params: {
  lines: LineCandidate[];
}): { title: string; confidence: number; reason: string } | null {
  const candidates = params.lines
    .map((l) => ({ text: l.raw, norm: l.norm, bbox: l.bbox, lineIndex: l.lineIndex }))
    .filter((l) => l.norm.length >= 3 && l.norm.length <= 80)
    .filter((l) => !isUrlEmailPhone(l.norm) && !looksLikePageNumber(l.norm));

  if (candidates.length === 0) return null;

  // Fast path: detect common deck headings even when OCR drops/space-splits letters.
  // We only trust this near the top to avoid matching body-copy words.
  for (const l of candidates) {
    const isTop = l.bbox?.y != null ? l.bbox.y < 0.35 : l.lineIndex <= 6;
    if (!isTop) continue;
    const compact = String(l.text || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (!compact || compact.length < 4 || compact.length > 24) continue;

    // OCR for big headings is often correct but polluted with a few stray letters.
    // Allow matching on a stable suffix for common headings.
    const compactSuffix = compact.slice(-24);

    if (compact === "THEPIVOT" || compact === "PIVOT" || compactSuffix.endsWith("THEPIVOT") || compactSuffix.endsWith("PIVOT")) {
      return { title: "The Pivot", confidence: 0.78, reason: `compact_heading:${compact}` };
    }
    if (
      compact === "PRODUCTS" ||
      compact === "PRODUCT" ||
      compact === "DUCTS" ||
      compactSuffix.endsWith("PRODUCTS") ||
      (compactSuffix.endsWith("DUCTS") && compactSuffix.length <= 14)
    ) {
      const conf = compact === "DUCTS" || compactSuffix.endsWith("DUCTS") ? 0.72 : 0.78;
      return { title: "Products", confidence: conf, reason: `compact_heading:${compact}` };
    }
    if (
      compact === "SOLUTION" ||
      compact === "SOLUTIONS" ||
      compact === "LUTION" ||
      compactSuffix.endsWith("SOLUTION") ||
      compactSuffix.endsWith("SOLUTIONS") ||
      (compactSuffix.endsWith("LUTION") && compactSuffix.length <= 14)
    ) {
      const conf = compact === "LUTION" || compactSuffix.endsWith("LUTION") ? 0.72 : 0.78;
      return { title: "Solution", confidence: conf, reason: `compact_heading:${compact}` };
    }
  }

  // Canonical headings we are willing to emit as titles.
  const headings: Array<{ label: string; variants: string[] }> = [
    { label: "The Pivot", variants: ["the pivot", "pivot"] },
    { label: "Overview", variants: ["overview", "company overview"] },
    { label: "Problem", variants: ["problem", "market problem"] },
    { label: "Solution", variants: ["solution"] },
    { label: "Products", variants: ["products", "product", "how it works"] },
    { label: "Market", variants: ["market", "market opportunity"] },
    { label: "Traction", variants: ["traction"] },
    { label: "Business Model", variants: ["business model", "pricing"] },
    { label: "Go-to-Market", variants: ["go-to-market", "go to market", "distribution"] },
    { label: "Team", variants: ["team"] },
    { label: "Competition", variants: ["competition"] },
    { label: "Risks", variants: ["risks"] },
    { label: "Financials", variants: ["financials", "financial", "unit economics"] },
    { label: "Raise / Terms", variants: ["raise", "terms", "use of funds"] },
    { label: "Exit", variants: ["exit", "exit strategy", "acquirers"] },
    { label: "Key Considerations", variants: ["key considerations"] },
    { label: "Project Breakdown", variants: ["project breakdown"] },
    { label: "Development Summary", variants: ["development summary"] },
  ];

  let best: { label: string; score: number; raw: string; why: string } | null = null;
  for (const l of candidates) {
    const topBoost = l.bbox?.y != null ? clamp(0.12 - l.bbox.y * 0.25, 0, 0.12) : l.lineIndex <= 6 ? 0.06 : 0;
    for (const h of headings) {
      for (const v of h.variants) {
        const d = diceCoefficient(l.norm, v);
        const s = d + topBoost;
        if (!best || s > best.score) best = { label: h.label, score: s, raw: l.text, why: `dice(${v})=${d.toFixed(3)} topBoost=${topBoost.toFixed(3)}` };
      }
    }
  }

  if (!best) return null;

  // Require a reasonably strong match; avoids forcing a segment-title on random text.
  if (best.score < 0.78) return null;

  return { title: best.label, confidence: clamp(0.55 + (best.score - 0.78) * 1.2, 0.55, 0.82), reason: `fuzzy_heading:${best.why} raw=${best.raw.slice(0, 60)}` };
}

export function normalizePhrase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUrlEmailPhone(text: string): boolean {
  const s = text.trim().toLowerCase();
  const compact = s.replace(/[^a-z0-9]/g, "");
  if (/https?:\/\//.test(s)) return true;
  if (/www\./.test(s)) return true;
  if (/\bwww\b/.test(s) && /(com|io|ai|net|co)/.test(s)) return true;
  if (compact.startsWith("www") && /(com|io|ai|net|co)/.test(compact)) return true;
  if (/\S+@\S+\.\S+/.test(s)) return true;
  if (/tel:\d/.test(s)) return true;
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(s)) return true;
  return false;
}

function looksLikePageNumber(text: string): boolean {
  const s = text.trim().toLowerCase();
  return /^page\s*\d{1,4}$/.test(s) || /^\d{1,3}\s*\/\s*\d{1,3}$/.test(s);
}

function normalizeBlocks(blocks: OcrBlock[] | null | undefined, pageWidth?: number | null, pageHeight?: number | null): Array<{ raw: string; norm: string; bbox: NormBBox; level?: string; line_id?: string | number | null }> {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];

  const parsed = blocks
    .map((b) => {
      const rawText = typeof b.text === "string" ? b.text : typeof b.value === "string" ? b.value : "";
      if (!rawText || !rawText.trim()) return null;
      const box = (b.bbox ?? b.box ?? b.bounding_box ?? {}) as any;
      const pick = (v: any): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const x = pick(box.x ?? box.left ?? box.x0);
      const y = pick(box.y ?? box.top ?? box.y0);
      const w = pick(box.w ?? box.width);
      const h = pick(box.h ?? box.height);
      const x1 = pick(box.x1 ?? box.right);
      const y1 = pick(box.y1 ?? box.bottom);
      const resolvedW = w != null ? w : x != null && x1 != null ? Math.max(0, x1 - x) : null;
      const resolvedH = h != null ? h : y != null && y1 != null ? Math.max(0, y1 - y) : null;
      return {
        raw: rawText.trim(),
        norm: normalizePhrase(rawText),
        bbox: { x, y, w: resolvedW, h: resolvedH } as NormBBox,
        level: b.level,
        line_id: b.line_id,
      };
    })
    .filter(Boolean) as Array<{ raw: string; norm: string; bbox: NormBBox; level?: string; line_id?: string | number | null }>;

  const maxX = parsed.reduce((m, p) => {
    const x = p.bbox?.x ?? 0;
    const w = p.bbox?.w ?? 0;
    return Math.max(m, x + (w ?? 0));
  }, 0);
  const maxY = parsed.reduce((m, p) => {
    const y = p.bbox?.y ?? 0;
    const h = p.bbox?.h ?? 0;
    return Math.max(m, y + (h ?? 0));
  }, 0);

  const denomX = pageWidth && pageWidth > 0 ? pageWidth : maxX > 1.5 ? maxX : 1;
  const denomY = pageHeight && pageHeight > 0 ? pageHeight : maxY > 1.5 ? maxY : 1;

  return parsed.map((p) => {
    const nx = p.bbox?.x != null ? clamp(p.bbox.x / denomX, 0, 1) : null;
    const ny = p.bbox?.y != null ? clamp(p.bbox.y / denomY, 0, 1) : null;
    const nw = p.bbox?.w != null ? clamp((p.bbox.w ?? 0) / denomX, 0, 1) : null;
    const nh = p.bbox?.h != null ? clamp((p.bbox.h ?? 0) / denomY, 0, 1) : null;
    const bbox = nx == null || ny == null ? null : { x: nx, y: ny, w: nw ?? 0, h: nh ?? 0 };
    return { ...p, bbox };
  });
}

function groupLines(blocks: Array<{ raw: string; norm: string; bbox: NormBBox; level?: string; line_id?: string | number | null }>): LineCandidate[] {
  if (blocks.length === 0) return [];

  const lineBlocks = blocks.filter((b) => b.level === "line");
  if (lineBlocks.length > 0) {
    return lineBlocks
      .map((b, idx) => ({ raw: b.raw, norm: b.norm, bbox: b.bbox, lineIndex: idx }))
      .filter((l) => Boolean(l.norm));
  }

  const grouped = new Map<string, Array<typeof blocks[number]>>();
  for (const b of blocks) {
    const key = b.line_id != null ? String(b.line_id) : String(Math.round((b.bbox?.y ?? 0) / 0.02));
    const arr = grouped.get(key) ?? [];
    arr.push(b);
    grouped.set(key, arr);
  }

  const lines: LineCandidate[] = [];
  let idx = 0;
  for (const arr of grouped.values()) {
    const sorted = arr.slice().sort((a, b) => (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0));
    const rawLine = sorted.map((s) => s.raw).join(" ").trim();
    const repaired = repairCommonOcrTypos(repairSpacedLetterRuns(rawLine));
    const norm = normalizePhrase(repaired);
    if (!norm) continue;
    const xs = sorted.map((s) => s.bbox?.x ?? 0);
    const ys = sorted.map((s) => s.bbox?.y ?? 0);
    const ws = sorted.map((s) => (s.bbox?.x ?? 0) + (s.bbox?.w ?? 0));
    const hs = sorted.map((s) => s.bbox?.h ?? 0).filter((v) => Number.isFinite(v));
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...ws);
    const hAvg = hs.length > 0 ? hs.reduce((a, b) => a + b, 0) / hs.length : 0;
    lines.push({ raw: repaired || rawLine, norm, bbox: { x: minX, y: minY, w: Math.max(0, maxX - minX), h: hAvg }, lineIndex: idx++ });
  }

  return lines.sort((a, b) => (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0));
}

function extractLines(page: PageInput): LineCandidate[] {
  const normalizedBlocks = normalizeBlocks(page.ocr_blocks ?? null, page.page_width, page.page_height);
  const lineFromBlocks = groupLines(normalizedBlocks);
  if (lineFromBlocks.length > 0) return lineFromBlocks;

  const lines: LineCandidate[] = [];
  if (typeof page.ocr_text === "string") {
    let idx = 0;
    for (const rawLine of page.ocr_text.split(/\r?\n/)) {
      const repaired = repairCommonOcrTypos(repairSpacedLetterRuns(rawLine));
      const norm = normalizePhrase(repaired);
      if (!norm) continue;
      lines.push({ raw: (repaired || rawLine).trim(), norm, bbox: null, lineIndex: idx++ });
    }
  }
  return lines;
}

function alphaRatio(text: string): number {
  const letters = (text.match(/[a-z]/gi) || []).length;
  return letters / Math.max(1, text.length);
}

function isMostlyNumeric(text: string): boolean {
  const digits = (text.match(/\d/g) || []).length;
  return digits / Math.max(1, text.length) > 0.5;
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean));
}

function findBrandTokenFromText(text: string): string | null {
  if (!text) return null;
  // Prefer brand-like tokens that contain digits (e.g., 3ICE, 1Password).
  const digitToken = text.match(/\b[A-Za-z]*\d+[A-Za-z\d]{1,}\b/);
  if (digitToken && digitToken[0]) return digitToken[0];

  // Fall back to short-ish ALLCAPS-ish tokens (e.g., ACME, DDAI).
  const capsToken = text.match(/\b[A-Z]{3,10}\b/);
  if (capsToken && capsToken[0]) return capsToken[0];

  return null;
}

function extractBodyCopyFromOcrText(text: string | null | undefined): string {
  if (typeof text !== "string") return "";
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Many OCR pipelines use "»" or similar as a bullet delimiter.
  // If present, treat everything after the first bullet as primary body copy.
  const parts = t.split(/\s*[»›>•]\s*/g).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(1).join(" ");
  return t;
}

function stripBrandFromLine(params: { rawLine: string; brandToken: string | null; docBlacklist?: Set<string> | null }): string | null {
  const raw = typeof params.rawLine === "string" ? params.rawLine : "";
  const brandToken = typeof params.brandToken === "string" && params.brandToken.trim() ? params.brandToken.trim() : null;
  const docBlacklist = params.docBlacklist ?? null;
  if (!raw.trim()) return null;

  // Remove URLs/emails which often appear in top lines.
  let s = raw.replace(/\bhttps?:\/\/\S+\b/gi, " ").replace(/\b\S+@\S+\b/gi, " ");

  if (brandToken) {
    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escapeRegExp(brandToken)}\\b`, "gi");
    s = s.replace(re, " ");
  }

  // Trim stray separators.
  s = s.replace(/[|•·]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;

  const norm = normalizePhrase(s);
  if (!norm || norm.length < 3) return null;
  if (DEFAULT_BLACKLIST.has(norm)) return null;
  if (docBlacklist && docBlacklist.has(norm)) return null;
  if (isUrlEmailPhone(norm) || looksLikePageNumber(norm) || isMostlyNumeric(norm)) return null;

  return s.length > 180 ? s.slice(0, 180) : s;
}

function inferTitleFromBodyCopy(params: { ocr_text?: string | null; brandModel: BrandModel }): { title: string | null; reason: string | null } {
  const body = extractBodyCopyFromOcrText(params.ocr_text ?? null);
  if (!body) return { title: null, reason: null };

  const brandToken = findBrandTokenFromText(body) ?? findBrandTokenFromText(params.ocr_text ?? "");
  const brandNorm = normalizePhrase(brandToken);
  const bodyNorm = normalizePhrase(body);

  // Very common "Overview" signal in intro copy.
  const hasIsA = /\bis\s+a\b/i.test(body);
  const hasIntroVerb = /\b(we\s+are|we\s+have|our\s+|mission|vision)\b/i.test(body);
  const hasBrand = Boolean(brandNorm) && bodyNorm.includes(brandNorm);

  if (hasBrand && (hasIsA || hasIntroVerb)) {
    return { title: `${brandToken} Overview`, reason: "body_copy_brand_is_a" };
  }

  if (hasIsA && brandToken) {
    return { title: `${brandToken} Overview`, reason: "body_copy_is_a" };
  }

  // If body strongly indicates a general overview but we can't reliably identify brand.
  if (/\boverview\b/i.test(body) || /\bintroduction\b/i.test(body)) {
    return { title: "Overview", reason: "body_copy_overview" };
  }

  return { title: null, reason: null };
}

function overlapRatio(text: string, phrases: Set<string>): number {
  const tokens = Array.from(tokenSet(text));
  if (tokens.length === 0) return 0;
  let best = 0;
  for (const phrase of phrases) {
    const phraseTokens = tokenSet(phrase);
    const inter = tokens.filter((t) => phraseTokens.has(t)).length;
    if (phraseTokens.size === 0) continue;
    const ratio = inter / phraseTokens.size;
    if (ratio > best) best = ratio;
  }
  return best;
}

function inBrandRegion(bbox: NormBBox, regions: BrandRegion[]): boolean {
  if (!bbox) return false;
  const cx = bbox.x + (bbox.w ?? 0) / 2;
  const cy = bbox.y + (bbox.h ?? 0) / 2;
  for (const r of regions) {
    const dx = r.rx > 0 ? (cx - r.cx) / r.rx : 0;
    const dy = r.ry > 0 ? (cy - r.cy) / r.ry : 0;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

export function buildBrandModel(pages: PageInput[]): BrandModel {
  if (!Array.isArray(pages) || pages.length === 0) return { phrases: new Set(DEFAULT_BLACKLIST), regions: [] };

  const phraseCounts = new Map<string, number>();
  const positions = new Map<string, Array<{ cx: number; cy: number; w: number; h: number }>>();

  pages.forEach((page) => {
    const lines = extractLines(page);
    const seen = new Set<string>();
    for (const line of lines) {
      const norm = normalizePhrase(line.norm);
      if (!norm || norm.length < 3 || norm.length > 120) continue;
      if (isUrlEmailPhone(norm) || looksLikePageNumber(norm)) continue;
      if (looksLikeSlideIndexPlaceholder(norm)) continue;
      const isTop = line.bbox?.y != null ? line.bbox.y <= 0.5 : line.lineIndex <= 8;
      if (!isTop) continue;
      seen.add(norm);
      if (line.bbox) {
        const cx = line.bbox.x + (line.bbox.w ?? 0) * 0.5;
        const cy = line.bbox.y + (line.bbox.h ?? 0) * 0.5;
        const arr = positions.get(norm) ?? [];
        arr.push({ cx, cy, w: line.bbox.w ?? 0, h: line.bbox.h ?? 0 });
        positions.set(norm, arr);
      }
    }
    for (const n of seen) phraseCounts.set(n, (phraseCounts.get(n) ?? 0) + 1);
  });

  const pageCount = pages.length;
  const threshold = Math.max(2, Math.min(Math.ceil(pageCount * 0.35), 4));

  const phrases = new Set<string>(DEFAULT_BLACKLIST);
  const regions: BrandRegion[] = [];

  for (const [phrase, count] of phraseCounts.entries()) {
    if (count >= threshold) {
      phrases.add(phrase);
      const pts = positions.get(phrase) ?? [];
      if (pts.length >= 2) {
        const meanCx = pts.reduce((s, p) => s + p.cx, 0) / pts.length;
        const meanCy = pts.reduce((s, p) => s + p.cy, 0) / pts.length;
        const meanW = pts.reduce((s, p) => s + p.w, 0) / pts.length;
        const meanH = pts.reduce((s, p) => s + p.h, 0) / pts.length;
        const varCx = pts.reduce((s, p) => s + Math.pow(p.cx - meanCx, 2), 0) / pts.length;
        const varCy = pts.reduce((s, p) => s + Math.pow(p.cy - meanCy, 2), 0) / pts.length;
        const stdCx = Math.sqrt(varCx);
        const stdCy = Math.sqrt(varCy);
        if (stdCx <= 0.08 && stdCy <= 0.08) {
          regions.push({ cx: meanCx, cy: meanCy, rx: Math.min(0.3, Math.max(0.05, stdCx * 3 + meanW * 0.5)), ry: Math.min(0.3, Math.max(0.05, stdCy * 3 + meanH * 0.5)) });
        }
      }
    }
  }

  return { phrases, regions };
}

function scoreCandidate(line: LineCandidate, brandModel: BrandModel): SlideCandidateScore {
  const heading = headingKeywords.find((h) => line.norm.includes(h)) ?? null;
  const sizeScore = line.bbox?.h != null ? clamp((line.bbox.h ?? 0) * 8, 0, 2) : 0.3;
  const widthScore = line.bbox?.w != null ? clamp((line.bbox.w ?? 0) * 2, 0, 1.2) : 0.2;
  const topScore = line.bbox?.y != null ? clamp(0.7 - line.bbox.y * 1.4, 0, 0.7) : line.lineIndex === 0 ? 0.4 : 0;
  const centerBias = line.bbox?.x != null && line.bbox?.w != null ? clamp(0.3 - Math.abs(line.bbox.x + (line.bbox.w ?? 0) / 2 - 0.5), -0.1, 0.3) : 0;
  const headingBoost = heading ? 1.2 : 0;

  const containsBrandPhrase = (normText: string, phrases: Set<string>): boolean => {
    if (!normText) return false;
    for (const p of phrases) {
      if (!p || p.length < 6) continue;
      if (normText === p) return true;
      if (normText.includes(p)) return true;
      if (p.includes(normText) && normText.length >= 10) return true;
    }
    return false;
  };

  const brandContains = containsBrandPhrase(line.norm, brandModel.phrases);
  const brandOverlap = brandContains ? 1 : overlapRatio(line.norm, brandModel.phrases);
  const brandPenalty = brandOverlap >= 0.7 ? -2.4 : brandOverlap >= 0.5 ? -1.6 : brandOverlap >= 0.3 ? -0.8 : 0;
  const brandRegionHit = inBrandRegion(line.bbox, brandModel.regions);
  const regionPenalty = brandRegionHit ? -1.2 : 0;
  const alphaScore = alphaRatio(line.norm) < 0.3 ? -0.8 : 0;

  const score = sizeScore + widthScore + topScore + centerBias + headingBoost + brandPenalty + regionPenalty + alphaScore;

  const parts: string[] = [];
  if (heading) parts.push(`heading:${heading}`);
  if (sizeScore) parts.push(`size:${sizeScore.toFixed(2)}`);
  if (widthScore) parts.push(`width:${widthScore.toFixed(2)}`);
  if (topScore) parts.push(`top:${topScore.toFixed(2)}`);
  if (centerBias) parts.push(`center:${centerBias.toFixed(2)}`);
  if (brandPenalty) parts.push(`brand_penalty:${brandPenalty.toFixed(2)}`);
  if (regionPenalty) parts.push("brand_region");
  if (alphaScore < 0) parts.push("low_alpha");

  return { text: line.norm, rawText: line.raw, score, parts, bbox: line.bbox, lineIndex: line.lineIndex, heading, brandRegionHit, brandOverlap };
}

export function inferSlideTitleForSlide(input: SlideTitleInput): SlideTitleResult {
  const brandModel: BrandModel = input.brandModel ?? { phrases: new Set(DEFAULT_BLACKLIST), regions: [] };
  const hasLayoutBlocks = Array.isArray(input.blocks) && input.blocks.length > 0;
  const lines = extractLines({ ocr_blocks: input.blocks ?? null, ocr_text: input.ocr_text ?? null, page_width: input.page_width, page_height: input.page_height });

  const containsBrandPhrase = (normText: string, phrases: Set<string>): boolean => {
    if (!normText) return false;
    for (const p of phrases) {
      if (!p || p.length < 6) continue;
      if (normText === p) return true;
      if (normText.includes(p)) return true;
      if (p.includes(normText) && normText.length >= 10) return true;
    }
    return false;
  };

  const candidates: SlideCandidateScore[] = [];
  const altCandidates: SlideCandidateScore[] = [];
  for (const line of lines) {
    const len = line.norm.length;
    if (len < 3 || len > 120) continue;
    if (isUrlEmailPhone(line.norm) || looksLikePageNumber(line.norm)) continue;
    if (looksLikeSlideIndexPlaceholder(line.norm)) continue;
    if (isMostlyNumeric(line.norm)) continue;
    const alpha = alphaRatio(line.norm);
    if (alpha < 0.25) continue;
    const topPortion = line.bbox?.y != null ? line.bbox.y < 0.35 : line.lineIndex <= 6;
    const sc = scoreCandidate(line, brandModel);
    const isBrandPhrase = brandModel.phrases.has(line.norm) || containsBrandPhrase(line.norm, brandModel.phrases);
    if (topPortion && !isBrandPhrase) {
      candidates.push(sc);
    } else if (!isBrandPhrase) {
      altCandidates.push(sc);
    }
  }

  const byHeight = (arr: SlideCandidateScore[]) => arr.slice().sort((a, b) => (b.bbox?.h ?? 0) - (a.bbox?.h ?? 0));
  const tallest = byHeight([...candidates, ...altCandidates])[0];
  const tallestHeight = tallest?.bbox?.h ?? 0;

  const filtered = candidates.filter((c) => !(c.brandRegionHit && (c.bbox?.h ?? 0) < tallestHeight * 0.9));
  filtered.sort((a, b) => b.score - a.score || (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0));

  let pick = filtered[0] ?? null;
  if (!pick) {
    const nonBrandFallback = altCandidates.filter((c) => c.brandOverlap < 0.3 && !c.brandRegionHit && !brandModel.phrases.has(c.text));
    nonBrandFallback.sort((a, b) => (b.bbox?.h ?? 0) - (a.bbox?.h ?? 0) || b.score - a.score);
    pick = nonBrandFallback[0] ?? null;
  }

  if (!pick) {
    // System-wide fallback: attempt fuzzy detection of common pitch-deck headings.
    const fuzzy = inferTitleFromFuzzyHeading({ lines });
    if (fuzzy) {
      return {
        slide_title: fuzzy.title,
        slide_title_confidence: Number(fuzzy.confidence.toFixed(3)),
        slide_title_source: "heading_fuzzy_v1",
        slide_title_warnings: ["derived_from_fuzzy_heading"],
        ...(input.enableDebug
          ? {
              slide_title_debug: {
                candidates: [{ text: fuzzy.title, score: Number(fuzzy.confidence.toFixed(3)), reasons: [fuzzy.reason] }],
              },
            }
          : {}),
      };
    }

    // Last-resort fallback: if the top line looks like "BRAND + tagline", strip brand token and use remaining phrase.
    const topLine = lines[0]?.raw ?? "";
    const brandToken = findBrandTokenFromText(input.ocr_text ?? "") ?? findBrandTokenFromText(topLine);
    const stripped = stripBrandFromLine({ rawLine: topLine, brandToken, docBlacklist: brandModel.phrases });
    if (stripped) {
      return {
        slide_title: stripped,
        slide_title_confidence: 0.4,
        slide_title_source: "brand_fallback",
        slide_title_warnings: ["derived_from_brand_stripping"],
        ...(input.enableDebug
          ? {
              slide_title_debug: {
                candidates: [{ text: stripped, score: 0.4, reasons: ["brand_stripping_fallback", `brandToken=${brandToken ?? "none"}`] }],
              },
            }
          : {}),
      };
    }

    return { slide_title: null, slide_title_confidence: 0, slide_title_source: "none" };
  }

  // If the selected top-line title doesn't appear to include any recognizable heading
  // and body copy is available, try a body-copy contextual fallback.
  const pickedRaw = pick.rawText || pick.text;
  const pickedNorm = normalizePhrase(pickedRaw);
  const bodyFallback = inferTitleFromBodyCopy({ ocr_text: input.ocr_text ?? null, brandModel });
  const pickedHasHeading = Boolean(pick.heading);
  const pickedLooksLikeHeadingKeyword = headingKeywords.some((h) => pickedNorm.includes(normalizePhrase(h)));
  const pickedHasBrandToken = (() => {
    const brandToken = findBrandTokenFromText(input.ocr_text ?? "");
    const bn = normalizePhrase(brandToken);
    return Boolean(bn) && pickedNorm.includes(bn);
  })();

  const pickedGarbled = looksGarbledTitleCandidate(pickedRaw, pickedNorm);
  const pickedReasonable = looksReasonableTitleCandidate(pickedRaw, pickedNorm);
  const pickedBrandish = pickedHasBrandToken && !pickedHasHeading && !pickedLooksLikeHeadingKeyword;
  let pickedBad = pickedGarbled || !pickedReasonable || pickedBrandish;

  // If the OCR line contains a real heading at the start followed by garbled tokens,
  // emit only the heading prefix. This is common in PDFs where a small OCR artifact
  // gets co-located with the true heading.
  const headingPrefix = extractHeadingPrefixFromRaw(pickedRaw);
  if (headingPrefix) {
    const headingNorm = normalizePhrase(headingPrefix);
    const tailRaw = pickedRaw.slice(headingPrefix.length).trim();
    const tailNorm = normalizePhrase(tailRaw);
    const tailLooksGarbled = tailRaw.length >= 6 && looksGarbledTitleCandidate(tailRaw, tailNorm);
    const shouldStripToPrefix = pickedGarbled || tailLooksGarbled;

    if (shouldStripToPrefix && !looksGarbledTitleCandidate(headingPrefix, headingNorm)) {
      return {
        slide_title: headingPrefix,
        slide_title_confidence: Math.max(0.6, Math.min(0.85, Number((input.enableDebug ? 0.75 : 0.7).toFixed(3)))),
        slide_title_source: hasLayoutBlocks ? "ocr_layout_v1" : "ocr_fallback",
        slide_title_warnings: pickedGarbled ? ["picked_title_garbled", "derived_from_heading_prefix"] : ["derived_from_heading_prefix"],
        ...(input.enableDebug
          ? {
              slide_title_debug: {
                candidates: [{ text: headingPrefix, score: 0.72, reasons: ["heading_prefix_stripping"] }],
              },
            }
          : {}),
      };
    }
  }

  // If the chosen title looks garbled, prefer a high-confidence fuzzy heading title.
  // This tends to stabilize titles (and downstream segments) for common deck pages.
  const fuzzyHeading = inferTitleFromFuzzyHeading({ lines });
  if (fuzzyHeading && pickedBad) {
    return {
      slide_title: fuzzyHeading.title,
      slide_title_confidence: Number(fuzzyHeading.confidence.toFixed(3)),
      slide_title_source: "heading_fuzzy_v1",
      slide_title_warnings: [
        pickedGarbled ? "picked_title_garbled" : pickedBrandish ? "picked_title_brandish" : "picked_title_unreasonable",
        "derived_from_fuzzy_heading",
      ],
      ...(input.enableDebug
        ? {
            slide_title_debug: {
              candidates: [{ text: fuzzyHeading.title, score: Number(fuzzyHeading.confidence.toFixed(3)), reasons: [fuzzyHeading.reason] }],
            },
          }
        : {}),
    };
  }

  if (!pickedHasHeading && !pickedLooksLikeHeadingKeyword && !pickedHasBrandToken && bodyFallback.title) {
    const bodyNorm = normalizePhrase(bodyFallback.title);
    // Avoid promoting body copy if it also looks like OCR garbage.
    if (!looksGarbledTitleCandidate(bodyFallback.title, bodyNorm)) {
    return {
      slide_title: bodyFallback.title,
      slide_title_confidence: 0.55,
      slide_title_source: "ocr_fallback",
      slide_title_warnings: pickedBad ? [pickedGarbled ? "picked_title_garbled" : "picked_title_unreasonable", "derived_from_body_copy"] : ["derived_from_body_copy"],
      ...(input.enableDebug
        ? {
            slide_title_debug: {
              candidates: [{ text: bodyFallback.title, score: 0.55, reasons: ["body_copy_fallback", bodyFallback.reason ?? "unknown"] }],
            },
          }
        : {}),
    };
    }
  }

  // If we cannot find a non-garbled title, force callers to fall back to structured titles
  // or stable index-based titles (e.g. "Slide 12") instead of emitting OCR junk.
  if (pickedBad) {
    // Try the best non-garbled runner-up before giving up.
    const pool = [...filtered.slice(0, 6), ...altCandidates.slice(0, 6)];
    for (const c of pool) {
      const raw = c.rawText || c.text;
      if (!raw) continue;
      const prefix = extractHeadingPrefixFromRaw(raw);
      const candidateText = prefix ?? raw;
      const candidateNorm = normalizePhrase(candidateText);
      if (looksGarbledTitleCandidate(candidateText, candidateNorm)) continue;
      if (!looksReasonableTitleCandidate(candidateText, candidateNorm)) continue;
      return {
        slide_title: candidateText,
        slide_title_confidence: 0.55,
        slide_title_source: hasLayoutBlocks ? "ocr_layout_v1" : "ocr_fallback",
        slide_title_warnings: [pickedGarbled ? "picked_title_garbled" : "picked_title_unreasonable", "used_runner_up_candidate"],
        ...(input.enableDebug
          ? {
              slide_title_debug: {
                candidates: [{ text: candidateText, score: Number(c.score.toFixed(3)), reasons: [...c.parts, "runner_up_selected"] }],
              },
            }
          : {}),
      };
    }

    return {
      slide_title: null,
      slide_title_confidence: 0,
      slide_title_source: "none",
      slide_title_warnings: [pickedGarbled ? "picked_title_garbled" : "picked_title_unreasonable"],
      ...(input.enableDebug
        ? {
            slide_title_debug: {
              candidates: [{ text: pickedRaw, score: Number(pick.score.toFixed(3)), reasons: [...pick.parts, "suppressed_garbled_title"] }],
            },
          }
        : {}),
    };
  }

  const runner = filtered[1] ?? null;
  const margin = runner ? pick.score - runner.score : pick.score;
  const scoreScale = clamp(pick.score / 5, 0, 1);
  let confidence = clamp(0.35 + scoreScale * 0.45 + clamp(margin, 0, 2) * 0.1, 0, 1);
  if (pick.brandRegionHit) confidence = Math.min(confidence, 0.65);
  if (pick.brandOverlap > 0.4) confidence = Math.min(confidence, 0.55);

  const result: SlideTitleResult = {
    slide_title: pickedRaw,
    slide_title_confidence: Number(confidence.toFixed(3)),
    slide_title_source: hasLayoutBlocks ? "ocr_layout_v1" : "ocr_fallback",
  };

  if (input.enableDebug) {
    result.slide_title_debug = {
      candidates: [...filtered, ...altCandidates]
        .slice(0, 12)
        .map((c) => ({ text: c.rawText || c.text, score: Number(c.score.toFixed(3)), reasons: c.parts })),
    };
  }

  return result;
}

export function inferSlideTitleForDocument(pages: PageInput[]): { brandModel: BrandModel; titles: SlideTitleResult[] } {
  const brandModel = buildBrandModel(pages);
  const titles = pages.map((p) => inferSlideTitleForSlide({ blocks: p.ocr_blocks ?? null, ocr_text: p.ocr_text ?? null, page_height: p.page_height, page_width: p.page_width, brandModel }));
  return { brandModel, titles };
}

export function inferDocumentBrandName(pages: PageInput[]): { brand_name: string | null; confidence: number | null } {
  if (!Array.isArray(pages) || pages.length === 0) return { brand_name: null, confidence: null };
  const counts = new Map<string, number>();

  for (const page of pages) {
    const lines = extractLines(page);
    const topLines = lines.filter((l) => (l.bbox?.y != null ? l.bbox.y <= 0.25 : l.lineIndex <= 4));
    const pageSet = new Set<string>();
    for (const line of topLines) {
      if (!line.norm || line.norm.length < 3 || line.norm.length > 60) continue;
      if (isUrlEmailPhone(line.norm) || looksLikePageNumber(line.norm)) continue;
      if (DEFAULT_BLACKLIST.has(line.norm)) continue;
      pageSet.add(line.norm);
    }
    for (const n of pageSet) counts.set(n, (counts.get(n) ?? 0) + 1);
  }

  let best: { text: string; count: number } | null = null;
  const pagesCount = pages.length;
  const threshold = Math.max(2, Math.ceil(pagesCount * 0.35));
  for (const [text, count] of counts.entries()) {
    if (count < threshold) continue;
    if (!best || count > best.count) best = { text, count };
  }
  if (!best) return { brand_name: null, confidence: null };
  const confidence = clamp(0.5 + (best.count / pagesCount) * 0.45, 0, 0.95);
  return { brand_name: best.text, confidence: Number(confidence.toFixed(3)) };
}

// Backward compatibility exports
export function buildBrandBlacklistForDocument(pages: PageInput[]): Set<string> {
  return buildBrandModel(pages).phrases;
}

export const buildBrandBlacklist = buildBrandBlacklistForDocument;

export function inferSlideTitle(params: { ocr_blocks?: unknown; ocr_text?: string | null; page_index?: number | null; doc_brand_blacklist: Set<string>; brand_name?: string | null; enableDebug?: boolean }): SlideTitleResult {
  const brandModel: BrandModel = { phrases: new Set(params.doc_brand_blacklist ?? []), regions: [] };
  if (params.brand_name) brandModel.phrases.add(normalizePhrase(params.brand_name));
  return inferSlideTitleForSlide({ blocks: Array.isArray(params.ocr_blocks) ? (params.ocr_blocks as OcrBlock[]) : null, ocr_text: params.ocr_text ?? null, brandModel, enableDebug: params.enableDebug });
}
