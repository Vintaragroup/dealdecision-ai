export function normalizeDealSummaryParagraphs(input: unknown, opts?: { maxParagraphs?: number }): string[] {
  const maxParagraphs = typeof opts?.maxParagraphs === 'number' && Number.isFinite(opts.maxParagraphs)
    ? Math.max(1, Math.floor(opts.maxParagraphs))
    : 6;

  const rawParas: string[] = [];

  if (Array.isArray(input)) {
    for (const v of input) {
      if (typeof v !== 'string') continue;
      rawParas.push(v);
    }
  } else if (typeof input === 'string') {
    rawParas.push(input);
  } else if (input && typeof input === 'object') {
    const text = (input as any).text;
    if (typeof text === 'string') rawParas.push(text);
  }

  const expanded: string[] = [];
  for (const raw of rawParas) {
    const normalized = String(raw)
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\n')
      .trim();

    if (!normalized) continue;

    const pieces = normalized.split(/\n{2,}/g);
    for (const p of pieces) {
      const s = String(p).replace(/\n+/g, ' ').trim();
      if (!s) continue;
      expanded.push(s);
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const keyOf = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[“”"'’]/g, '').trim();

  for (const p of expanded) {
    const key = keyOf(p);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= maxParagraphs) break;
  }

  return out;
}
