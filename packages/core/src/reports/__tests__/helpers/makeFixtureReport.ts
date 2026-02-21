import { compileDIOToReportWithPromotedFacts } from "../../compiler-simple";

type FixturePage = {
  document_id: string;
  page_index: number; // 0-based
  page: number; // 1-based
  text: string;
  source_path?: string; // default doc:{document_id}:page:{page}
};

type FixtureDocument = {
  document_id: string;
  kind?: string;
  mime_type?: string;
  filename?: string;
  metrics?: Array<{ key: string; value: unknown; unit?: string | null; page?: number | string; confidence?: number }>;
};

type Fixture = {
  pages: FixturePage[];
  documents?: FixtureDocument[];
};

const parseScaledUsdAmount = (text: string): number | null => {
  const s = String(text ?? "");
  const m = s.match(/\$\s*(\d+(?:[\d,]*\d)?(?:\.\d+)?)\s*([kKmMbB])?\b/);
  if (!m) return null;
  const base = Number(String(m[1]).replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = (m[2] ?? "").toLowerCase();
  const mult = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
  return Math.round(base * mult);
};

const inferPromotedFactTypeForPage = (pageText: string): string | null => {
  const t = pageText.toLowerCase();
  if (!t.trim()) return null;

  // Raise terms
  if (/\b(the\s+ask|raise|raising|fundraise|fundraising|safe|convertible)\b/i.test(t) && /\$/.test(t)) return "raise_terms_v1";

  // Market size
  if (
    /\b(tam|sam|som|market\s*(size|sizing)|total\s+addressable\s+market)\b/i.test(t) && /\$/.test(t)
  ) return "market_size_v1";
  // Common shorthand like "$8B market"
  if (/\$/.test(t) && /\bmarket\b/i.test(t)) return "market_size_v1";

  // Valuation
  if (/\bvaluation\b/i.test(t) && /\$/.test(t)) return "valuation_v1";

  // Revenue
  if (/\brevenue\b/i.test(t) && /\$/.test(t)) return "revenue_v1";
  // Recurring revenue shorthands
  if (/\b(arr|mrr)\b/i.test(t) && /\$/.test(t)) return "revenue_v1";

  // Bookings
  if (/\bbookings\b/i.test(t) && /\$/.test(t)) return "bookings_v1";

  return "note";
};

const inferRevenueSubtype = (pageText: string): "forecast" | "historical" => {
  const t = pageText.toLowerCase();
  return /\b(forecast|projection|projected|plan)\b/i.test(t) ? "forecast" : "historical";
};

const inferYear = (pageText: string): number | null => {
  const m = String(pageText ?? "").match(/\b(20\d{2})\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
};

const minimalDio = (now: string): any => ({
  schema_version: "1.0.0",
  dio_id: "00000000-0000-4000-8000-00000000f1xt",
  deal_id: "00000000-0000-4000-8000-00000000f1xt",
  created_at: now,
  updated_at: now,
  analysis_version: 1,
  dio_context: { primary_doc_type: "pitch_deck" },
  inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
  analyzer_results: {},
  dio: { phase1: {} },
});

export function makeFixture(fix: Fixture): {
  report: any;
  pageTextByRef: Map<string, string>; // key: `${document_id}:${page_index}`
} {
  const now = new Date().toISOString();

  const pageTextByRef = new Map<string, string>();
  for (const p of fix.pages) {
    pageTextByRef.set(`${p.document_id}:${p.page_index}`, p.text);
  }

  const promotedFacts: any[] = fix.pages.map((p) => {
    const fact_type = inferPromotedFactTypeForPage(p.text);
    const source_path = p.source_path ?? `doc:${p.document_id}:page:${p.page}`;

    const amount = parseScaledUsdAmount(p.text);
    const year = inferYear(p.text);

    const value_json: any = {
      display: p.text,
      raw_text: p.text,
    };

    if (amount != null) value_json.amount = { amount };

    if (fact_type === "raise_terms_v1") {
      if (/\bsafe\b/i.test(p.text)) value_json.instrument = "SAFE";
    }

    if (fact_type === "valuation_v1") {
      value_json.valuation_type = /\bpost\s*-?money\b/i.test(p.text) ? "post_money" : (/\bcap\b/i.test(p.text) ? "cap" : "unknown");
    }

    if (fact_type === "revenue_v1") {
      value_json.subtype = inferRevenueSubtype(p.text);
      value_json.scope = "company_total";
      if (year != null) value_json.year = year;
      value_json.raw = p.text;
    }

    return {
      fact_type,
      confidence: 0.9,
      extracted_at: now,
      source_path,
      source_document_id: p.document_id,
      content_json: {
        fact_type,
        value_json,
        text: p.text,
        raw: p.text,
        provenance: {
          source_document_id: p.document_id,
          page_index: p.page_index,
          page: p.page,
          source_path,
          slide_title: p.text,
        },
      },
      meta: { document_id: p.document_id, page_index: p.page_index },
    };
  });

  const dio = minimalDio(now);
  dio.inputs.documents = Array.isArray(fix.documents) ? fix.documents : [];
  const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts });
  return { report, pageTextByRef };
}

export function getPageText(pageTextByRef: Map<string, string>, src: any): string {
  const docId = String(src?.source_document_id ?? src?.document_id ?? src?.documentId ?? "");
  const pageIndex = (() => {
    if (typeof src?.page_index === "number") return src.page_index;
    if (typeof src?.pageIndex === "number") return src.pageIndex;
    const pageRaw = src?.page;
    const pageNum =
      typeof pageRaw === "number"
        ? pageRaw
        : (typeof pageRaw === "string" && pageRaw.trim() && Number.isFinite(Number(pageRaw)))
          ? Number(pageRaw)
          : null;
    if (typeof pageNum === "number" && Number.isFinite(pageNum)) return Math.max(0, Math.floor(pageNum) - 1);
    return null;
  })();
  if (!docId || pageIndex == null) return "";
  return pageTextByRef.get(`${docId}:${pageIndex}`) ?? "";
}

export function expectSourcePageToMatch(pageText: string, requiredRegex: RegExp): void {
  expect(String(pageText ?? "")).toMatch(requiredRegex);
}

export function expectSourcePageToNotMatch(pageText: string, forbiddenRegex: RegExp): void {
  expect(String(pageText ?? "")).not.toMatch(forbiddenRegex);
}
