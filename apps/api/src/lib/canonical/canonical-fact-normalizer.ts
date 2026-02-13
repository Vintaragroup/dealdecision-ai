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

export function normalizeCanonicalFact(input: string, opts: { kind: CanonicalFactKind; maxLen?: number }): CanonicalFactResult {
  const kind = opts.kind;
  const raw = typeof input === 'string' ? input : String(input ?? '');
  const rules: string[] = [];

  const sanitized0 = sanitizeForDisplay(raw);
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

  const display = afterAssessed.display;
  return {
    text: display ?? '',
    display_text: display,
    quality: afterAssessed.quality,
    suppressed_reasons: afterAssessed.reasons,
    meta: {
      kind,
      rules_applied: rules,
      before: { quality: beforeAssessed.quality, suppressed_reasons: beforeAssessed.reasons, display_text: beforeAssessed.display },
      after: { quality: afterAssessed.quality, suppressed_reasons: afterAssessed.reasons, display_text: afterAssessed.display },
    },
  };
}
