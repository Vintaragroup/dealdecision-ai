import { assessTextQuality, sanitizeForDisplay, type SuppressReason, type TextQuality } from '../text-quality';

export type CanonicalFactKind =
  | 'one_liner'
  | 'product'
  | 'market_target'
  | 'market_context'
  | 'market'
  | 'business_model'
  | 'raise'
  | 'generic';

export type CanonicalFactMeta = {
  kind: CanonicalFactKind;
  rules_applied: string[];
  before: { quality: TextQuality; suppressed_reasons: SuppressReason[]; display_text: string | null };
  after: { quality: TextQuality; suppressed_reasons: SuppressReason[]; display_text: string | null };
};

export type CanonicalFactResult = {
  text: string;
  display_text: string | null;
  quality: TextQuality;
  suppressed_reasons: SuppressReason[];
  meta: CanonicalFactMeta;
};

const normalizeWhitespace = (s: string): string => String(s).replace(/\s+/g, ' ').trim();

function looksLikeDisclaimerOrBoilerplate(input: string): boolean {
  const s = normalizeWhitespace(String(input)).toLowerCase();
  if (!s) return false;

  if (s.includes('as an ai language model')) return true;
  if (/\bnot\s+(?:financial|legal)\s+advice\b/i.test(s)) return true;
  if (/\bfor\s+informational\s+purposes\s+only\b/i.test(s)) return true;
  if (/\bi\s+(?:am|'m)\s+not\s+(?:a\s+)?(?:lawyer|attorney|financial\s+advisor)\b/i.test(s)) return true;
  if (/\bi\s+cannot\s+(?:provide|offer|give)\s+(?:financial|legal)\s+advice\b/i.test(s)) return true;

  // Model-ish summary boilerplate that is almost never a valid product/market fact.
  if (s.startsWith('this is a company') && /\bsells\s+via\b/i.test(s)) return true;

  return false;
}

const COHERENCE_GATED_KINDS: ReadonlySet<CanonicalFactKind> = new Set(['market', 'market_target', 'market_context', 'product']);

const VERB_LIKE_TOKENS = new Set([
  'is',
  'are',
  'becomes',
  'targets',
  'captures',
  'powers',
  'enables',
  'provides',
  'helps',
  'serves',
  'sell',
  'buy',
]);

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'for',
  'of',
  'in',
  'on',
  'with',
  'by',
  'from',
  'at',
  'as',
]);

export type CoherenceAnalysis = {
  ok: boolean;
  sentence_like: boolean;
  reasons: string[];
  score: number;
  word_count: number;
  paren_count: number;
  digit_token_ratio: number;
  title_case_ratio: number;
  stopword_ratio: number;
  has_verb_like: boolean;
};

function tokenizeWordsLoose(input: string): string[] {
  return String(input)
    .replace(/\u2013|\u2014/g, '-')
    .replace(/[^\p{L}\p{N}%$€£]+/gu, ' ')
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
}

function countParentheticals(input: string): number {
  return (String(input).match(/\([^)]*\)/g) ?? []).length;
}

function digitTokenRatio(input: string): number {
  const toks = tokenizeWordsLoose(input);
  if (toks.length === 0) return 0;
  const num = toks.filter((t) => /\d/.test(t)).length;
  return num / toks.length;
}

function titleCaseRatio(input: string): number {
  const toks = tokenizeWordsLoose(input).filter((t) => /[a-zA-Z]/.test(t));
  if (toks.length === 0) return 0;
  const title = toks.filter((t) => /^[A-Z][a-z]+$/.test(t)).length;
  return title / toks.length;
}

function stopwordRatio(input: string): number {
  const toks = tokenizeWordsLoose(input).map((t) => t.toLowerCase());
  if (toks.length === 0) return 0;
  const hits = toks.filter((t) => STOPWORDS.has(t)).length;
  return hits / toks.length;
}

function hasVerbLikeToken(input: string): boolean {
  const toks = tokenizeWordsLoose(input).map((t) => t.toLowerCase());
  return toks.some((t) => VERB_LIKE_TOKENS.has(t));
}

function isHardFragmentStart(input: string): boolean {
  const s = normalizeWhitespace(input);
  if (!s) return false;
  if (/^[a-z]\s+[A-Z]/.test(s)) return true;
  if (/^(a|an|the)\s+[A-Z][a-z]+\s+(Every|Next|Today|Future)\b/i.test(s)) return true;
  return false;
}

export function analyzeSentenceCoherence(input: string): CoherenceAnalysis {
  const raw = normalizeWhitespace(input);
  const text = raw.replace(/^[^\p{L}\p{N}]+\s*/gu, '');
  const reasons: string[] = [];

  const toks = tokenizeWordsLoose(text);
  const wc = toks.length;
  const paren = countParentheticals(text);
  const digitRatio = digitTokenRatio(text);
  const titleRatio = titleCaseRatio(text);
  const stopRatio = stopwordRatio(text);
  const hasVerb = hasVerbLikeToken(text);
  const hasForTo = /\b(for|to)\b/i.test(text);
  const hasListConnector = /,/.test(text) || /\b(and|with)\b/i.test(text);

  if (!text) {
    reasons.push('empty');
    return {
      ok: false,
      sentence_like: false,
      reasons,
      score: -100,
      word_count: 0,
      paren_count: 0,
      digit_token_ratio: 0,
      title_case_ratio: 0,
      stopword_ratio: 0,
      has_verb_like: false,
    };
  }

  if (isHardFragmentStart(text)) reasons.push('fragment_start');
  if (paren >= 2 && digitRatio > 0.18) reasons.push('paren_and_numeric_dense');
  if (titleRatio >= 0.68 && stopRatio <= 0.08 && !hasVerb) reasons.push('heading_style');

  const hardReject = reasons.includes('fragment_start') || reasons.includes('paren_and_numeric_dense');
  if (hardReject) {
    return {
      ok: false,
      sentence_like: false,
      reasons,
      score: -20,
      word_count: wc,
      paren_count: paren,
      digit_token_ratio: digitRatio,
      title_case_ratio: titleRatio,
      stopword_ratio: stopRatio,
      has_verb_like: hasVerb,
    };
  }

  // Sentence-like: prefer a verb-like token; punctuation is not required because
  // canonical normalization will ensure terminal punctuation.
  const sentenceLike = hasVerb;

  // Clause-like: allow noun phrases if they look explanatory ("for/to"), have enough words,
  // and are not numeric/symbol soup.
  const hasLetters = /[a-zA-Z]/.test(text);
  const clauseLike =
    hasLetters &&
    wc >= 4 &&
    wc <= 26 &&
    (hasForTo || hasListConnector) &&
    digitRatio <= 0.4 &&
    !reasons.includes('heading_style');

  let score = 0;
  if (sentenceLike) score += 4;
  if (clauseLike) score += 2;
  if (hasForTo) score += 1;
  if (wc >= 8 && wc <= 24) score += 1;
  if (digitRatio < 0.2) score += 1;
  if (reasons.includes('heading_style')) score -= 3;

  const ok = sentenceLike || clauseLike;
  if (!ok) reasons.push('no_sentence_or_clause_signal');

  return {
    ok,
    sentence_like: sentenceLike,
    reasons,
    score,
    word_count: wc,
    paren_count: paren,
    digit_token_ratio: digitRatio,
    title_case_ratio: titleRatio,
    stopword_ratio: stopRatio,
    has_verb_like: hasVerb,
  };
}

function stripLeadingQuoteLike(input: string): { text: string; applied: boolean } {
  const s = String(input);
  const out = s.replace(/^(?:\s*["'“”‘’]+\s*)+/, '');
  return { text: out, applied: out !== s };
}

function splitIntoClauseCandidates(input: string): string[] {
  const s = normalizeWhitespace(String(input));
  if (!s) return [];

  // First split on strong separators.
  const first = s.split(/[;\u2013\u2014\|•\n]+/g).map((p) => normalizeWhitespace(p)).filter(Boolean);

  // Then split on periods that are not part of decimals.
  const out: string[] = [];
  for (const part of first) {
    const pieces = part
      .split(/(?<!\d)\.(?!\d)/g)
      .map((p) => normalizeWhitespace(p))
      .filter(Boolean);
    out.push(...pieces);
  }
  return out;
}

function scoreClauseCandidate(clause: string, kind: CanonicalFactKind): number {
  const text = normalizeWhitespace(clause);
  if (!text) return -100;
  const wc = tokenizeWordsLoose(text).length;
  const hasVerb = hasVerbLikeToken(text);
  const hasForTo = /\b(for|to)\b/i.test(text);
  const digitRatio = digitTokenRatio(text);
  const symbolHeavy = /[|{}\\[\\]<>]/.test(text) || /\b(?:€|\$|%)\b/.test(text);
  const startsArticle = /^(a|an|the)\b/i.test(text);
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length;

  let score = 0;
  if (hasVerb) score += 2;
  if (hasForTo) score += 2;
  if (!symbolHeavy && digitRatio < 0.25) score += 1;
  if (wc >= 8 && wc <= 24) score += 1;

  if (startsArticle && !hasVerb) score -= 3;

  const mostlyNumbers = letters < 4 && digitRatio >= 0.6;
  if (mostlyNumbers) score -= 3;

  // Kind-specific boosts: pick clauses that better match the canonical field.
  const t = text.toLowerCase();
  if (kind === 'market_target' || kind === 'market') {
    if (/\b(icp|target|customer|customers|segment|segments|persona|cohort)\b/.test(t)) score += 2;
    if (/\b\d{1,2}\s*[-–]\s*\d{1,2}\b/.test(text)) score += 2;
  }
  if (kind === 'market_context') {
    if (/\b(industry|category|tailwinds?|growth|market)\b/.test(t)) score += 1;
  }
  if (kind === 'product') {
    if (/\b(we\s+sell|product|platform|software|app|api|workflow)\b/.test(t)) score += 1;
  }

  return score;
}

export function extractBestClause(text: string, _kind: CanonicalFactKind): { clause: string | null; ruleApplied?: string } {
  const candidates = splitIntoClauseCandidates(text);
  let best: { clause: string; score: number } | null = null;

  for (const c0 of candidates) {
    let c = c0;
    c = stripLeadingBulletLike(c).text;
    c = stripLeadingQuoteLike(c).text;
    c = normalizeWhitespace(c);
    if (!c) continue;

    const score = scoreClauseCandidate(c, _kind);
    if (!best || score > best.score) best = { clause: c, score };
  }

  // Threshold: require at least a modest signal.
  if (!best || best.score < 2) return { clause: null };
  return { clause: best.clause, ruleApplied: 'extract_best_clause_from_source' };
}

function stripLeadingBulletLike(input: string): { text: string; applied: boolean } {
  const s = String(input);
  const out = s.replace(/^(?:\s*[•\-*\u2022]+\s*)+/, '');
  return { text: out, applied: out !== s };
}

function replaceHeavySeparators(input: string): { text: string; applied: boolean } {
  const s = String(input);
  // Pipes/bullet separators are a common OCR/title-dump artifact.
  // Convert to semicolon lists to reduce "title dump" heuristics while preserving meaning.
  const out = s
    .replace(/\s*\|\s*/g, '; ')
    .replace(/\s*•\s*/g, '; ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/(?:;\s*){2,}/g, '; ')
    .replace(/\s+;/g, ';')
    .replace(/;\s+([,.;!?])/g, '$1')
    .trim();
  return { text: out, applied: out !== s };
}

function collapseMidwordNewlines(input: string): { text: string; applied: boolean } {
  const before = typeof input === 'string' ? input : String(input ?? '');
  if (!before) return { text: before, applied: false };

  let text = before;

  // Actual newlines (OCR hard wraps).
  text = text.replace(/([A-Za-z])\-\r?\n([A-Za-z])/g, '$1$2');
  text = text.replace(/([A-Za-z])\r?\n([A-Za-z])/g, '$1$2');

  // Literal escape sequences like "payment\\ns".
  text = text.replace(/([A-Za-z])\-(?:\\r\\n|\\n)([A-Za-z])/g, '$1$2');
  text = text.replace(/([A-Za-z])(?:\\r\\n|\\n)([A-Za-z])/g, '$1$2');

  return { text, applied: text !== before };
}

function lightenMarketTargetSymbols(input: string): { text: string; applied: boolean } {
  const before = typeof input === 'string' ? input : String(input ?? '');
  if (!before) return { text: before, applied: false };

  let text = before;

  // Replace separator runs that commonly trigger symbol density suppressions.
  text = text.replace(/\|{2,}/g, ' ');
  text = text.replace(/\s*\|\s*/g, ' ');
  text = text.replace(/\|\s*a\s+/gi, ' ');
  text = text.replace(/_{2,}/g, ' ');
  text = text.replace(/\\+/g, ' ');

  // Token pass: drop standalone glyphs/punct tokens, but preserve numeric units.
  const rawTokens = text.split(/\s+/g).filter(Boolean);
  const out: string[] = [];

  const isPureSymbolToken = (tok: string): boolean => {
    // Keep any token with letters or digits.
    if (/[\p{L}\p{N}]/u.test(tok)) return false;
    // Keep currency-only tokens because we may merge them with a following number.
    if (/^(?:€|\$|£)$/.test(tok)) return false;
    // Keep percent-only tokens because we may merge them with a prior number.
    if (/^%$/.test(tok)) return false;
    return true;
  };

  const isNumberToken = (tok: string): boolean => /^\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(tok);
  const isUnitToken = (tok: string): boolean => /^(?:k|m|b|bn|mm|million|billion|thousand)$/i.test(tok);

  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i];
    const next = rawTokens[i + 1];

    // Merge "$" + "15.5B" => "$15.5B" (or "$" + "15.5" + "B" => "$15.5B").
    if (/^(?:€|\$|£)$/.test(tok) && next && isNumberToken(next)) {
      const unit = rawTokens[i + 2];
      if (unit && isUnitToken(unit)) {
        out.push(`${tok}${next}${unit}`);
        i += 2;
        continue;
      }
      out.push(`${tok}${next}`);
      i += 1;
      continue;
    }

    // Merge "10" + "%" => "10%".
    if (isNumberToken(tok) && next === '%') {
      out.push(`${tok}%`);
      i += 1;
      continue;
    }

    // Merge "15.5" + "B" => "15.5B".
    if (isNumberToken(tok) && next && isUnitToken(next)) {
      out.push(`${tok}${next}`);
      i += 1;
      continue;
    }

    // Drop standalone glyph tokens.
    if (isPureSymbolToken(tok)) continue;

    // Drop a small, explicit set of common standalone glyphs.
    if (/^(?:©|™|•|—|–|…)+$/.test(tok)) continue;

    out.push(tok);
  }

  const lightened = normalizeWhitespace(out.join(' '));

  // Safety: if we made it too short, revert (avoid meaning loss / false positives).
  const beforeWc = tokenizeWordsLoose(normalizeWhitespace(before)).length;
  const afterWc = tokenizeWordsLoose(lightened).length;
  if (afterWc < 8 && afterWc < beforeWc) return { text: before, applied: false };

  return { text: lightened, applied: lightened !== normalizeWhitespace(before) };
}

type ReconstructionResult = { text: string; appliedRule: string } | null;

function extractFirstNumericKpi(input: string): string | null {
  const s = String(input ?? '');
  if (!s) return null;

  // NOTE: Avoid using a leading word-boundary (\b) for currency symbols like "€" because it
  // will not match at the start of a string ("€" is not a word char). We instead use a
  // "safe start" boundary that works at string start or after non-word-ish characters.
  const SAFE_START = String.raw`(?:^|[^\p{L}\p{N}_])`;
  const SAFE_END = String.raw`(?=$|[^\p{L}\p{N}_])`;

  const patterns: RegExp[] = [
    new RegExp(
      `${SAFE_START}((?:€|\\$|£)\\s*\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*(?:B|M|K|bn|mm|billion|million|thousand)?)${SAFE_END}`,
      'iu'
    ),
    new RegExp(
      `${SAFE_START}(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*(?:B|M|K|bn|mm|billion|million|thousand))${SAFE_END}`,
      'iu'
    ),
    new RegExp(`${SAFE_START}(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%)${SAFE_END}`, 'iu'),
    /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/, // bare number (last resort)
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;

    // For SAFE_START/SAFE_END patterns we capture the KPI in group 1.
    const candidate = m[1] ?? m[0];
    if (candidate) return normalizeWhitespace(candidate);
  }
  return null;
}

function extractFirstPercentKpi(input: string): string | null {
  const s = String(input ?? '');
  if (!s) return null;
  const m = s.match(/(?:^|[^\p{L}\p{N}_])(\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*%)(?=$|[^\p{L}\p{N}_])/iu);
  return m?.[1] ? normalizeWhitespace(m[1]) : null;
}

function extractIcpCountPhrase(input: string): string | null {
  const s = normalizeWhitespace(String(input ?? ''));
  if (!s) return null;

  // Prefer explicit user/customer mentions.
  const m = s.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:B|M|K|bn|mm|billion|million|thousand)?\s*(?:users?|customers?|accounts?|households?|people)\b/i);
  if (m && m[0]) return normalizeWhitespace(m[0]);

  // Otherwise return a compact count-like number.
  // Do NOT treat currency or percent KPIs as "ICP count"; those should remain a TAM/metric.
  const kpi = extractFirstNumericKpi(s);
  if (!kpi) return null;
  if (/^(?:€|\$|£)/.test(kpi)) return null;
  if (/%$/.test(kpi)) return null;
  return kpi;
}

function extractIcpIndicator(input: string): string | null {
  const s = normalizeWhitespace(String(input ?? ''));
  if (!s) return null;
  const t = s.toLowerCase();

  const indicators: Array<{ re: RegExp; label: string }> = [
    { re: /\bgen\s*z\b/i, label: 'Gen Z' },
    { re: /\bmillennials?\b/i, label: 'millennials' },
    { re: /\bsmbs?\b/i, label: 'SMBs' },
    { re: /\benterprises?\b/i, label: 'enterprises' },
    { re: /\bprofessionals?\b/i, label: 'professionals' },
    { re: /\bhouseholds?\b/i, label: 'households' },
    { re: /\bstudents?\b/i, label: 'students' },
  ];

  for (const c of indicators) {
    if (c.re.test(t)) return c.label;
  }
  return null;
}

function extractMarketDescriptor(input: string): string | null {
  const s = normalizeWhitespace(String(input ?? ''));
  if (!s) return null;

  // Prefer explicit "X market" phrases.
  const candidates: string[] = [];
  const re = /\b([A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*){0,4})\s+market\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (!m[0]) continue;
    candidates.push(normalizeWhitespace(m[0].toLowerCase()));
  }

  const keywordBoost = (c: string): number => {
    let score = 0;
    if (/\bshared\b/.test(c)) score += 2;
    if (/\bpayment(s)?\b/.test(c)) score += 2;
    if (/\bspend\b/.test(c)) score += 1;
    if (/\bconsumer\b|\bb2b\b|\bb2c\b/.test(c)) score += 1;
    return score;
  };

  if (candidates.length) {
    candidates.sort((a, b) => keywordBoost(b) - keywordBoost(a) || b.length - a.length);
    let best = candidates[0];

    // Strip leading articles.
    best = best.replace(/^(?:a|an|the)\s+/i, '');

    // If the phrase contains a strong anchor keyword, keep the suffix starting at the anchor
    // to avoid leading headline fluff (e.g., "a powering every shared payment market").
    const anchors = ['shared', 'payments', 'payment', 'spend', 'consumer', 'enterprise', 'smb', 'smbs'];
    for (const a of anchors) {
      const reAnchor = new RegExp(`\\b${a}\\b`, 'i');
      if (!reAnchor.test(best)) continue;

      const parts = best.split(/\s+/g);
      const idx = parts.findIndex((p) => p.toLowerCase() === a);
      if (idx >= 0 && parts.length - idx >= 2) {
        best = parts.slice(idx).join(' ');
      }
      break;
    }

    best = normalizeWhitespace(best);
    return best || candidates[0];
  }

  // Fallback: if both tokens exist, construct "shared payment market" deterministically from existing words.
  const t = s.toLowerCase();
  if (/\bshared\b/.test(t) && /\bpayment(s)?\b/.test(t) && /\bmarket\b/.test(t)) {
    const paymentToken = /\bpayments\b/.test(t) ? 'payments' : 'payment';
    return `shared ${paymentToken} market`;
  }

  return null;
}

function deterministicReconstructV1(kind: CanonicalFactKind, input: string): ReconstructionResult {
  const s = normalizeWhitespace(String(input ?? ''));
  if (!s) return null;

  if (kind === 'market_target') {
    const marketDescriptor = extractMarketDescriptor(s);
    const icpCount = extractIcpCountPhrase(s);
    const icpIndicator = extractIcpIndicator(s);
    const tamOrMetric = extractFirstNumericKpi(s);
    const percentMetric = extractFirstPercentKpi(s);

    const components: Array<string | null> = [marketDescriptor, icpCount, icpIndicator, tamOrMetric];
    const found = components.filter(Boolean).length;
    if (found < 2) return null;

    const countPhrase = icpCount ? normalizeWhitespace(icpCount) : null;
    const marketPhrase = marketDescriptor ? normalizeWhitespace(marketDescriptor) : null;

    if (countPhrase && marketPhrase) {
      return { text: `The company targets approximately ${countPhrase} in the ${marketPhrase}.`, appliedRule: 'deterministic_reconstruction_v1' };
    }

    if (countPhrase && icpIndicator) {
      return { text: `The company targets approximately ${countPhrase} among ${icpIndicator}.`, appliedRule: 'deterministic_reconstruction_v1' };
    }

    if (marketPhrase && tamOrMetric) {
      const metric = normalizeWhitespace(tamOrMetric);
      const percent = percentMetric && percentMetric !== metric ? normalizeWhitespace(percentMetric) : null;
      const penetrationPhrase = percent && /\bpenetration\b/i.test(s) ? ` and ${percent} penetration` : percent ? ` and ${percent}` : '';
      return {
        text: `The company targets the ${marketPhrase}, representing approximately ${metric}${penetrationPhrase}.`,
        appliedRule: 'deterministic_reconstruction_v1',
      };
    }

    return null;
  }

  if (kind === 'product') {
    const t = s.toLowerCase();

    const categoryMatch = s.match(/\b([A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*){0,2})\s+(platform|app|api|software|tool|solution|marketplace|card|wallet)\b/i);
    const productCategory = categoryMatch?.[0] ? normalizeWhitespace(categoryMatch[0].toLowerCase()) : (/(platform|app|api|software|marketplace|card|wallet)\b/i.exec(s)?.[0]?.toLowerCase() ?? null);

    const monetizationMatch = s.match(/\b(subscription|saas|usage[- ]based|per\s+transaction(?:\s+fee)?|commission|take\s*rate|license|licensing|fee|fees)\b/i);
    const monetizationModel = monetizationMatch?.[0] ? normalizeWhitespace(monetizationMatch[0].toLowerCase()) : null;

    const feeSignal = extractFirstNumericKpi(s);

    const components: Array<string | null> = [productCategory, monetizationModel, feeSignal];
    const found = components.filter(Boolean).length;
    if (found < 2) return null;

    if (productCategory && monetizationModel) {
      return {
        text: `The product is a ${productCategory} monetized via ${monetizationModel}.`,
        appliedRule: 'deterministic_reconstruction_v1',
      };
    }

    // If we have a product category and a numeric fee signal, only reconstruct if the original text contains fee-like wording.
    if (productCategory && feeSignal && /\b(fee|fees|commission|take\s*rate)\b/.test(t)) {
      return {
        text: `The product is a ${productCategory} monetized via fees (e.g., ${normalizeWhitespace(feeSignal)}).`,
        appliedRule: 'deterministic_reconstruction_v1',
      };
    }

    return null;
  }

  if (kind === 'business_model') {
    const t = s.toLowerCase();
    const m = t.match(/\b(saas|marketplace|subscription|transaction\s+fees?|usage[- ]based|advertising|licens(?:e|ing))\b/);
    if (!m) return null;
    return { text: `The company operates via a ${m[0]} model.`, appliedRule: 'deterministic_reconstruction_v1' };
  }

  return null;
}

function stripKindLabelPrefix(kind: CanonicalFactKind, input: string): { text: string; applied: boolean } {
  const s = String(input).trim();
  if (!s) return { text: s, applied: false };

  const patterns: Array<{ kinds: CanonicalFactKind[]; re: RegExp }> = [
    { kinds: ['product'], re: /^(?:product|solution)\s*[:\-–—]\s*/i },
    // NOTE: preserve the explicit "Target market:" label (used by deterministic templates).
    { kinds: ['market'], re: /^(?:market\s*\/\s*icp|market|icp)\s*[:\-–—]\s*/i },
    { kinds: ['market_target'], re: /^(?:market\s*\/\s*icp|market|icp)\s*[:\-–—]\s*/i },
    { kinds: ['market_context'], re: /^(?:market\s+context|context|industry\s+context)\s*[:\-–—]\s*/i },
    { kinds: ['business_model'], re: /^(?:business\s+model|model)\s*[:\-–—]\s*/i },
    { kinds: ['raise'], re: /^(?:raise|raise\s*\/\s*terms|raise\s+terms|terms)\s*[:\-–—]\s*/i },
  ];

  for (const p of patterns) {
    if (!p.kinds.includes(kind)) continue;
    const out = s.replace(p.re, '');
    if (out !== s) return { text: out, applied: true };
  }

  return { text: s, applied: false };
}

function ensureTerminalPunctuation(input: string): { text: string; applied: boolean } {
  const s = normalizeWhitespace(input);
  if (!s) return { text: s, applied: false };
  if (/[.!?]$/.test(s)) return { text: s, applied: false };
  return { text: `${s}.`, applied: true };
}

function maybeAddKindPrefix(kind: CanonicalFactKind, assessed: { display: string | null; reasons: SuppressReason[] }, input: string): { text: string; applied: boolean } {
  const display = assessed.display;
  if (!display) return { text: input, applied: false };
  if (!assessed.reasons.includes('not_sentence_like')) return { text: display, applied: false };

  // If already labeled (or already a full "Sells/Serves/Context" sentence), don't add prefixes.
  if (/^(?:company|sells|serves|context|market\s+context|target\s+market|why\s+it\s+wins)\s*[:\-]/i.test(display)) {
    return { text: display, applied: false };
  }

  const prefix = (() => {
    if (kind === 'product') return 'Product: ';
    if (kind === 'market') return 'Market: ';
    if (kind === 'market_target') return 'Target market: ';
    if (kind === 'market_context') return 'Market context: ';
    if (kind === 'business_model') return 'Business model: ';
    if (kind === 'raise') return 'Raise terms: ';
    return '';
  })();

  if (!prefix) return { text: display, applied: false };
  return { text: `${prefix}${display}`, applied: true };
}

export function normalizeCanonicalFact(
  input: string,
  opts: { kind: CanonicalFactKind; maxLen?: number; sourceTexts?: string[] }
): CanonicalFactResult {
  const kind = opts.kind;
  const raw0 = typeof input === 'string' ? input : String(input ?? '');
  const rules: string[] = [];

  const rawCollapsed = collapseMidwordNewlines(raw0);
  if (rawCollapsed.applied) rules.push('collapse_midword_newlines');
  let raw = rawCollapsed.text;

  if (kind === 'market_target') {
    const lightened = lightenMarketTargetSymbols(raw);
    if (lightened.applied) rules.push('market_target_symbol_lighten_v1');
    raw = lightened.text;
  }

  const sanitized0 = sanitizeForDisplay(raw);

  if (looksLikeDisclaimerOrBoilerplate(sanitized0) && kind !== 'raise') {
    const beforeAssessed = assessTextQuality(sanitized0);
    const reasons: SuppressReason[] = Array.from(new Set<SuppressReason>([...beforeAssessed.reasons, 'boilerplate_marker']));
    return {
      text: '',
      display_text: null,
      quality: 'garbage',
      suppressed_reasons: reasons,
      meta: {
        kind,
        rules_applied: ['suppress_disclaimer_boilerplate_v1'],
        before: { quality: beforeAssessed.quality, suppressed_reasons: beforeAssessed.reasons, display_text: beforeAssessed.display },
        after: { quality: 'garbage', suppressed_reasons: reasons, display_text: null },
      },
    };
  }
  const beforeAssessed = assessTextQuality(sanitized0);

  // If the input is garbage under the project-wide rules, keep it suppressed —
  // except for raise terms, which are often numeric-dense but still human-readable.
  if (!beforeAssessed.display) {
    const disqualifying = beforeAssessed.reasons.some((r) => r === 'boilerplate_marker' || r === 'looks_like_footer' || r === 'looks_like_title_dump' || r === 'empty');
    if (kind !== 'raise' || disqualifying || !sanitized0) {
      return {
        text: '',
        display_text: null,
        quality: beforeAssessed.quality,
        suppressed_reasons: beforeAssessed.reasons,
        meta: {
          kind,
          rules_applied: [],
          before: { quality: beforeAssessed.quality, suppressed_reasons: beforeAssessed.reasons, display_text: null },
          after: { quality: beforeAssessed.quality, suppressed_reasons: beforeAssessed.reasons, display_text: null },
        },
      };
    }

    // Salvage path: add context words, normalize separators, then reassess.
    let working = sanitized0;
    rules.push('salvage_raise_terms');

    const strippedBullet = stripLeadingBulletLike(working);
    if (strippedBullet.applied) rules.push('strip_leading_bullets');
    working = strippedBullet.text;

    const strippedLabel = stripKindLabelPrefix(kind, working);
    if (strippedLabel.applied) rules.push('strip_kind_label');
    working = strippedLabel.text;

    const replacedSep = replaceHeavySeparators(working);
    if (replacedSep.applied) rules.push('replace_heavy_separators');
    working = replacedSep.text;

    working = `Raise terms: ${normalizeWhitespace(working)}`;
    rules.push('add_kind_prefix');

    const punct = ensureTerminalPunctuation(working);
    if (punct.applied) rules.push('ensure_terminal_punct');
    working = punct.text;

    const maxLen = typeof opts.maxLen === 'number' && Number.isFinite(opts.maxLen) ? Math.max(40, Math.floor(opts.maxLen)) : null;
    if (maxLen && working.length > maxLen) {
      const clipped = normalizeWhitespace(working.slice(0, Math.max(0, maxLen - 1))).replace(/[,;:\-–—\s]+$/, '');
      if (clipped.length >= 12) {
        working = `${clipped}…`;
        rules.push('truncate');
      }
    }

    const afterSanitized = sanitizeForDisplay(working);
    const afterAssessed = assessTextQuality(afterSanitized);
    const display = afterAssessed.display;
    return {
      text: display ?? '',
      display_text: display,
      quality: afterAssessed.quality,
      suppressed_reasons: afterAssessed.reasons,
      meta: {
        kind,
        rules_applied: rules,
        before: { quality: beforeAssessed.quality, suppressed_reasons: beforeAssessed.reasons, display_text: null },
        after: { quality: afterAssessed.quality, suppressed_reasons: afterAssessed.reasons, display_text: afterAssessed.display },
      },
    };
  }

  let working = beforeAssessed.display;

  const strippedBullet = stripLeadingBulletLike(working);
  if (strippedBullet.applied) rules.push('strip_leading_bullets');
  working = strippedBullet.text;

  const strippedLabel = stripKindLabelPrefix(kind, working);
  if (strippedLabel.applied) rules.push('strip_kind_label');
  working = strippedLabel.text;

  const replacedSep = replaceHeavySeparators(working);
  if (replacedSep.applied) rules.push('replace_heavy_separators');
  working = replacedSep.text;

  // Re-assess after structural cleanup.
  const midSanitized = sanitizeForDisplay(working);
  const midAssessed = assessTextQuality(midSanitized);
  working = midAssessed.display ?? midSanitized;

  const maybePrefixed = maybeAddKindPrefix(kind, midAssessed, working);
  if (maybePrefixed.applied) rules.push('add_kind_prefix');
  working = maybePrefixed.text;

  const punct = ensureTerminalPunctuation(working);
  if (punct.applied) rules.push('ensure_terminal_punct');
  working = punct.text;

  // Apply maxLen at the very end, to avoid breaking heuristics by truncating early.
  const maxLen = typeof opts.maxLen === 'number' && Number.isFinite(opts.maxLen) ? Math.max(40, Math.floor(opts.maxLen)) : null;
  if (maxLen && working.length > maxLen) {
    const clipped = normalizeWhitespace(working.slice(0, Math.max(0, maxLen - 1))).replace(/[,;:\-–—\s]+$/, '');
    if (clipped.length >= 12) {
      working = `${clipped}…`;
      rules.push('truncate');
    }
  }

  const afterSanitized = sanitizeForDisplay(working);
  const afterAssessed = assessTextQuality(afterSanitized);

  let finalDisplay = afterAssessed.display;
  let finalQuality: TextQuality = afterAssessed.quality;
  let finalReasons: SuppressReason[] = afterAssessed.reasons;

  // Coherence gate for canonical facts: avoid displaying clean-but-incoherent heading fragments.
  if (finalDisplay && COHERENCE_GATED_KINDS.has(kind)) {
    const coh = analyzeSentenceCoherence(finalDisplay);

    // Only allow "good" when sentence-like (has a verb-like signal).
    if (coh.ok && !coh.sentence_like && finalQuality === 'good') {
      finalQuality = 'ok';
      rules.push('coherence_gate_downgrade_good_to_ok');
    }

    if (!coh.ok) {
      // Attempt clause extraction using provided evidence texts (slide_title/snippet), falling back to the raw input.
      const sourceTexts = Array.isArray(opts.sourceTexts) ? opts.sourceTexts.filter((v): v is string => typeof v === 'string') : [];
      const candidates = [...sourceTexts, raw].filter(Boolean);

      let midwordAppliedInExtraction = false;

      let bestClause: string | null = null;
      for (const t0 of candidates) {
        const collapsed = collapseMidwordNewlines(t0);
        if (collapsed.applied) midwordAppliedInExtraction = true;
        const t = normalizeWhitespace(collapsed.text);

        const extracted = extractBestClause(t, kind);
        if (!extracted.clause) continue;
        bestClause = extracted.clause;
        if (midwordAppliedInExtraction && !rules.includes('collapse_midword_newlines')) rules.push('collapse_midword_newlines');
        rules.push('extract_best_clause_from_source');
        break;
      }

      if (bestClause) {
        // Finalize the extracted clause using the same normalization steps.
        let clauseWorking = sanitizeForDisplay(bestClause);

        const clauseStrippedBullet = stripLeadingBulletLike(clauseWorking);
        if (clauseStrippedBullet.applied) rules.push('strip_leading_bullets');
        clauseWorking = clauseStrippedBullet.text;

        const clauseStrippedLabel = stripKindLabelPrefix(kind, clauseWorking);
        if (clauseStrippedLabel.applied) rules.push('strip_kind_label');
        clauseWorking = clauseStrippedLabel.text;

        const clauseSep = replaceHeavySeparators(clauseWorking);
        if (clauseSep.applied) rules.push('replace_heavy_separators');
        clauseWorking = clauseSep.text;

        const clausePunct = ensureTerminalPunctuation(clauseWorking);
        if (clausePunct.applied) rules.push('ensure_terminal_punct');
        clauseWorking = clausePunct.text;

        if (maxLen && clauseWorking.length > maxLen) {
          const clipped = normalizeWhitespace(clauseWorking.slice(0, Math.max(0, maxLen - 1))).replace(/[,;:\-–—\s]+$/, '');
          if (clipped.length >= 12) {
            clauseWorking = `${clipped}…`;
            rules.push('truncate');
          }
        }

        const clauseAfterSanitized = sanitizeForDisplay(clauseWorking);
        const clauseAssessed = assessTextQuality(clauseAfterSanitized);

        if (clauseAssessed.display) {
          const coh2 = analyzeSentenceCoherence(clauseAssessed.display);
          if (coh2.ok) {
            finalDisplay = clauseAssessed.display;
            finalQuality = coh2.sentence_like ? clauseAssessed.quality : 'ok';
            finalReasons = clauseAssessed.reasons;
          }
        }
      }

      // Deterministic reconstruction fallback: if the clause extraction did not yield a coherent clause,
      // try to rebuild a minimal sentence from components (numeric KPI + market/product descriptor).
      // This does NOT weaken the coherence gate: reconstructed text must pass full quality + coherence.
      const cohAfterClause = finalDisplay ? analyzeSentenceCoherence(finalDisplay) : null;
      if (!cohAfterClause || !cohAfterClause.ok) {
        for (const t0 of candidates) {
          const collapsed = collapseMidwordNewlines(t0);
          if (collapsed.applied && !rules.includes('collapse_midword_newlines')) rules.push('collapse_midword_newlines');
          const t = normalizeWhitespace(collapsed.text);

          const reconstructed = deterministicReconstructV1(kind, t);
          if (!reconstructed) continue;

          rules.push(reconstructed.appliedRule);

          let reconWorking = sanitizeForDisplay(reconstructed.text);
          const reconPunct = ensureTerminalPunctuation(reconWorking);
          if (reconPunct.applied) rules.push('ensure_terminal_punct');
          reconWorking = reconPunct.text;

          if (maxLen && reconWorking.length > maxLen) {
            const clipped = normalizeWhitespace(reconWorking.slice(0, Math.max(0, maxLen - 1))).replace(/[,;:\-–—\s]+$/, '');
            if (clipped.length >= 12) {
              reconWorking = `${clipped}…`;
              rules.push('truncate');
            }
          }

          const reconAssessed = assessTextQuality(sanitizeForDisplay(reconWorking));
          if (!reconAssessed.display) continue;

          const cohRecon = analyzeSentenceCoherence(reconAssessed.display);
          if (!cohRecon.ok) continue;

          finalDisplay = reconAssessed.display;
          finalQuality = cohRecon.sentence_like ? reconAssessed.quality : 'ok';
          finalReasons = reconAssessed.reasons;
          break;
        }
      }

      // If we still don't have a coherent display clause, suppress with explicit reasons.
      const cohFinal = finalDisplay ? analyzeSentenceCoherence(finalDisplay) : null;
      if (!finalDisplay || !cohFinal || !cohFinal.ok) {
        finalDisplay = null;
        finalQuality = 'weak_linguistic';
        finalReasons = Array.from(
          new Set<SuppressReason>([...afterAssessed.reasons, 'not_coherent_sentence_like', 'no_coherent_clause_found'])
        );
      }
    }
  }

  const display = finalDisplay;
  return {
    text: display ?? '',
    display_text: display,
    quality: finalQuality,
    suppressed_reasons: finalReasons,
    meta: {
      kind,
      rules_applied: rules,
      before: { quality: beforeAssessed.quality, suppressed_reasons: beforeAssessed.reasons, display_text: beforeAssessed.display },
      after: { quality: finalQuality, suppressed_reasons: finalReasons, display_text: display },
    },
  };
}
