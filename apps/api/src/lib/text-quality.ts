export type TextQuality = 'good' | 'ok' | 'garbage' | 'empty';

export type SuppressReason =
  | 'empty'
  | 'too_long'
  | 'too_many_symbols'
  | 'too_many_numbers'
  | 'boilerplate_marker'
  | 'looks_like_footer'
  | 'looks_like_title_dump'
  | 'not_sentence_like';

const normalizeWhitespace = (s: string): string => String(s).replace(/\s+/g, ' ').trim();

const normalizePunctuation = (s: string): string =>
  s
    .replace(/\u2013|\u2014/g, '-') // en/em dash
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/[\u2022]/g, '•')
    .replace(/\s*([,:;.!?])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();

const countMatches = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

function stripRepeatedFragments(input: string): string {
  // Remove obvious repeated footer fragments, e.g.
  // "Confidential Confidential" or "www.x.com | www.x.com".
  const s = normalizeWhitespace(input);
  if (!s) return '';

  // Collapse repeated tokens (case-insensitive) when the string is short-ish.
  const toks = s.split(' ').filter(Boolean);
  if (toks.length <= 30) {
    const out: string[] = [];
    let prev: string | null = null;
    for (const t of toks) {
      const k = t.toLowerCase();
      if (prev && k === prev) continue;
      out.push(t);
      prev = k;
    }
    return out.join(' ');
  }

  // Collapse repeated pipe-separated segments.
  const parts = s.split('|').map((p) => normalizeWhitespace(p)).filter(Boolean);
  if (parts.length >= 3) {
    const seen = new Set<string>();
    const uniq: string[] = [];
    for (const p of parts) {
      const k = p.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(p);
    }
    if (uniq.length < parts.length) return uniq.join(' | ');
  }

  return s;
}

export function sanitizeForDisplay(input: string): string {
  const raw = typeof input === 'string' ? input : String(input ?? '');
  if (!raw) return '';
  const s = normalizePunctuation(stripRepeatedFragments(raw));

  // De-OCR common artifacts.
  return s
    .replace(/\s*•\s*/g, ' • ')
    .replace(/\s*\|\s*/g, ' | ')
    // Undo punctuation spacing inside numeric groups (e.g. "800, 000" -> "800,000", "3. 2%" -> "3.2%")
    .replace(/(\d)\s*([,.])\s*(\d)/g, '$1$2$3')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function symbolRatio(input: string): number {
  const s = input;
  if (!s) return 0;
  let symbol = 0;
  let nonSpace = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    nonSpace += 1;
    if (/[a-zA-Z0-9]/.test(ch)) continue;
    symbol += 1;
  }
  return nonSpace > 0 ? symbol / nonSpace : 0;
}

function numericTokenRatio(input: string): number {
  // Note: `sanitizeForDisplay()` normalizes punctuation by inserting spaces after
  // punctuation characters. That can accidentally split numeric groups like
  // "$800,000" -> "$800, 000" or "3.2%" -> "3. 2%", inflating numeric-token
  // ratios and suppressing high-signal KPI bullets.
  //
  // Before tokenization, re-join punctuation that appears *between digits*.
  const s = String(input).replace(/(\d)\s*([,.])\s*(\d)/g, '$1$2$3');
  const toks = s.split(/\s+/g).filter(Boolean);
  if (toks.length === 0) return 0;
  const num = toks.filter((t) => /\d/.test(t)).length;
  return num / toks.length;
}

function hasLetters(input: string): boolean {
  return /[a-zA-Z]/.test(input);
}

function looksSentenceLike(input: string): boolean {
  const s = input;
  const t = s.toLowerCase();
  const hasVerb = /\b(is|are|was|were|has|have|had|builds|built|building|sell|sells|selling|provide|provides|enables|helps|allow|allows|offers|serves|targets|delivers)\b/.test(t);
  const hasPunct = /[.!?]/.test(s);
  const hasSpace = /\s/.test(s);

  // Short phrases are allowed without verbs.
  const len = s.length;
  if (len <= 48) return hasLetters(s) && hasSpace;

  return hasLetters(s) && hasSpace && (hasVerb || hasPunct);
}

const BOILERPLATE_MARKERS: RegExp[] = [
  /\bconfidential\b/i,
  /\ball\s+rights\s+reserved\b/i,
  /\bforward[-\s]?looking\b/i,
  /\bdo\s+not\s+distribute\b/i,
  /\bterms\s+and\s+conditions\b/i,
  /\bprivacy\s+policy\b/i,
  /\bwww\./i,
  /https?:\/\//i,
  /\bpage\s*\d+\b/i,
  /©/i,
  /\bvisa\s*\/\s*mastercard\b/i,
  /\b(mastercard|visa)\b/i,
];

function looksLikeFooterOrHeader(input: string): boolean {
  const s = input.toLowerCase();
  if (s.includes('confidential')) return true;
  if (s.includes('all rights reserved')) return true;
  if (s.includes('©')) return true;
  if (/\bpage\s*\d+\b/.test(s)) return true;
  if (/\bwww\./.test(s) || /https?:\/\//.test(s)) return true;
  return false;
}

function looksLikeTitleDump(input: string): boolean {
  const s = input;
  const pipes = countMatches(s, /\|/g);
  const bullets = countMatches(s, /•/g);
  const colons = countMatches(s, /:/g);
  if (pipes >= 6) return true;
  if (bullets >= 6) return true;
  if (colons >= 8) return true;

  // Many all-caps words is a common OCR title/header dump.
  const words = s.split(/\s+/g).filter(Boolean);
  if (words.length >= 10) {
    const caps = words.filter((w) => /^[A-Z0-9]{3,}$/.test(w)).length;
    if (caps / words.length >= 0.6) return true;
  }

  return false;
}

export function assessTextQuality(input: string): { quality: TextQuality; reasons: SuppressReason[]; display: string | null } {
  const display = sanitizeForDisplay(input);
  const reasons: SuppressReason[] = [];

  if (!display) {
    return { quality: 'empty', reasons: ['empty'], display: null };
  }

  const len = display.length;
  const sym = symbolRatio(display);
  const num = numericTokenRatio(display);

  // Some high-signal bullets include multiple numeric counts (customers/courses/retailers/etc).
  // Allow those while still rejecting numeric soup (tables / spreadsheets).
  const countPhraseHits = (display.match(/\b\d+(?:,\d{3})*(?:\.\d+)?\s*[a-zA-Z]{3,}\b/g) ?? []).length;
  const hasCountContextWord = /\b(serving|customers?|accounts?|users?|retailers?|courses?|locations?|stores?|shops?|clubs?)\b/i.test(display);
  const allowHigherNumericDensity = hasCountContextWord && countPhraseHits >= 2;

  const markerHit = BOILERPLATE_MARKERS.some((re) => re.test(display));
  if (markerHit) reasons.push('boilerplate_marker');
  if (looksLikeFooterOrHeader(display)) reasons.push('looks_like_footer');
  if (looksLikeTitleDump(display)) reasons.push('looks_like_title_dump');

  // Default thresholds are tuned for product/market display strings.
  if (len > 220) reasons.push('too_long');
  if (sym >= 0.24) reasons.push('too_many_symbols');
  if (num >= 0.35 && !allowHigherNumericDensity) reasons.push('too_many_numbers');

  if (!looksSentenceLike(display)) reasons.push('not_sentence_like');

  // Garbage if any of these triggers are present.
  const garbageTriggers: SuppressReason[] = [
    'empty',
    'too_long',
    'too_many_symbols',
    'too_many_numbers',
    'boilerplate_marker',
    'looks_like_footer',
    'looks_like_title_dump',
  ];

  const isGarbage = reasons.some((r) => garbageTriggers.includes(r));
  if (isGarbage) return { quality: 'garbage', reasons: Array.from(new Set(reasons)), display: null };

  // OK vs good: allow short phrases (no verb/punct) as OK.
  const quality: TextQuality = display.length < 70 && reasons.includes('not_sentence_like') ? 'ok' : 'good';

  // For good/ok, keep the sanitized display and keep reasons (for diagnostics).
  return { quality, reasons: Array.from(new Set(reasons)), display };
}
