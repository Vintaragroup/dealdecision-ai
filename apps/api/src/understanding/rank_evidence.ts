import type { EvidenceSnippet, PageType, SourceSpan } from "./types";

const MAX_EVIDENCE = 7;

// Conservative currency detector: "$" followed by a digit, or "USD" followed by optional whitespace and a digit.
const CURRENCY_RE = /(?:\$\s*\d|\bUSD\b\s*\d)/i;
const PERCENT_RE = /\b\d+(?:\.\d+)?%/;
const YEAR_RE = /\b(?:19|20)\d{2}\b/;

const FINANCE_TERMS = [
  "revenue",
  "sales",
  "cogs",
  "gross",
  "margin",
  "ebitda",
  "net income",
  "operating",
  "cash flow",
  "balance sheet",
  "assets",
  "liabilities",
  "equity",
  "forecast",
  "budget",
];

const TERMS_TERMS = [
  "cap table",
  "capitalization",
  "preferred",
  "common",
  "option pool",
  "dilution",
  "valuation",
  "pre-money",
  "post-money",
  "safe",
  "note",
  "interest",
  "maturity",
  "liquidation preference",
];

const MARKET_TERMS = [
  "tam",
  "sam",
  "som",
  "market size",
  "competition",
  "competitor",
  "industry",
  "segments",
  "positioning",
];

const PRODUCT_TERMS = [
  "platform",
  "product",
  "features",
  "workflow",
  "integration",
  "api",
  "dashboard",
  "module",
  "screenshots",
];

type Candidate = {
  start: number;
  end: number;
};

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function trimSpan(text: string, span: Candidate): Candidate | null {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end <= start) return null;
  return { start, end };
}

function nonAlnumRatio(s: string): number {
  if (!s) return 0;
  let non = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!/[A-Za-z0-9\s]/.test(ch)) non++;
  }
  return non / s.length;
}

function containsAnyTerm(lower: string, terms: string[]): { hit: boolean; matched: string[] } {
  const matched: string[] = [];
  for (const t of terms) {
    // For multi-word phrases we just check substring; for single words, require word boundary.
    if (t.includes(" ")) {
      if (lower.includes(t)) matched.push(t);
    } else {
      const re = new RegExp(`\\b${escapeRegExp(t)}\\b`, "i");
      if (re.test(lower)) matched.push(t);
    }
  }
  matched.sort((a, b) => a.localeCompare(b));
  return { hit: matched.length > 0, matched };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsEntitiesHeuristic(snippet: string): boolean {
  if (/\b(Inc|LLC|Ltd|Corp)\b/.test(snippet)) return true;
  // Title Case multi-word: "Jane Doe", "Acme Capital".
  if (/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(snippet)) return true;
  return false;
}

function generateLineCandidates(text: string): Array<{ line: string; start: number; end: number }> {
  const out: Array<{ line: string; start: number; end: number }> = [];
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    const isBreak = i === text.length || text[i] === "\n";
    if (!isBreak) continue;
    const start = lineStart;
    const end = i;
    out.push({ line: text.slice(start, end), start, end });
    lineStart = i + 1;
  }
  return out;
}

function isBulletLine(line: string): boolean {
  const t = line.replace(/^\s+/, "");
  if (!t) return false;
  if (/^[•\-–*]\s+/.test(t)) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  return false;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return false;

  const numericTokens = tokens.filter((t) => /\d/.test(t)).length;
  if (numericTokens < 2) return false;

  // Prefer rows that look like columns.
  const digitChars = (trimmed.match(/\d/g) ?? []).length;
  const digitRatio = digitChars / trimmed.length;
  return digitRatio > 0.12;
}

function generateSentenceCandidates(text: string): Candidate[] {
  const spans: Candidate[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isNewline = ch === "\n";
    const isEndPunct = ch === "." || ch === "?" || ch === "!";
    if (!isNewline && !isEndPunct) continue;

    const end = i + 1;
    spans.push({ start, end });
    start = end;
  }
  if (start < text.length) {
    spans.push({ start, end: text.length });
  }
  return spans;
}

function scoreCandidate(snippet: string): { score: number; features: string[] } {
  const features: string[] = [];
  const lower = snippet.toLowerCase();
  let raw = 0;

  // Positive features
  if (CURRENCY_RE.test(snippet)) {
    raw += 0.25;
    features.push("contains_currency");
  }

  if (PERCENT_RE.test(snippet)) {
    raw += 0.15;
    features.push("contains_percent");
  }

  if (YEAR_RE.test(snippet)) {
    raw += 0.1;
    features.push("contains_year");
  }

  const fin = containsAnyTerm(lower, FINANCE_TERMS);
  if (fin.hit) {
    raw += 0.1;
    features.push("contains_finance_terms");
    for (const t of fin.matched.slice(0, 5)) features.push(`keyword:${t}`);
  }

  const terms = containsAnyTerm(lower, TERMS_TERMS);
  if (terms.hit) {
    raw += 0.1;
    features.push("contains_terms_terms");
    for (const t of terms.matched.slice(0, 5)) features.push(`keyword:${t}`);
  }

  const market = containsAnyTerm(lower, MARKET_TERMS);
  if (market.hit) {
    raw += 0.08;
    features.push("contains_market_terms");
    for (const t of market.matched.slice(0, 5)) features.push(`keyword:${t}`);
  }

  const product = containsAnyTerm(lower, PRODUCT_TERMS);
  if (product.hit) {
    raw += 0.06;
    features.push("contains_product_terms");
    for (const t of product.matched.slice(0, 5)) features.push(`keyword:${t}`);
  }

  if (containsEntitiesHeuristic(snippet)) {
    raw += 0.05;
    features.push("contains_entities");
  }

  // Penalties
  if (snippet.length < 25) {
    raw -= 0.25;
    features.push("too_short");
  }
  if (snippet.length > 300) {
    raw -= 0.1;
    features.push("too_long");
  }
  if (nonAlnumRatio(snippet) > 0.35) {
    raw -= 0.2;
    features.push("high_garble");
  }

  // Deterministic normalization to 0..1.
  const score = clamp01(raw);

  return { score, features };
}

export function rankEvidence(normalized_text: string, _page_type?: PageType): EvidenceSnippet[] {
  if (!normalized_text) return [];

  const candidates: Candidate[] = [];
  const lines = generateLineCandidates(normalized_text);

  // Bullet lines
  for (const { line, start, end } of lines) {
    if (!isBulletLine(line)) continue;
    const trimmed = trimSpan(normalized_text, { start, end });
    if (trimmed) candidates.push(trimmed);
  }

  // Table rows
  for (const { line, start, end } of lines) {
    if (!isTableRow(line)) continue;
    const trimmed = trimSpan(normalized_text, { start, end });
    if (trimmed) candidates.push(trimmed);
  }

  // Sentences (split on .?! and newlines)
  for (const span of generateSentenceCandidates(normalized_text)) {
    const trimmed = trimSpan(normalized_text, span);
    if (trimmed) candidates.push(trimmed);
  }

  // Dedupe by span (after trimming)
  const seen = new Set<string>();
  const scored: EvidenceSnippet[] = [];
  for (const c of candidates) {
    const key = `${c.start}:${c.end}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const snippet = normalized_text.slice(c.start, c.end);
    const { score, features } = scoreCandidate(snippet);
    const source_span: SourceSpan = { start: c.start, end: c.end };
    scored.push({ snippet, score, features, source_span });
  }

  scored.sort((a, b) => {
    const sd = b.score - a.score;
    if (sd !== 0) return sd;
    return a.snippet.localeCompare(b.snippet);
  });

  return scored.slice(0, MAX_EVIDENCE);
}
