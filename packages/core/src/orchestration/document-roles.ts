export type DocumentRoles = {
  primary_pitch_deck_doc_id: string | null;
  financials_doc_id: string | null;
  supporting_doc_ids: string[];
};

export type RoleSelectionOptions = {
  pitchDeckIdealPages?: number; // defaults to 14
};

function stableDocId(doc: any, index: number): string {
  const fromDoc =
    (typeof doc?.document_id === "string" && doc.document_id) ||
    (typeof doc?.id === "string" && doc.id);
  if (fromDoc) return fromDoc;
  return `idx_${index}`;
}

function str(doc: any, ...keys: string[]): string {
  for (const key of keys) {
    const v = doc?.[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function lower(s: string): string {
  return s.toLowerCase();
}

function extFromName(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function isExcel(doc: any): boolean {
  const ct = lower(str(doc, "contentType", "content_type"));
  const name = lower(str(doc, "filename", "fileName", "title", "name"));
  const ext = extFromName(name);
  return (
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    ext === "xls" ||
    ext === "xlsx" ||
    ext === "csv"
  );
}

function isPdf(doc: any): boolean {
  const ct = lower(str(doc, "contentType", "content_type"));
  const name = lower(str(doc, "filename", "fileName", "title", "name"));
  const ext = extFromName(name);
  return ct.includes("pdf") || ext === "pdf";
}

function totalPages(doc: any): number {
  const raw = doc?.totalPages ?? doc?.page_count ?? doc?.pages;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function headings(doc: any): string[] {
  const h = doc?.mainHeadings ?? doc?.headings;
  return Array.isArray(h) ? h.filter((x) => typeof x === "string") : [];
}

function pitchDeckScore(doc: any, index: number, idealPages: number): number {
  const name = lower(str(doc, "filename", "fileName", "title", "name"));
  const h = headings(doc).map((x) => x.toLowerCase());
  const pages = totalPages(doc);

  let score = 0;

  if (isPdf(doc)) score += 50;

  // Strong pitch/deck filename signals
  if (name.includes("pitch")) score += 40;
  if (name.includes("deck")) score += 35;
  if (name.includes("presentation")) score += 10;

  // Content-y headings signals
  const joined = h.join(" ");
  if (joined.includes("problem")) score += 10;
  if (joined.includes("solution")) score += 10;
  if (joined.includes("traction")) score += 10;
  if (joined.includes("market")) score += 5;
  if (joined.includes("team")) score += 5;
  if (joined.includes("ask") || joined.includes("raising")) score += 5;

  // Penalize obvious non-primary/old variants
  const penalizeTokens = ["draft", "old", "archive", "backup", "notes", "edits"];
  for (const t of penalizeTokens) {
    if (name.includes(t)) score -= 15;
  }
  if (name.match(/\bv\d+\b/)) score -= 10;

  // Prefer page counts near typical deck size
  if (pages > 0) {
    score -= Math.abs(pages - idealPages) * 2;
  } else {
    score -= 10;
  }

  // Deterministic final tie-break bias by index (earlier wins)
  score -= index * 0.001;

  return score;
}

function financialsScore(doc: any, index: number): number {
  const name = lower(str(doc, "filename", "fileName", "title", "name"));
  const h = headings(doc).map((x) => x.toLowerCase());

  let score = 0;

  if (isExcel(doc)) score += 100;
  if (isPdf(doc)) score += 10;

  if (name.includes("financial")) score += 30;
  if (name.includes("model")) score += 20;
  if (name.includes("projection") || name.includes("forecast")) score += 10;

  const joined = h.join(" ");
  if (joined.includes("income") || joined.includes("p&l") || joined.includes("profit")) score += 10;
  if (joined.includes("balance") || joined.includes("cash")) score += 10;

  // Penalize things that look like deck/marketing
  if (name.includes("deck") || name.includes("pitch")) score -= 10;

  score -= index * 0.001;
  return score;
}

function pickBest(
  docs: any[],
  scorer: (doc: any, index: number) => number,
  predicate?: (doc: any) => boolean
): { doc: any; index: number } | null {
  let best: { doc: any; index: number; score: number } | null = null;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (predicate && !predicate(doc)) continue;
    const score = scorer(doc, i);
    if (!best || score > best.score) {
      best = { doc, index: i, score };
    }
  }

  return best ? { doc: best.doc, index: best.index } : null;
}

export function selectDocumentRoles(documents: any[], opts: RoleSelectionOptions = {}): DocumentRoles {
  const idealPages = typeof opts.pitchDeckIdealPages === "number" ? opts.pitchDeckIdealPages : 14;

  const primaryDeck = pickBest(
    documents,
    (d, i) => pitchDeckScore(d, i, idealPages),
    (d) => isPdf(d)
  );

  const financials = pickBest(
    documents,
    (d, i) => financialsScore(d, i),
    (d) => isExcel(d) || lower(str(d, "filename", "fileName", "title", "name")).includes("financial")
  );

  const primaryId = primaryDeck ? stableDocId(primaryDeck.doc, primaryDeck.index) : null;
  const financialId = financials ? stableDocId(financials.doc, financials.index) : null;

  const supporting: string[] = [];
  for (let i = 0; i < documents.length; i++) {
    const id = stableDocId(documents[i], i);
    if (primaryId && id === primaryId) continue;
    if (financialId && id === financialId) continue;
    supporting.push(id);
  }

  return {
    primary_pitch_deck_doc_id: primaryId,
    financials_doc_id: financialId,
    supporting_doc_ids: supporting,
  };
}

export function getStableDocumentId(doc: any, index: number): string {
  return stableDocId(doc, index);
}
