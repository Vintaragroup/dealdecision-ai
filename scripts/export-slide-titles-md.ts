export {};

import fs from "node:fs";
import path from "node:path";

type DealRow = {
  id: string;
  name?: string | null;
  stage?: string | null;
  priority?: string | null;
};

type VisualAssetRow = {
  document_id?: string | null;
  document_title?: string | null;
  document_type?: string | null;
  page_index?: number | null;
  extractor_version?: string | null;
  quality_flags?: { source?: string | null } | null;

  slide_title?: string | null;
  slide_title_source?: string | null;
  slide_title_confidence?: number | null;
  slide_title_warnings?: string[] | null;

  ocr_text?: string | null;
};

type DealVisualAssetsResponse = {
  deal_id: string;
  visual_assets: VisualAssetRow[];
};

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function alphaRatio(s: string): number {
  const t = s.replace(/\s+/g, "");
  if (!t) return 0;
  const alpha = (t.match(/[a-zA-Z]/g) ?? []).length;
  return alpha / t.length;
}

function weirdCharRatio(s: string): number {
  if (!s) return 0;
  const weird = (s.match(/[^a-zA-Z0-9\s\-\/:,.()&+%$]/g) ?? []).length;
  return weird / Math.max(1, s.length);
}

function vowelDensity(s: string): number {
  const letters = (s.match(/[a-z]/gi) ?? []).length;
  const vowels = (s.match(/[aeiou]/gi) ?? []).length;
  return vowels / Math.max(1, letters);
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

  if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(w)) return false;

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

  const transitions = countCaseTransitions(w);
  const adjusted = /^[A-Z][a-z]/.test(w) ? Math.max(0, transitions - 1) : transitions;
  return adjusted >= 2;
}

function looksUnpronounceableToken(rawWord: string): boolean {
  const w = String(rawWord ?? "").replace(/[^A-Za-z]/g, "");
  if (w.length < 7) return false;
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

function looksNonLanguageTitle(title: string): { nonLanguage: boolean; reasons: string[] } {
  const raw = normalizeWhitespace(title);
  if (!raw) return { nonLanguage: true, reasons: ["empty"] };

  const reasons: string[] = [];
  const words = raw.split(/\s+/).filter(Boolean);

  const alpha = alphaRatio(raw);
  if (raw.length >= 10 && alpha < 0.6) reasons.push(`low_alpha:${alpha.toFixed(2)}`);

  const weird = weirdCharRatio(raw);
  if (raw.length >= 8 && weird >= 0.12) reasons.push(`weird_chars:${weird.toFixed(2)}`);

  const vd = vowelDensity(raw);
  if (raw.replace(/\s+/g, "").length >= 10 && vd < 0.18) reasons.push(`low_vowel_density:${vd.toFixed(2)}`);

  if (words.length >= 4 && words.every((w) => w.length <= 2)) reasons.push("all_short_tokens");

  const shortWords = words.filter((w) => w.length <= 2).length;
  const longWordCount = words.filter((w) => w.length >= 4).length;
  if (words.length >= 10 && shortWords >= Math.ceil(words.length * 0.7) && longWordCount < 2) reasons.push("token_soup");

  const rawWords = raw.split(/\s+/).filter(Boolean);
  if (rawWords.some((w) => looksMixedCaseNoVowelToken(w))) reasons.push("mixed_case_no_vowel_token");

  if (rawWords.some((w) => looksRandomMixedCaseToken(w))) reasons.push("random_mixed_case_token");

  if (rawWords.length >= 3) {
    const weirdCount = rawWords.filter((w) => looksUnpronounceableToken(w) || looksMixedCaseNoVowelToken(w) || looksRandomMixedCaseToken(w)).length;
    if (weirdCount >= Math.ceil(rawWords.length * 0.4)) reasons.push("unpronounceable_token_soup");
  }

  const shortCaps = rawWords.filter((w) => isAllCapsShortToken(w) && !isAllowedAcronym(w));
  const singleChar = rawWords.filter((w) => String(w).trim().length === 1);
  if (rawWords.length >= 4 && (shortCaps.length >= 2 || singleChar.length >= 1)) reasons.push("suspicious_caps_fragments");
  if (rawWords.length === 2) {
    const [a, b] = rawWords;
    const aAllCaps = /^[A-Z0-9]+$/.test(a.replace(/[^A-Za-z0-9]/g, ""));
    const bAllCaps = /^[A-Z0-9]+$/.test(b.replace(/[^A-Za-z0-9]/g, ""));
    const bClean = b.replace(/[^A-Za-z0-9]/g, "");
    if (aAllCaps && bAllCaps && bClean.length <= 4 && !isAllowedAcronym(bClean)) reasons.push("suspicious_two_word_caps");
  }

  // Detect common deterministic fallback titles so review can focus on them.
  if (/^slide\s+\d+$/i.test(raw)) reasons.push("index_fallback_title");

  return { nonLanguage: reasons.length > 0, reasons };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function runWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function mdCode(s: string): string {
  // Best-effort: avoid breaking fences.
  return s.replace(/```/g, "``\u200b`");
}

function groupKey(a: VisualAssetRow): string {
  const docId = a.document_id ?? "unknown_doc";
  const docTitle = a.document_title ?? "(untitled)";
  return `${docId}::${docTitle}`;
}

async function main() {
  const args = process.argv.slice(2);

  let baseUrl = "http://localhost:9000";
  if (args[0] && /^https?:\/\//i.test(args[0])) {
    baseUrl = String(args.shift());
  }

  let outPathArg: string | null = null;
  let dealFilterRaw: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i] ?? "");
    if (a === "--out" || a === "-o") {
      const v = args[i + 1];
      if (typeof v === "string" && v.trim().length > 0) {
        outPathArg = v;
        i += 1;
      }
      continue;
    }
    if (a === "--deal") {
      const v = args[i + 1];
      if (typeof v === "string" && v.trim().length > 0) {
        dealFilterRaw = v;
        i += 1;
      }
      continue;
    }
    // Back-compat: if an arg is a bare path (not an option) and out wasn't set, treat it as outPath.
    if (!a.startsWith("-") && !outPathArg) {
      outPathArg = a;
    }
  }

  if (!outPathArg) outPathArg = `artifacts/slide-titles.${nowStamp()}.md`;
  const outPath = path.resolve(process.cwd(), outPathArg);

  let deals = await fetchJson<DealRow[]>(`${baseUrl}/api/dashboard/deals`);

  if (dealFilterRaw) {
    const q = dealFilterRaw.trim();
    const byId = deals.find((d) => d && typeof d.id === "string" && d.id === q);
    const byName = deals.find((d) => {
      const nm = typeof d?.name === "string" ? d.name : "";
      return nm.trim().toLowerCase() === q.toLowerCase();
    });
    const hit = byId ?? byName;
    if (!hit) {
      const sampleNames = deals
        .slice(0, 10)
        .map((d) => (typeof d?.name === "string" ? d.name : d?.id))
        .filter(Boolean)
        .join(", ");
      throw new Error(`Deal not found for --deal=${q}. Sample deals: ${sampleNames}`);
    }
    deals = [hit];
  }

  const perDeal = await runWithLimit(deals, 3, async (deal) => {
    const payload = await fetchJson<DealVisualAssetsResponse>(`${baseUrl}/api/v1/deals/${encodeURIComponent(deal.id)}/visual-assets`);
    const assets = Array.isArray(payload.visual_assets) ? payload.visual_assets : [];

    const docs = new Map<string, VisualAssetRow[]>();
    for (const a of assets) {
      const key = groupKey(a);
      const arr = docs.get(key) ?? [];
      arr.push(a);
      docs.set(key, arr);
    }

    const allTitles = assets
      .map((a) => (typeof a.slide_title === "string" ? normalizeWhitespace(a.slide_title) : ""))
      .filter(Boolean);

    const uniqueTitles = new Set(allTitles);

    let nonLanguageCount = 0;
    let indexFallbackCount = 0;
    let garbledWarnCount = 0;

    const nonLanguageSamples: Array<{
      document_title: string | null;
      page_index: number | null;
      title: string;
      source: string | null;
      conf: number | null;
      warnings: string[];
      reasons: string[];
    }> = [];

    for (const a of assets) {
      const title = typeof a.slide_title === "string" ? normalizeWhitespace(a.slide_title) : "";
      if (!title) continue;

      const warnings = Array.isArray(a.slide_title_warnings) ? a.slide_title_warnings.filter((w) => typeof w === "string") : [];
      if (warnings.includes("picked_title_garbled")) garbledWarnCount += 1;

      if (/^slide\s+\d+$/i.test(title) || a.slide_title_source === "index_fallback_v1") indexFallbackCount += 1;

      const nl = looksNonLanguageTitle(title);
      if (nl.nonLanguage) {
        nonLanguageCount += 1;
        if (nonLanguageSamples.length < 40) {
          nonLanguageSamples.push({
            document_title: a.document_title ?? null,
            page_index: typeof a.page_index === "number" ? a.page_index : null,
            title,
            source: typeof a.slide_title_source === "string" ? a.slide_title_source : null,
            conf: typeof a.slide_title_confidence === "number" ? a.slide_title_confidence : null,
            warnings,
            reasons: nl.reasons,
          });
        }
      }
    }

    nonLanguageSamples.sort((x, y) => {
      const ax = x.reasons.includes("index_fallback_title") ? 1 : 0;
      const ay = y.reasons.includes("index_fallback_title") ? 1 : 0;
      if (ax !== ay) return ax - ay;
      return (x.page_index ?? 9999) - (y.page_index ?? 9999);
    });

    const docSummaries = Array.from(docs.entries())
      .map(([key, items]) => {
        const [docId, docTitle] = key.split("::");
        const titleSet = new Set<string>();
        let docNonLanguage = 0;
        let docIndexFallback = 0;
        for (const a of items) {
          const t = typeof a.slide_title === "string" ? normalizeWhitespace(a.slide_title) : "";
          if (t) titleSet.add(t);
          if (t && looksNonLanguageTitle(t).nonLanguage) docNonLanguage += 1;
          if (t && (/^slide\s+\d+$/i.test(t) || a.slide_title_source === "index_fallback_v1")) docIndexFallback += 1;
        }
        return {
          doc_id: docId,
          doc_title: docTitle,
          pages: items.length,
          unique_titles: titleSet.size,
          non_language_titles: docNonLanguage,
          index_fallback_titles: docIndexFallback,
          items: items
            .slice()
            .sort((a, b) => (a.page_index ?? 9999) - (b.page_index ?? 9999))
            .map((a) => {
              const title = typeof a.slide_title === "string" ? normalizeWhitespace(a.slide_title) : "";
              const warnings = Array.isArray(a.slide_title_warnings) ? a.slide_title_warnings.filter((w) => typeof w === "string") : [];
              const nl = title ? looksNonLanguageTitle(title) : { nonLanguage: true, reasons: ["missing_title"] };
              return {
                page_index: typeof a.page_index === "number" ? a.page_index : null,
                title: title || null,
                source: typeof a.slide_title_source === "string" ? a.slide_title_source : null,
                confidence: typeof a.slide_title_confidence === "number" ? a.slide_title_confidence : null,
                warnings,
                non_language: nl.nonLanguage,
                non_language_reasons: nl.reasons,
              };
            }),
        };
      })
      .sort((a, b) => b.non_language_titles - a.non_language_titles || b.pages - a.pages);

    return {
      deal_id: deal.id,
      deal_name: deal.name ?? null,
      stage: deal.stage ?? null,
      priority: deal.priority ?? null,
      totals: {
        visual_assets: assets.length,
        unique_titles: uniqueTitles.size,
        non_language_titles: nonLanguageCount,
        index_fallback_titles: indexFallbackCount,
        picked_title_garbled_warnings: garbledWarnCount,
      },
      non_language_samples: nonLanguageSamples,
      docs: docSummaries,
    };
  });

  const global = {
    deals: deals.length,
    visual_assets: perDeal.reduce((s, d) => s + d.totals.visual_assets, 0),
    unique_titles: perDeal.reduce((s, d) => s + d.totals.unique_titles, 0),
    non_language_titles: perDeal.reduce((s, d) => s + d.totals.non_language_titles, 0),
    index_fallback_titles: perDeal.reduce((s, d) => s + d.totals.index_fallback_titles, 0),
    picked_title_garbled_warnings: perDeal.reduce((s, d) => s + d.totals.picked_title_garbled_warnings, 0),
  };

  const lines: string[] = [];
  lines.push(`# Slide Titles (All Deals)`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Base URL: ${baseUrl}`);
  lines.push("");
  lines.push(`## Global Summary`);
  lines.push("");
  lines.push(`- Deals: ${global.deals}`);
  lines.push(`- Visual assets: ${global.visual_assets}`);
  lines.push(`- Unique titles (sum per-deal): ${global.unique_titles}`);
  lines.push(`- Titles flagged as non-language (heuristic): ${global.non_language_titles}`);
  lines.push(`- Index fallback titles (Slide N): ${global.index_fallback_titles}`);
  lines.push(`- picked_title_garbled warnings: ${global.picked_title_garbled_warnings}`);
  lines.push("");

  const sortedDeals = perDeal
    .slice()
    .sort((a, b) => b.totals.non_language_titles - a.totals.non_language_titles || b.totals.index_fallback_titles - a.totals.index_fallback_titles);

  lines.push(`## Deals Overview`);
  lines.push("");
  lines.push(`| Deal | Assets | Unique titles | Non-language | Index fallback | Garbled warnings |`);
  lines.push(`|---|---:|---:|---:|---:|---:|`);
  for (const d of sortedDeals) {
    const name = d.deal_name ? mdEscape(d.deal_name) : d.deal_id;
    lines.push(
      `| ${name} | ${d.totals.visual_assets} | ${d.totals.unique_titles} | ${d.totals.non_language_titles} | ${d.totals.index_fallback_titles} | ${d.totals.picked_title_garbled_warnings} |`
    );
  }
  lines.push("");

  for (const d of sortedDeals) {
    const title = d.deal_name ? `${d.deal_name} (${d.deal_id})` : d.deal_id;
    lines.push(`---`);
    lines.push("");
    lines.push(`## ${mdEscape(title)}`);
    lines.push("");
    lines.push(
      `Assets=${d.totals.visual_assets} | UniqueTitles=${d.totals.unique_titles} | NonLanguage=${d.totals.non_language_titles} | IndexFallback=${d.totals.index_fallback_titles} | GarbledWarnings=${d.totals.picked_title_garbled_warnings}`
    );
    lines.push("");

    if (d.non_language_samples.length > 0) {
      lines.push(`### Non-language Samples (up to 40)`);
      lines.push("");
      lines.push(`| Document | Page | Title | Source | Conf | Warnings | Reasons |`);
      lines.push(`|---|---:|---|---|---:|---|---|`);
      for (const s of d.non_language_samples) {
        const doc = s.document_title ? mdEscape(s.document_title) : "(unknown)";
        const page = s.page_index == null ? "" : String(s.page_index + 1);
        const warn = s.warnings.length ? mdEscape(s.warnings.join(",")) : "";
        const reasons = mdEscape(s.reasons.join(","));
        const conf = s.conf == null ? "" : s.conf.toFixed(2);
        lines.push(`| ${doc} | ${page} | ${mdEscape(s.title)} | ${s.source ?? ""} | ${conf} | ${warn} | ${reasons} |`);
      }
      lines.push("");
    }

    lines.push(`### Documents`);
    lines.push("");

    for (const doc of d.docs) {
      lines.push(`#### ${mdEscape(doc.doc_title)} (${doc.doc_id})`);
      lines.push("");
      lines.push(`Pages=${doc.pages} | UniqueTitles=${doc.unique_titles} | NonLanguage=${doc.non_language_titles} | IndexFallback=${doc.index_fallback_titles}`);
      lines.push("");
      lines.push(`| Page | Title | Source | Conf | Warnings | Non-language? | Reasons |`);
      lines.push(`|---:|---|---|---:|---|---|---|`);
      for (const it of doc.items) {
        const page = it.page_index == null ? "" : String(it.page_index + 1);
        const t = it.title ? mdEscape(it.title) : "";
        const conf = it.confidence == null ? "" : it.confidence.toFixed(2);
        const warn = it.warnings.length ? mdEscape(it.warnings.join(",")) : "";
        const nl = it.non_language ? "yes" : "";
        const reasons = mdEscape(it.non_language_reasons.join(","));
        lines.push(`| ${page} | ${t} | ${it.source ?? ""} | ${conf} | ${warn} | ${nl} | ${reasons} |`);
      }
      lines.push("");
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ out: outPathArg, global }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
