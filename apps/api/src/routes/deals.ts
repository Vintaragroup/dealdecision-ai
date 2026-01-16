import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fetchPhaseBVisualsFromDb } from "../lib/phaseb-visuals";
import { getPool } from "../lib/db";
import type { Deal } from "@dealdecision/contracts";
import { enqueueJob } from "../services/jobs";
import { autoProgressDealStage } from "../services/stageProgression";
import { updateDealPriority, updateAllDealPriorities } from "../services/priorityClassification";
import { computeNodeEvidenceGateV1 } from "../services/nodeEvidenceGateV1";
import { getNodeEvidenceGateForDeal } from "../services/nodeEvidenceGateForDeal";
import { normalizeDealName } from "../lib/normalize-deal-name";
import { buildDocumentsDigest } from "../lib/documents-digest";
import type { DocumentsDigestV1 } from "../lib/documents-digest";
import { purgeDealCascade, isPurgeDealNotFoundError, sanitizeText, buildDealScoringInputV0FromLineage } from "@dealdecision/core";
import { getSegmentConfidenceThresholds } from "@dealdecision/core/dist/config/segment-thresholds";
import { BrandModel, PageInput, buildBrandModel, inferDocumentBrandName, inferSlideTitleForSlide, normalizePhrase } from "../lib/slide-title";
import { buildClassificationText, buildSegmentFeatures, classifySegment, normalizeAnalystSegment, type AnalystSegment, type SegmentClassifierInput } from "../lib/analyst-segment";
import { groupWordVisualAssetsByDocument, groupWordVisualAssetsByDocumentWithStats, type WordGroupingStats } from "../lib/word-visual-grouping";

export { computeNodeEvidenceGateV1 };

export type QueryResult<T> = { rows: T[]; rowCount?: number };
type DealRoutesClient = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
  release: () => void;
};
type DealRoutesPool = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
  connect?: () => Promise<DealRoutesClient>;
};

type DealApiMode = "phase1" | "full";

// Lightweight helpers reused across routes. These mirror the patterns used in tests (information_schema + to_regclass).
async function hasTable(pool: DealRoutesPool, table: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ oid: string | null }>("SELECT to_regclass($1) as oid", [table]);
    return rows?.[0]?.oid !== null;
  } catch {
    return false;
  }
}

async function hasColumn(pool: DealRoutesPool, table: string, column: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ ok: number }>(
      `SELECT 1 as ok FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function getColumnDataType(pool: DealRoutesPool, table: string, column: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ data_type: string }>(
      `SELECT data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        LIMIT 1`,
      [table, column]
    );
    return rows?.[0]?.data_type ?? null;
  } catch {
    return null;
  }
}

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

function stripEvidenceFromExecutiveSummary(exec: any): any {
  if (!exec || typeof exec !== "object") return null;
  const clone = { ...exec } as any;
  if ("evidence" in clone) delete clone.evidence;
  return clone;
}

function stripEvidenceFromClaims(claims: any): any[] {
  if (!Array.isArray(claims)) return [];
  return claims.map((c) => {
    if (!c || typeof c !== "object") return c;
    const clone = { ...c } as any;
    if ("evidence" in clone) delete clone.evidence;
    return clone;
  });
}

function parseDealApiMode(request: FastifyRequest | any): DealApiMode {
  const modeRaw = (request?.query as any)?.mode ?? (request as any)?.mode;
  return typeof modeRaw === "string" && modeRaw.toLowerCase() === "phase1" ? "phase1" : "full";
}

function parseBoolQ(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value !== "string") return defaultValue;

  const v = value.trim().toLowerCase();
  if (!v) return defaultValue;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return defaultValue;
}

function pickNonUnknownSegment(value: unknown): AnalystSegment | null {
  const seg = normalizeAnalystSegment(value);
  return seg && seg !== "unknown" ? seg : null;
}

function majorityNonUnknownSegment(values: unknown[]): AnalystSegment | null {
  const counts = new Map<AnalystSegment, number>();
  const order: AnalystSegment[] = [];
  for (const v of values) {
    const seg = pickNonUnknownSegment(v);
    if (!seg) continue;
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
    if (!order.includes(seg)) order.push(seg);
  }
  if (order.length === 0) return null;

  let best = order[0];
  let bestCount = -1;
  for (const seg of order) {
    const c = counts.get(seg) ?? 0;
    if (c > bestCount) {
      best = seg;
      bestCount = c;
    }
  }
  return best;
}

function isStructuredWordSectionAsset(v: any): boolean {
  const extractorVersion = typeof v?.extractor_version === "string" ? String(v.extractor_version) : "";
  const qSource = typeof v?.quality_flags?.source === "string" ? String(v.quality_flags.source) : "";
  const kind = typeof v?.structured_json?.kind === "string" ? String(v.structured_json.kind) : "";
  if (extractorVersion === "structured_native_v1" && qSource.startsWith("structured_word")) return true;
  if (qSource.startsWith("structured_word")) return true;
  if (kind === "word_section") return true;
  return false;
}

function structuredWordContentStats(v: any): { headingLen: number; textSnippetLen: number; paragraphsLen: number } {
  const sj = (v?.structured_json ?? {}) as any;
  const heading = typeof sj?.heading === "string" ? sj.heading.trim() : "";
  const snippet = typeof sj?.text_snippet === "string" ? sj.text_snippet.trim() : "";
  const paragraphsRaw = Array.isArray(sj?.paragraphs) ? sj.paragraphs : [];

  const paraText = (p: any): string => {
    if (typeof p === "string") return p.trim();
    if (!p || typeof p !== "object") return "";
    const direct =
      (typeof (p as any).text === "string" ? (p as any).text : "") ||
      (typeof (p as any).content === "string" ? (p as any).content : "") ||
      (typeof (p as any).value === "string" ? (p as any).value : "");
    return typeof direct === "string" ? direct.trim() : "";
  };

  let paragraphsLen = 0;
  for (const p of paragraphsRaw) {
    if (paragraphsLen >= 60) break;
    const s = paraText(p);
    if (s) paragraphsLen += 1;
  }

  return { headingLen: heading.length, textSnippetLen: snippet.length, paragraphsLen };
}

function isEmptyStructuredWordSectionAsset(v: any): boolean {
  if (!isStructuredWordSectionAsset(v)) return false;
  const stats = structuredWordContentStats(v);
  const ocr = typeof v?.ocr_text === "string" ? v.ocr_text.replace(/\s+/g, " ").trim() : "";
  const sj = (v?.structured_json ?? {}) as any;
  const tableRows = Array.isArray(sj?.table_rows) ? sj.table_rows : [];
  let hasTable = false;
  for (const row of tableRows.slice(0, 4)) {
    if (!Array.isArray(row)) continue;
    for (const cell of row.slice(0, 6)) {
      const s = typeof cell === "string" ? cell.replace(/\s+/g, " ").trim() : cell != null ? String(cell).trim() : "";
      if (s) {
        hasTable = true;
        break;
      }
    }
    if (hasTable) break;
  }

  return stats.headingLen === 0 && stats.textSnippetLen === 0 && stats.paragraphsLen === 0 && !hasTable && !ocr;
}

function computeDocHintSegmentByDocId(assets: any[], opts?: { minMajorityPct?: number }): Map<string, AnalystSegment> {
  const minMajorityPct = typeof opts?.minMajorityPct === "number" && Number.isFinite(opts.minMajorityPct) ? opts.minMajorityPct : 0.6;

  const nonEmptyCountByDoc = new Map<string, number>();
  const countsByDoc = new Map<string, Map<AnalystSegment, number>>();

  for (const a of assets) {
    if (!isStructuredWordSectionAsset(a)) continue;
    const docId = typeof a?.document_id === "string" ? a.document_id : typeof a?.documentId === "string" ? a.documentId : null;
    if (!docId) continue;
    if (isEmptyStructuredWordSectionAsset(a)) continue;

    nonEmptyCountByDoc.set(docId, (nonEmptyCountByDoc.get(docId) ?? 0) + 1);

    const persisted = pickNonUnknownSegment((a as any)?.persisted_segment_key);
    const computed = pickNonUnknownSegment((a as any)?.computed_segment);
    const candidate = persisted ?? computed;
    if (!candidate) continue;

    const map = countsByDoc.get(docId) ?? new Map<AnalystSegment, number>();
    map.set(candidate, (map.get(candidate) ?? 0) + 1);
    countsByDoc.set(docId, map);
  }

  const out = new Map<string, AnalystSegment>();
  for (const [docId, totalNonEmpty] of nonEmptyCountByDoc.entries()) {
    const counts = countsByDoc.get(docId);
    if (!counts || totalNonEmpty <= 0) continue;
    let bestSeg: AnalystSegment | null = null;
    let bestCount = -1;
    for (const [seg, n] of counts.entries()) {
      if (n > bestCount) {
        bestSeg = seg;
        bestCount = n;
      }
    }
    if (!bestSeg || bestSeg === "unknown" || bestCount <= 0) continue;
    const pct = bestCount / totalNonEmpty;
    if (pct >= minMajorityPct) out.set(docId, bestSeg);
  }
  return out;
}

function buildDeterministicGroupCapturedText(members: any[], maxChars = 1500): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  const localSnippet = (text: unknown): string => {
    if (typeof text !== "string") return "";
    const s = text.replace(/\s+/g, " ").trim();
    if (!s) return "";
    return s.length > 140 ? s.slice(0, 140) : s;
  };

  for (const m of members) {
    if (!m || typeof m !== "object") continue;

    const captured = typeof (m as any).captured_text === "string" ? String((m as any).captured_text) : "";
    const sj = (m as any).structured_json;
    const textSnippet = typeof sj?.text_snippet === "string" ? String(sj.text_snippet) : "";
    const snippet = localSnippet((m as any).ocr_text);

    const chosen = (captured || textSnippet || snippet).replace(/\s+/g, " ").trim();
    if (!chosen) continue;

    const key = chosen.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(chosen);

    const joinedLen = parts.reduce((acc, s) => acc + s.length, 0) + Math.max(0, parts.length - 1) * 2;
    if (joinedLen >= maxChars) break;
  }

  const joined = parts.join("\n\n").trim();
  if (!joined) return "";
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars).trimEnd()}…`;
}

function extractStructuredWordTextForCue(v: any, maxChars = 1200): string {
  const sj = (v?.structured_json ?? {}) as any;
  const heading = typeof sj?.heading === "string" ? sj.heading.trim() : "";
  const snippet = typeof sj?.text_snippet === "string" ? sj.text_snippet.trim() : "";

  const parasRaw = Array.isArray(sj?.paragraphs) ? sj.paragraphs : [];
  const paras: string[] = [];
  for (const p of parasRaw.slice(0, 40)) {
    if (typeof p === "string") {
      const s = p.trim();
      if (s) paras.push(s);
      continue;
    }
    if (!p || typeof p !== "object") continue;
    const direct =
      (typeof (p as any).text === "string" ? (p as any).text : "") ||
      (typeof (p as any).content === "string" ? (p as any).content : "") ||
      (typeof (p as any).value === "string" ? (p as any).value : "");
    const s = typeof direct === "string" ? direct.trim() : "";
    if (s) paras.push(s);
  }

  const raw = [heading, ...paras, snippet].filter(Boolean).join("\n");
  return raw.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function inferStructuredWordCueSegment(v: any): { segment: AnalystSegment; confidence: number; matched: string } | null {
  if (!isStructuredWordSectionAsset(v)) return null;
  if (isEmptyStructuredWordSectionAsset(v)) return null;

  const text = extractStructuredWordTextForCue(v, 1600);
  if (!text) return null;

  const t = text.toLowerCase();
  const cue = (re: RegExp, matched: string, segment: AnalystSegment, confidence: number) =>
    re.test(t) ? ({ segment, confidence, matched } as const) : null;

  // Keep this conservative and only used for computed=unknown.
  return (
    cue(/\bwhat\s+we\s+do\b/, "what we do", "overview", 0.65) ||
    cue(/\bwho\s+we\s+are\b/, "who we are", "overview", 0.6) ||
    cue(/\bkey\s+strategic\s+advantages\b/, "key strategic advantages", "overview", 0.6) ||
    cue(/\bcompany\s*:\b/, "company:", "overview", 0.55) ||
    cue(/\bbusiness\s+model\b/, "business model", "business_model", 0.65) ||
    cue(/\bhow\s+we\s+make\s+money\b/, "how we make money", "business_model", 0.65) ||
    cue(/\brevenue\s+model\b/, "revenue model", "business_model", 0.6) ||
    cue(/\bpricing\b/, "pricing", "business_model", 0.55) ||
    null
  );
}

function requireDestructiveAuth(request: FastifyRequest | any): { ok: true } | { ok: false; status: number; error: string } {
  // Allow destructive operations in non-production by default to keep tests/dev simple.
  if (process.env.NODE_ENV !== "production") return { ok: true };

  const headers = (request?.headers ?? {}) as any;
  const token = headers["x-admin-token"] ?? headers["admin-token"];
  if (typeof token === "string" && token.trim() && token === process.env.ADMIN_TOKEN) return { ok: true };

  return { ok: false, status: 403, error: "Unauthorized destructive operation" };
}

const dealStageEnum = z.enum(["intake", "under_review", "in_diligence", "ready_decision", "pitched"]);
const dealPriorityEnum = z.enum(["high", "medium", "low"]);
const dealTrendEnum = z.enum(["up", "down", "flat"]);

const dealCreateSchema = z.object({
  name: z.string().min(1),
  stage: dealStageEnum.default("intake"),
  priority: dealPriorityEnum.default("medium"),
  trend: dealTrendEnum.optional(),
  score: z.number().optional(),
  owner: z.string().optional(),
});

const dealDraftCreateSchema = z
  .object({
    name: z.string().min(1).optional(),
    stage: dealStageEnum.optional(),
    priority: dealPriorityEnum.optional(),
    owner: z.string().optional(),
  })
  .optional();

const dealConfirmProfileSchema = z
  .object({
    company_name: z.string().min(1).optional(),
    deal_name: z.string().min(1).optional(),
    investment_type: z.string().min(1).optional(),
    round: z.string().min(1).optional(),
    industry: z.string().min(1).optional(),
  })
  .refine((data) => Object.values(data).some((v) => typeof v === "string" && v.trim().length > 0), {
    message: "At least one profile field is required",
  });

function sanitizeProfileValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = sanitizeText(value).replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > 120) return s.slice(0, 120);
  return s;
}

function extractLabeledValue(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n\\r]{2,120})`, "i");
  const m = text.match(re);
  return m ? sanitizeProfileValue(m[1]) : null;
}

function isGenericCandidateName(value: string): boolean {
  const s = String(value || "").trim();
  if (!s) return true;
  const normalized = s
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,6}$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return true;
  if (normalized.length <= 2) return true;
  if (/^(?:pd|deck|pitch|presentation)$/.test(normalized)) return true;
  if (/^(?:pitch deck|pitchdeck|data room|dataroom|financials|model|term sheet|teaser|one pager|onepager)$/.test(normalized)) {
    return true;
  }
  if (/^(?:document|doc|file|scan)$/.test(normalized)) return true;
  if (/^\d+$/.test(normalized)) return true;
  return false;
}

function deriveNameFromFilenameLike(fileNameOrTitle: string): string | null {
  const raw = String(fileNameOrTitle || "").trim();
  if (!raw) return null;
  const noExt = raw.replace(/\.[A-Za-z0-9]{2,6}$/i, "");
  const cleaned = noExt
    .replace(/[_]+/g, " ")
    .replace(
      /\b(pd|pitch\s*deck|pitch\s*deck\s*v\d+|pitch\s*deck\s*final|pitchdeck|deck|presentation|data\s*room|dataroom|financials|model|term\s*sheet|teaser|one\s*pager|onepager|executive\s*summary|overview)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2) return null;
  const seg = cleaned.split(/\s[-–—|:]\s/)[0]?.trim();
  if (!seg) return null;
  const candidate = sanitizeProfileValue(seg);
  if (!candidate) return null;
  if (isGenericCandidateName(candidate)) return null;
  return candidate;
}

function extractCompanyFromEarlyText(fullText: string): string | null {
  const text = String(fullText || "").trim();
  if (!text) return null;

  const head = text.slice(0, 6_000);
  const lines = head
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines.slice(0, 10)) {
    if (line.length < 3 || line.length > 70) continue;
    if (line.includes(":")) continue; // likely a label/value line handled elsewhere
    const candidate = sanitizeProfileValue(line);
    if (!candidate) continue;
    if (isGenericCandidateName(candidate)) continue;
    // avoid obvious section headings
    if (/^(?:pitch\s*deck|company\s*overview|overview|contents|table\s*of\s*contents)$/i.test(candidate)) continue;
    return candidate;
  }

  const about = head.match(
    /\b(?:about|welcome to|introducing)\s+([A-Z][A-Za-z0-9&.'\-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'\-]{1,40}){0,3})\b/
  );
  if (about?.[1]) {
    const candidate = sanitizeProfileValue(about[1]);
    if (candidate && !isGenericCandidateName(candidate)) return candidate;
  }

  const legal = head.match(
    /\b([A-Z][A-Za-z0-9&.'\-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'\-]{1,40}){0,4})\s+(?:Inc\.?|LLC|Ltd\.?|Corporation|Corp\.?|GmbH|S\.A\.|SAS)\b/
  );
  if (legal?.[1]) {
    const candidate = sanitizeProfileValue(legal[1]);
    if (candidate && !isGenericCandidateName(candidate)) return candidate;
  }

  return null;
}

type AutoProfileDocRow = {
  id: string;
  title: string;
  file_name?: string | null;
  full_text: string | null;
  structured_data: any | null;
  full_content: any | null;
};

function computeAutoProfileFromDocuments(docs: AutoProfileDocRow[]) {
  const warnings: string[] = [];

  const sources: Record<string, string[]> = {
    company_name: [],
    deal_name: [],
    investment_type: [],
    round: [],
    industry: [],
  };

  const confidence: Record<string, number> = {
    company_name: 0,
    deal_name: 0,
    investment_type: 0,
    round: 0,
    industry: 0,
  };

  const candidates: Record<string, Array<{ value: string; score: number; docId: string }>> = {
    company_name: [],
    investment_type: [],
    round: [],
    industry: [],
  };

  const docTexts = docs.map((d) => {
    const fullText = typeof d.full_text === "string" ? d.full_text : "";
    return { id: d.id, fullText: fullText.slice(0, 80_000) };
  });

  for (const { id: docId, fullText } of docTexts) {
    const text = String(fullText || "");
    if (!text.trim()) continue;

    const labeledCompany =
      extractLabeledValue(text, "Company Name") ||
      extractLabeledValue(text, "Company") ||
      extractLabeledValue(text, "Legal Name");

    if (labeledCompany) {
      candidates.company_name.push({ value: labeledCompany, score: 0.75, docId });
    }

    const earlyCompany = extractCompanyFromEarlyText(text);
    if (earlyCompany) {
      candidates.company_name.push({ value: earlyCompany, score: 0.6, docId });
    }

    const industry = extractLabeledValue(text, "Industry") || extractLabeledValue(text, "Sector");
    if (industry) {
      candidates.industry.push({ value: industry, score: 0.65, docId });
    }

    const roundPatterns: Array<{ re: RegExp; value: string; score: number }> = [
      { re: /\bpre[- ]?seed\b/i, value: "pre-seed", score: 0.9 },
      { re: /\bseed\b/i, value: "seed", score: 0.8 },
      { re: /\bseries\s*a\b/i, value: "series a", score: 0.9 },
      { re: /\bseries\s*b\b/i, value: "series b", score: 0.9 },
      { re: /\bseries\s*c\b/i, value: "series c", score: 0.9 },
      { re: /\bseries\s*d\b/i, value: "series d", score: 0.9 },
      { re: /\bbridge\b/i, value: "bridge", score: 0.7 },
      { re: /\bangel\b/i, value: "angel", score: 0.6 },
    ];

    for (const p of roundPatterns) {
      if (p.re.test(text)) {
        candidates.round.push({ value: p.value, score: p.score, docId });
      }
    }

    const investmentPatterns: Array<{ re: RegExp; value: string; score: number }> = [
      { re: /\bSAFE\b/i, value: "safe", score: 0.9 },
      { re: /convertible\s+note/i, value: "note", score: 0.85 },
      { re: /\bterm\s*sheet\b/i, value: "equity", score: 0.65 },
      { re: /preferred\s+stock/i, value: "equity", score: 0.75 },
      { re: /\bequity\b/i, value: "equity", score: 0.7 },
    ];

    for (const p of investmentPatterns) {
      if (p.re.test(text)) {
        candidates.investment_type.push({ value: p.value, score: p.score, docId });
      }
    }
  }

  if (candidates.company_name.length === 0) {
    for (const d of docs) {
      const preferredNameSource = (d.file_name ?? d.title) as string;
      const fromFileName = deriveNameFromFilenameLike(preferredNameSource);
      if (fromFileName) candidates.company_name.push({ value: fromFileName, score: 0.35, docId: d.id });
      else if (preferredNameSource && isGenericCandidateName(preferredNameSource)) {
        warnings.push("filename looked generic (e.g. PD/deck); ignored for company_name");
      }
    }
    if (candidates.company_name.length > 0) warnings.push("company_name inferred from filename (low confidence)");
  }

  const pickBest = (key: keyof typeof candidates): { value: string | null; conf: number; docIds: string[] } => {
    const list = candidates[key] ?? [];
    if (list.length === 0) return { value: null, conf: 0, docIds: [] };

    const byValue = new Map<string, { value: string; max: number; docs: Set<string> }>();
    for (const c of list) {
      const v = c.value.trim();
      const item = byValue.get(v) ?? { value: v, max: 0, docs: new Set<string>() };
      item.max = Math.max(item.max, c.score);
      item.docs.add(c.docId);
      byValue.set(v, item);
    }

    const ranked = Array.from(byValue.values())
      .map((x) => {
        const agreeBoost = x.docs.size >= 2 ? 0.1 : 0;
        const conf = Math.min(1, x.max + agreeBoost);
        return { value: x.value, conf, docs: Array.from(x.docs) };
      })
      .sort((a, b) => b.conf - a.conf);

    return { value: ranked[0]?.value ?? null, conf: ranked[0]?.conf ?? 0, docIds: ranked[0]?.docs ?? [] };
  };

  const company = pickBest("company_name");
  const round = pickBest("round");
  const investmentType = pickBest("investment_type");
  const industry = pickBest("industry");

  const dealName = company.value && round.value ? `${company.value} — ${round.value}` : company.value ? company.value : null;
  const dealNameConf = dealName ? Math.min(1, Math.max(company.conf, round.conf) * 0.9) : 0;
  const dealNameDocs = Array.from(new Set([...company.docIds, ...round.docIds]));

  const proposed_profile = {
    company_name: company.value,
    deal_name: dealName,
    investment_type: investmentType.value,
    round: round.value,
    industry: industry.value,
  };

  confidence.company_name = company.conf;
  confidence.deal_name = dealNameConf;
  confidence.investment_type = investmentType.conf;
  confidence.round = round.conf;
  confidence.industry = industry.conf;

  sources.company_name = company.docIds;
  sources.deal_name = dealNameDocs;
  sources.investment_type = investmentType.docIds;
  sources.round = round.docIds;
  sources.industry = industry.docIds;

  if (!docs.length) warnings.push("no documents found for deal");
  if (!company.value) warnings.push("company_name not inferred");
  if (!round.value) warnings.push("round not inferred");
  if (!investmentType.value) warnings.push("investment_type not inferred");
  if (!industry.value) warnings.push("industry not inferred");

  return { proposed_profile, confidence, sources, warnings };
}

export function normalizeWarningsForPersistence(input: unknown): string[] | null {
  if (input == null) return null;

  const coerceOne = (value: unknown): string[] => {
    if (value == null) return [];
    if (typeof value !== "string") return [];
    const raw = value.trim();
    if (!raw) return [];
    if (raw.includes(" • ")) {
      return raw
        .split(" • ")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    }
    return [raw];
  };

  const out: string[] = [];

  if (Array.isArray(input)) {
    for (const item of input) out.push(...coerceOne(item));
  } else {
    out.push(...coerceOne(input));
  }

  return out.length > 0 ? out : null;
}

function jsonbParam(value: unknown): any {
  if (value == null) return null;
  // node-postgres treats JS arrays as Postgres array literals (not JSON);
  // using a toPostgres wrapper ensures json/jsonb columns receive valid JSON.
  if (Array.isArray(value)) {
    return { toPostgres: () => JSON.stringify(value) };
  }
  return value;
}

const dealUpdateSchema = dealCreateSchema.partial();

type DealRow = {
  id: string;
  name: string;
  stage: Deal["stage"];
  priority: Deal["priority"];
  trend: Deal["trend"] | null;
  score: number | null;
  owner: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  documents_digest_v1?: DocumentsDigestV1 | null;
};

type DIOAggregateRow = {
  dio_id: string | null;
  analysis_version: number | null;
  recommendation: string | null;
  overall_score: number | null;
  last_analyzed_at: string | null;
  run_count: number | null;
	// Optional Phase 1 executive summary (jsonb slice from dio_data)
	executive_summary_v1?: any;
	executive_summary_v2?: any;
	decision_summary_v1?: any;
	phase1_coverage?: any;
	phase1_claims?: any;
	phase1_business_archetype_v1?: any;
  phase1_deal_overview_v2?: any;
  phase1_update_report_v1?: any;
	phase1_deal_summary_v2?: any;
  phase1_score_evidence?: any;
  phase_b_latest_run?: any | null;
  phase_b_history?: any | null;
};

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type Phase1ScoreEvidenceSectionKey = "product" | "market" | "icp" | "business_model" | "traction" | "risks" | "terms" | "team";

type Phase1ScoreEvidencePayload = {
  sections: Array<{
    key: Phase1ScoreEvidenceSectionKey;
    support: "evidence" | "inferred" | "missing";
    missingReason?: string;
    claims: Array<{
      id: string;
      text: string;
      confidence?: number | null;
      evidence: Array<{
        id: string;
        kind?: string;
        label?: string;
        value?: any;
        doc_id?: string;
        document_title?: string;
        page?: number | null;
        snippet?: string;
        source?: string;
        created_at?: string;
      }>;
    }>;
  }>;
  totals: { claims: number; evidence: number };
};

type ScoreBreakdownSectionKey = "market" | "product" | "business_model" | "traction" | "risks" | "team" | "terms" | "icp";

type ScoreBreakdownSupport = "supported" | "weak" | "missing" | "unknown";

type ScoreTraceAuditV1 = {
  status: "ok" | "partial" | "poor";
  sections_total: number;
  sections_with_trace: number;
  sections_missing_trace: number;
  mismatch_sections: number;
  notes: string[];
};

type ScoreBreakdownSection = {
  key: ScoreBreakdownSectionKey;
  section_key?: ScoreBreakdownSectionKey;
  coverage_group_key?: string;
  support_status: ScoreBreakdownSupport;
  evidence_count: number;
  evidence_ids?: string[];
  evidence_ids_sample?: string[];
  evidence_count_total?: number;
  evidence_count_linked?: number;
  evidence_ids_linked?: string[];
  trace_coverage_pct?: number;
  coverage_pct?: number;
  // Path A: node-backed evidence defensibility metrics (requires evidence.visual_asset_id)
  node_evidence_count_linked?: number;
  node_trace_coverage_pct?: number;
  node_coverage_pct?: number;
  node_missing_linked_evidence_ids?: string[];
  rule_key?: string;
  inputs_used?: {
    coverage_keys?: string[];
    claim_ids?: string[];
    doc_ids?: string[];
    evidence_ids?: string[];
  };
  support_reason?: string;
  evidence_source?: "claims" | "evidence_table" | "unknown";
  missing_reasons?: string[];
  missing_link_reasons?: string[];
  hint?: string;
  mismatch?: boolean;
};

type ScoreBreakdownV1 = {
  sections: ScoreBreakdownSection[];
  evidence_total?: number;
  trace_audit_v1?: ScoreTraceAuditV1;
};

type EvidenceRow = {
  id: string;
  document_id?: string | null;
  visual_asset_id?: string | null;
  page?: number | null;
  kind?: string | null;
  source?: string | null;
  text?: string | null;
  value?: unknown;
  confidence?: number | null;
  created_at?: string | null;
};

type DocumentIndex = Record<string, { title?: string | null; page_count?: number | null }>;

const SCORE_BREAKDOWN_SECTION_ORDER: ScoreBreakdownSectionKey[] = [
  "market",
  "product",
  "business_model",
  "traction",
  "risks",
  "team",
  "terms",
  "icp",
];

const CLAIM_CATEGORY_SECTION_MAP: Record<ScoreBreakdownSectionKey, string[]> = {
  market: ["market", "market_icp"],
  product: ["product"],
  business_model: ["product", "business_model", "pricing"],
  traction: ["traction"],
  risks: ["risk", "risks"],
  team: ["team"],
  terms: ["terms", "raise_terms", "deal_terms", "terms_raise"],
  icp: ["icp"],
};

function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  return s || null;
}

function sectionForCategory(category: string | null): ScoreBreakdownSectionKey | null {
  if (!category) return null;
  for (const [section, cats] of Object.entries(CLAIM_CATEGORY_SECTION_MAP)) {
    if (cats.includes(category)) return section as ScoreBreakdownSectionKey;
  }
  return null;
}

export function buildScoreBreakdownV1(params: {
  accountability?: any;
  scoreAudit?: any;
  coverage?: any;
  claims?: any;
  sectionEvidenceSamples?: Partial<Record<ScoreBreakdownSectionKey, string[]>>;
}): ScoreBreakdownV1 | null {
  const accountability = params.accountability && typeof params.accountability === "object" ? params.accountability : null;
  const coverage = params.coverage && typeof params.coverage === "object" ? params.coverage : null;
  const claims = Array.isArray(params.claims) ? params.claims : [];

  const hasInputs = Boolean(accountability) || Boolean(coverage) || claims.length > 0;
  if (!hasInputs) return null;

  const sectionOrder = SCORE_BREAKDOWN_SECTION_ORDER;

  const coverageKeyMap: Record<ScoreBreakdownSectionKey, string> = {
    market: "market_icp",
    product: "product_solution",
    business_model: "business_model",
    traction: "traction",
    risks: "risks",
    team: "team",
    terms: "terms",
    icp: "market_icp",
  };

  const labelMap: Record<ScoreBreakdownSectionKey, string> = {
    market: "Market",
    product: "Product",
    business_model: "Business model",
    traction: "Traction",
    risks: "Risks",
    team: "Team",
    terms: "Terms",
    icp: "ICP",
  };

  const hints: Record<ScoreBreakdownSectionKey, string> = {
    market: "Add market sizing and ICP evidence to strengthen this section.",
    product: "Attach product definition and capability proof points.",
    business_model: "Provide pricing or revenue model evidence for business model clarity.",
    traction: "Add traction metrics or customer proof to support traction claims.",
    risks: "Document key risks with mitigations to tighten this section.",
    team: "Include founder bios or key hires to bolster team assessment.",
    terms: "Attach term sheet or raise terms to validate deal structure.",
    icp: "Add ICP or customer definition evidence to strengthen this section.",
  };

  const claimIdsForSection = (key: ScoreBreakdownSectionKey): string[] => {
    const ids: string[] = [];
    for (const claim of claims) {
      if (!claim || typeof claim !== "object") continue;
      const section = deriveSectionKeyFromClaim(claim);
      if (section !== key) continue;
      const claimId = typeof (claim as any).claim_id === "string" ? (claim as any).claim_id : typeof (claim as any).id === "string" ? (claim as any).id : null;
      if (claimId && claimId.trim()) ids.push(claimId.trim());
    }
    return Array.from(new Set(ids));
  };

  const docIdsFromClaims = (key: ScoreBreakdownSectionKey): string[] => {
    const ids: string[] = [];
    for (const claim of claims) {
      if (!claim || typeof claim !== "object") continue;
      const section = deriveSectionKeyFromClaim(claim);
      if (section !== key) continue;
      const evList = Array.isArray((claim as any).evidence) ? (claim as any).evidence : [];
      for (const ev of evList) {
        const docId = typeof ev?.document_id === "string" ? ev.document_id : typeof ev?.doc_id === "string" ? ev.doc_id : null;
        if (docId && docId.trim()) ids.push(docId.trim());
      }
    }
    return Array.from(new Set(ids));
  };

  const normalizeSupport = (value: string | undefined | null): ScoreBreakdownSupport | undefined => {
    if (value === "evidence") return "supported";
    if (value === "inferred") return "weak";
    if (value === "missing") return "missing";
    return undefined;
  };

  const supportFromAccountability = (key: ScoreBreakdownSectionKey): ScoreBreakdownSupport | undefined => {
    const support = (accountability as any)?.support || (accountability as any)?.coverage_support;
    if (!support || typeof support !== "object") return undefined;
    return normalizeSupport((support as any)[key]);
  };

  const supportFromCoverage = (key: ScoreBreakdownSectionKey): ScoreBreakdownSupport | undefined => {
    const coverageKey = coverageKeyMap[key];
    const status = coverage && typeof coverage === "object" ? (coverage as any).sections?.[coverageKey] : undefined;
    if (status === "missing") return "missing";
    if (status === "partial") return "weak";
    if (status === "present") return "supported";
    return undefined;
  };

  const supportMetaFor = (
    key: ScoreBreakdownSectionKey
  ): { support: ScoreBreakdownSupport; ruleKey: string; reason: string; coverageKeysUsed: string[] } => {
    const coverageKey = coverageKeyMap[key];
    const coverageKeysUsed = coverageKey ? [coverageKey] : [];
    const accountabilityRaw = (accountability as any)?.support?.[key] ?? (accountability as any)?.coverage_support?.[key];
    if (accountabilityRaw) coverageKeysUsed.push(`accountability:${key}`);

    const normalizedAccountability = normalizeSupport(accountabilityRaw);
    if (normalizedAccountability) {
      return {
        support: normalizedAccountability,
        ruleKey: `accountability:${accountabilityRaw}`,
        reason: `Support set to ${normalizedAccountability} via accountability support value '${accountabilityRaw}'.`,
        coverageKeysUsed,
      };
    }

    const coverageSupport = supportFromCoverage(key);
    const coverageStatusRaw = coverage && typeof coverage === "object" ? (coverage as any).sections?.[coverageKey] : undefined;
    if (coverageSupport) {
      return {
        support: coverageSupport,
        ruleKey: `coverage:${coverageStatusRaw ?? coverageSupport}`,
        reason: `Support set to ${coverageSupport} because coverage.sections.${coverageKey}=${coverageStatusRaw ?? coverageSupport}.`,
        coverageKeysUsed,
      };
    }

    return {
      support: "weak",
      ruleKey: "default:weak",
      reason: `Support defaulted to weak; no accountability or coverage inputs provided for ${labelMap[key]}.`,
      coverageKeysUsed,
    };
  };

  const evidenceCountFor = (key: ScoreBreakdownSectionKey): number => {
    return claims.reduce((acc, claim) => {
      if (!claim || typeof claim !== "object") return acc;
      const section = deriveSectionKeyFromClaim(claim);
      if (section !== key) return acc;
      const evCount = Array.isArray((claim as any).evidence) ? (claim as any).evidence.length : 0;
      return acc + evCount;
    }, 0);
  };

  const evidenceIdsFromClaims = (key: ScoreBreakdownSectionKey): string[] => {
    const ids: string[] = [];
    for (const claim of claims) {
      if (!claim || typeof claim !== "object") continue;
      const section = deriveSectionKeyFromClaim(claim);
      if (section !== key) continue;
      const evidenceList = Array.isArray((claim as any).evidence) ? (claim as any).evidence : [];
      for (const ev of evidenceList) {
        const evId = typeof ev?.evidence_id === "string" ? ev.evidence_id : typeof ev?.id === "string" ? ev.id : null;
        if (evId && evId.trim().length > 0) ids.push(evId.trim());
      }
    }
    return Array.from(new Set(ids));
  };

  const reasonLabel = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const map: Record<string, string> = {
      empty_text: "Evidence text missing",
      explicit_not_provided: "Explicitly not provided",
      no_evidence: "No evidence provided",
      low_confidence: "Low confidence evidence",
    };
    return map[value] || value;
  };

  const missingReasonsFor = (key: ScoreBreakdownSectionKey, support: ScoreBreakdownSupport): string[] => {
    const reasons: string[] = [];
    const label = labelMap[key].toLowerCase();
    const coverageKey = coverageKeyMap[key];

    const missingSections = Array.isArray((accountability as any)?.coverage_missing_sections)
      ? (accountability as any).coverage_missing_sections
      : [];
    for (const entry of missingSections) {
      if (typeof entry !== "string") continue;
      const lower = entry.toLowerCase();
      if (lower.includes(label) || lower.includes(coverageKey.replace(/_/g, " "))) {
        reasons.push(entry.trim());
      }
    }

    const detail = (coverage as any)?.section_details?.[coverageKey];
    if (detail?.why_missing) {
      const friendly = reasonLabel(detail.why_missing);
      if (friendly) reasons.push(friendly);
    }

    if ((coverage as any)?.sections?.[coverageKey] === "partial") {
      reasons.push("Partial coverage");
    }

    if (support === "missing" && reasons.length === 0) {
      reasons.push("No supporting evidence provided");
    }

    return Array.from(new Set(reasons)).filter((r) => typeof r === "string" && r.trim().length > 0);
  };

  const sections: ScoreBreakdownSection[] = [];

  for (const key of sectionOrder) {
    const supportMeta = supportMetaFor(key);
    const coverageKey = coverageKeyMap[key];
    const coverageStatusRaw = coverage && typeof coverage === "object" ? (coverage as any).sections?.[coverageKey] : undefined;
    let support = supportMeta.support ?? "unknown";
    let rule_key = supportMeta.ruleKey;
    const claimEvidenceIds = evidenceIdsFromClaims(key);
    const claimIds = claimIdsForSection(key);
    const docIds = docIdsFromClaims(key);
    const fallbackSample = (params.sectionEvidenceSamples?.[key] ?? []).filter((id) => typeof id === "string" && id.trim().length > 0);
    const evidence_ids_linked = claimEvidenceIds.slice(0, 25);
    const evidence_ids_sample = fallbackSample.slice(0, 3);
    const evidence_ids = Array.from(new Set([...claimEvidenceIds, ...fallbackSample]));

    const hasAnyInput =
      typeof coverageStatusRaw === "string"
      || claimIds.length > 0
      || evidence_ids.length > 0
      || fallbackSample.length > 0;
    if (!hasAnyInput) continue;
    const evidence_source: ScoreBreakdownSection["evidence_source"] = claimEvidenceIds.length > 0
      ? "claims"
      : fallbackSample.length > 0
        ? "evidence_table"
        : "unknown";

    const evidence_count_from_claims = evidenceCountFor(key);
    const evidence_count_total_raw = Math.max(evidence_count_from_claims, evidence_ids.length);
    const evidence_count_total = Number.isFinite(evidence_count_total_raw) && evidence_count_total_raw > 0 ? evidence_count_total_raw : 0;
    const evidence_count_linked_raw = evidence_ids_linked.length;
    const evidence_count_linked = Number.isFinite(evidence_count_linked_raw) && evidence_count_linked_raw > 0 ? evidence_count_linked_raw : 0;
    const trace_coverage_pct = evidence_count_total > 0 ? Math.min(1, evidence_count_linked / evidence_count_total) : 0;
    const coverage_pct = evidence_count_total > 0 ? Math.min(100, Math.max(0, Math.round(trace_coverage_pct * 100))) : 0;

    const coverageMarkedMissingButHasEvidence = coverageStatusRaw === "missing" && evidence_count_linked > 0;
    if (coverageMarkedMissingButHasEvidence) {
      support = "weak";
      rule_key = `${supportMeta.ruleKey};coverage_missing_overridden_with_evidence`;
    }

    const coverageGap = support === "supported" && evidence_count_total >= 3 && trace_coverage_pct < 0.4;
    const mismatch = (support === "supported" && evidence_count_linked === 0) || coverageGap || (support === "missing" && evidence_count_total > 0);

    const support_reason = (() => {
      const base = supportMeta.reason;
      const override = coverageMarkedMissingButHasEvidence
        ? " Support overridden to weak because coverage was marked missing but linked evidence exists."
        : "";
      if (evidence_count_total === 0) return `${base}${override} No evidence counted for this section.`;
      return `${base}${override} Trace coverage ${evidence_count_linked}/${evidence_count_total} (${coverage_pct}%).`;
    })();

    const inputs_used_candidate: ScoreBreakdownSection["inputs_used"] = {
      coverage_keys: supportMeta.coverageKeysUsed.filter((v) => typeof v === "string" && v.trim().length > 0),
      claim_ids: claimIds,
      doc_ids: docIds,
      evidence_ids,
    };
    const inputs_used = Object.values(inputs_used_candidate).some((arr) => Array.isArray(arr) && arr.length > 0)
      ? inputs_used_candidate
      : undefined;

    const missing_link_reasons: string[] = [];
    if (evidence_count_total === 0) missing_link_reasons.push("No evidence counted for this section");
    if (evidence_count_total > 0 && evidence_count_linked === 0) missing_link_reasons.push("Evidence not linked to this section");
    if (coverageGap) missing_link_reasons.push("Linked evidence coverage below threshold");
    if (support === "missing" && evidence_count_total > 0) missing_link_reasons.push("Section marked missing but evidence exists");

    const missingReasonsBase = missingReasonsFor(key, support);
    const missing_reasons = coverageMarkedMissingButHasEvidence
      ? [
          "Coverage marked missing but evidence exists; treated as weak until structured coverage is extracted.",
          ...missingReasonsBase,
        ]
      : missingReasonsBase;

    sections.push({
      key,
      section_key: key,
      coverage_group_key: coverageKey,
      support_status: support,
      evidence_count: evidence_count_total,
      evidence_ids,
      evidence_ids_linked,
      evidence_ids_sample,
      evidence_count_total,
      evidence_count_linked,
      trace_coverage_pct,
      coverage_pct,
      rule_key,
      inputs_used,
      support_reason,
      evidence_source,
      missing_reasons,
      missing_link_reasons,
      hint: hints[key],
      mismatch,
    });
  }

  const evidence_total = sections.reduce((acc, s) => acc + (Number.isFinite(s.evidence_count_total) ? (s.evidence_count_total as number) : Number.isFinite(s.evidence_count) ? (s.evidence_count as number) : 0), 0);

  const traceAudit: ScoreTraceAuditV1 = (() => {
    const intentionalMissing = (s: ScoreBreakdownSection) =>
      s.support_status === "missing" && typeof s.rule_key === "string" && s.rule_key.startsWith("coverage:missing");

    const autoExcluded = (s: ScoreBreakdownSection) => {
      const total = s.evidence_count_total ?? (s as any).evidence_count ?? 0;
      const hasClaims = Array.isArray(s.inputs_used?.claim_ids) && s.inputs_used.claim_ids.length > 0;
      const hasEvIds = Array.isArray(s.evidence_ids) && s.evidence_ids.length > 0;
      const fromCoverage = typeof s.rule_key === "string" && s.rule_key.startsWith("coverage:");
      return !fromCoverage && (s.support_status === "missing" || s.support_status === "weak") && total === 0 && !hasClaims && !hasEvIds;
    };

    const usedSections = sections.filter((s) => !autoExcluded(s));

    const groupKeyFor = (s: ScoreBreakdownSection) => {
      const key = (s as any).coverage_group_key ?? (s.section_key ?? s.key);
      if (typeof key === "string" && key.trim()) return key;
      const fallback = (s.section_key ?? s.key) as ScoreBreakdownSectionKey | undefined;
      return fallback ? coverageKeyMap[fallback] ?? fallback : "unknown";
    };

    const grouped = new Map<string, ScoreBreakdownSection[]>();
    for (const s of usedSections) {
      const gk = groupKeyFor(s);
      const list = grouped.get(gk) ?? [];
      list.push(s);
      grouped.set(gk, list);
    }

    const groupStats = Array.from(grouped.entries()).map(([groupKey, list]) => {
      const hasIntentionalMissing = list.every((s) => intentionalMissing(s));
      const linked = list.reduce((acc, s) => acc + (s.evidence_count_linked ?? 0), 0);
      const total = list.reduce((acc, s) => acc + (s.evidence_count_total ?? (s as any).evidence_count ?? 0), 0);
      const hasMismatch = list.some((s) => s.mismatch);
      return { groupKey, hasIntentionalMissing, linked, total, hasMismatch };
    });

    const eligibleGroups = groupStats.filter((g) => !g.hasIntentionalMissing);
    const groupsUsed = eligibleGroups.length > 0 ? eligibleGroups : groupStats;

    const sections_total = groupsUsed.length;
    const sections_with_trace = groupsUsed.filter((g) => g.linked > 0).length;
    const sections_missing_trace = groupsUsed.filter((g) => g.linked === 0).length;
    const mismatch_sections = groupsUsed.filter((g) => g.hasMismatch).length;
    const coverageRatio = sections_total > 0 ? sections_with_trace / sections_total : 0;

    let status: ScoreTraceAuditV1["status"] = "partial";
    if (coverageRatio >= 0.75 && mismatch_sections === 0) status = "ok";
    else if (coverageRatio < 0.4) status = "poor";

    const notes: string[] = [];
    if (mismatch_sections > 0) {
      notes.push(`${mismatch_sections} section${mismatch_sections === 1 ? "" : "s"} flagged as mismatch`);
    }
    if (sections_missing_trace > 0) {
      notes.push(`${sections_missing_trace} section${sections_missing_trace === 1 ? "" : "s"} missing linked evidence`);
    }
    if (coverageRatio < 0.75 && coverageRatio >= 0.4) {
      notes.push("Trace coverage below 75% across sections");
    }
    if (coverageRatio < 0.4) {
      notes.push("Trace coverage is poor; link evidence to score sections");
    }

    return {
      status,
      sections_total,
      sections_with_trace,
      sections_missing_trace,
      mismatch_sections,
      notes,
    } satisfies ScoreTraceAuditV1;
  })();

  return {
    sections,
    evidence_total,
    trace_audit_v1: traceAudit,
  };
}

function collectEvidenceIdsFromClaims(claims: any[]): string[] {
  const ids = new Set<string>();
  for (const claim of claims) {
    const directIds = Array.isArray(claim?.evidence_ids)
      ? claim.evidence_ids.filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
    directIds.forEach((id: string) => ids.add(id));

    const claimEvidence = Array.isArray(claim?.evidence) ? claim.evidence : [];
    for (const ev of claimEvidence) {
      const maybeId = typeof ev?.evidence_id === "string" ? ev.evidence_id : typeof ev?.id === "string" ? ev.id : null;
      if (maybeId) ids.add(maybeId);
    }
  }
  return Array.from(ids);
}

async function getEvidenceByIds(pool: DealRoutesPool, ids: string[]): Promise<EvidenceRow[]> {
  if (!ids || ids.length === 0) return [];
  const hasEvidenceTable = await hasTable(pool, "evidence");
  if (!hasEvidenceTable) return [];

  const [hasDocumentId, hasPage, hasPageNumber, hasValue, hasVisualAssetId] = await Promise.all([
    hasColumn(pool, "evidence", "document_id"),
    hasColumn(pool, "evidence", "page"),
    hasColumn(pool, "evidence", "page_number"),
    hasColumn(pool, "evidence", "value"),
    hasColumn(pool, "evidence", "visual_asset_id"),
  ]);

  const idType = await getColumnDataType(pool, "evidence", "id");
  const useUuidIds = idType === "uuid";
  const queryIds = useUuidIds ? ids.filter(isUuid) : ids;
  if (queryIds.length === 0) return [];
  const anyCast = useUuidIds ? "uuid" : "text";

  const documentIdExpr = hasDocumentId ? "document_id" : "NULL::text AS document_id";
  const pageExpr = hasPage ? "page" : hasPageNumber ? "page_number" : "NULL::int AS page";
  const valueExpr = hasValue ? "value" : "NULL::jsonb AS value";
  const visualAssetIdExpr = hasVisualAssetId ? "visual_asset_id" : "NULL::text AS visual_asset_id";

  const { rows } = await pool.query<EvidenceRow & { page_number?: number | null }>(
    `SELECT id,
      ${documentIdExpr},
      ${visualAssetIdExpr},
      source,
      kind,
      text,
      ${valueExpr},
      confidence::float8 AS confidence,
      created_at,
      ${pageExpr}
     FROM evidence
    WHERE id = ANY($1::${anyCast}[])`,
    [queryIds]
  );

  return rows ?? [];
}

async function getDocumentIndex(pool: DealRoutesPool, docIds: string[]): Promise<DocumentIndex> {
  if (!docIds || docIds.length === 0) return {};
  const hasDocs = await hasTable(pool, "documents");
  if (!hasDocs) return {};

  const idType = await getColumnDataType(pool, "documents", "id");
  const useUuidIds = idType === "uuid";
  const queryIds = useUuidIds ? docIds.filter(isUuid) : docIds;
  if (queryIds.length === 0) return {};
  const anyCast = useUuidIds ? "uuid" : "text";

  const [hasTitle, hasPageCount] = await Promise.all([
    hasColumn(pool, "documents", "title"),
    hasColumn(pool, "documents", "page_count"),
  ]);

  const selectCols = ["id"]
    .concat(hasTitle ? ["title"] : [])
    .concat(hasPageCount ? ["page_count"] : []);

  const { rows } = await pool.query<any>(
    `SELECT ${selectCols.join(", ")}
      FROM documents
     WHERE id = ANY($1::${anyCast}[])`,
    [queryIds]
  );

  const index: DocumentIndex = {};
  for (const row of rows ?? []) {
    if (!row?.id) continue;
    index[row.id] = {
      title: hasTitle ? row.title : undefined,
      page_count: hasPageCount ? row.page_count : undefined,
    };
  }
  return index;
}

async function fetchEvidenceSamplesBySection(params: {
  pool: DealRoutesPool;
  dealId: string;
  dioId?: string | null;
  limit?: number;
}): Promise<Partial<Record<ScoreBreakdownSectionKey, string[]>>> {
  try {
    const { pool, dealId, dioId } = params;
    const limit = params.limit ?? 50;
    const hasEvidenceTable = await hasTable(pool, "evidence");
    const hasDealId = hasEvidenceTable ? await hasColumn(pool, "evidence", "deal_id") : false;
    if (!hasEvidenceTable || !hasDealId) return {};

    const hasDioId = await hasColumn(pool, "evidence", "dio_id");
    const hasSectionKey = await hasColumn(pool, "evidence", "section_key");
    const hasExcerpt = await hasColumn(pool, "evidence", "excerpt");
    const hasText = await hasColumn(pool, "evidence", "text");
    const effectiveLimit = Math.max(5, Math.min(200, limit));
    const samples: Partial<Record<ScoreBreakdownSectionKey, string[]>> = {};

    const sectionKeys: ScoreBreakdownSectionKey[] = ["market", "product", "business_model", "traction", "risks", "team", "terms", "icp"];

    for (const key of sectionKeys) {
      const where: string[] = ["deal_id = $1"];
      const paramsArr: Array<string> = [dealId];
      let paramIdx = 2;

      if (hasDioId && dioId) {
        where.push(`dio_id = $${paramIdx}`);
        paramsArr.push(dioId);
        paramIdx += 1;
      }

      if (hasSectionKey) {
        where.push(`section_key = $${paramIdx}`);
        paramsArr.push(key);
        paramIdx += 1;
      }

      const snippetExpr = hasExcerpt ? "excerpt" : hasText ? "text" : "NULL::text";

      const query = hasSectionKey
        ? `SELECT id, document_id${key === "business_model" ? `, ${snippetExpr} AS snippet` : ""}
             FROM evidence
            WHERE ${where.join(" AND ")}
            ORDER BY (document_id IS NULL), created_at DESC NULLS LAST, id DESC
            LIMIT ${effectiveLimit}`
        : `SELECT id, source, kind, text, document_id
           FROM evidence
          WHERE ${where.join(" AND ")}
          ORDER BY (document_id IS NULL), created_at DESC NULLS LAST, id DESC
          LIMIT ${effectiveLimit}`;

      const { rows } = await pool.query<any>(query, paramsArr);

      if (hasSectionKey) {
        const businessModelRegex = /(marketplace|pricing|take rate|take-rate|take\s*rate|fee|commission|subscription|revenue model|royalties|licensing)/i;
        const filtered = key === "business_model"
          ? (rows ?? []).filter((r: any) => typeof r?.snippet === "string" && businessModelRegex.test(r.snippet))
          : rows ?? [];

        const ids = filtered
          .map((r: any) => (typeof r?.id === "string" ? r.id.trim() : null))
          .filter((v: string | null): v is string => Boolean(v))
          .slice(0, 5);
        if (ids.length > 0) samples[key] = ids;
        continue;
      }

      const keywords: Record<ScoreBreakdownSectionKey, string[]> = {
        market: ["market", "tam", "sam", "som", "segment", "icp"],
        product: ["product", "solution", "feature", "platform"],
        business_model: ["business model", "pricing", "revenue", "unit economics", "model"],
        traction: ["traction", "revenue", "arr", "mrr", "customers", "users", "growth", "kpi"],
        risks: ["risk", "compliance", "threat", "mitigation", "issue"],
        team: ["team", "founder", "ceo", "cto", "leadership", "hiring", "talent"],
        terms: ["terms", "term sheet", "raise", "valuation", "ownership", "liquidation"],
        icp: ["icp", "customer", "ideal customer", "buyer", "persona"],
      };

      const haystack = (row: any): string => `${row?.source ?? ""} ${row?.kind ?? ""} ${row?.text ?? ""}`.toLowerCase();
      const ids: string[] = [];
      for (const row of rows ?? []) {
        const h = haystack(row);
        if (keywords[key].some((kw) => h.includes(kw))) {
          const id = typeof row?.id === "string" ? row.id : null;
          if (id && id.trim()) ids.push(id.trim());
        }
        if (ids.length >= 5) break;
      }
      if (ids.length > 0) samples[key] = Array.from(new Set(ids)).slice(0, 5);
    }

    return samples;
  } catch {
    return {};
  }
}

function normalizeEvidenceSnippet(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = sanitizeText(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > 500 ? cleaned.slice(0, 500) : cleaned;
}

const BUSINESS_MODEL_STRONG_REGEX = /\b(marketplace|subscription|recurring|saas|pricing|price|revenue model|rev model|take\s*rate|take-rate|commission|fee|arpu|ltv|cac|gross margin|unit economics|licensing|royalties|usage-based|consumption|per[- ]seat|per[- ]user|per[- ]transaction|transaction fee|rake|payment fee|processing fee)\b/i;

function deriveSectionKeyFromClaim(claim: any): ScoreBreakdownSectionKey | null {
  if (!claim || typeof claim !== "object") return null;
  const rawCategory = (claim as any)?.category ?? (claim as any)?.section_key ?? (claim as any)?.topic ?? (claim as any)?.source ?? null;
  const category = normalizeCategory(rawCategory);
  const text = typeof (claim as any)?.text === "string" ? (claim as any).text.toLowerCase() : "";

  const preferIcp = category === "market_icp" || category === "icp" || text.includes(" icp") || text.includes("ideal customer") || text.includes("customer profile");

  if (preferIcp && CLAIM_CATEGORY_SECTION_MAP.icp.includes("icp")) return "icp";

  const sectionFromCategory = sectionForCategory(category);
  if (sectionFromCategory) return sectionFromCategory;

  const sectionKey = normalizeCategory((claim as any)?.section_key ?? (claim as any)?.source);
  if (sectionKey && (SCORE_BREAKDOWN_SECTION_ORDER as string[]).includes(sectionKey)) {
    return sectionKey as ScoreBreakdownSectionKey;
  }

  if (preferIcp) return "icp";
  return null;
}

async function ensureEvidenceLinksForClaims(params: {
  pool: DealRoutesPool;
  dealId: string;
  dioId?: string | null;
  claims: any[];
}): Promise<any[]> {
  const claims = Array.isArray(params.claims)
    ? params.claims.map((c) => (c && typeof c === "object" ? { ...c } : c))
    : [];
  if (claims.length === 0) return claims;

  const stats = {
    totalClaims: claims.length,
    skippedMissingSnippet: 0,
    skippedNoSection: 0,
    skippedNoDoc: 0,
    matchedExisting: 0,
    insertedNew: 0,
    perSection: new Map<ScoreBreakdownSectionKey, number>(),
  };

  const evidenceTableExists = await hasTable(params.pool, "evidence");
  if (!evidenceTableExists) return claims;

  const [hasDealId, hasDocumentId, hasSource, hasKind, hasConfidence, hasPage, hasPageNumber, hasExcerpt, hasText, hasDioId, hasSectionKey] =
    await Promise.all([
      hasColumn(params.pool, "evidence", "deal_id"),
      hasColumn(params.pool, "evidence", "document_id"),
      hasColumn(params.pool, "evidence", "source"),
      hasColumn(params.pool, "evidence", "kind"),
      hasColumn(params.pool, "evidence", "confidence"),
      hasColumn(params.pool, "evidence", "page"),
      hasColumn(params.pool, "evidence", "page_number"),
      hasColumn(params.pool, "evidence", "excerpt"),
      hasColumn(params.pool, "evidence", "text"),
      hasColumn(params.pool, "evidence", "dio_id"),
      hasColumn(params.pool, "evidence", "section_key"),
    ]);

  const textColumn = hasExcerpt ? "excerpt" : hasText ? "text" : null;
  if (!hasDealId || !textColumn) return claims;

  const existingCache = new Map<string, string>();

  const findExistingEvidenceId = async (docId: string | null, snippet: string): Promise<string | null> => {
    const key = `${docId ?? "null"}:${snippet}`;
    if (existingCache.has(key)) return existingCache.get(key) ?? null;

    const where: string[] = ["deal_id = $1", `${textColumn} = $2`];
    const paramsArr: Array<string | null> = [params.dealId, snippet];
    let idx = 3;
    if (hasDocumentId) {
      where.push(`document_id IS NOT DISTINCT FROM $${idx}`);
      paramsArr.push(docId);
      idx += 1;
    }

    const { rows } = await params.pool.query<{ id: string }>(
      `SELECT id
         FROM evidence
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1`,
      paramsArr
    );

    const found = rows?.[0]?.id ?? null;
    if (found) existingCache.set(key, found);
    return found;
  };

  for (const claim of claims) {
    if (!claim || typeof claim !== "object") continue;
    const sectionKey = deriveSectionKeyFromClaim(claim);
    if (!sectionKey) {
      stats.skippedNoSection += 1;
      continue;
    }
    const evidenceList = Array.isArray((claim as any).evidence) ? (claim as any).evidence : [];
    const normalizedEvidence: any[] = [];
    const existingEvidenceIds = new Set<string>(
      Array.isArray((claim as any).evidence_ids)
        ? (claim as any).evidence_ids.filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0)
        : []
    );

    for (const ev of evidenceList) {
      if (!ev || typeof ev !== "object") continue;
      const cloned = { ...ev } as any;

      const explicitId = typeof ev?.evidence_id === "string" ? ev.evidence_id : typeof ev?.id === "string" ? ev.id : null;
      if (explicitId && explicitId.trim()) {
        const id = explicitId.trim();
        cloned.evidence_id = id;
        cloned.id = id;
        existingEvidenceIds.add(id);
        normalizedEvidence.push(cloned);
        stats.matchedExisting += 1;
        continue;
      }

      const snippet = normalizeEvidenceSnippet((ev as any)?.snippet ?? (ev as any)?.text);
      if (!snippet) {
        stats.skippedMissingSnippet += 1;
        normalizedEvidence.push(cloned);
        continue;
      }

      const isBusinessModel = sectionKey === "business_model";
      const passesBusinessModelGate = !isBusinessModel || BUSINESS_MODEL_STRONG_REGEX.test(snippet);
      if (!passesBusinessModelGate) {
        stats.skippedNoSection += 1;
        continue;
      }

      const docIdRaw = (ev as any)?.document_id ?? (ev as any)?.doc_id;
      const docId = typeof docIdRaw === "string" && docIdRaw.trim() ? sanitizeText(docIdRaw) : null;
      if (docId) {
        cloned.document_id = docId;
        cloned.doc_id = docId;
      }
      if (!docId) stats.skippedNoDoc += 1;

      const confidenceRaw = (ev as any)?.confidence ?? (claim as any)?.confidence;
      const confidence = Number.isFinite(confidenceRaw) ? Number(confidenceRaw) : null;
      const sourceRaw = typeof (ev as any)?.source === "string" && (ev as any).source.trim() ? (ev as any).source.trim() : null;
      const kindRaw = typeof (ev as any)?.kind === "string" && (ev as any).kind.trim()
        ? (ev as any).kind.trim()
        : typeof (claim as any)?.category === "string"
          ? (claim as any).category
          : sectionKey ?? "claim";
      const pageRaw = (ev as any)?.page ?? (ev as any)?.page_number;
      const page = typeof pageRaw === "number" && Number.isFinite(pageRaw) ? pageRaw : null;

      const existingId = await findExistingEvidenceId(docId, snippet);
      const evidenceId = existingId ?? randomUUID();

      if (!existingId) {
        const cols: string[] = ["id", "deal_id", textColumn];
        const values: Array<string | number | null> = [evidenceId, params.dealId, snippet];

        if (hasDocumentId) {
          cols.push("document_id");
          values.push(docId);
        }
        if (hasSource) {
          cols.push("source");
          values.push(sourceRaw ?? "phase1_claim");
        }
        if (hasKind) {
          cols.push("kind");
          values.push(kindRaw ?? "claim");
        }
        if (hasConfidence) {
          cols.push("confidence");
          values.push(confidence);
        }
        if (hasPage || hasPageNumber) {
          cols.push(hasPage ? "page" : "page_number");
          values.push(page);
        }
        if (hasDioId && params.dioId) {
          cols.push("dio_id");
          values.push(params.dioId);
        }
        if (hasSectionKey && sectionKey) {
          cols.push("section_key");
          values.push(sectionKey);
        }

        const placeholders = cols.map((_, idx) => `$${idx + 1}`);
        await params.pool.query(
          `INSERT INTO evidence (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT (id) DO NOTHING`,
          values
        );
        stats.insertedNew += 1;
      } else {
        stats.matchedExisting += 1;
      }

      cloned.evidence_id = evidenceId;
      cloned.id = evidenceId;
      existingEvidenceIds.add(evidenceId);
      normalizedEvidence.push(cloned);
      stats.perSection.set(sectionKey, (stats.perSection.get(sectionKey) ?? 0) + 1);
    }

    if (normalizedEvidence.length > 0) {
      (claim as any).evidence = normalizedEvidence;
    }
    if (existingEvidenceIds.size > 0) {
      const combined = Array.from(new Set([...(claim as any).evidence_ids ?? [], ...Array.from(existingEvidenceIds)]));
      (claim as any).evidence_ids = combined;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.info({
      deal_id: params.dealId,
      dio_id: params.dioId ?? undefined,
      stats: {
        ...stats,
        perSection: Object.fromEntries(stats.perSection.entries()),
      },
    }, "phase1.evidence_linker.stats");
  }

  return claims;
}

function buildPhase1ScoreEvidence(params: {
  executiveSummaryV2?: any;
  claims?: any;
  evidenceById: Map<string, EvidenceRow>;
  docIndex: DocumentIndex;
}): Phase1ScoreEvidencePayload | null {
  const sectionsOrder: Phase1ScoreEvidenceSectionKey[] = ["product", "market", "icp", "business_model", "traction", "risks"];
  const claims = Array.isArray(params.claims) ? params.claims : [];
  if (claims.length === 0) return null;

  const accountability = params.executiveSummaryV2?.accountability_v1;
  const supportRaw = (accountability && typeof accountability === "object" ? accountability.support : null) || {};
  const missingListRaw = Array.isArray(accountability?.coverage_missing_sections) ? accountability.coverage_missing_sections : [];
  const missingBySection = new Map<Phase1ScoreEvidenceSectionKey, string>();
  for (const entry of missingListRaw) {
    if (typeof entry !== "string") continue;
    const lower = entry.toLowerCase();
    if (lower.includes("product")) missingBySection.set("product", entry);
    if (lower.includes("market")) {
      missingBySection.set("market", entry);
      missingBySection.set("icp", entry);
    }
    if (lower.includes("icp")) missingBySection.set("icp", entry);
    if (lower.includes("business")) missingBySection.set("business_model", entry);
    if (lower.includes("traction")) missingBySection.set("traction", entry);
    if (lower.includes("risk")) missingBySection.set("risks", entry);
  }

  const supportFor = (key: Phase1ScoreEvidenceSectionKey): "evidence" | "inferred" | "missing" => {
    const raw = (supportRaw as any)?.[key];
    if (raw === "evidence" || raw === "inferred" || raw === "missing") return raw;
    return "inferred";
  };

  const sectionMap: Record<string, Phase1ScoreEvidenceSectionKey[]> = {
    product: ["product", "business_model"],
    business_model: ["business_model", "product"],
    market: ["market", "icp"],
    market_icp: ["market", "icp"],
    icp: ["icp", "market"],
    traction: ["traction"],
    risk: ["risks"],
    risks: ["risks"],
    terms: ["business_model"],
  };

  const normalizedClaims = claims
    .map((claim) => {
      const id = typeof claim?.claim_id === "string" ? claim.claim_id : typeof claim?.id === "string" ? claim.id : null;
      const text = typeof claim?.text === "string" ? claim.text.trim() : null;
      if (!id || !text) return null;
      const categoryRaw = typeof claim?.category === "string" ? claim.category : typeof claim?.section_key === "string" ? claim.section_key : typeof claim?.topic === "string" ? claim.topic : "";
      const category = categoryRaw.toLowerCase();
      const sectionKeys = sectionMap[category] ?? [];
      const evidenceIds = Array.isArray(claim?.evidence_ids)
        ? claim.evidence_ids.filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      if (Array.isArray(claim?.evidence)) {
        for (const ev of claim.evidence) {
          const evId = typeof ev?.evidence_id === "string" ? ev.evidence_id : typeof ev?.id === "string" ? ev.id : null;
          if (evId) evidenceIds.push(evId);
        }
      }
      const confidence = typeof claim?.confidence === "number" ? claim.confidence : null;
      return { id, text, sectionKeys, evidenceIds: Array.from(new Set(evidenceIds)), confidence };
    })
    .filter((c): c is { id: string; text: string; sectionKeys: Phase1ScoreEvidenceSectionKey[]; evidenceIds: string[]; confidence: number | null } => Boolean(c));

  const evidenceUsed = new Set<string>();
  const claimsUsed = new Set<string>();

  const normalizeEvidenceItem = (row: EvidenceRow | undefined, fallbackId: string): {
    id: string;
    kind?: string;
    label?: string;
    value?: any;
    doc_id?: string;
    document_title?: string;
    page?: number | null;
    snippet?: string;
    source?: string;
    created_at?: string;
  } => {
    const pageRaw = row?.page ?? (row as any)?.page_number;
    const page = typeof pageRaw === "number" && Number.isFinite(pageRaw) ? pageRaw : null;
    const docId = typeof row?.document_id === "string" ? row.document_id : undefined;
    const docMeta = docId ? params.docIndex[docId] : undefined;
    const snippet = typeof row?.text === "string" ? row.text : undefined;
    return {
      id: row?.id ?? fallbackId,
      kind: row?.kind ?? undefined,
      label: (row as any)?.label ?? undefined,
      value: (row as any)?.value ?? undefined,
      doc_id: docId,
      document_title: docMeta?.title ?? undefined,
      page,
      snippet,
      source: row?.source ?? undefined,
      created_at: row?.created_at ?? undefined,
    };
  };

  const sectionPayloads = sectionsOrder.map((key) => {
    const claimsForSection = normalizedClaims.filter((c) => c.sectionKeys.includes(key));
    const claimsWithEvidence = claimsForSection.map((claim) => {
      claimsUsed.add(claim.id);
      const evItems = claim.evidenceIds
        .map((evId) => {
          const row = params.evidenceById.get(evId);
          if (row) evidenceUsed.add(evId);
          return normalizeEvidenceItem(row, evId);
        })
        .filter((ev) => Boolean(ev));
      return {
        id: claim.id,
        text: claim.text,
        confidence: claim.confidence,
        evidence: evItems,
      };
    });

    return {
      key,
      support: supportFor(key),
      missingReason: supportFor(key) === "missing" ? missingBySection.get(key) ?? undefined : undefined,
      claims: claimsWithEvidence,
    };
  });

  return {
    sections: sectionPayloads,
    totals: { claims: claimsUsed.size, evidence: evidenceUsed.size },
  };
}

function buildScoreEvidenceFromBreakdown(params: {
  sections: ScoreBreakdownSection[];
  evidenceById: Map<string, EvidenceRow>;
  docIndex: DocumentIndex;
}): Phase1ScoreEvidencePayload {
  const sectionKeyMap: Partial<Record<ScoreBreakdownSectionKey, Phase1ScoreEvidenceSectionKey>> = {
    market: "market",
    icp: "icp",
    product: "product",
    business_model: "business_model",
    traction: "traction",
    risks: "risks",
    team: "team",
    terms: "terms",
  };

  const normalizeEvidenceItem = (id: string): Phase1ScoreEvidencePayload["sections"][number]["claims"][number]["evidence"][number] => {
    const row = params.evidenceById.get(id);
    const pageRaw = row?.page ?? (row as any)?.page_number;
    const page = typeof pageRaw === "number" && Number.isFinite(pageRaw) ? pageRaw : null;
    const docId = typeof row?.document_id === "string" ? row.document_id : undefined;
    const docMeta = docId ? params.docIndex[docId] : undefined;
    const snippet = typeof row?.text === "string" ? row.text : undefined;
    return {
      id,
      kind: row?.kind ?? undefined,
      value: (row as any)?.value ?? undefined,
      doc_id: docId,
      document_title: docMeta?.title ?? undefined,
      page,
      snippet,
      source: row?.source ?? undefined,
      created_at: row?.created_at ?? undefined,
    };
  };

  const supportMap: Record<ScoreBreakdownSupport, "evidence" | "inferred" | "missing"> = {
    supported: "evidence",
    weak: "inferred",
    missing: "missing",
    unknown: "inferred",
  };

  const outSections: Phase1ScoreEvidencePayload["sections"] = [];
  let evidenceTotal = 0;

  for (const section of params.sections) {
    const mapped = sectionKeyMap[section.section_key ?? section.key];
    if (!mapped) continue;
    const idsPrimary = Array.isArray(section.evidence_ids_linked)
      ? section.evidence_ids_linked.filter((v) => typeof v === "string" && v.trim().length > 0)
      : [];
    const idsSamples = Array.isArray(section.evidence_ids_sample)
      ? section.evidence_ids_sample.filter((v) => typeof v === "string" && v.trim().length > 0)
      : [];
    const ids = Array.from(new Set([...idsPrimary, ...idsSamples]));
    const evidenceItems = ids.map(normalizeEvidenceItem);
    evidenceTotal += evidenceItems.length;

    outSections.push({
      key: mapped,
      support: supportMap[section.support_status] ?? "inferred",
      missingReason: Array.isArray(section.missing_reasons) ? section.missing_reasons[0] : undefined,
      claims: evidenceItems.length > 0
        ? [{ id: `${mapped}-evidence`, text: `${mapped} evidence`, confidence: null, evidence: evidenceItems }]
        : [],
    });
  }

  return {
    sections: outSections,
    totals: { claims: outSections.reduce((acc, s) => acc + s.claims.length, 0), evidence: evidenceTotal },
  };
}

function mapDeal(
  row: DealRow,
  dio: DIOAggregateRow | null | undefined,
  mode: DealApiMode,
  opts?: { sectionEvidenceSamples?: Partial<Record<ScoreBreakdownSectionKey, string[]>> }
): Deal {
  const safeExec = stripEvidenceFromExecutiveSummary((dio as any)?.executive_summary_v1);
  const execV2Raw = (dio as any)?.executive_summary_v2;
  const decision = (dio as any)?.decision_summary_v1;
  const coverage = (dio as any)?.phase1_coverage;
	const scoreEvidence = (dio as any)?.phase1_score_evidence;
	const phaseBLatest = (dio as any)?.phase_b_latest_run;
  const phaseBHistory = (dio as any)?.phase_b_history;
	const businessArchetypeV1 = (dio as any)?.phase1_business_archetype_v1;
  const dealOverviewV2 = (dio as any)?.phase1_deal_overview_v2;
  const updateReportV1 = (dio as any)?.phase1_update_report_v1;
	const dealSummaryV2 = (dio as any)?.phase1_deal_summary_v2;
  const nodeEvidenceGateV1 = (dio as any)?.phase1_node_evidence_gate_v1;
  const topClaims = stripEvidenceFromClaims((dio as any)?.phase1_claims).slice(0, 8);

  const execV2 = execV2Raw && typeof execV2Raw === "object" ? { ...execV2Raw } : null;
  const scoreBreakdownV1 = buildScoreBreakdownV1({
    accountability: (execV2Raw as any)?.accountability_v1,
    scoreAudit: (execV2Raw as any)?.score_audit_v1,
    coverage,
    claims: (dio as any)?.phase1_claims,
    sectionEvidenceSamples: opts?.sectionEvidenceSamples,
  });
  const scoreBreakdownFromDio = (dio as any)?.computed_score_breakdown_v1 ?? (execV2Raw as any)?.score_breakdown_v1;
  const effectiveScoreBreakdown = scoreBreakdownFromDio ?? scoreBreakdownV1;

  if (execV2 && effectiveScoreBreakdown) {
    (execV2 as any).score_breakdown_v1 = effectiveScoreBreakdown;
    if (effectiveScoreBreakdown.trace_audit_v1) (execV2 as any).score_trace_audit_v1 = effectiveScoreBreakdown.trace_audit_v1;
  }

  const out: any = {
    id: row.id,
    name: row.name,
    stage: row.stage,
    priority: row.priority,
    trend: row.trend ?? undefined,
    owner: row.owner ?? undefined,
    lastUpdated: new Date(row.updated_at).toISOString(),
    dioVersionId: dio?.dio_id ?? undefined,
    lastAnalyzedAt: dio?.last_analyzed_at ? new Date(dio.last_analyzed_at).toISOString() : undefined,
    dioRunCount: typeof dio?.run_count === 'number' ? dio.run_count : undefined,
    dioAnalysisVersion: typeof dio?.analysis_version === 'number' ? dio.analysis_version : undefined,
	};

	if (mode !== "phase1") {
    const fallbackScore = typeof dio?.overall_score === 'number' && Number.isFinite(dio.overall_score)
      ? dio.overall_score
      : undefined;
    out.score = (row.score ?? fallbackScore) ?? undefined;
		out.dioStatus = dio?.recommendation ?? undefined;
    if (phaseBLatest && typeof phaseBLatest === "object") {
      out.phase_b = { latest_run: phaseBLatest };
    }
		if (Array.isArray(phaseBHistory) && phaseBHistory.length > 0) {
			out.phase_b = { ...(out.phase_b ?? {}), history: phaseBHistory };
		}
	}

	// Additive field: UI can render summary without extra calls.
	if (safeExec) out.executive_summary_v1 = safeExec;
  if (execV2 && typeof execV2 === "object") out.executive_summary_v2 = execV2;
	if (scoreEvidence && typeof scoreEvidence === "object") (out as any).phase1_score_evidence = scoreEvidence;
	if (businessArchetypeV1 && typeof businessArchetypeV1 === "object") out.business_archetype_v1 = businessArchetypeV1;
  if (dealOverviewV2 && typeof dealOverviewV2 === "object") out.deal_overview_v2 = dealOverviewV2;
  if (updateReportV1 && typeof updateReportV1 === "object") out.update_report_v1 = updateReportV1;
  if (dealSummaryV2 && typeof dealSummaryV2 === "object") (out as any).deal_summary_v2 = dealSummaryV2;

  // Additive field: ensure ES2 is also reachable under phase1.* even in full mode.
  if (mode !== "phase1" && execV2 && typeof execV2 === "object") {
    out.phase1 = { ...(out.phase1 ?? {}), executive_summary_v2: execV2 };
  }

  if (mode === "phase1") {
		out.phase1 = {
			executive_summary_v1: safeExec,
      executive_summary_v2: execV2 && typeof execV2 === "object" ? execV2 : undefined,
      decision_summary_v1: decision && typeof decision === "object" ? decision : undefined,
			coverage: coverage && typeof coverage === "object" ? coverage : undefined,
      business_archetype_v1: businessArchetypeV1 && typeof businessArchetypeV1 === "object" ? businessArchetypeV1 : undefined,
      deal_overview_v2: dealOverviewV2 && typeof dealOverviewV2 === "object" ? dealOverviewV2 : undefined,
      update_report_v1: updateReportV1 && typeof updateReportV1 === "object" ? updateReportV1 : undefined,
      deal_summary_v2: dealSummaryV2 && typeof dealSummaryV2 === "object" ? dealSummaryV2 : undefined,
                     score_evidence: scoreEvidence && typeof scoreEvidence === "object" ? scoreEvidence : undefined,
      node_evidence_gate_v1: nodeEvidenceGateV1 && typeof nodeEvidenceGateV1 === "object" ? nodeEvidenceGateV1 : undefined,
			unknowns: Array.isArray(safeExec?.unknowns) ? safeExec.unknowns : [],
			top_claims: topClaims,
		};
    if (phaseBLatest && typeof phaseBLatest === "object") {
      out.phase1 = { ...(out.phase1 ?? {}), phase_b_latest_run: phaseBLatest };
    }
    if (Array.isArray(phaseBHistory) && phaseBHistory.length > 0) {
      out.phase1 = { ...(out.phase1 ?? {}), phase_b_history: phaseBHistory };
    }
	}
	return out as Deal;
}

export async function registerDealRoutes(app: FastifyInstance, poolOverride?: any) {
  const pool = (poolOverride ?? getPool()) as DealRoutesPool;
  const debugRoutesEnabled = process.env.DEBUG_ROUTES === "1" || process.env.NODE_ENV !== "production";

  if (debugRoutesEnabled) {
    // DEV-only: dump standardized segment features for sample assets.
    // Helps verify PPTX/DOCX/XLSX structured_json normalization and vision OCR title extraction.
    app.get(
      "/api/v1/deals/:deal_id/segments/features",
      {
        schema: {
          description: "DEV-only: return buildSegmentFeatures() output for representative assets across document types.",
          tags: ["deals"],
          params: {
            type: "object",
            properties: { deal_id: { type: "string" } },
            required: ["deal_id"],
          },
          querystring: {
            type: "object",
            additionalProperties: true,
            properties: {
              limit_per_kind: { type: "number" },
            },
          },
        },
      },
      async (request, reply) => {
        if (process.env.NODE_ENV === "production") {
          return reply.status(403).send({ error: "segments/features is disabled in production" });
        }

        const dealIdRaw = (request.params as any)?.deal_id;
        const dealId = sanitizeText(typeof dealIdRaw === "string" ? dealIdRaw : String(dealIdRaw ?? ""));
        if (!dealId) return reply.status(400).send({ error: "deal_id is required" });

        const limitPerKindRaw = Number(((request.query as any) ?? {})?.limit_per_kind ?? 1);
        const limitPerKind =
          Number.isFinite(limitPerKindRaw) && limitPerKindRaw > 0 ? Math.min(5, Math.floor(limitPerKindRaw)) : 1;

        const hasMimeType = await hasColumn(pool as any, "documents", "mime_type");
        const hasFilename = await hasColumn(pool as any, "documents", "filename");
        const hasOcrBlocks = await hasColumn(pool as any, "visual_extractions", "ocr_blocks");
        const hasStructuredSummary = await hasColumn(pool as any, "visual_extractions", "structured_summary");
        const hasStructuredKind = await hasColumn(pool as any, "visual_extractions", "structured_kind");
        const hasLabels = await hasColumn(pool as any, "visual_extractions", "labels");

        type DocRow = {
          id: string;
          title: string | null;
          type: string | null;
          mime_type?: string | null;
          filename?: string | null;
        };

        const { rows: docs } = await pool.query<DocRow>(
          `SELECT id,
                  title,
                  type
                  ${hasMimeType ? ", mime_type" : ", NULL::text AS mime_type"}
                  ${hasFilename ? ", filename" : ", NULL::text AS filename"}
             FROM documents
            WHERE deal_id = $1
            ORDER BY uploaded_at ASC NULLS LAST, created_at ASC NULLS LAST`,
          [dealId]
        );

        const docIds = docs.map((d) => d.id).filter(Boolean);
        if (docIds.length === 0) {
          return reply.send({ deal_id: dealId, generated_at: new Date().toISOString(), samples: [] });
        }

        type VisualRow = {
          id: string;
          document_id: string;
          page_index: number | null;
          asset_type: string | null;
          extractor_version: string | null;
          quality_flags: any;
          ocr_text: string | null;
          ocr_blocks?: any;
          structured_json: any;
          structured_summary?: any;
          structured_kind?: string | null;
          labels?: any;
        };

        const { rows: visuals } = await pool.query<VisualRow>(
          `SELECT va.id,
                  va.document_id,
                  va.page_index,
                  va.asset_type,
                  va.extractor_version,
                  va.quality_flags,
                  ve.ocr_text,
                  ${hasOcrBlocks ? "ve.ocr_blocks" : "NULL::jsonb AS ocr_blocks"},
                  ve.structured_json
                  ${hasStructuredSummary ? ", ve.structured_summary" : ", NULL::jsonb AS structured_summary"}
                  ${hasStructuredKind ? ", ve.structured_kind" : ", NULL::text AS structured_kind"}
                  ${hasLabels ? ", ve.labels" : ", NULL::jsonb AS labels"}
             FROM visual_assets va
             LEFT JOIN visual_extractions ve
               ON ve.visual_asset_id = va.id
              AND ve.extractor_version = va.extractor_version
            WHERE va.document_id = ANY($1)
            ORDER BY va.document_id ASC, va.page_index ASC NULLS LAST, va.created_at ASC`,
          [docIds]
        );

        const docById = new Map<string, DocRow>();
        for (const d of docs) docById.set(d.id, d);

        const picked: Record<string, number> = {};
        const samples: any[] = [];

        for (const v of visuals) {
          const d = docById.get(v.document_id);
          const features = buildSegmentFeatures({
            ocr_text: v.ocr_text,
            ocr_blocks: (v as any).ocr_blocks ?? null,
            structured_kind: (v as any).structured_kind ?? null,
            structured_summary: (v as any).structured_summary ?? null,
            structured_json: (v as any).structured_json ?? null,
            labels: (v as any).labels ?? null,
            asset_type: v.asset_type,
            page_index: typeof v.page_index === "number" ? v.page_index : null,
            evidence_snippets: [],
            extractor_version: v.extractor_version,
            quality_source:
              typeof (v as any)?.quality_flags?.source === "string" ? (v as any).quality_flags.source : null,
            document_title: typeof d?.title === "string" ? d.title : null,
            document_mime_type: typeof (d as any)?.mime_type === "string" ? String((d as any).mime_type) : null,
            document_filename: typeof (d as any)?.filename === "string" ? String((d as any).filename) : null,
            brand_blacklist: new Set<string>(),
            brand_name: null,
          });

          const k = features.source_kind;
          picked[k] = picked[k] ?? 0;
          if (picked[k] >= limitPerKind) continue;
          picked[k] += 1;

          samples.push({
            source_kind: k,
            document_id: v.document_id,
            visual_asset_id: v.id,
            page_index: v.page_index,
            features,
            classification_text: buildClassificationText(features),
          });

          const done = (kind: string) => (picked[kind] ?? 0) >= limitPerKind;
          if (done("vision") && done("image") && done("pptx") && done("docx") && done("xlsx")) break;
        }

        return reply.send({ deal_id: dealId, generated_at: new Date().toISOString(), samples });
      }
    );
  }

  function safeJsonValue(input: unknown): any {
    try {
      if (input == null) return null;
      if (typeof input === "string") {
        const s = input.trim();
        if (!s) return null;
        return JSON.parse(s);
      }
      return input;
    } catch {
      return null;
    }
  }

  function ocrSnippet(text: unknown): string | null {
    if (typeof text !== "string") return null;
    const s = text.replace(/\s+/g, " ").trim();
    if (!s) return null;
    return s.length > 140 ? s.slice(0, 140) : s;
  }

  function deriveStructuredSummary(
    structuredJson: any,
    units: string | null
  ): {
    structured_kind: "table" | "bar" | null;
    structured_summary:
      | { table: { rows: number; cols: number }; method?: string; confidence?: number | null }
      | { bar: { bars: number; title?: string; unit?: string; normalized?: boolean }; method?: string; confidence?: number | null }
      | null;
  } {
    try {
      const parsed = safeJsonValue(structuredJson);
      const sj = parsed && typeof parsed === "object" ? parsed : null;
      if (!sj) return { structured_kind: null, structured_summary: null };

      const asNumber = (v: any): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      // Table: required behavior
      // If structured_json.table exists, attempt to infer rows/cols.
      const tableObj = (sj as any)?.table;
      if (tableObj && typeof tableObj === "object") {
        const tableRowsRaw = (tableObj as any)?.rows;

        let rows: number | null = null;
        let cols: number | null = null;

        if (Array.isArray(tableRowsRaw)) {
          rows = tableRowsRaw.length;
          cols = 0;
          for (const r of tableRowsRaw) {
            if (!Array.isArray(r)) continue;
            cols = Math.max(cols, r.length);
          }
        } else {
          // Fallback table heuristics (older shapes)
          rows = asNumber((sj as any).rows) ?? asNumber((sj as any).row_count) ?? asNumber((tableObj as any)?.row_count);
          cols = asNumber((sj as any).cols) ?? asNumber((sj as any).col_count) ?? asNumber((tableObj as any)?.col_count);
        }

        const methodRaw = (tableObj as any)?.method ?? (sj as any)?.method;
        const method = typeof methodRaw === "string" && methodRaw.trim() ? methodRaw.trim().slice(0, 64) : undefined;

        const confRaw = (tableObj as any)?.confidence ?? (sj as any)?.confidence;
        const confidence = confRaw == null ? null : asNumber(confRaw);

        const structured_summary: any = { table: { rows: rows ?? 0, cols: cols ?? 0 } };
        if (method) structured_summary.method = method;
        if (confidence != null) structured_summary.confidence = confidence;
        return { structured_kind: "table", structured_summary };
      }

      // Bar chart: required behavior
      // If structured_json.chart.type === "bar" OR chart has bar-ish structure, infer bar count.
      const chart = (sj as any)?.chart;
      if (chart && typeof chart === "object") {
        const chartType = (chart as any).type;
        const barsArray = Array.isArray((chart as any).bars) ? (chart as any).bars : null;
        const bars = barsArray ? barsArray.length : asNumber((chart as any).bars);

        const isBar = chartType === "bar" || barsArray != null || bars != null;
        if (!isBar) return { structured_kind: null, structured_summary: null };

        const titleRaw =
          typeof (chart as any).title === "string"
            ? (chart as any).title
            : typeof (chart as any).chart_title === "string"
              ? (chart as any).chart_title
              : typeof (sj as any).title === "string"
                ? (sj as any).title
                : undefined;

        const normalizedRaw = (chart as any).normalized;
        const normalized = typeof normalizedRaw === "boolean" ? normalizedRaw : undefined;

        const unitRaw =
          typeof (chart as any).unit === "string" && (chart as any).unit.trim()
            ? (chart as any).unit.trim()
            : typeof units === "string" && units.trim()
              ? units.trim()
              : undefined;

        const out: { bars: number; title?: string; unit?: string; normalized?: boolean } = { bars: bars ?? 0 };
        if (titleRaw && titleRaw.trim()) out.title = titleRaw.trim().slice(0, 120);
        if (unitRaw) out.unit = unitRaw.slice(0, 40);
        if (normalized !== undefined) out.normalized = normalized;

        const methodRaw = (chart as any)?.method;
        const method = typeof methodRaw === "string" && methodRaw.trim() ? methodRaw.trim().slice(0, 64) : undefined;

        const confRaw = (chart as any)?.confidence;
        const confidence = confRaw == null ? null : asNumber(confRaw);

        const structured_summary: any = { bar: out };
        if (method) structured_summary.method = method;
        if (confidence != null) structured_summary.confidence = confidence;
        return { structured_kind: "bar", structured_summary };
      }

      return { structured_kind: null, structured_summary: null };
    } catch {
      return { structured_kind: null, structured_summary: null };
    }
  }

  function deriveBestExtractionConfidence(params: {
    structuredJson: unknown;
    fallback: unknown;
  }): number | null {
    try {
      const fallbackRaw = params.fallback == null ? null : Number(params.fallback);
      const fallback = fallbackRaw != null && Number.isFinite(fallbackRaw) ? fallbackRaw : null;

      const parsed = safeJsonValue(params.structuredJson);
      if (!parsed || typeof parsed !== "object") return fallback;

      const sj: any = parsed as any;
      const tableConf = sj?.table?.confidence;
      const chartConf = sj?.chart?.confidence;

      const pick = (v: any): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      return pick(tableConf) ?? pick(chartConf) ?? fallback;
    } catch {
      const fallbackRaw = params.fallback == null ? null : Number(params.fallback);
      return fallbackRaw != null && Number.isFinite(fallbackRaw) ? fallbackRaw : null;
    }
  }

  app.get(
    "/api/v1/deals/:deal_id/lineage",
    {
      schema: {
        description: "Return a minimal deal lineage graph (React Flow ready).",
        tags: ["deals"],
        params: {
          type: "object",
          properties: {
            deal_id: { type: "string" },
          },
          required: ["deal_id"],
        },
        querystring: {
          type: "object",
          properties: {
            debug_segments: { type: "string" },
            dump_unknown: { type: "string" },
            segment_audit: { type: "string" },
            segment_rescore: { type: "string" },
          },
          additionalProperties: true,
        },
        response: {
          200: {
            type: "object",
            properties: {
              deal_id: { type: "string" },
              nodes: { type: "array", items: { type: "object", additionalProperties: true } },
              edges: { type: "array", items: { type: "object", additionalProperties: true } },
              warnings: { type: "array", items: { type: "string" } },
              warnings_counters: {
                type: "object",
                properties: {
                  word_members_skipped_empty: { type: "number" },
                  word_groups_skipped_empty: { type: "number" },
                },
                additionalProperties: true,
              },
              unknown_structured_report: { type: "object", additionalProperties: true },
              segment_audit_report: { type: "object", additionalProperties: true },
            },
            required: ["deal_id", "nodes", "edges", "warnings"],
          },
        },
      },
    },
    async (request, reply) => {
    const startTs = Date.now();
    const dealIdRaw = (request.params as any)?.deal_id;
    const dealId = sanitizeText(typeof dealIdRaw === "string" ? dealIdRaw : String(dealIdRaw ?? ""));
    const warnings: string[] = [];

    request.log.info({ msg: "deal.lineage.start", deal_id: dealId, start_ts: new Date(startTs).toISOString() });

    if (!dealId) {
      return reply.status(400).send({ error: "deal_id is required" });
    }

    // Load deal label + minimal metadata if it exists; keep endpoint read-only and resilient.
    let dealName: string | null = null;
    let dealLifecycleStatus: string | null = null;
    let dealScore: number | null = null;
    try {
      const hasLifecycle = await hasColumn(pool, "deals", "lifecycle_status");
      const hasScore = await hasColumn(pool, "deals", "score");
      const selectCols = ["id", "name"].concat(
        hasLifecycle ? ["lifecycle_status"] : [],
        hasScore ? ["score"] : []
      );
      const { rows } = await pool.query<any>(
        `SELECT ${selectCols.join(", ")}
           FROM deals
          WHERE id = $1 AND deleted_at IS NULL
          LIMIT 1`,
        [dealId]
      );
      if (!rows?.[0]) {
        warnings.push("deal not found");
      } else {
        if (typeof rows[0].name === "string" && rows[0].name.trim().length > 0) dealName = rows[0].name;
        if (hasLifecycle && typeof rows[0].lifecycle_status === "string") dealLifecycleStatus = rows[0].lifecycle_status;
        if (hasScore) {
          const s = Number(rows[0].score);
          dealScore = Number.isFinite(s) ? s : null;
        }
      }
    } catch {
      warnings.push("deal lookup failed");
    }

    // Documents are always included if present.
    type DocRow = {
      id: string;
      title: string;
      type: string | null;
      page_count: number | null;
      uploaded_at: string;
      updated_at?: string;
        extraction_metadata?: any;
    };

      let docs: DocRow[] = [];
      let hasExtractionMetadata = false;
      try {
        const hasUpdatedAt = await hasColumn(pool, "documents", "updated_at");
        hasExtractionMetadata = await hasColumn(pool, "documents", "extraction_metadata");
        const { rows } = await pool.query<DocRow & { extraction_metadata?: any }>(
          `SELECT id, title, type, page_count, uploaded_at${hasUpdatedAt ? ", updated_at" : ""}${
            hasExtractionMetadata ? ", extraction_metadata" : ""
          }
           FROM documents
          WHERE deal_id = $1
          ORDER BY ${hasUpdatedAt ? "updated_at" : "uploaded_at"} DESC, uploaded_at DESC, id ASC`,
          [dealId]
        );
        docs = rows ?? [];
      } catch {
        warnings.push("document lookup failed");
        docs = [];
      }

    const dealNodeId = `deal:${dealId}`;
    const nodes: any[] = [
      {
        id: dealNodeId,
        node_id: dealNodeId,
        kind: "deal",
        type: "deal",
        node_type: "DEAL",
        label: dealName || "Deal",
        metadata: {
          deal_id: dealId,
          lifecycle_status: dealLifecycleStatus,
          score: dealScore,
        },
        data: {
          label: dealName || "Deal",
          deal_id: dealId,
          name: dealName,
          lifecycle_status: dealLifecycleStatus,
          score: dealScore,
        },
      },
    ];
    const edges: any[] = [];

    for (const d of docs) {
      const docNodeId = `document:${d.id}`;
      nodes.push({
        id: docNodeId,
        node_id: docNodeId,
        kind: "document",
        type: "document",
        node_type: "DOCUMENT",
        label: d.title,
        metadata: {
          document_id: d.id,
          uploaded_at: d.uploaded_at,
          updated_at: (d as any).updated_at ?? null,
        },
        data: {
          label: d.title,
          document_id: d.id,
          title: d.title,
          type: d.type ?? undefined,
          page_count: typeof d.page_count === "number" ? d.page_count : 0,
        },
      });
      edges.push({
        id: `e:has_document:${dealId}:${d.id}`,
        source: dealNodeId,
        target: docNodeId,
        type: "HAS_DOCUMENT",
        edge_type: "HAS_DOCUMENT",
      });
    }

    // Visual lane is optional; if tables are missing return deal+docs and warnings.
    const visualsOk =
      (await hasTable(pool, "public.visual_assets")) &&
      (await hasTable(pool, "public.visual_extractions")) &&
      (await hasTable(pool, "public.evidence_links"));

    if (!visualsOk) {
      warnings.push("visual extraction tables not installed");
      const endTs = Date.now();
      request.log.info(
        {
          request_id: (request as any).id,
          deal_id: dealId,
          counts: {
            documents: docs.length,
            visual_assets: 0,
            evidence_nodes: 0,
          },
          warnings_count: warnings.length,
          start_ts: new Date(startTs).toISOString(),
          end_ts: new Date(endTs).toISOString(),
          duration_ms: endTs - startTs,
        },
        "deal.lineage"
      );
      return reply.send({ deal_id: dealId, nodes, edges, warnings });
    }

    type VisualRow = {
      id: string;
      document_id: string;
      page_index: number;
      asset_type: string;
      bbox: any;
      image_uri: string | null;
      image_hash: string | null;
      extractor_version: string;
      confidence: number | string;
      quality_flags: any;
      created_at: string;

      ocr_text: string | null;
      ocr_blocks: any;
      structured_json: any;
      units: string | null;
      extraction_confidence: number | string | null;
      structured_kind?: string | null;
      structured_summary?: any;

      extraction_method: string | null;

      evidence_count: number;
      evidence_sample_snippets: string[] | null;

      segment?: string | null;
      segment_confidence?: number | null;
      page_understanding?: PageUnderstanding | null;
    };

    type PageUnderstanding = {
      summary: string | null;
      key_points: string[];
      extracted_signals: Array<{ type: string; value: string; unit?: string | null; confidence?: number | null }>;
      score_contributions: Array<{
        driver: string;
        delta: number;
        rationale: string;
        evidence_ref_ids: string[];
      }>;
    };

      const buildEmptyPageUnderstanding = (): PageUnderstanding => ({
        summary: null,
        key_points: [],
        extracted_signals: [],
        score_contributions: [],
      });

      const normalizePageUnderstanding = (value: unknown): PageUnderstanding => {
        if (!value || typeof value !== "object") return buildEmptyPageUnderstanding();
        const candidate = value as any;
        return {
          summary: typeof candidate.summary === "string" ? candidate.summary : null,
          key_points: Array.isArray(candidate.key_points)
            ? candidate.key_points.filter((k: unknown): k is string => typeof k === "string" && k.trim().length > 0)
            : [],
          extracted_signals: Array.isArray(candidate.extracted_signals)
            ? candidate.extracted_signals.filter(
                (s: unknown): s is { type: string; value: string; unit?: string | null; confidence?: number | null } =>
                  Boolean(s && typeof s === "object")
              )
            : [],
          score_contributions: Array.isArray(candidate.score_contributions)
            ? candidate.score_contributions.filter(
                (s: unknown): s is {
                  driver: string;
                  delta: number;
                  rationale: string;
                  evidence_ref_ids: string[];
                } => Boolean(s && typeof s === "object")
              )
            : [],
        };
      };

      const extractTextForUnderstanding = (input: {
        ocr_text?: string | null;
        structured_json?: any;
        structured_kind?: string | null;
        structured_summary?: any;
        evidence_snippets?: string[] | null;
      }): string | null => {
        const firstEvidence = Array.isArray(input.evidence_snippets)
          ? input.evidence_snippets.find((s) => typeof s === "string" && s.trim().length > 0)
          : null;
        if (firstEvidence) return firstEvidence.trim();

        const ocr = typeof input.ocr_text === "string" ? input.ocr_text : null;
        const snippet = ocrSnippet(ocr);
        if (snippet) return snippet;

        const kind = typeof input.structured_kind === "string" ? input.structured_kind.toLowerCase() : "";
        const ss = input.structured_summary;
        if (kind === "word_group" && typeof ss === "string") {
          const t = ss.trim();
          if (!t) return null;
          return t.length > 600 ? t.slice(0, 600) : t;
        }

        const extractStructuredJsonText = (structuredJson: unknown, maxChars: number): string | null => {
          const parsed = safeJsonValue(structuredJson);
          const sj = parsed && typeof parsed === "object" ? (parsed as any) : null;
          if (!sj) return null;
          const sjKind = typeof sj.kind === "string" ? sj.kind.trim().toLowerCase() : "";

          const parts: string[] = [];
          const push = (v: unknown) => {
            if (typeof v !== "string") return;
            const t = v.replace(/\s+/g, " ").trim();
            if (!t) return;
            parts.push(t);
          };

          if (sjKind === "powerpoint_slide") {
            push(sj.title);
            if (Array.isArray(sj.bullets)) {
              for (const b of sj.bullets.slice(0, 12)) {
                if (typeof b !== "string") continue;
                const t = b.replace(/\s+/g, " ").trim();
                if (!t) continue;
                parts.push(`- ${t}`);
              }
            }
            push(sj.text_snippet);
            push(sj.notes);
          } else if (sjKind === "word_section") {
            push(sj.heading);
            push(sj.text_snippet);
            if (Array.isArray(sj.paragraphs)) {
              for (const p of sj.paragraphs.slice(0, 6)) push(p);
            }
          } else if (typeof sj.text_snippet === "string") {
            push(sj.text_snippet);
          }

          const joined = parts.join("\n").trim();
          if (!joined) return null;
          return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
        };

        const sjText = extractStructuredJsonText(input.structured_json, 600);
        if (sjText) return sjText;

        return null;
      };

      const derivePageSummary = (input: {
        slide_title?: string | null;
        evidence_snippets?: string[] | null;
        ocr_text?: string | null;
        structured_json?: any;
        structured_kind?: string | null;
        structured_summary?: any;
      }): string | null => {
        const parts: string[] = [];
        const title = typeof input.slide_title === "string" ? input.slide_title.trim() : "";
        if (title) parts.push(title);

        const coreText = extractTextForUnderstanding({
          ocr_text: input.ocr_text,
          structured_json: input.structured_json,
          structured_kind: input.structured_kind,
          structured_summary: input.structured_summary,
          evidence_snippets: input.evidence_snippets,
        });
        if (coreText) parts.push(coreText);

        const summary = parts.join(" — ").trim();
        if (!summary) return null;
        return summary.length > 240 ? summary.slice(0, 240) : summary;
      };

      const deriveKeyPointsFromText = (text: unknown): string[] => {
        if (typeof text !== "string") return [];
        const lines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && l.length <= 260);

        const bullets = lines
          .map((line) => {
            const isBullet = /^[-•*@]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
            if (!isBullet) return null;
            const bulletStripped = line
              .replace(/^[-•*@]\s+/, "")
              .replace(/^\d+[.)]\s+/, "")
              .trim();
            if (bulletStripped.length < 3) return null;
            return bulletStripped.slice(0, 220);
          })
          .filter((v): v is string => typeof v === "string" && v.length > 0);

        const unique: string[] = [];
        for (const b of bullets) {
          if (unique.length >= 6) break;
          if (!unique.some((u) => u.toLowerCase() === b.toLowerCase())) unique.push(b);
        }
        return unique;
      };

      const deriveKeyPointsFromOcr = (ocrText: unknown): string[] => {
        if (typeof ocrText !== "string") return [];
        const lines = ocrText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && l.length <= 240);

        const bullets = lines
          .map((line) => {
            const bulletStripped = line
              .replace(/^[-•*]\s+/, "")
              .replace(/^\d+[.)]\s+/, "")
              .trim();
            const isBullet = /^[-•*]/.test(line) || /^\d+[.)]/.test(line);
            if (!isBullet) return null;
            if (bulletStripped.length < 3) return null;
            return bulletStripped.slice(0, 200);
          })
          .filter((v): v is string => typeof v === "string" && v.length > 0);

        const unique: string[] = [];
        for (const b of bullets) {
          if (unique.length >= 5) break;
          if (!unique.some((u) => u.toLowerCase() === b.toLowerCase())) unique.push(b);
        }
        return unique;
      };

      const deriveExtractedSignals = (input: {
        segment_key?: string | null;
        raw_text?: string | null;
        structured_kind?: string | null;
        structured_summary?: any;
      }): PageUnderstanding["extracted_signals"] => {
        const signals: PageUnderstanding["extracted_signals"] = [];
        const kind = typeof input.structured_kind === "string" ? input.structured_kind.toLowerCase() : null;
        const summary = input.structured_summary;

        if (kind === "table" && summary?.table) {
          const rows = Number(summary.table.rows);
          const cols = Number(summary.table.cols);
          if (Number.isFinite(rows)) signals.push({ type: "table_rows", value: String(rows) });
          if (Number.isFinite(cols)) signals.push({ type: "table_cols", value: String(cols) });
        }

        if (kind === "bar" && summary?.bar) {
          const bars = Number(summary.bar.bars);
          if (Number.isFinite(bars)) signals.push({ type: "bar_count", value: String(bars), unit: summary?.bar?.unit ?? undefined });
          const title = typeof summary.bar.title === "string" ? summary.bar.title.trim() : "";
          if (title) signals.push({ type: "bar_title", value: title });
          if (typeof summary.bar.normalized === "boolean") {
            signals.push({ type: "bar_normalized", value: summary.bar.normalized ? "true" : "false" });
          }
        }

        if (kind === "word_group" && typeof input.raw_text === "string") {
          const t = input.raw_text;
          const add = (s: { type: string; value: string; unit?: string | null; confidence?: number | null }) => {
            if (signals.length >= 10) return;
            signals.push(s);
          };

          const currencyRe = /\$\s?\d+(?:[\d,]*\d)?(?:\.\d+)?\s?(?:[kKmMbB])?/g;
          const pctRe = /\b\d+(?:\.\d+)?%\b/g;
          const countPlusRe = /\b\d+\+\b/g;
          const marketsRe = /\b(?:AZ|FL|NV|PA|CA|NY|TX|WA|IL)\b/g;

          const currency = Array.from(t.matchAll(currencyRe)).map((m) => m[0].replace(/\s+/g, "").trim());
          for (const c of currency.slice(0, 4)) add({ type: "currency_amount", value: c });

          const pcts = Array.from(t.matchAll(pctRe)).map((m) => m[0].trim());
          for (const p of pcts.slice(0, 4)) add({ type: "percent", value: p });

          const counts = Array.from(t.matchAll(countPlusRe)).map((m) => m[0].trim());
          for (const c of counts.slice(0, 4)) add({ type: "count_hint", value: c });

          const markets = Array.from(t.matchAll(marketsRe)).map((m) => m[0].trim());
          const uniqMarkets = Array.from(new Set(markets));
          if (uniqMarkets.length > 0) add({ type: "geo_markets", value: uniqMarkets.slice(0, 6).join(",") });

          const seg = typeof input.segment_key === "string" ? input.segment_key : null;
          if (seg && seg !== "unknown") add({ type: "segment", value: seg });
        }

        return signals;
      };

      const deriveScoreContributions = (input: {
        segment_key?: string | null;
        raw_text?: string | null;
      }): PageUnderstanding["score_contributions"] => {
        const seg = typeof input.segment_key === "string" ? input.segment_key : null;
        const text = typeof input.raw_text === "string" ? input.raw_text.toLowerCase() : "";
        if (!seg || seg === "unknown") return [];

        const driverBySeg: Record<string, string> = {
          market: "market_strength",
          traction: "traction",
          distribution: "go_to_market",
          business_model: "business_model",
          team: "team_strength",
          financials: "financial_health",
          risks: "risk_profile",
          competition: "competitive_moat",
        };

        const driver = driverBySeg[seg] ?? `segment_${seg}`;

        const posHits = ["strong", "proven", "growth", "partnership", "advantage", "automation", "launch", "achieve", "reorders"].filter((k) => text.includes(k)).length;
        const negHits = ["risk", "lack", "challenge", "uncertain", "legal", "compliance", "burn", "loss"].filter((k) => text.includes(k)).length;
        const delta = Math.max(-1, Math.min(1, (posHits - negHits) * 0.15));

        const rationale =
          delta > 0
            ? `Positive signals detected in ${seg} section.`
            : delta < 0
              ? `Risk signals detected in ${seg} section.`
              : `No clear directional signal detected for ${seg} section.`;

        // These are heuristic placeholders until score linking is implemented.
        return [
          {
            driver,
            delta,
            rationale,
            evidence_ref_ids: [],
          },
        ];
      };

      const buildPageUnderstanding = (input: {
        slide_title?: string | null;
        evidence_snippets?: string[] | null;
        ocr_text?: string | null;
        segment_key?: string | null;
        structured_json?: any;
        structured_kind?: string | null;
        structured_summary?: any;
      }): PageUnderstanding => {
        const summary = derivePageSummary({
          slide_title: input.slide_title,
          evidence_snippets: input.evidence_snippets,
          ocr_text: input.ocr_text,
          structured_json: input.structured_json,
          structured_kind: input.structured_kind,
          structured_summary: input.structured_summary,
        });

        const rawText = extractTextForUnderstanding({
          ocr_text: input.ocr_text,
          structured_json: input.structured_json,
          structured_kind: input.structured_kind,
          structured_summary: input.structured_summary,
          evidence_snippets: input.evidence_snippets,
        });

        const key_points = (
          (deriveKeyPointsFromText(rawText).length > 0 ? deriveKeyPointsFromText(rawText) : deriveKeyPointsFromOcr(input.ocr_text))
        ).slice(0, 6);
        const extracted_signals = deriveExtractedSignals({
          segment_key: input.segment_key,
          raw_text: rawText,
          structured_kind: input.structured_kind,
          structured_summary: input.structured_summary,
        });

        const score_contributions = deriveScoreContributions({ segment_key: input.segment_key, raw_text: rawText });

        return normalizePageUnderstanding({
          summary,
          key_points,
          extracted_signals,
          score_contributions,
        });
      };

    let visuals: VisualRow[] = [];
    const slideTitleDebug = process.env.DDAI_DEV_SLIDE_TITLE_DEBUG === "1";
    const debugSegments =
      process.env.NODE_ENV !== "production" && String(((request.query as any) ?? {})?.debug_segments ?? "") === "1";
    const dumpUnknown = debugSegments && String(((request.query as any) ?? {})?.dump_unknown ?? "") === "1";
    const segmentAuditRequested = String(((request.query as any) ?? {})?.segment_audit ?? "") === "1";
    const segmentAuditEnabled = debugSegments && segmentAuditRequested;
    const segmentRescoreRequested = segmentAuditEnabled && String(((request.query as any) ?? {})?.segment_rescore ?? "") === "1";
    const groupWordEnabled = parseBoolQ(((request.query as any) ?? {})?.group_word, false);
    const debugWordRaw = parseBoolQ(((request.query as any) ?? {})?.debug_word_raw, false);
    const groupPptxEnabled = parseBoolQ(((request.query as any) ?? {})?.group_pptx, true);
    const debugPptxRaw = parseBoolQ(((request.query as any) ?? {})?.debug_pptx_raw, false);
    try {
      const hasOcrBlocks = await hasColumn(pool, "visual_extractions", "ocr_blocks");
      const hasUnits = await hasColumn(pool, "visual_extractions", "units");
      const hasExtractionConfidence = await hasColumn(pool, "visual_extractions", "extraction_confidence");
      const hasStructuredKind = await hasColumn(pool, "visual_extractions", "structured_kind");
      const hasStructuredSummary = await hasColumn(pool, "visual_extractions", "structured_summary");
      const ocrBlocksSelect = hasOcrBlocks ? "ve.ocr_blocks" : "NULL::jsonb AS ocr_blocks";
      const structuredSummarySelect = hasStructuredSummary ? "ve.structured_summary" : "NULL::jsonb AS structured_summary";

      const { rows } = await pool.query<VisualRow>(
        `WITH latest_extractions AS (
           SELECT ve.visual_asset_id,
                  ve.ocr_text,
                  ${ocrBlocksSelect},
                  ve.structured_json,
                  ${structuredSummarySelect},
                  ${hasUnits ? "ve.units" : "NULL::text AS units"},
                  ${hasExtractionConfidence ? "ve.extraction_confidence" : "NULL::numeric AS extraction_confidence"},
                  ${hasStructuredKind ? "ve.structured_kind" : "NULL::text AS structured_kind"},
                  ROW_NUMBER() OVER (PARTITION BY ve.visual_asset_id ORDER BY ve.created_at DESC) AS rn
             FROM visual_extractions ve
        )
         SELECT
           va.id,
           va.document_id,
           va.page_index,
           va.asset_type,
           va.bbox,
           va.image_uri,
           va.image_hash,
           va.extractor_version,
           va.confidence,
           va.quality_flags,
           va.created_at,
           COALESCE(ev.count, 0) AS evidence_count,
           COALESCE(ev.sample_snippets, ARRAY[]::text[]) AS evidence_sample_snippets,
           le.ocr_text,
           le.ocr_blocks,
           le.structured_json,
           le.structured_summary,
           le.units,
           le.extraction_confidence,
           le.structured_kind
         FROM visual_assets va
         JOIN documents d ON d.id = va.document_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS count,
                  ARRAY(
                  SELECT LEFT(el.snippet, 200)
                   FROM evidence_links el
                  WHERE el.visual_asset_id = va.id AND el.snippet IS NOT NULL AND el.snippet <> ''
                  ORDER BY el.created_at DESC
                     LIMIT 3
                  ) AS sample_snippets
             FROM evidence_links el2
            WHERE el2.visual_asset_id = va.id
         ) ev ON true
         LEFT JOIN LATERAL (
           SELECT ocr_text, ocr_blocks, structured_json, structured_summary, units, extraction_confidence, structured_kind
             FROM latest_extractions le
            WHERE le.visual_asset_id = va.id AND le.rn = 1
         ) le ON true
         WHERE d.deal_id = $1
         ORDER BY va.document_id ASC, va.page_index ASC, va.created_at ASC`,
        [dealId]
      );
      visuals = rows ?? [];
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "unknown error";
      warnings.push(`visual asset lookup failed: ${msg.slice(0, 160)}`);
      request.log?.error?.(
        {
          deal_id: dealId,
          err: msg,
          stack: typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 5).join(" | ") : undefined,
        },
        "deal.lineage.visuals_query_failed"
      );
      visuals = [];
    }

    const brandModelByDocId = new Map<string, BrandModel>();
    const brandNameByDocId = new Map<string, { brand: string | null; confidence: number | null }>();

    for (const d of docs) {
      const pageInputs: PageInput[] = visuals
        .filter((v) => v.document_id === d.id)
        .map((v) => ({ ocr_blocks: (v as any).ocr_blocks ?? null, ocr_text: v.ocr_text ?? null }));

      const brandModel = buildBrandModel(pageInputs);

      const brandInfo = inferDocumentBrandName(pageInputs);
      if (brandInfo.brand_name) {
        const normBrand = normalizePhrase(brandInfo.brand_name);
        if (normBrand) brandModel.phrases.add(normBrand);
      }

      brandModelByDocId.set(d.id, brandModel);
      brandNameByDocId.set(d.id, { brand: brandInfo.brand_name, confidence: brandInfo.confidence });

      if (hasExtractionMetadata && brandInfo.brand_name) {
        const metadata = ((d as any).extraction_metadata ?? {}) as Record<string, any>;
        const existing = metadata.brand_name;
        if (!existing?.value) {
          metadata.brand_name = { value: brandInfo.brand_name, confidence: brandInfo.confidence };
          try {
            await pool.query(
              `UPDATE documents SET extraction_metadata = $2, updated_at = now() WHERE id = $1`,
              [d.id, metadata]
            );
          } catch {
            warnings.push("failed to persist document brand_name");
          }
        }
      }
    }

    const segmentInputByVisualId = new Map<string, SegmentClassifierInput>();

    const visualsWithSegmentsPass1 = visuals.map((v) => {
      const brandModel = brandModelByDocId.get(v.document_id) ?? buildBrandModel([]);
      const blacklist = brandModel.phrases;
      const brandInfo = brandNameByDocId.get(v.document_id) ?? { brand: null, confidence: null };
      const derivedStructure = deriveStructuredSummary((v as any)?.structured_json, (v as any)?.units ?? null);
      const structuredKindFromJson = (() => {
        const sj = (v as any)?.structured_json;
        const sjObj = safeJsonValue(sj);
        const kindRaw = sjObj && typeof sjObj === "object" ? (sjObj as any).kind : null;
        const kind = typeof kindRaw === "string" ? kindRaw.trim().toLowerCase() : "";
        if (!kind) return null;
        if (kind === "word_section") return "word_section";
        if (kind === "powerpoint_slide") return "powerpoint_slide";
        if (kind === "excel_sheet") return "excel_sheet";
        return null;
      })();

      const structured_kind = (v as any)?.structured_kind ?? derivedStructure.structured_kind ?? structuredKindFromJson;
      const structured_summary = (v as any)?.structured_summary ?? derivedStructure.structured_summary;

      const titleDerived = inferSlideTitleForSlide({
        blocks: (v as any).ocr_blocks as any[],
        ocr_text: v.ocr_text,
        page_width: null,
        page_height: null,
        brandModel,
        enableDebug: slideTitleDebug,
      });

      const structuredSlideTitle = (() => {
        const sjObj = safeJsonValue((v as any)?.structured_json);
        if (!sjObj || typeof sjObj !== "object") return null;
        const kind = typeof (sjObj as any).kind === "string" ? String((sjObj as any).kind).toLowerCase() : "";
        if (kind !== "powerpoint_slide") return null;
        const title = typeof (sjObj as any).title === "string" ? String((sjObj as any).title).trim() : "";
        return title.length > 0 ? title.slice(0, 180) : null;
      })();

      const slide_title = titleDerived.slide_title ?? structuredSlideTitle;
      const slide_title_source = titleDerived.slide_title
        ? titleDerived.slide_title_source
        : structuredSlideTitle
          ? "structured_json.title"
          : null;
      const slide_title_confidence = titleDerived.slide_title
        ? titleDerived.slide_title_confidence
        : structuredSlideTitle
          ? 0.9
          : null;

      const page_understanding = normalizePageUnderstanding((v as any)?.page_understanding);

      // Segment resolution order (effective truth, non-destructive):
      // 1) human_override (quality_flags.segment_source === 'human_override' or 'human_override_*')
      // 2) promoted/persisted (quality_flags.segment_key)
      // 3) computed (API classifier)
      // 4) unknown
      // NOTE: structured_json.segment_key is treated as an input/persisted hint but does not override computed.
      const persistedFromQualityRaw = normalizeAnalystSegment((v as any)?.quality_flags?.segment_key);
      const persistedFromStructuredRaw = normalizeAnalystSegment((v as any)?.structured_json?.segment_key);
      const qualitySourceRaw =
        typeof (v as any)?.quality_flags?.source === "string" ? String((v as any).quality_flags.source) : null;
      const qualitySegmentSourceRawDirect =
        typeof (v as any)?.quality_flags?.segment_source === "string" ? String((v as any).quality_flags.segment_source) : null;
      const qualityPersistMarker = qualitySegmentSourceRawDirect ?? qualitySourceRaw;
      const allowQualityPersist = (() => {
        const s = typeof qualityPersistMarker === "string" ? qualityPersistMarker.trim() : "";
        if (!s) return false;
        if (s === "human_override" || s === "human_override_v1" || s.startsWith("human_override_")) return true;
        if (s.startsWith("promoted") || s.startsWith("promoted_")) return true;
        if (s.startsWith("structured_")) return true;
        return false;
      })();

      const persistedFromQuality =
        allowQualityPersist && persistedFromQualityRaw && persistedFromQualityRaw !== "unknown" ? persistedFromQualityRaw : null;
      const persistedFromStructured = persistedFromStructuredRaw && persistedFromStructuredRaw !== "unknown" ? persistedFromStructuredRaw : null;
      const persistedSegmentKey = persistedFromQuality ?? persistedFromStructured;
      const persistedSourceKey = persistedFromQuality
        ? "quality_flags.segment_key"
        : persistedFromStructured
          ? "structured_json.segment_key"
          : null;

      const qualitySegmentSourceRaw = qualityPersistMarker;

      const isHumanOverride = Boolean(
        persistedFromQuality &&
          (qualitySegmentSourceRaw === "human_override" ||
            qualitySegmentSourceRaw === "human_override_v1" ||
            Boolean(qualitySegmentSourceRaw?.startsWith("human_override_")))
      );

      const isStructuredAsset =
        String((v as any)?.extractor_version ?? "") === "structured_native_v1" ||
        (typeof (v as any)?.quality_flags?.source === "string" && String((v as any).quality_flags.source).startsWith("structured_")) ||
        (typeof (v as any)?.structured_json?.kind === "string" && ["word_section", "powerpoint_slide", "excel_sheet"].includes(String((v as any).structured_json.kind)));

      // Prefer worker-provided structured_json.segment_key when present; otherwise fall back to persisted/promoted key.
      // Only pass hints for structured assets (vision should be hint-free).
      const hintSegment = isStructuredAsset ? (persistedFromStructured ?? persistedFromQuality) : null;

      const baseInput: SegmentClassifierInput = {
        ocr_text: v.ocr_text,
        ocr_snippet: ocrSnippet(v.ocr_text),
        structured_kind,
        structured_summary,
        structured_json: (v as any)?.structured_json,
        asset_type: v.asset_type,
        page_index: v.page_index,
        slide_title: titleDerived.slide_title,
        slide_title_confidence: titleDerived.slide_title_confidence,
        evidence_snippets: Array.isArray((v as any).evidence_sample_snippets) ? (v as any).evidence_sample_snippets : [],
        brand_blacklist: blacklist,
        brand_name: brandInfo.brand,
        extractor_version: (v as any)?.extractor_version,
        quality_source: (v as any)?.quality_flags?.source,
        enable_debug: debugSegments,
        include_debug_text_snippet: dumpUnknown || segmentAuditEnabled,
        // Make computed_v1 deterministic and independent of worker-provided segment_key.
        disable_structured_segment_key_signal: true,
        disable_structured_segment_key_fallback: true,
      };

      if (typeof (v as any)?.id === "string") segmentInputByVisualId.set(String((v as any).id), baseInput);

      const computed = classifySegment({ ...baseInput, hint_segment: hintSegment });

    const computedReason = (() => {
      if (computed.segment !== "unknown") return null;
      const hasOcr = typeof v.ocr_text === "string" && v.ocr_text.trim().length > 0;
      const hasTitle = typeof slide_title === "string" && slide_title.trim().length > 0;
      const reasonCode = hasOcr || hasTitle ? "LOW_SIGNAL" : "NO_TEXT";
      return {
        rule_id: "UNKNOWN_CLASSIFICATION_V1",
        unknown_reason_code: reasonCode,
      };
    })();

      const effectiveSegment = isHumanOverride
        ? (persistedFromQuality ?? computed.segment)
        : persistedFromQuality
          ? persistedFromQuality
          : computed.segment;

      const persistedConfidenceRaw = (v as any)?.quality_flags?.segment_confidence;
      const persistedConfidence = typeof persistedConfidenceRaw === "number" && Number.isFinite(persistedConfidenceRaw) ? persistedConfidenceRaw : 1;
      const effectiveConfidence = persistedFromQuality ? persistedConfidence : computed.confidence;

      const effectiveSource = (() => {
        if (persistedFromQuality) {
          if (isHumanOverride) return qualitySegmentSourceRaw || "human_override_v1";
          return qualitySegmentSourceRaw || "persisted_v0";
        }
        return "computed_v1";
      })();

      const rescore = persistedSegmentKey && segmentRescoreRequested
        ? classifySegment({
            ocr_text: v.ocr_text,
            ocr_snippet: ocrSnippet(v.ocr_text),
            structured_kind,
            structured_summary,
            structured_json: (v as any)?.structured_json,
            asset_type: v.asset_type,
            page_index: v.page_index,
            slide_title: titleDerived.slide_title,
            slide_title_confidence: titleDerived.slide_title_confidence,
            evidence_snippets: Array.isArray((v as any).evidence_sample_snippets) ? (v as any).evidence_sample_snippets : [],
            brand_blacklist: blacklist,
            brand_name: brandInfo.brand,
            extractor_version: (v as any)?.extractor_version,
            quality_source: (v as any)?.quality_flags?.source,
            hint_segment: hintSegment,
            enable_debug: true,
            include_debug_text_snippet: true,
            disable_structured_segment_key_signal: true,
            disable_structured_segment_key_fallback: true,
          })
        : null;

      const computedDebug = debugSegments ? computed.debug : undefined;

      return {
        ...v,
        structured_summary,
        structured_kind,
        slide_title,
        slide_title_source,
        slide_title_confidence,
        slide_title_warnings: titleDerived.slide_title_warnings,
        slide_title_debug: titleDerived.slide_title_debug,
        // Backwards-compatible, but now explicitly the effective segment.
        segment: effectiveSegment,
        effective_segment: effectiveSegment,
        segment_source: effectiveSource,
        segment_confidence: effectiveConfidence,
        // Always expose computed + persisted fields for provenance.
        computed_segment: computed.segment,
        computed_confidence: computed.confidence,
        computed_reason: (v as any)?.computed_reason ?? computedReason,
        persisted_segment_key: persistedSegmentKey,
        persisted_segment_source: persistedSourceKey,
        segment_debug: computedDebug,
        ...(rescore
          ? {
              segment_rescore_segment: rescore.segment,
              segment_rescore_confidence: rescore.confidence,
              segment_rescore_debug: rescore.debug,
            }
          : {}),
      } as VisualRow & { structured_summary?: unknown };
    });

    // Option A: DOCX doc-level hint propagation for low-signal structured_word blocks.
    const docHintByDocId = computeDocHintSegmentByDocId(visualsWithSegmentsPass1 as any, { minMajorityPct: 0.6 });

    const visualsWithSegments = visualsWithSegmentsPass1.map((v: any) => {
      if (!isStructuredWordSectionAsset(v)) return v;
      if (isEmptyStructuredWordSectionAsset(v)) return v;

      const persisted = pickNonUnknownSegment(v?.persisted_segment_key);
      if (persisted) return v;

      const computedSeg = normalizeAnalystSegment(v?.computed_segment);

      // First: doc-level hint propagation for structured_word blocks that are still unknown.
      let out: any = v;
      if (!computedSeg || computedSeg === "unknown") {
        const docId = typeof v?.document_id === "string" ? v.document_id : null;
        const hint = docId ? (docHintByDocId.get(docId) ?? null) : null;
        if (hint) {
          const base = segmentInputByVisualId.get(String(v?.id ?? ""));
          if (base) {
            const recomputed = classifySegment({ ...base, hint_segment: hint });
            const seg = normalizeAnalystSegment(recomputed.segment) ?? "unknown";
            if (seg !== "unknown") {
              out = {
                ...v,
                segment: seg,
                effective_segment: seg,
                segment_source: "doc_hint_v1",
                segment_confidence: recomputed.confidence,
                computed_segment: seg,
                computed_confidence: recomputed.confidence,
                computed_reason: {
                  rule_id: "DOCX_DOC_HINT_FALLBACK",
                  doc_hint_segment: hint,
                },
              };
            }
          }
        }
      }

      // Second: cue-based rescue for structured_word blocks that are still unknown.
      const outComputed = normalizeAnalystSegment(out?.computed_segment);
      if (!outComputed || outComputed === "unknown") {
        const inferred = inferStructuredWordCueSegment(out);
        if (inferred) {
          out = {
            ...out,
            segment: inferred.segment,
            effective_segment: inferred.segment,
            segment_source: "docx_cue_v1",
            segment_confidence: inferred.confidence,
            computed_segment: inferred.segment,
            computed_confidence: inferred.confidence,
            computed_reason: {
              rule_id: "DOCX_CUE_RULE_V1",
              matched: inferred.matched,
            },
          };
        }
      }

      return out;
    });

    const unknownStructuredReport = (() => {
      if (!dumpUnknown) return null;

      const bucketBestScore = (bestScore: number): string => {
        if (!Number.isFinite(bestScore)) return "<0.15";
        if (bestScore < 0.15) return "<0.15";
        if (bestScore < 0.25) return "0.15-0.25";
        if (bestScore < 0.35) return "0.25-0.35";
        return ">=0.35";
      };

      const items = visualsWithSegments
        .filter((v: any) => {
          const seg = typeof v?.segment === "string" ? v.segment : "";
          const src = typeof v?.segment_debug?.classification_source === "string" ? v.segment_debug.classification_source : null;
          // Under computed-first, we still want to understand unknowns driven by structured/vision sources.
          return (src === "structured" || src === "vision" || src === "persisted") && seg === "unknown";
        })
        .map((v: any) => {
          const qSource = typeof v?.quality_flags?.source === "string" ? v.quality_flags.source : null;
          const debug = v?.segment_debug ?? null;
          const top = Array.isArray(debug?.top_scores) ? debug.top_scores : [];
          const best = top[0] ?? null;
          const runnerUp = top[1] ?? null;
          const bestScore = typeof best?.score === "number" ? best.score : 0;
          const sourcesUsed = Array.isArray(debug?.classification_text_sources_used)
            ? debug.classification_text_sources_used
            : [];

          return {
            visual_asset_id: v.id,
            document_id: v.document_id,
            extractor_version: v.extractor_version ?? null,
            quality_source: qSource,
            classification_text_len: typeof debug?.classification_text_len === "number" ? debug.classification_text_len : null,
            classification_text_snippet: typeof debug?.classification_text_snippet === "string" ? debug.classification_text_snippet : null,
            classification_text_sources_used: sourcesUsed,
            top_scores: top,
            best_segment: typeof best?.segment === "string" ? best.segment : null,
            best_score: typeof best?.score === "number" ? best.score : null,
            runner_up_segment: typeof runnerUp?.segment === "string" ? runnerUp.segment : null,
            runner_up_score: typeof runnerUp?.score === "number" ? runnerUp.score : null,
            best_score_bucket: bucketBestScore(bestScore),
            sources_used_present: sourcesUsed.length > 0,
          };
        });

      const countBy = (rows: any[], keyFn: (r: any) => string): Array<{ key: string; n: number }> => {
        const map = new Map<string, number>();
        for (const r of rows) {
          const k = keyFn(r);
          map.set(k, (map.get(k) ?? 0) + 1);
        }
        return Array.from(map.entries())
          .map(([key, n]) => ({ key, n }))
          .sort((a, b) => b.n - a.n);
      };

      const summary = {
        total_unknown_structured: items.length,
        unknown_by_quality_source: countBy(items, (r) => (typeof r.quality_source === "string" ? r.quality_source : "missing")),
        unknown_by_sources_used_presence: countBy(items, (r) => (r.sources_used_present ? "populated" : "empty")),
        unknown_by_best_score_bucket: countBy(items, (r) => (typeof r.best_score_bucket === "string" ? r.best_score_bucket : "<0.15")),
      };

      try {
        // eslint-disable-next-line no-console
        console.log("[DEV dump_unknown structured]", { deal_id: dealId, summary });
      } catch {
        // ignore
      }

      return { summary, items };
    })();

    let didLogSlideTitle = false;

    // Segment nodes are document-scoped: Deal -> Document -> Segment -> Visual -> Evidence.
    const segmentNodeIds = new Set<string>();
    const documentSegmentEdgeIds = new Set<string>();
    let didWarnMissingDocumentId = false;

    const formatSegmentLabel = (seg: string) =>
      seg.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    type PptxGroup = {
      __pptx_group: true;
      visual_asset_group_id: string;
      document_id: string;
      page_index: number;
      page_label: string;
      heading: string | null;
      member_visual_asset_ids: string[];
      captured_text: string;
      evidence_count_total: number;
      evidence_snippets: string[];
      structured_json: any;
      persisted_segment_key: string | null;
      persisted_segment_source: string | null;
      computed_segment: string;
      computed_confidence: number;
      computed_reason: any;
      effective_segment: string;
      segment_source: string;
      segment_confidence: number;
      segment_promoted_at: null;
      segment_overridden_at: null;
      segment_override_note: null;
    };

    const pptxGroups: PptxGroup[] = (() => {
      if (!groupPptxEnabled) return [];

      const structuredByDocPage = new Map<string, any>();
      const visionByDocPage = new Map<string, any>();
      const structuredDocIds = new Set<string>();

      const asDocPageKey = (docId: string, pageIndex: number) => `${docId}::${pageIndex}`;

      const isStructuredPptxSlide = (v: any): boolean => {
        const extractorVersion = typeof v?.extractor_version === "string" ? String(v.extractor_version) : "";
        if (extractorVersion !== "structured_native_v1") return false;
        const qSource = typeof v?.quality_flags?.source === "string" ? String(v.quality_flags.source) : "";
        const kind = typeof v?.structured_json?.kind === "string" ? String(v.structured_json.kind) : "";
        if (qSource.includes("structured_powerpoint")) return true;
        if (kind === "powerpoint_slide") return true;
        return false;
      };

      for (const v of visualsWithSegments as any[]) {
        const docId = typeof v?.document_id === "string" ? v.document_id : null;
        const pageIndex = typeof v?.page_index === "number" ? v.page_index : null;
        const id = typeof v?.id === "string" ? v.id : null;
        if (!docId || pageIndex == null || !id) continue;
        if (!isStructuredPptxSlide(v)) continue;
        structuredDocIds.add(docId);
        structuredByDocPage.set(asDocPageKey(docId, pageIndex), v);
      }

      for (const v of visualsWithSegments as any[]) {
        const docId = typeof v?.document_id === "string" ? v.document_id : null;
        const pageIndex = typeof v?.page_index === "number" ? v.page_index : null;
        const id = typeof v?.id === "string" ? v.id : null;
        if (!docId || pageIndex == null || !id) continue;
        if (!structuredDocIds.has(docId)) continue;
        const extractorVersion = typeof v?.extractor_version === "string" ? String(v.extractor_version) : "";
        if (extractorVersion !== "vision_v1") continue;
        visionByDocPage.set(asDocPageKey(docId, pageIndex), v);
      }

      const buildCapturedText = (structuredSlideJson: any, ocrText: string | null): string => {
        const sjObj = safeJsonValue(structuredSlideJson);
        const sj = sjObj && typeof sjObj === "object" ? (sjObj as any) : null;
        const title = typeof sj?.title === "string" ? sj.title.trim() : "";
        const bullets = Array.isArray(sj?.bullets) ? sj.bullets : [];
        const notes = typeof sj?.notes === "string" ? sj.notes.trim() : "";
        const textSnippet = typeof sj?.text_snippet === "string" ? sj.text_snippet.trim() : "";
        const ocr = typeof ocrText === "string" ? ocrText.trim() : "";

        const parts: string[] = [];
        if (title) parts.push(title);
        if (bullets.length > 0) {
          for (const b of bullets.slice(0, 12)) {
            if (typeof b !== "string") continue;
            const t = b.replace(/\s+/g, " ").trim();
            if (!t) continue;
            parts.push(`- ${t}`);
          }
        }
        if (textSnippet) parts.push(textSnippet);
        if (notes) parts.push(`Notes: ${notes}`);
        if (ocr) parts.push(`OCR: ${ocrSnippet(ocr) ?? ""}`.trim());

        const joined = parts.join("\n").trim();
        if (!joined) return "";
        return joined.length > 1500 ? joined.slice(0, 1500) : joined;
      };

      const groups: PptxGroup[] = [];
      for (const [k, structuredSlide] of structuredByDocPage.entries()) {
        const visionSlide = visionByDocPage.get(k);
        if (!visionSlide) continue; // only group when both exist

        const docId = typeof structuredSlide?.document_id === "string" ? structuredSlide.document_id : null;
        const pageIndex = typeof structuredSlide?.page_index === "number" ? structuredSlide.page_index : null;
        if (!docId || pageIndex == null) continue;

        const groupId = `pptx_slide_${docId}_${pageIndex}`;
        const memberIds = [String(structuredSlide.id), String(visionSlide.id)];

        const structuredJson = safeJsonValue(structuredSlide.structured_json);
        const title = typeof (structuredJson as any)?.title === "string" ? String((structuredJson as any).title).trim() : "";
        const pageLabel = title ? `Slide ${pageIndex + 1} • ${title}` : `Slide ${pageIndex + 1}`;

        const capturedText = buildCapturedText(structuredJson, typeof visionSlide?.ocr_text === "string" ? visionSlide.ocr_text : null);

        const evidenceSnippetsRaw: string[] = [];
        const addSnips = (snips: unknown) => {
          if (!Array.isArray(snips)) return;
          for (const s of snips) {
            if (typeof s !== "string") continue;
            const t = s.trim();
            if (!t) continue;
            evidenceSnippetsRaw.push(t);
          }
        };

        addSnips(structuredSlide.evidence_sample_snippets);
        addSnips(visionSlide.evidence_sample_snippets);

        const uniqEvidence: string[] = [];
        for (const s of evidenceSnippetsRaw) {
          if (uniqEvidence.length >= 6) break;
          if (!uniqEvidence.some((u) => u.toLowerCase() === s.toLowerCase())) uniqEvidence.push(s);
        }

        const hintSegment =
          majorityNonUnknownSegment([
            structuredSlide?.persisted_segment_key,
            structuredSlide?.effective_segment,
            (structuredSlide?.structured_json as any)?.segment_key,
            visionSlide?.persisted_segment_key,
            visionSlide?.effective_segment,
            (visionSlide?.structured_json as any)?.segment_key,
          ]) ?? null;

        const persistedSegmentKey =
          majorityNonUnknownSegment([structuredSlide?.persisted_segment_key, visionSlide?.persisted_segment_key]) ?? null;

        const computed = classifySegment({
          ocr_text: typeof visionSlide?.ocr_text === "string" ? visionSlide.ocr_text : null,
          ocr_snippet: capturedText ? capturedText.slice(0, 140) : null,
          structured_kind: "powerpoint_slide",
          structured_summary: null,
          structured_json: structuredJson,
          asset_type: "pptx_slide_group",
          page_index: pageIndex,
          slide_title: title || null,
          slide_title_confidence: title ? 0.9 : null,
          evidence_snippets: uniqEvidence,
          brand_blacklist: new Set<string>(),
          brand_name: null,
          extractor_version: "structured_native_v1",
          quality_source: "structured_powerpoint",
          hint_segment: hintSegment,
          enable_debug: false,
          include_debug_text_snippet: false,
          disable_structured_segment_key_signal: true,
          disable_structured_segment_key_fallback: true,
        });

        const hasHumanOverride = (() => {
          const srcs = [structuredSlide?.segment_source, visionSlide?.segment_source].map((s: any) => (typeof s === "string" ? s : ""));
          if (!persistedSegmentKey) return false;
          return srcs.some((s) => s === "human_override" || s === "human_override_v1" || s.startsWith("human_override_"));
        })();

        const effectiveSegment = hasHumanOverride
          ? (persistedSegmentKey ?? computed.segment)
          : persistedSegmentKey
            ? persistedSegmentKey
            : computed.segment;

        const segmentSource = (() => {
          if (hasHumanOverride && persistedSegmentKey) return "human_override_v1";
          if (persistedSegmentKey) return "persisted_v0";
          return "computed_v1";
        })();

        const segmentConfidence = persistedSegmentKey ? 1 : computed.confidence;

        groups.push({
          __pptx_group: true,
          visual_asset_group_id: groupId,
          document_id: docId,
          page_index: pageIndex,
          page_label: pageLabel,
          heading: title || null,
          member_visual_asset_ids: memberIds,
          captured_text: capturedText,
          evidence_count_total:
            (Number.isFinite(structuredSlide?.evidence_count) ? Number(structuredSlide.evidence_count) : 0) +
            (Number.isFinite(visionSlide?.evidence_count) ? Number(visionSlide.evidence_count) : 0),
          evidence_snippets: uniqEvidence,
          structured_json: {
            kind: "powerpoint_group",
            slide: structuredJson,
            vision_visual_asset_id: String(visionSlide.id),
            structured_visual_asset_id: String(structuredSlide.id),
            member_visual_asset_ids: memberIds,
            page_index: pageIndex,
            slide_number: typeof (structuredJson as any)?.slide_number === "number" ? (structuredJson as any).slide_number : pageIndex + 1,
            title: title || null,
            segment_key: effectiveSegment,
            effective_segment: effectiveSegment,
          },
          persisted_segment_key: persistedSegmentKey,
          persisted_segment_source: persistedSegmentKey ? "group_majority" : null,
          computed_segment: computed.segment,
          computed_confidence: computed.confidence,
          computed_reason: computed.debug ?? null,
          effective_segment: effectiveSegment,
          segment_source: segmentSource,
          segment_confidence: segmentConfidence,
          segment_promoted_at: null,
          segment_overridden_at: null,
          segment_override_note: null,
        });
      }

      // Stable ordering
      groups.sort((a, b) => {
        if (a.document_id !== b.document_id) return a.document_id.localeCompare(b.document_id);
        if (a.page_index !== b.page_index) return a.page_index - b.page_index;
        return a.visual_asset_group_id.localeCompare(b.visual_asset_group_id);
      });

      return groups;
    })();

    let wordGroupingStatsForLineage: WordGroupingStats | null = null;

    const wordGroups = (() => {
      // Captured for response warning counters.
      // Initialized here to keep grouping deterministic and easy to test.
      if (!groupWordEnabled) return [] as any[];
      const { groups: rawGroups, stats } = groupWordVisualAssetsByDocumentWithStats(visualsWithSegments as any, { maxBlocksPerGroup: 8, maxCapturedChars: 1500 });
      wordGroupingStatsForLineage = stats;

      const byId = new Map<string, any>();
      for (const v of visualsWithSegments as any[]) {
        const id = typeof v?.id === "string" ? v.id : null;
        if (id) byId.set(id, v);
      }

      return rawGroups.map((g: any) => {
        const visualAssetGroupId =
          typeof g?.visual_asset_group_id === "string" && g.visual_asset_group_id.trim().length > 0
            ? g.visual_asset_group_id
            : typeof g?.group_id === "string" && g.group_id.trim().length > 0
              ? g.group_id
              : null;
        const docId = typeof g?.document_id === "string" ? g.document_id : null;
        const membersRaw = Array.isArray(g?.member_visual_asset_ids) ? g.member_visual_asset_ids : [];
        const members = membersRaw
          .map((id: any) => (typeof id === "string" ? byId.get(id) : null))
          .filter((v: any) => v && typeof v === "object");

        members.sort((a: any, b: any) => {
          const pa = typeof a?.page_index === "number" ? a.page_index : 1e9;
          const pb = typeof b?.page_index === "number" ? b.page_index : 1e9;
          if (pa !== pb) return pa - pb;
          const ca = typeof a?.created_at === "string" ? a.created_at : "";
          const cb = typeof b?.created_at === "string" ? b.created_at : "";
          if (ca !== cb) return ca.localeCompare(cb);
          return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
        });

        const groupText = buildDeterministicGroupCapturedText(members, 1500);

        const hintSegment =
          majorityNonUnknownSegment([
            ...members.map((m: any) => m?.persisted_segment_key),
            ...members.map((m: any) => m?.effective_segment),
            ...members.map((m: any) => (m?.structured_json as any)?.segment_key),
          ]) ?? null;

        // Persisted must ONLY come from persisted member segments; never from computed/effective hints.
        const persistedSegmentKey = majorityNonUnknownSegment(members.map((m: any) => m?.persisted_segment_key)) ?? null;

        const brandModel = docId ? brandModelByDocId.get(docId) ?? buildBrandModel([]) : buildBrandModel([]);
        const blacklist = brandModel.phrases;
        const brandInfo = docId ? brandNameByDocId.get(docId) ?? { brand: null, confidence: null } : { brand: null, confidence: null };

        const computed = classifySegment({
          ocr_text: null,
          ocr_snippet: groupText ? groupText.slice(0, 140) : null,
          structured_kind: "word_section",
          structured_summary: null,
          structured_json: {
            kind: "word_section",
            heading: typeof g?.heading === "string" ? g.heading : null,
            paragraphs: groupText ? [groupText] : [],
            text_snippet: groupText,
            segment_key: hintSegment,
          },
          asset_type: "structured_word_group",
          page_index: typeof g?.page_index === "number" ? g.page_index : null,
          slide_title: null,
          slide_title_confidence: null,
          evidence_snippets: Array.isArray(g?.evidence_snippets) ? g.evidence_snippets : [],
          brand_blacklist: blacklist,
          brand_name: brandInfo.brand,
          extractor_version: "structured_native_v1",
          quality_source: "structured_word",
          hint_segment: hintSegment,
          enable_debug: false,
          include_debug_text_snippet: false,
          disable_structured_segment_key_signal: true,
          disable_structured_segment_key_fallback: true,
        });

        const computedReasonRaw = computed.debug && typeof computed.debug === "object" ? computed.debug : null;
        const unknownReasonCode = typeof (computedReasonRaw as any)?.unknown_reason_code === "string" ? String((computedReasonRaw as any).unknown_reason_code) : null;

        const computedSegment =
          computed.segment === "unknown" && hintSegment && (unknownReasonCode === "NO_TEXT" || unknownReasonCode === "LOW_SIGNAL")
            ? hintSegment
            : computed.segment;

        const computedConfidence =
          computed.segment === "unknown" && hintSegment && (unknownReasonCode === "NO_TEXT" || unknownReasonCode === "LOW_SIGNAL")
            ? Math.max(0.2, computed.confidence)
            : computed.confidence;

        const computedReason =
          computed.segment === "unknown" && hintSegment && (unknownReasonCode === "NO_TEXT" || unknownReasonCode === "LOW_SIGNAL")
            ? {
                ...(computedReasonRaw ?? {}),
                rule_id: "STRUCTURED_HINT_FALLBACK",
                unknown_reason_code: null,
              }
            : computedReasonRaw;

        const hasHumanOverride = members.some((m: any) => {
          const seg = pickNonUnknownSegment(m?.persisted_segment_key);
          const src = typeof m?.segment_source === "string" ? String(m.segment_source) : "";
          if (!seg || !persistedSegmentKey) return false;
          return seg === persistedSegmentKey && (src === "human_override" || src === "human_override_v1" || src.startsWith("human_override_"));
        });

        const effectiveSegment = hasHumanOverride
          ? (persistedSegmentKey ?? computedSegment)
          : persistedSegmentKey
            ? persistedSegmentKey
            : computedSegment;

        const segmentSource = (() => {
          if (hasHumanOverride && persistedSegmentKey) return "human_override_v1";
          if (persistedSegmentKey) return "persisted_v0";
          return "computed_v1";
        })();

        const segmentConfidence = persistedSegmentKey ? 1 : computedConfidence;

        return {
          ...g,
          visual_asset_group_id: visualAssetGroupId,
          captured_text: groupText,
          persisted_segment_key: persistedSegmentKey,
          persisted_segment_source: persistedSegmentKey ? "group_majority" : null,
          computed_segment: computedSegment,
          computed_confidence: computedConfidence,
          computed_reason: computedReason,
          effective_segment: effectiveSegment,
          segment_source: segmentSource,
          segment_confidence: segmentConfidence,
          segment_promoted_at: null,
          segment_overridden_at: null,
          segment_override_note: null,
        };
      });
    })();

    const wordGroupingStatsFinal: WordGroupingStats = wordGroupingStatsForLineage ?? { word_members_skipped_empty: 0, word_groups_skipped_empty: 0 };
    if (groupWordEnabled) {
      if (wordGroupingStatsFinal.word_members_skipped_empty > 0) {
        warnings.push(`skipped ${wordGroupingStatsFinal.word_members_skipped_empty} empty word blocks during grouping`);
      }
      if (wordGroupingStatsFinal.word_groups_skipped_empty > 0) {
        warnings.push(`skipped ${wordGroupingStatsFinal.word_groups_skipped_empty} empty word groups during grouping`);
      }
    }

    const wordGroupByDocId = (() => {
      const m = new Map<string, typeof wordGroups>();
      for (const g of wordGroups) {
        const list = m.get(g.document_id) ?? [];
        list.push(g);
        m.set(g.document_id, list);
      }
      return m;
    })();

    const wordMemberIdsByDocId = (() => {
      const m = new Map<string, Set<string>>();
      for (const g of wordGroups) {
        const set = m.get(g.document_id) ?? new Set<string>();
        for (const id of g.member_visual_asset_ids) set.add(id);
        m.set(g.document_id, set);
      }
      return m;
    })();

    const pptxGroupByDocId = (() => {
      const m = new Map<string, PptxGroup[]>();
      for (const g of pptxGroups) {
        const list = m.get(g.document_id) ?? [];
        list.push(g);
        m.set(g.document_id, list);
      }
      return m;
    })();

    const pptxMemberIdsByDocId = (() => {
      const m = new Map<string, Set<string>>();
      for (const g of pptxGroups) {
        const set = m.get(g.document_id) ?? new Set<string>();
        for (const id of g.member_visual_asset_ids) set.add(id);
        m.set(g.document_id, set);
      }
      return m;
    })();

    const visualsToRender = (() => {
      if (!groupWordEnabled && !groupPptxEnabled) return visualsWithSegments;

      // Suppress grouped raw blocks unless debug flags are set.
      const out: any[] = [];
      const seenWordDoc = new Set<string>();
      const seenPptxDocPage = new Set<string>();

      const isStructuredWord = (v: any): boolean => {
        const extractorVersion = typeof v?.extractor_version === "string" ? v.extractor_version : "";
        const qSource = typeof v?.quality_flags?.source === "string" ? String(v.quality_flags.source) : "";
        const kind = typeof v?.structured_json?.kind === "string" ? String(v.structured_json.kind) : "";
        if (extractorVersion === "structured_native_v1" && qSource.startsWith("structured_word")) return true;
        if (qSource.startsWith("structured_word")) return true;
        if (kind === "word_section") return true;
        return false;
      };

      const clean = (value: unknown): string => {
        if (typeof value !== "string") return "";
        return value.replace(/\s+/g, " ").trim();
      };

      const toTextLooseLocal = (value: unknown, depth = 4): string => {
        if (value == null) return "";
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        if (depth <= 0) return "";
        if (Array.isArray(value)) return value.map((x) => toTextLooseLocal(x, depth - 1)).filter(Boolean).join(" ");
        if (typeof value === "object") {
          const v: any = value as any;
          const direct =
            (typeof v?.text === "string" ? v.text : null) ??
            (typeof v?.content === "string" ? v.content : null) ??
            (typeof v?.value === "string" ? v.value : null);
          if (direct) return direct;
          const children = v?.children ?? v?.runs ?? v?.items ?? v?.paragraphs;
          if (children) return toTextLooseLocal(children, depth - 1);
        }
        return "";
      };

      const hasAnyTableContent = (rows: unknown): boolean => {
        if (!Array.isArray(rows) || rows.length === 0) return false;
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          for (const cell of row) {
            const t = clean(toTextLooseLocal(cell));
            if (t) return true;
          }
        }
        return false;
      };

      const isEmptyStructuredWord = (v: any): boolean => {
        const sj = v?.structured_json;
        if (!sj || typeof sj !== "object") return false;
        const heading = clean((sj as any).heading);
        const snippet = clean((sj as any).text_snippet);
        const paragraphsRaw = (sj as any).paragraphs;
        const paragraphsText = Array.isArray(paragraphsRaw)
          ? paragraphsRaw.map((p: any) => clean(toTextLooseLocal(p))).filter(Boolean).join(" ")
          : "";
        const tableRows = (sj as any).table_rows;
        const hasTable = hasAnyTableContent(tableRows);
        const ocr = clean(v?.ocr_text);
        return !heading && !snippet && !paragraphsText && !hasTable && !ocr;
      };
      for (const v of visualsWithSegments) {
        const docId = typeof (v as any)?.document_id === "string" ? (v as any).document_id : "";
        const wordMembers = docId ? wordMemberIdsByDocId.get(docId) : null;
        const isWordMember = Boolean(wordMembers && wordMembers.has(String((v as any)?.id ?? "")));

        const pptxMembers = docId ? pptxMemberIdsByDocId.get(docId) : null;
        const pageIndex = typeof (v as any)?.page_index === "number" ? (v as any).page_index : null;
        const docPageKey = pageIndex == null ? null : `${docId}::${pageIndex}`;
        const isPptxMember = Boolean(pptxMembers && pptxMembers.has(String((v as any)?.id ?? "")));

        if (groupPptxEnabled && isPptxMember) {
          if (debugPptxRaw) out.push(v);
          if (docPageKey && !seenPptxDocPage.has(docPageKey)) {
            const gs = (pptxGroupByDocId.get(docId) ?? []).filter((g) => g.page_index === pageIndex);
            for (const g of gs) out.push(g);
            seenPptxDocPage.add(docPageKey);
          }
          continue;
        }

        if (isWordMember) {
          if (debugWordRaw) out.push(v);
          if (!seenWordDoc.has(docId)) {
            const gs = wordGroupByDocId.get(docId) ?? [];
            for (const g of gs) out.push({ __word_group: true, ...g });
            seenWordDoc.add(docId);
          }
          continue;
        }

        if (groupWordEnabled && !debugWordRaw && isStructuredWord(v) && isEmptyStructuredWord(v)) {
          continue;
        }

        out.push(v);
      }

      // If a doc has only word blocks (so we never encountered a non-word row), ensure groups are still emitted.
      for (const [docId, gs] of wordGroupByDocId.entries()) {
        if (seenWordDoc.has(docId)) continue;
        for (const g of gs) out.push({ __word_group: true, ...g });
      }

      // If a doc/page has only PPTX member rows, ensure groups are still emitted.
      for (const [docId, gs] of pptxGroupByDocId.entries()) {
        for (const g of gs) {
          const key = `${docId}::${g.page_index}`;
          if (seenPptxDocPage.has(key)) continue;
          out.push(g);
          seenPptxDocPage.add(key);
        }
      }

      return out;
    })();

    for (const v of visualsToRender as any[]) {
      const isWordGroup = Boolean((v as any)?.__word_group);
      const isPptxGroup = Boolean((v as any)?.__pptx_group);
      const isAnyGroup = isWordGroup || isPptxGroup;
      const hasDocumentId = typeof v.document_id === "string" && v.document_id.length > 0;
      const docNodeId = hasDocumentId ? `document:${v.document_id}` : null;
      const visualId = isAnyGroup
        ? String((v as any).visual_asset_group_id ?? "")
        : String((v as any).id ?? "");
      if (isAnyGroup && !visualId) {
        warnings.push("skipped visual asset group with missing visual_asset_group_id");
        continue;
      }
      if (!visualId) {
        warnings.push("skipped visual asset with missing id");
        continue;
      }
      const vaNodeId = isAnyGroup ? `visual_asset_group:${visualId}` : `visual_asset:${visualId}`;
      const evNodeId = `evidence:${visualId}`;
      const conf = Number((v as any).confidence);
      const confidence = Number.isFinite(conf) ? conf : 0;
      const pageLabel = typeof (v as any).page_index === "number" ? (v as any).page_index + 1 : 0;

      const snippet = isWordGroup ? null : ocrSnippet((v as any).ocr_text);
      const structured = isAnyGroup
        ? { structured_kind: isWordGroup ? "word_group" : "pptx_group", structured_summary: (v as any).captured_text }
        : { structured_kind: (v as any).structured_kind, structured_summary: (v as any)?.structured_summary };
      const extraction_confidence = isWordGroup
        ? null
        : deriveBestExtractionConfidence({ structuredJson: (v as any).structured_json, fallback: (v as any).extraction_confidence });
      const evidence_count = isWordGroup
        ? Number.isFinite((v as any).evidence_count_total)
          ? (v as any).evidence_count_total
          : 0
        : Number.isFinite((v as any).evidence_count)
          ? (v as any).evidence_count
          : 0;
      let evidence_snippets = isWordGroup
        ? (Array.isArray((v as any).evidence_snippets) ? (v as any).evidence_snippets : [])
        : Array.isArray((v as any).evidence_sample_snippets)
          ? (v as any).evidence_sample_snippets
          : typeof (v as any).evidence_sample_snippets === "string"
            ? [(v as any).evidence_sample_snippets]
            : [];

      // If the evidence link rows exist but were created before snippet text was available
      // (e.g. OCR enabled later), fall back to the extraction OCR snippet.
      if (evidence_snippets.length === 0 && evidence_count > 0 && snippet) {
        evidence_snippets = [snippet];
      }

      const titleDerived = isWordGroup
        ? {
            slide_title: null,
            slide_title_source: null,
            slide_title_confidence: null,
            slide_title_warnings: undefined,
            slide_title_debug: undefined,
          }
        : {
            slide_title: (v as any)?.slide_title ?? null,
            slide_title_source: (v as any)?.slide_title_source ?? null,
            slide_title_confidence: (v as any)?.slide_title_confidence ?? null,
            slide_title_warnings: (v as any)?.slide_title_warnings,
            slide_title_debug: (v as any)?.slide_title_debug,
          };

      const segmentKeyForUnderstandingRaw = isWordGroup
        ? (typeof (v as any).effective_segment === "string" && String((v as any).effective_segment).trim().length > 0
            ? String((v as any).effective_segment)
            : typeof (v as any).segment_key === "string"
              ? String((v as any).segment_key)
              : null)
        : (typeof (v as any)?.effective_segment === "string" && String((v as any).effective_segment).trim().length > 0
            ? String((v as any).effective_segment)
            : typeof (v as any)?.segment === "string" && String((v as any).segment).trim().length > 0
              ? String((v as any).segment)
              : null);

      const segmentKeyForUnderstanding = hasDocumentId ? segmentKeyForUnderstandingRaw : "unknown";

      const page_understanding = buildPageUnderstanding({
        slide_title: titleDerived.slide_title,
        evidence_snippets,
        ocr_text: isWordGroup ? null : (v as any).ocr_text,
        segment_key: segmentKeyForUnderstanding,
        structured_json: isWordGroup ? (v as any).structured_json ?? null : (v as any).structured_json,
        structured_kind: structured.structured_kind,
        structured_summary: structured.structured_summary,
      });

      if (process.env.DDAI_DEV_SLIDE_TITLE_LOG === "1" && !didLogSlideTitle && titleDerived.slide_title) {
        didLogSlideTitle = true;
        try {
          // eslint-disable-next-line no-console
          console.log('[DEV slide_title]', {
            id: v.id,
            slide_title: titleDerived.slide_title,
            source: titleDerived.slide_title_source,
            confidence: titleDerived.slide_title_confidence,
            ocr_head: typeof snippet === 'string' ? snippet.slice(0, 80) : null,
            warnings: titleDerived.slide_title_warnings,
          });
        } catch {
          // ignore
        }
      }

      const segmentDebugRaw = !isWordGroup && debugSegments ? (v as any)?.segment_debug ?? null : null;
      const segmentDebug = debugSegments
        ? (() => {
            const top = Array.isArray(segmentDebugRaw?.top_scores) ? segmentDebugRaw.top_scores : [];
            const best = top[0];
            const runnerUp = top[1];
            return {
              ...segmentDebugRaw,
              text_len:
                typeof segmentDebugRaw?.classification_text_len === "number" ? segmentDebugRaw.classification_text_len : null,
              best_score: typeof best?.score === "number" ? best.score : null,
              best_segment: typeof best?.segment === "string" ? best.segment : null,
              runner_up_score: typeof runnerUp?.score === "number" ? runnerUp.score : null,
              runner_up_segment: typeof runnerUp?.segment === "string" ? runnerUp.segment : null,
            };
          })()
        : null;

      const classifiedSegment =
        isWordGroup
          ? (typeof (v as any).effective_segment === "string" && String((v as any).effective_segment).trim().length > 0
              ? String((v as any).effective_segment)
              : String((v as any).segment_key ?? "unknown"))
          : typeof (v as any)?.effective_segment === "string" && String((v as any).effective_segment).length > 0
            ? String((v as any).effective_segment)
            : typeof (v as any)?.segment === "string" && String((v as any).segment).length > 0
              ? String((v as any).segment)
              : "unknown";
      const effectiveSegment = hasDocumentId ? classifiedSegment : "unknown";
      const effectiveSegmentConfidence = hasDocumentId
        ? (typeof (v as any).segment_confidence === "number" && Number.isFinite((v as any).segment_confidence) ? (v as any).segment_confidence : null)
        : null;
      const effectiveSegmentSource =
        typeof (v as any)?.segment_source === "string" && String((v as any).segment_source).trim().length > 0
          ? String((v as any).segment_source)
          : null;

      const persistedSegmentKey =
        typeof (v as any)?.persisted_segment_key === "string" && String((v as any).persisted_segment_key).trim().length > 0
          ? String((v as any).persisted_segment_key)
          : null;
      const computedSegmentKey =
        typeof (v as any)?.computed_segment === "string" && String((v as any).computed_segment).trim().length > 0
          ? String((v as any).computed_segment)
          : null;
      const computedSegmentConfidence =
        typeof (v as any)?.computed_confidence === "number" && Number.isFinite((v as any).computed_confidence)
          ? (v as any).computed_confidence
          : null;

      if (!hasDocumentId && process.env.NODE_ENV !== "production" && !didWarnMissingDocumentId) {
        didWarnMissingDocumentId = true;
        try {
          request.log?.warn?.(
            {
              deal_id: dealId,
              visual_asset_id: v.id,
              msg: "visual asset missing document_id; attaching under deal->unknown segment",
            },
            "deal.lineage.visual_missing_document_id"
          );
        } catch {
          // ignore
        }
      }

      const segNodeId = hasDocumentId
        ? `segment:${dealId}:${v.document_id}:${effectiveSegment}`
        : `segment:${dealId}:unknown_document:${effectiveSegment}`;

      if (!segmentNodeIds.has(segNodeId)) {
        segmentNodeIds.add(segNodeId);
        nodes.push({
          id: segNodeId,
          node_id: segNodeId,
          document_id: hasDocumentId ? v.document_id : null,
          kind: "segment",
          type: "segment",
          node_type: "SEGMENT",
          label: formatSegmentLabel(effectiveSegment),
          metadata: {
            deal_id: dealId,
            document_id: hasDocumentId ? v.document_id : null,
            segment: effectiveSegment,
          },
          data: {
            label: formatSegmentLabel(effectiveSegment),
            segment: effectiveSegment,
            segment_key: effectiveSegment,
            segment_confidence: effectiveSegmentConfidence,
            ...(hasDocumentId ? { document_id: v.document_id } : {}),
          },
        });
      }

      if (hasDocumentId && docNodeId) {
        const docSegEdgeId = `e:has_segment:doc:${v.document_id}:${effectiveSegment}`;
        if (!documentSegmentEdgeIds.has(docSegEdgeId)) {
          documentSegmentEdgeIds.add(docSegEdgeId);
          edges.push({
            id: docSegEdgeId,
            source: docNodeId,
            target: segNodeId,
            type: "HAS_SEGMENT",
            edge_type: "HAS_SEGMENT",
          });
        }
      } else {
        const dealSegEdgeId = `e:has_segment:deal:${dealId}:${effectiveSegment}`;
        if (!documentSegmentEdgeIds.has(dealSegEdgeId)) {
          documentSegmentEdgeIds.add(dealSegEdgeId);
          edges.push({
            id: dealSegEdgeId,
            source: dealNodeId,
            target: segNodeId,
            type: "HAS_SEGMENT",
            edge_type: "HAS_SEGMENT",
          });
        }
      }

      const nodeLabel = isWordGroup
        ? String((v as any).page_label ?? `Section (${visualId})`)
        : isPptxGroup
          ? String((v as any).page_label ?? `Slide ${pageLabel}`)
          : `Page ${pageLabel} • ${(v as any).asset_type}`;

      nodes.push({
        id: vaNodeId,
        node_id: vaNodeId,
        document_id: typeof (v as any).document_id === "string" ? (v as any).document_id : null,
        kind: isAnyGroup ? "visual_asset_group" : "visual_asset",
        type: isAnyGroup ? "visual_asset_group" : "visual_asset",
        node_type: isAnyGroup ? "VISUAL_ASSET_GROUP" : "VISUAL_ASSET",
        label: nodeLabel,
        metadata: isAnyGroup
          ? {
              visual_asset_group_id: visualId,
              document_id: (v as any).document_id,
              member_visual_asset_ids: (v as any).member_visual_asset_ids,
            }
          : {
              visual_asset_id: (v as any).id,
              document_id: (v as any).document_id,
              page_index: (v as any).page_index,
              asset_type: (v as any).asset_type,
              created_at: (v as any).created_at,
            },
        data: {
          label: nodeLabel,
          ...(isWordGroup
            ? {
                visual_asset_group_id: visualId,
                document_id: (v as any).document_id,
                member_visual_asset_ids: (v as any).member_visual_asset_ids,
                count_members: Array.isArray((v as any).member_visual_asset_ids) ? (v as any).member_visual_asset_ids.length : 0,
                asset_type: "structured_word_group",
                page_index: typeof (v as any).page_index === "number" ? (v as any).page_index : null,
                page_label: nodeLabel,
                structured_kind: "word_group",
                structured_summary: (v as any).captured_text,
                structured_json: {
                  kind: "word_group",
                  heading: (v as any).heading ?? null,
                  text_snippet: (v as any).captured_text,
                  member_visual_asset_ids: (v as any).member_visual_asset_ids,
                  page_label: nodeLabel,
                  segment_key: (v as any).effective_segment ?? "unknown",
                  effective_segment: (v as any).effective_segment ?? "unknown",
                },
              }
            : isPptxGroup
              ? {
                  visual_asset_group_id: visualId,
                  document_id: (v as any).document_id,
                  member_visual_asset_ids: (v as any).member_visual_asset_ids,
                  count_members: Array.isArray((v as any).member_visual_asset_ids) ? (v as any).member_visual_asset_ids.length : 0,
                  asset_type: "pptx_slide_group",
                  page_index: typeof (v as any).page_index === "number" ? (v as any).page_index : null,
                  page_label: nodeLabel,
                  structured_kind: "pptx_group",
                  structured_summary: (v as any).captured_text,
                  structured_json: (v as any).structured_json,
                }
            : {
                visual_asset_id: (v as any).id,
                document_id: (v as any).document_id,
                page_index: (v as any).page_index,
                asset_type: (v as any).asset_type,
                bbox: (v as any).bbox ?? {},
                image_uri: (v as any).image_uri,
                image_hash: (v as any).image_hash,
                confidence,
                extractor_version: (v as any).extractor_version,
                ocr_text_snippet: snippet,
                slide_title: titleDerived.slide_title,
                slide_title_source: titleDerived.slide_title_source,
                slide_title_confidence: titleDerived.slide_title_confidence,
                ...(titleDerived.slide_title_warnings ? { slide_title_warnings: titleDerived.slide_title_warnings } : {}),
                ...(titleDerived.slide_title_debug ? { slide_title_debug: titleDerived.slide_title_debug } : {}),
                structured_kind: structured.structured_kind,
                structured_summary: structured.structured_summary,
                structured_json: (v as any).structured_json,
              }),
          page_understanding,
          evidence_count,
          evidence_snippets: Array.isArray(evidence_snippets) ? evidence_snippets : [],
          extraction_confidence,
          extraction_method: !isWordGroup && typeof (v as any).extraction_method === "string" ? (v as any).extraction_method : null,
          ...(isWordGroup
            ? {
                segment: (v as any).effective_segment,
                effective_segment: (v as any).effective_segment,
                computed_segment: (v as any).computed_segment ?? null,
                persisted_segment_key: (v as any).persisted_segment_key ?? null,
                segment_source: (v as any).segment_source ?? null,
                segment_confidence:
                  typeof (v as any).segment_confidence === "number" && Number.isFinite((v as any).segment_confidence)
                    ? (v as any).segment_confidence
                    : null,
              }
            : {
                segment: effectiveSegment,
                effective_segment: effectiveSegment,
                segment_confidence: effectiveSegmentConfidence,
                segment_source: effectiveSegmentSource,
                persisted_segment_key: persistedSegmentKey,
                computed_segment: computedSegmentKey,
                computed_confidence: computedSegmentConfidence,
              }),
          ...(typeof (v as any)?.computed_reason === "object" && (v as any).computed_reason ? { computed_reason: (v as any).computed_reason } : {}),
          ...(debugSegments && !isWordGroup ? { segment_debug: segmentDebug } : {}),
        },
      });

      edges.push({
        id: `e:has_visual_asset:${segNodeId}:${visualId}`,
        source: segNodeId,
        target: vaNodeId,
        type: "HAS_VISUAL_ASSET",
        edge_type: "HAS_VISUAL_ASSET",
      });

      if (!isWordGroup) {
        const count = evidence_count;
        nodes.push({
          id: evNodeId,
          node_id: evNodeId,
          kind: "evidence",
          type: "evidence",
          node_type: "EVIDENCE",
          label: `Evidence (${count})`,
          metadata: {
            visual_asset_id: visualId,
            count,
          },
          data: {
            label: `Evidence (${count})`,
            count,
            visual_asset_id: visualId,
          },
        });
        edges.push({
          id: `e:has_evidence:${visualId}`,
          source: vaNodeId,
          target: evNodeId,
          type: "HAS_EVIDENCE",
          edge_type: "HAS_EVIDENCE",
        });
      }
    }

    if (groupWordEnabled && !debugWordRaw && wordGroups.length > 0) {
      // Remap any edges that still reference suppressed word member nodes.
      const memberNodeIdToGroupNodeId = new Map<string, string>();
      for (const g of wordGroups as any[]) {
        const groupVisualId = String(g.visual_asset_group_id ?? g.group_id ?? "");
        if (!groupVisualId) continue;
        const groupNodeId = `visual_asset_group:${groupVisualId}`;
        const members = Array.isArray(g.member_visual_asset_ids) ? g.member_visual_asset_ids : [];
        for (const memberId of members) {
          if (typeof memberId !== "string" || !memberId) continue;
          memberNodeIdToGroupNodeId.set(`visual_asset:${memberId}`, groupNodeId);
        }
      }

      for (const e of edges as any[]) {
        const src = typeof e?.source === "string" ? e.source : "";
        const tgt = typeof e?.target === "string" ? e.target : "";
        const srcRemap = memberNodeIdToGroupNodeId.get(src);
        const tgtRemap = memberNodeIdToGroupNodeId.get(tgt);
        if (srcRemap) e.source = srcRemap;
        if (tgtRemap) e.target = tgtRemap;
      }

      const nodeIds = new Set(nodes.map((n: any) => String(n?.id ?? n?.node_id ?? "")).filter(Boolean));
      const before = edges.length;
      const filtered = edges.filter((e: any) => nodeIds.has(String(e?.source ?? "")) && nodeIds.has(String(e?.target ?? "")));
      const removed = before - filtered.length;
      if (removed > 0) {
        warnings.push(`removed ${removed} dangling edges after word grouping remap`);
        edges.length = 0;
        edges.push(...filtered);
      }
    }

    if (debugSegments) {
      const missingType = edges.filter((e) => typeof e?.type !== "string" || e.type.trim().length === 0);
      if (missingType.length > 0) {
        request.log?.error?.(
          {
            deal_id: dealId,
            missing_edge_type_count: missingType.length,
            sample: missingType.slice(0, 5).map((e) => ({ id: e?.id, edge_type: e?.edge_type, source: e?.source, target: e?.target })),
          },
          "deal.lineage.edge_type_missing"
        );
        throw new Error(`Lineage edges missing type (count=${missingType.length})`);
      }
    }

    const endTs = Date.now();
    request.log.info(
      {
        request_id: (request as any).id,
        deal_id: dealId,
        counts: {
          documents: docs.length,
          visual_assets: visuals.length,
          evidence_nodes: visuals.length,
        },
        warnings_count: warnings.length,
        start_ts: new Date(startTs).toISOString(),
        end_ts: new Date(endTs).toISOString(),
        duration_ms: endTs - startTs,
      },
      "deal.lineage"
    );

    return reply.send({
      deal_id: dealId,
      nodes,
      edges,
      warnings,
      ...(groupWordEnabled
        ? {
          warnings_counters: {
            word_members_skipped_empty: wordGroupingStatsFinal.word_members_skipped_empty,
            word_groups_skipped_empty: wordGroupingStatsFinal.word_groups_skipped_empty,
          },
        }
        : {}),
      ...(unknownStructuredReport ? { unknown_structured_report: unknownStructuredReport } : {}),
      ...(segmentAuditRequested
        ? {
            segment_audit_report: (() => {
              if (!segmentAuditEnabled) {
                const reason =
                  process.env.NODE_ENV === "production"
                    ? "segment_audit is disabled in production"
                    : "segment_audit requires debug_segments=1 (dev-only)";
                return {
                  deal_id: dealId,
                  generated_at: new Date().toISOString(),
                  documents: [],
                  error: {
                    code: "SEGMENT_AUDIT_DISABLED",
                    message: reason,
                  },
                };
              }

              type SegmentSource = "persisted" | "structured" | "vision" | "missing";
              const tieDelta = 0.1;
              const tieScoreDelta = 0.05;

              const normalizeSnippet = (value: unknown, maxLen: number): string | null => {
                if (typeof value !== "string") return null;
                const s = value.replace(/\s+/g, " ").trim();
                if (!s) return null;
                return s.length > maxLen ? `${s.slice(0, maxLen).trimEnd()}…` : s;
              };

              const stableJsonPreview = (value: unknown, maxLen: number): string | null => {
                if (value == null) return null;
                if (typeof value !== "object") {
                  try {
                    return normalizeSnippet(String(value), maxLen);
                  } catch {
                    return null;
                  }
                }

                const seen = new WeakSet<object>();
                const simplify = (input: any, depth: number): any => {
                  if (input == null) return null;
                  const t = typeof input;
                  if (t === "string" || t === "number" || t === "boolean") return input;
                  if (t !== "object") return String(input);

                  if (seen.has(input)) return "[Circular]";
                  seen.add(input);

                  if (Array.isArray(input)) {
                    const head = input.slice(0, 8).map((v) => simplify(v, depth - 1));
                    if (input.length > 8) head.push(`…(+${input.length - 8} more)`);
                    return head;
                  }

                  if (depth <= 0) return "[Object]";
                  const keys = Object.keys(input).sort((a, b) => a.localeCompare(b));
                  const out: Record<string, any> = {};
                  const take = keys.slice(0, 20);
                  for (const k of take) out[k] = simplify(input[k], depth - 1);
                  if (keys.length > take.length) out.__more_keys__ = keys.length - take.length;
                  return out;
                };

                try {
                  const json = JSON.stringify(simplify(value as any, 2));
                  if (typeof json !== "string") return null;
                  if (json.length <= maxLen) return json;
                  return `${json.slice(0, maxLen).trimEnd()}…`;
                } catch {
                  return null;
                }
              };

              const normalizeUnknownReasonCode = (value: unknown): "NO_TEXT" | "LOW_SIGNAL" | "AMBIGUOUS_TIE" | null => {
                if (typeof value !== "string") return null;
                const v = value.trim();
                if (v === "NO_TEXT" || v === "LOW_SIGNAL" || v === "AMBIGUOUS_TIE") return v;
                return null;
              };

              const docById = new Map(docs.map((d) => [d.id, d] as const));
              const visualsByDoc = new Map<string, Array<VisualRow & any>>();
              for (const v of visualsWithSegments as any[]) {
                const docId = typeof v?.document_id === "string" && v.document_id ? v.document_id : "unknown_document";
                const arr = visualsByDoc.get(docId) ?? [];
                arr.push(v);
                visualsByDoc.set(docId, arr);
              }

              const documentEntries = Array.from(visualsByDoc.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([document_id, rows]) => {
                  const doc = docById.get(document_id) ?? null;
                  const title = doc ? doc.title : null;
                  const type = doc ? doc.type : null;
                  const status = null;
                  const page_count = doc && typeof doc.page_count === "number" ? doc.page_count : null;

                  const sorted = rows.slice().sort((x, y) => {
                    const px = typeof x.page_index === "number" ? x.page_index : Number.MAX_SAFE_INTEGER;
                    const py = typeof y.page_index === "number" ? y.page_index : Number.MAX_SAFE_INTEGER;
                    if (px !== py) return px - py;
                    const tx = typeof x.created_at === "string" ? Date.parse(x.created_at) : 0;
                    const ty = typeof y.created_at === "string" ? Date.parse(y.created_at) : 0;
                    return tx - ty;
                  });

                  const items = sorted.map((v: any) => {
                    const debug = (v as any)?.segment_debug ?? null;
                    const persistedKey = typeof v?.persisted_segment_key === "string" && v.persisted_segment_key.trim()
                      ? v.persisted_segment_key.trim()
                      : null;
                    const effectiveSource = typeof v?.segment_source === "string" && v.segment_source.trim() ? v.segment_source.trim() : null;
                    const isPersistedEffective = Boolean(persistedKey && typeof v?.segment === "string" && v.segment.trim() === persistedKey && effectiveSource !== "computed_v1");

                    const rawSource = isPersistedEffective
                      ? "persisted"
                      : typeof debug?.classification_source === "string"
                        ? debug.classification_source
                        : null;
                    const segment_source: SegmentSource =
                      rawSource === "persisted" || rawSource === "structured" || rawSource === "vision" ? rawSource : "missing";
                    const quality_source = typeof v?.quality_flags?.source === "string" ? v.quality_flags.source : null;

                    const segment = typeof v?.segment === "string" && v.segment.trim() ? v.segment.trim() : "unknown";
                    const segment_confidence =
                      typeof v?.segment_confidence === "number" && Number.isFinite(v.segment_confidence)
                        ? v.segment_confidence
                        : null;

                    const top = Array.isArray(debug?.top_scores) ? debug.top_scores : [];
                    const best = top[0] ?? null;
                    const runnerUp = top[1] ?? null;
                    const best_score = typeof best?.score === "number" && Number.isFinite(best.score) ? best.score : null;
                    const runner_up_score = typeof runnerUp?.score === "number" && Number.isFinite(runnerUp.score) ? runnerUp.score : null;

                    const threshold =
                      typeof debug?.threshold === "number" && Number.isFinite(debug.threshold)
                        ? debug.threshold
                        : segment_source === "structured"
                          ? 0.2
                          : segment_source === "vision"
                            ? 0.35
                            : 0;

                    const sourcesUsed = Array.isArray(debug?.classification_text_sources_used)
                      ? debug.classification_text_sources_used.filter((s: any) => typeof s === "string" && s.trim().length > 0)
                      : [];

                    const classificationTextLen =
                      typeof debug?.classification_text_len === "number" && Number.isFinite(debug.classification_text_len)
                        ? debug.classification_text_len
                        : 0;

                    const snippet = normalizeSnippet(debug?.classification_text_snippet, 200);

                    const ocrTextRaw = typeof v?.ocr_text === "string" ? v.ocr_text : null;
                    const ocr_text_len = ocrTextRaw ? ocrTextRaw.length : 0;
                    const ocr_text_snippet = ocrTextRaw ? normalizeSnippet(ocrTextRaw, 260) : null;

                    const structuredJson = v?.structured_json;
                    const structured_json_present = Boolean(structuredJson);
                    const structured_json_keys = structured_json_present && typeof structuredJson === "object" && !Array.isArray(structuredJson)
                      ? Object.keys(structuredJson as any)
                          .filter((k) => typeof k === "string" && k.trim().length > 0)
                          .sort((a, b) => a.localeCompare(b))
                          .slice(0, 24)
                      : [];
                    const structured_json_snippet = structuredJson ? stableJsonPreview(structuredJson, 260) : null;

                    const structuredJsonPresent = Boolean(v?.structured_json);
                    const ocrTextPresent = typeof v?.ocr_text === "string" ? v.ocr_text.trim().length > 0 : false;

                    const evidence_count =
                      typeof v?.evidence_count === "number" && Number.isFinite(v.evidence_count)
                        ? v.evidence_count
                        : 0;

                    const page_index = typeof v?.page_index === "number" && Number.isFinite(v.page_index) ? v.page_index : null;
                    const pageN = page_index != null ? page_index + 1 : null;

                    const sj = v?.structured_json;
                    const sheetName = typeof sj?.sheet_name === "string" ? sj.sheet_name : null;
                    const slideNumber = typeof sj?.slide_number === "number" && Number.isFinite(sj.slide_number) ? sj.slide_number : null;

                    const isStructuredPpt = quality_source === "structured_powerpoint";
                    const isStructuredWord = quality_source === "structured_word";
                    const isStructuredExcel = quality_source === "structured_excel";

                    const page_label = (() => {
                      if (segment_source === "vision" || !quality_source || (!quality_source.startsWith("structured_") && segment_source !== "structured")) {
                        return `Page ${pageN != null ? pageN : "—"}`;
                      }
                      if (isStructuredPpt) {
                        if (slideNumber != null) return `Slide ${slideNumber}`;
                        return `Slide ${pageN != null ? pageN : "—"}`;
                      }
                      if (isStructuredWord) return `Block ${pageN != null ? pageN : "—"}`;
                      if (isStructuredExcel) {
                        if (sheetName) return `Sheet ${sheetName} • item ${pageN != null ? pageN : "—"}`;
                        return `Item ${pageN != null ? pageN : "—"}`;
                      }
                      return `Item ${pageN != null ? pageN : "—"}`;
                    })();

                    const title_text_snippet = normalizeSnippet(debug?.title_text_snippet, 200);
                    const title_source = typeof debug?.title_source === "string" && debug.title_source.trim().length > 0
                      ? debug.title_source.trim()
                      : null;

                    const unknown_reason_code = segment === "unknown" ? normalizeUnknownReasonCode(debug?.unknown_reason_code) : null;

                    const computedSegmentRaw = segmentRescoreRequested && typeof v?.segment_rescore_segment === "string"
                      ? String(v.segment_rescore_segment)
                      : null;

                    const computedDebugRaw = segmentRescoreRequested ? v?.segment_rescore_debug : null;
                    const computedReasonDebug =
                      computedDebugRaw && typeof computedDebugRaw === "object" ? computedDebugRaw : debug && typeof debug === "object" ? debug : null;

                    const computedSegment = segmentRescoreRequested
                      ? computedSegmentRaw
                        ? computedSegmentRaw
                        : typeof (v as any)?.computed_segment === "string"
                          ? String((v as any).computed_segment)
                          : null
                      : null;

                    const computedCapturedText =
                      typeof (computedReasonDebug as any)?.captured_text === "string" ? String((computedReasonDebug as any).captured_text) : "";

                    const computedTopScores = Array.isArray((computedReasonDebug as any)?.top_scores)
                      ? (computedReasonDebug as any).top_scores
                          .filter((s: any) => s && typeof s === "object")
                          .slice(0, 12)
                          .map((s: any) => ({ segment: String(s.segment), score: Number(s.score) }))
                          .filter((s: any) => Number.isFinite(s.score))
                          .sort((a: any, b: any) => b.score - a.score)
                      : [];

                    const computedUnknownReasonCode = computedSegment === "unknown"
                      ? normalizeUnknownReasonCode((computedReasonDebug as any)?.unknown_reason_code)
                      : null;

                    return {
                      visual_asset_id: v.id,
                      document_id: typeof v?.document_id === "string" ? v.document_id : document_id,
                      extractor_version: typeof v?.extractor_version === "string" ? v.extractor_version : null,
                      quality_source,
                      segment,
                      segment_source,
                      segment_confidence,
                      page_index,
                      page_label,
                      image_uri: typeof v?.image_uri === "string" ? v.image_uri : null,
                      evidence_count,
                      snippet,
                      ...(segmentRescoreRequested
                        ? {
                            persisted_segment_key: persistedKey,
                            captured_text: computedCapturedText,
                            computed_segment: computedSegment,
                            computed_reason: computedSegment
                              ? {
                                  rule_id:
                                    typeof (computedReasonDebug as any)?.rule_id === "string" && String((computedReasonDebug as any).rule_id).trim().length > 0
                                      ? String((computedReasonDebug as any).rule_id).trim()
                                      : null,
                                  matched_terms: Array.isArray((computedReasonDebug as any)?.matched_terms)
                                    ? (computedReasonDebug as any).matched_terms.filter((s: any) => typeof s === "string" && s.trim().length > 0)
                                    : [],
                                  title_text_snippet: normalizeSnippet((computedReasonDebug as any)?.title_text_snippet, 200),
                                  title_source:
                                    typeof (computedReasonDebug as any)?.title_source === "string" && String((computedReasonDebug as any).title_source).trim().length > 0
                                      ? String((computedReasonDebug as any).title_source).trim()
                                      : null,
                                  classification_text_len:
                                    typeof (computedReasonDebug as any)?.classification_text_len === "number" && Number.isFinite((computedReasonDebug as any).classification_text_len)
                                      ? (computedReasonDebug as any).classification_text_len
                                      : 0,
                                  classification_text_sources_used: Array.isArray((computedReasonDebug as any)?.classification_text_sources_used)
                                    ? (computedReasonDebug as any).classification_text_sources_used.filter((s: any) => typeof s === "string" && s.trim().length > 0)
                                    : [],
                                  ...((computedReasonDebug as any)?.keyword_hits && typeof (computedReasonDebug as any).keyword_hits === "object"
                                    ? { keyword_hits: (computedReasonDebug as any).keyword_hits }
                                    : {}),
                                  top_scores: computedTopScores,
                                  best_score:
                                    typeof (computedReasonDebug as any)?.best_score === "number" && Number.isFinite((computedReasonDebug as any).best_score)
                                      ? (computedReasonDebug as any).best_score
                                      : null,
                                  runner_up_score:
                                    typeof (computedReasonDebug as any)?.runner_up_score === "number" && Number.isFinite((computedReasonDebug as any).runner_up_score)
                                      ? (computedReasonDebug as any).runner_up_score
                                      : null,
                                  threshold:
                                    typeof (computedReasonDebug as any)?.threshold === "number" && Number.isFinite((computedReasonDebug as any).threshold)
                                      ? (computedReasonDebug as any).threshold
                                      : undefined,
                                  tie_delta:
                                    typeof (computedReasonDebug as any)?.tie_delta === "number" && Number.isFinite((computedReasonDebug as any).tie_delta)
                                      ? (computedReasonDebug as any).tie_delta
                                      : undefined,
                                  override_applied: (computedReasonDebug as any)?.override_applied === true ? true : undefined,
                                  override_rule_id:
                                    typeof (computedReasonDebug as any)?.override_rule_id === "string" ? (computedReasonDebug as any).override_rule_id : undefined,
                                  override_explanation:
                                    typeof (computedReasonDebug as any)?.override_explanation === "string" ? (computedReasonDebug as any).override_explanation : undefined,
                                  top_scores_pre_override: Array.isArray((computedReasonDebug as any)?.top_scores_pre_override)
                                    ? (computedReasonDebug as any).top_scores_pre_override
                                        .filter((s: any) => s && typeof s === "object")
                                        .slice(0, 12)
                                        .map((s: any) => ({ segment: String(s.segment), score: Number(s.score) }))
                                        .filter((s: any) => Number.isFinite(s.score))
                                        .sort((a: any, b: any) => b.score - a.score)
                                    : undefined,
                                  ...(computedUnknownReasonCode ? { unknown_reason_code: computedUnknownReasonCode } : {}),
                                }
                              : null,
                          }
                        : {}),
                      content_preview: {
                        ocr_text_len,
                        ocr_text_snippet,
                        structured_json_present,
                        structured_json_keys,
                        structured_json_snippet,
                      },
                      reason: {
                        title_text_snippet,
                        title_source,
                        classification_text_len: classificationTextLen,
                        classification_text_sources_used: sourcesUsed,
                        ...(debug?.keyword_hits && typeof debug.keyword_hits === "object" ? { keyword_hits: debug.keyword_hits } : {}),
                        top_scores: Array.isArray(top)
                          ? top
                              .filter((s: any) => s && typeof s === "object")
                              .slice(0, 8)
                              .map((s: any) => ({ segment: String(s.segment), score: Number(s.score) }))
                          : [],
                        best_score,
                        runner_up_score,
                        threshold,
                        unknown_reason_code,
                      },
                    };
                  });

                  const bySegment: Record<string, number> = {};
                  for (const it of items) {
                    const seg = typeof it.segment === "string" ? it.segment : "unknown";
                    bySegment[seg] = (bySegment[seg] ?? 0) + 1;
                  }

                  return {
                    document_id,
                    title,
                    type,
                    status,
                    page_count,
                    items,
                    summary: {
                      total_items: items.length,
                      by_segment: bySegment,
                    },
                  };
                });

              return {
                deal_id: dealId,
                generated_at: new Date().toISOString(),
                documents: documentEntries,
              };
            })(),
          }
        : {}),
    });
  });

  // DEV-only: promote computed segments into persisted segment_key.
  // This is explicit, safe to rerun, and does not change production scoring behavior unless the persisted value changes.

  app.get(
    "/api/v1/deals/:deal_id/scoring-input",
    {
      schema: {
        description:
          "Return a normalized scoring input payload (v0) derived from the deal lineage graph (document-type agnostic, evidence-linked).",
        tags: ["deals"],
        params: {
          type: "object",
          properties: {
            deal_id: { type: "string" },
          },
          required: ["deal_id"],
        },
        // Pass-through: any query params accepted by lineage can be forwarded (debug flags, grouping toggles, etc).
        querystring: {
          type: "object",
          additionalProperties: true,
        },
        response: {
          200: {
            type: "object",
            properties: {
              deal_id: { type: "string" },
              generated_at: { type: "string" },
              items: { type: "array", items: { type: "object", additionalProperties: true } },
              warnings: { type: "array", items: { type: "string" } },
            },
            required: ["deal_id", "generated_at", "items"],
            additionalProperties: true,
          },
        },
      },
    },
    async (request, reply) => {
      const dealIdRaw = (request.params as any)?.deal_id;
      const dealId = sanitizeText(typeof dealIdRaw === "string" ? dealIdRaw : String(dealIdRaw ?? ""));
      if (!dealId) return reply.status(400).send({ error: "deal_id is required" });

      // Reuse the lineage implementation (single source of truth) and map to scoring-input v0.
      const rawUrl = (request as any)?.raw?.url ?? (request as any)?.url ?? "";
      const qs = typeof rawUrl === "string" && rawUrl.includes("?") ? rawUrl.split("?").slice(1).join("?") : "";
      const lineageUrl = `/api/v1/deals/${dealId}/lineage${qs ? `?${qs}` : ""}`;

      const injected = await app.inject({ method: "GET", url: lineageUrl });
      if (injected.statusCode !== 200) {
        try {
          return reply.status(injected.statusCode).send(injected.json());
        } catch {
          return reply.status(injected.statusCode).send({ error: "failed_to_build_scoring_input", message: injected.body });
        }
      }

      const lineage = injected.json() as any;
      const scoring = buildDealScoringInputV0FromLineage(lineage);
      return reply.send(scoring);
    }
  );

  app.post(
    "/api/v1/deals/:deal_id/segments/promote",
    {
      schema: {
        description: "DEV-only: compute segment classifications and persist high-confidence promotions to visual_assets.quality_flags.segment_key.",
        tags: ["deals"],
        params: {
          type: "object",
          properties: { deal_id: { type: "string" } },
          required: ["deal_id"],
        },
        body: {
          type: "object",
          additionalProperties: true,
          properties: {
            document_ids: { type: "array", items: { type: "string" } },
            visual_asset_ids: { type: "array", items: { type: "string" } },
            extractor_versions: { type: "array", items: { type: "string" } },
            dry_run: { type: "boolean" },
            force: { type: "boolean" },
            idempotency_key: { type: "string" },
            persist_artifact: { type: "boolean" },
            auto_accept_threshold: { type: "number" },
            review_threshold: { type: "number" },
            reject_threshold: { type: "number" },
          },
        },
      },
    },
    async (request, reply) => {
      if (process.env.NODE_ENV === "production") {
        return reply.status(403).send({ error: "segments/promote is disabled in production" });
      }

      const dealIdRaw = (request.params as any)?.deal_id;
      const dealId = sanitizeText(typeof dealIdRaw === "string" ? dealIdRaw : String(dealIdRaw ?? ""));
      if (!dealId) return reply.status(400).send({ error: "deal_id is required" });

      const bodySchema = z
        .object({
          document_ids: z.array(z.string()).optional(),
          visual_asset_ids: z.array(z.string()).optional(),
          extractor_versions: z.array(z.string()).optional(),
          dry_run: z.boolean().optional(),
          force: z.boolean().optional(),
          idempotency_key: z.string().optional(),
          persist_artifact: z.boolean().optional(),
          auto_accept_threshold: z.number().min(0).max(1).optional(),
          review_threshold: z.number().min(0).max(1).optional(),
          reject_threshold: z.number().min(0).max(1).optional(),
        })
        .passthrough();

      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const params = parsed.data;
      const dryRun = params.dry_run === true;
      const force = params.force === true;
      const persistArtifact = params.persist_artifact !== false;
      const requestedAutoAccept = typeof params.auto_accept_threshold === "number" ? params.auto_accept_threshold : null;
      const requestedReview = typeof params.review_threshold === "number" ? params.review_threshold : null;
      const requestedReject = typeof params.reject_threshold === "number" ? params.reject_threshold : null;

      // Threshold policy (default):
      // - auto_accept >= 0.85: safe to auto-persist
      // - review >= 0.65: plausible, needs review (no auto persist)
      // - reject < 0.65: keep unknown/keep existing persisted, but flag
      const defaults = getSegmentConfidenceThresholds();
      const AUTO_ACCEPT = requestedAutoAccept ?? defaults.auto_accept;
      const REVIEW = requestedReview ?? defaults.review;
      // Keep reject configurable for existing callers; default ties to review per policy.
      const REJECT = requestedReject ?? defaults.reject;

      if (!(REJECT <= REVIEW && REVIEW <= AUTO_ACCEPT)) {
        return reply.status(400).send({
          error: "Invalid thresholds: require reject_threshold <= review_threshold <= auto_accept_threshold",
        });
      }

      const safeKey = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const idempotencyKey = typeof params.idempotency_key === "string" && params.idempotency_key.trim() ? safeKey(params.idempotency_key.trim()) : null;
      const runId = idempotencyKey ?? randomUUID();

      const artifactDir = path.resolve(process.cwd(), "artifacts", "segment-promotion", dealId);
      const artifactPath = path.join(artifactDir, `${runId}.json`);

      if (idempotencyKey && fs.existsSync(artifactPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
          return reply.send({ ...existing, idempotent_replay: true });
        } catch {
          // fall through: re-run if artifact is unreadable
        }
      }

      const documentIds = Array.isArray(params.document_ids) ? params.document_ids.filter((d) => typeof d === "string" && d.trim()) : [];
      const visualAssetIds = Array.isArray(params.visual_asset_ids)
        ? params.visual_asset_ids.filter((v) => typeof v === "string" && v.trim())
        : [];
      const extractorVersions = Array.isArray(params.extractor_versions)
        ? params.extractor_versions.filter((v) => typeof v === "string" && v.trim())
        : [];

      const startTs = Date.now();
      const warnings: string[] = [];

      const visualsOk =
        (await hasTable(pool as any, "public.visual_assets")) &&
        (await hasTable(pool as any, "public.visual_extractions")) &&
        (await hasTable(pool as any, "public.evidence_links"));

      if (!visualsOk) {
        return reply.status(409).send({
          error: "visual extraction tables not installed",
          deal_id: dealId,
          run_id: runId,
        });
      }

      // Documents (for brand model + filtering)
      type DocRow = {
        id: string;
        title: string;
        type: string | null;
        page_count: number | null;
        uploaded_at: string;
      };
      let docs: DocRow[] = [];
      try {
        const { rows } = await pool.query<DocRow>(
          `SELECT id, title, type, page_count, uploaded_at
             FROM documents
            WHERE deal_id = $1
            ORDER BY uploaded_at DESC, id ASC`,
          [dealId]
        );
        docs = rows ?? [];
      } catch {
        warnings.push("document lookup failed");
        docs = [];
      }

      const docAllow = documentIds.length ? new Set(documentIds) : null;
      const docsFiltered = docAllow ? docs.filter((d) => docAllow.has(d.id)) : docs;

      // Visual assets + latest extraction + small evidence sample
      type VisualRow = {
        id: string;
        document_id: string;
        page_index: number;
        asset_type: string;
        extractor_version: string;
        quality_flags: any;
        ocr_text: string | null;
        ocr_blocks: any;
        structured_json: any;
        structured_summary: any;
        units: string | null;
        extraction_confidence: number | string | null;
        structured_kind?: string | null;
        evidence_sample_snippets?: string[] | null;
      };

      let visuals: VisualRow[] = [];
      try {
        const whereParts: string[] = ["d.deal_id = $1"];
        const paramsSql: any[] = [dealId];
        if (docAllow) {
          paramsSql.push(Array.from(docAllow));
          whereParts.push(`va.document_id = ANY($${paramsSql.length}::uuid[])`);
        }
        if (visualAssetIds.length) {
          paramsSql.push(visualAssetIds);
          whereParts.push(`va.id = ANY($${paramsSql.length}::uuid[])`);
        }
        if (extractorVersions.length) {
          paramsSql.push(extractorVersions);
          whereParts.push(`va.extractor_version = ANY($${paramsSql.length}::text[])`);
        }

        const { rows } = await pool.query<any>(
          `SELECT va.id,
                  va.document_id,
                  va.page_index,
                  va.asset_type,
                  va.extractor_version,
                  va.quality_flags,
                  le.ocr_text,
                  le.ocr_blocks,
                  le.structured_json,
                  le.structured_summary,
                  le.units,
                  le.extraction_confidence,
                  le.structured_kind,
                  ev.sample_snippets AS evidence_sample_snippets
             FROM documents d
             JOIN visual_assets va ON va.document_id = d.id
             LEFT JOIN LATERAL (
               SELECT ocr_text, ocr_blocks, structured_json, structured_summary, units, extraction_confidence, structured_kind
                 FROM (
                   SELECT ve.*, row_number() OVER (PARTITION BY ve.visual_asset_id ORDER BY ve.created_at DESC) rn
                     FROM visual_extractions ve
                    WHERE ve.visual_asset_id = va.id
                 ) latest_extractions
                WHERE latest_extractions.rn = 1
             ) le ON true
             LEFT JOIN LATERAL (
               SELECT array(
                 SELECT el.snippet
                   FROM evidence_links el
                  WHERE el.visual_asset_id = va.id AND el.snippet IS NOT NULL AND el.snippet <> ''
                  ORDER BY el.created_at DESC
                     LIMIT 3
               ) AS sample_snippets
             ) ev ON true
            WHERE ${whereParts.join(" AND ")}
            ORDER BY va.document_id ASC, va.page_index ASC, va.created_at ASC`,
          paramsSql
        );
        visuals = (rows ?? []) as VisualRow[];
      } catch (err: any) {
        const msg = typeof err?.message === "string" ? err.message : "unknown error";
        return reply.status(500).send({ error: `visual asset lookup failed: ${msg.slice(0, 200)}` });
      }

      // Brand model per doc (same idea as lineage)
      const brandModelByDocId = new Map<string, BrandModel>();
      const brandNameByDocId = new Map<string, { brand: string | null; confidence: number | null }>();

      for (const d of docsFiltered) {
        const pageInputs: PageInput[] = visuals
          .filter((v) => v.document_id === d.id)
          .map((v) => ({ ocr_blocks: (v as any).ocr_blocks ?? null, ocr_text: v.ocr_text ?? null }));

        const brandModel = buildBrandModel(pageInputs);
        const brandInfo = inferDocumentBrandName(pageInputs);
        if (brandInfo.brand_name) {
          const normBrand = normalizePhrase(brandInfo.brand_name);
          if (normBrand) brandModel.phrases.add(normBrand);
        }

        brandModelByDocId.set(d.id, brandModel);
        brandNameByDocId.set(d.id, { brand: brandInfo.brand_name, confidence: brandInfo.confidence });
      }

      const results: any[] = [];
      let promoted = 0;
      let unchanged = 0;
      let needsReview = 0;
      let rejected = 0;

      const byDocument: Record<string, { scanned: number; promoted: number; unchanged: number; needs_review: number; rejected: number }> = {};
      const transitions: Record<string, number> = {};

      const bumpDoc = (docId: string, key: keyof (typeof byDocument)[string]) => {
        byDocument[docId] = byDocument[docId] ?? { scanned: 0, promoted: 0, unchanged: 0, needs_review: 0, rejected: 0 };
        byDocument[docId][key] += 1;
      };

      for (const v of visuals) {
        const brandModel = brandModelByDocId.get(v.document_id) ?? buildBrandModel([]);
        const blacklist = brandModel.phrases;
        const brandInfo = brandNameByDocId.get(v.document_id) ?? { brand: null, confidence: null };

        const derivedStructure = deriveStructuredSummary((v as any)?.structured_json, (v as any)?.units ?? null);
        const structured_kind = (v as any)?.structured_kind ?? derivedStructure.structured_kind;
        const structured_summary = (v as any)?.structured_summary ?? derivedStructure.structured_summary;

        const titleDerived = inferSlideTitleForSlide({
          blocks: (v as any).ocr_blocks as any[],
          ocr_text: v.ocr_text,
          page_width: null,
          page_height: null,
          brandModel,
          enableDebug: false,
        });

        const persistedFromQualityRaw = normalizeAnalystSegment((v as any)?.quality_flags?.segment_key);
        const persistedFromStructuredRaw = normalizeAnalystSegment((v as any)?.structured_json?.segment_key);
        const qualitySourceRaw =
          typeof (v as any)?.quality_flags?.source === "string" ? String((v as any).quality_flags.source) : null;
        const qualitySegmentSourceRawDirect =
          typeof (v as any)?.quality_flags?.segment_source === "string" ? String((v as any).quality_flags.segment_source) : null;
        const qualityPersistMarker = qualitySegmentSourceRawDirect ?? qualitySourceRaw;
        const allowQualityPersist = (() => {
          const s = typeof qualityPersistMarker === "string" ? qualityPersistMarker.trim() : "";
          if (!s) return false;
          if (s === "human_override" || s === "human_override_v1" || s.startsWith("human_override_")) return true;
          if (s.startsWith("promoted") || s.startsWith("promoted_")) return true;
          if (s.startsWith("structured_")) return true;
          return false;
        })();
        const persistedFromQuality =
          allowQualityPersist && persistedFromQualityRaw && persistedFromQualityRaw !== "unknown" ? persistedFromQualityRaw : null;
        const persistedFromStructured = persistedFromStructuredRaw && persistedFromStructuredRaw !== "unknown" ? persistedFromStructuredRaw : null;
        const persistedSegment = persistedFromQuality ?? persistedFromStructured;
        const persistedSource = persistedFromQuality
          ? "quality_flags.segment_key"
          : persistedFromStructured
            ? "structured_json.segment_key"
            : null;

        const computed = classifySegment({
          ocr_text: v.ocr_text,
          ocr_snippet: ocrSnippet(v.ocr_text),
          structured_kind,
          structured_summary,
          structured_json: (v as any)?.structured_json,
          asset_type: v.asset_type,
          page_index: v.page_index,
          slide_title: titleDerived.slide_title,
          slide_title_confidence: titleDerived.slide_title_confidence,
          evidence_snippets: Array.isArray((v as any).evidence_sample_snippets) ? (v as any).evidence_sample_snippets : [],
          brand_blacklist: blacklist,
          brand_name: brandInfo.brand,
          extractor_version: (v as any)?.extractor_version,
          quality_source: (v as any)?.quality_flags?.source,
          enable_debug: true,
          include_debug_text_snippet: true,
          disable_structured_segment_key_signal: true,
          disable_structured_segment_key_fallback: true,
        });

        const delta = persistedSegment ? computed.segment !== persistedSegment : computed.segment !== "unknown";

        const transitionKey = `${persistedSegment ?? "(none)"}→${computed.segment}`;
        if (delta) transitions[transitionKey] = (transitions[transitionKey] ?? 0) + 1;

        let action: "promoted" | "unchanged" | "needs_review" = "unchanged";
        let review_band: "review" | "review_low" | "reject" | null = null;
        let updated = false;
        let decision_reason: string | null = null;

        // Reject unknown promotions by default: they add noise and don't help the UI.
        if (delta && computed.segment === "unknown" && !force) {
          action = "needs_review";
          review_band = "reject";
          decision_reason = "computed_unknown";
          rejected += 1;
          bumpDoc(v.document_id, "rejected");
          bumpDoc(v.document_id, "scanned");
          results.push({
            visual_asset_id: v.id,
            document_id: v.document_id,
            page_index: v.page_index,
            persisted_segment: persistedSegment,
            persisted_source: persistedSource,
            computed_segment: computed.segment,
            computed_confidence: computed.confidence,
            computed_reason: computed.debug,
            thresholds: { auto_accept: AUTO_ACCEPT, review: REVIEW, reject: REJECT },
            action,
            review_band,
            did_update: false,
            decision_reason,
            debug: computed.debug,
          });
          continue;
        }

        // If this asset was previously promoted, do not override a different promoted value unless forced.
        const priorPromotionSource = typeof (v as any)?.quality_flags?.segment_source === "string"
          ? String((v as any).quality_flags.segment_source)
          : typeof (v as any)?.quality_flags?.source === "string"
            ? String((v as any).quality_flags.source)
            : null;
        const priorPromotionComputed = (v as any)?.quality_flags?.segment_promotion?.computed_segment;
        const wasPromotedBefore = priorPromotionSource === "promoted_rescore_v1" || priorPromotionSource === "api_segment_promotion_v1";
        if (delta && wasPromotedBefore && persistedSource === "quality_flags.segment_key" && !force) {
          const alreadyMatchesComputed = typeof priorPromotionComputed === "string" && priorPromotionComputed === computed.segment;
          if (!alreadyMatchesComputed) {
            action = "needs_review";
            review_band = "review";
            decision_reason = "conflict_prior_promotion";
            needsReview += 1;
            bumpDoc(v.document_id, "needs_review");
            bumpDoc(v.document_id, "scanned");
            results.push({
              visual_asset_id: v.id,
              document_id: v.document_id,
              page_index: v.page_index,
              persisted_segment: persistedSegment,
              persisted_source: persistedSource,
              computed_segment: computed.segment,
              computed_confidence: computed.confidence,
              computed_reason: computed.debug,
              thresholds: { auto_accept: AUTO_ACCEPT, review: REVIEW, reject: REJECT },
              action,
              review_band,
              did_update: false,
              decision_reason,
              debug: computed.debug,
            });
            continue;
          }
        }

        if (delta) {
          if (computed.confidence >= AUTO_ACCEPT) {
            action = "promoted";
            if (!dryRun) {
              const promotionMeta = {
                run_id: runId,
                promoted_at: new Date().toISOString(),
                prior_segment: persistedSegment,
                prior_source: persistedSource,
                computed_segment: computed.segment,
                computed_confidence: computed.confidence,
                auto_accept_threshold: AUTO_ACCEPT,
              };

              const promotedAt = new Date().toISOString();

              const { rowCount } = await pool.query(
                `UPDATE visual_assets
                    SET quality_flags =
                      jsonb_set(
                        jsonb_set(
                          jsonb_set(
                            jsonb_set(
                              jsonb_set(
                                jsonb_set(coalesce(quality_flags, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true),
                                '{segment_source}', to_jsonb($3::text), true
                              ),
                              '{segment_confidence}', to_jsonb($4::double precision), true
                            ),
                            '{segment_promoted_at}', to_jsonb($5::text), true
                          ),
                          '{source}', to_jsonb($3::text), true
                        ),
                        '{segment_promotion}', $6::jsonb, true
                      )
                  WHERE id = $1
                    AND (quality_flags->>'segment_key') IS DISTINCT FROM $2`,
                [v.id, computed.segment, "promoted_rescore_v1", computed.confidence, promotedAt, JSON.stringify(promotionMeta)]
              );
              updated = (rowCount ?? 0) > 0;
            }
            promoted += 1;
            bumpDoc(v.document_id, "promoted");
          } else {
            action = "needs_review";
            if (computed.confidence >= REVIEW) {
              review_band = "review";
              needsReview += 1;
              bumpDoc(v.document_id, "needs_review");
            } else if (computed.confidence >= REJECT) {
              review_band = "review_low";
              needsReview += 1;
              bumpDoc(v.document_id, "needs_review");
            } else {
              review_band = "reject";
              rejected += 1;
              bumpDoc(v.document_id, "rejected");
            }
          }
        } else {
          unchanged += 1;
          bumpDoc(v.document_id, "unchanged");
        }

        bumpDoc(v.document_id, "scanned");

        results.push({
          visual_asset_id: v.id,
          document_id: v.document_id,
          page_index: v.page_index,
          persisted_segment: persistedSegment,
          persisted_source: persistedSource,
          computed_segment: computed.segment,
          computed_confidence: computed.confidence,
          computed_reason: computed.debug,
          thresholds: { auto_accept: AUTO_ACCEPT, review: REVIEW, reject: REJECT },
          action,
          review_band,
          did_update: updated,
          decision_reason,
          debug: computed.debug,
        });
      }

      const endTs = Date.now();
      const EXAMPLE_LIMIT = 8;
      const examples = {
        would_promote: results.filter((r) => r.action === "promoted").slice(0, EXAMPLE_LIMIT),
        review: results.filter((r) => r.action === "needs_review" && r.review_band === "review").slice(0, EXAMPLE_LIMIT),
        review_low: results.filter((r) => r.action === "needs_review" && r.review_band === "review_low").slice(0, EXAMPLE_LIMIT),
        reject: results.filter((r) => r.action === "needs_review" && r.review_band === "reject").slice(0, EXAMPLE_LIMIT),
        noop: results.filter((r) => r.action === "unchanged").slice(0, EXAMPLE_LIMIT),
      };

      const summary = {
        deal_id: dealId,
        run_id: runId,
        started_at: new Date(startTs).toISOString(),
        finished_at: new Date(endTs).toISOString(),
        duration_ms: endTs - startTs,
        dry_run: dryRun,
        thresholds: { auto_accept: AUTO_ACCEPT, review: REVIEW, reject: REJECT },
        filters: {
          document_ids: documentIds,
          visual_asset_ids: visualAssetIds,
          extractor_versions: extractorVersions,
          force,
        },
        counts: {
          scanned: results.length,
          promoted,
          unchanged,
          needs_review: needsReview,
          rejected,
        },
        totals: {
          considered: results.length,
          would_promote: promoted,
          review: needsReview,
          reject: rejected,
          noop: unchanged,
        },
        by_document: byDocument,
        transitions,
        examples,
        warnings,
      };

      const payload = { ...summary, items: results };

      if (persistArtifact) {
        try {
          fs.mkdirSync(artifactDir, { recursive: true });
          fs.writeFileSync(artifactPath, JSON.stringify(payload, null, 2));
        } catch (err: any) {
          warnings.push(`failed to write artifact: ${typeof err?.message === "string" ? err.message : "unknown error"}`);
        }
      }

      return reply.send({ ...payload, artifact_path: persistArtifact ? artifactPath : null });
    }
  );

  // Create a minimal deal record suitable for an upload-first flow.
  // Returns only {deal_id} so the client can immediately attach documents.
  app.post("/api/v1/deals/draft", async (request, reply) => {
    const parsed = dealDraftCreateSchema?.safeParse(request.body);
    if (parsed && !parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const data = parsed?.success ? parsed.data : undefined;

    const stage = data?.stage ?? "intake";
    const priority = data?.priority ?? "medium";
    const owner = data?.owner ?? null;

    const requestedName = typeof data?.name === "string" ? sanitizeText(data.name) : "";
    const name = requestedName || `Draft Deal ${randomUUID().slice(0, 8)}`;

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, priority, owner)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [name, stage, priority, owner]
    );

    const dealId = rows[0]?.id;

    if (dealId && (await hasColumn(pool, "deals", "lifecycle_status"))) {
      try {
        await pool.query(`UPDATE deals SET lifecycle_status = 'draft', updated_at = now() WHERE id = $1`, [dealId]);
      } catch {
        // ignore
      }
    }

    return reply.status(201).send({ deal_id: dealId });
  });

  app.post("/api/v1/deals/:deal_id/auto-profile", async (request, reply) => {
    const dealIdRaw = (request.params as any)?.deal_id;
    const dealId = sanitizeText(typeof dealIdRaw === "string" ? dealIdRaw : String(dealIdRaw ?? ""));
    const warnings: string[] = [];

    if (!dealId) {
      return reply.status(400).send({ error: "deal_id is required" });
    }

    let docs: AutoProfileDocRow[] = [];
    try {
      const canJoinOriginalFile = await hasTable(pool, "document_files");
      const res = await pool.query<AutoProfileDocRow>(
        canJoinOriginalFile
          ? `SELECT d.id, d.title, f.file_name, d.full_text, d.structured_data, d.full_content
             FROM documents d
             LEFT JOIN document_files f ON f.document_id = d.id
             WHERE d.deal_id = $1
             ORDER BY d.uploaded_at DESC`
          : `SELECT id, title, full_text, structured_data, full_content
             FROM documents
             WHERE deal_id = $1
             ORDER BY uploaded_at DESC`,
        [dealId]
      );
      docs = res.rows ?? [];
    } catch {
      warnings.push("failed to load documents for auto-profile");
      docs = [];
    }

    const computed = computeAutoProfileFromDocuments(docs);
    warnings.push(...computed.warnings);

    const canPersist =
      (await hasColumn(pool, "deals", "proposed_profile")) &&
      (await hasColumn(pool, "deals", "proposed_profile_confidence")) &&
      (await hasColumn(pool, "deals", "proposed_profile_sources")) &&
      (await hasColumn(pool, "deals", "proposed_profile_warnings"));

    if (canPersist) {
      try {
        const proposedProfileDb = (computed as any)?.proposed_profile ?? null;
        const confidenceDb = (computed as any)?.confidence ?? null;
        const sourcesDb = (computed as any)?.sources ?? null;
        const warningsDb = normalizeWarningsForPersistence(warnings);

        await pool.query(
          `UPDATE deals
           SET proposed_profile = $2,
               proposed_profile_confidence = $3,
               proposed_profile_sources = $4,
               proposed_profile_warnings = $5,
               updated_at = now()
           WHERE id = $1`,
          [dealId, jsonbParam(proposedProfileDb), jsonbParam(confidenceDb), jsonbParam(sourcesDb), jsonbParam(warningsDb)]
        );
      } catch (err: any) {
        const msg = typeof err?.message === "string" ? err.message : "unknown error";
        const warningsDb = normalizeWarningsForPersistence(warnings);
        request.log?.warn?.(
          {
            err: msg,
            deal_id: dealId,
            value_types: {
              proposed_profile: typeof (computed as any)?.proposed_profile,
              proposed_profile_isArray: Array.isArray((computed as any)?.proposed_profile),
              proposed_profile_confidence: typeof (computed as any)?.confidence,
              proposed_profile_sources: typeof (computed as any)?.sources,
              proposed_profile_warnings: warningsDb === null ? "null" : typeof warningsDb,
              proposed_profile_warnings_isArray: Array.isArray(warningsDb),
              proposed_profile_warnings_len: Array.isArray(warningsDb) ? warningsDb.length : 0,
            },
          },
          "auto-profile.persist_failed"
        );
        warnings.push(`failed to persist proposed profile (non-fatal): ${String(msg).slice(0, 240)}`);
      }
    } else {
      warnings.push("proposed profile storage not available (missing columns)");
    }

    return reply.status(200).send({
      deal_id: dealId,
      proposed_profile: computed.proposed_profile,
      confidence: computed.confidence,
      sources: computed.sources,
      warnings,
    });
  });

  app.post("/api/v1/deals/:deal_id/confirm-profile", async (request, reply) => {
    const dealIdRaw = (request.params as any)?.deal_id;
    const dealId = sanitizeText(typeof dealIdRaw === "string" ? dealIdRaw : String(dealIdRaw ?? ""));
    if (!dealId) {
      return reply.status(400).send({ error: "deal_id is required" });
    }

    const parsed = dealConfirmProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const dealName = sanitizeProfileValue(body.deal_name) ?? null;
    const companyName = sanitizeProfileValue(body.company_name) ?? null;
    const industry = sanitizeProfileValue(body.industry) ?? null;
    const investmentType = sanitizeProfileValue(body.investment_type) ?? null;
    const round = sanitizeProfileValue(body.round) ?? null;

    const hasLifecycle = await hasColumn(pool, "deals", "lifecycle_status");
    const hasInvestmentType = await hasColumn(pool, "deals", "investment_type");
    const hasRound = await hasColumn(pool, "deals", "round");
    const hasProposal = await hasColumn(pool, "deals", "proposed_profile");
    const hasIndustry = await hasColumn(pool, "deals", "industry");

    try {
      const setFragments: string[] = [];
      const params: any[] = [dealId];
      let idx = 2;

      if (dealName) {
        setFragments.push(`name = $${idx++}`);
        params.push(dealName);
      }
      if (companyName) {
        setFragments.push(`owner = $${idx++}`);
        params.push(companyName);
      }
      if (industry && hasIndustry) {
        setFragments.push(`industry = $${idx++}`);
        params.push(industry);
      }
      if (investmentType && hasInvestmentType) {
        setFragments.push(`investment_type = $${idx++}`);
        params.push(investmentType);
      }
      if (round && hasRound) {
        setFragments.push(`round = $${idx++}`);
        params.push(round);
      }
      if (hasLifecycle) {
        setFragments.push(`lifecycle_status = 'active'`);
      }
      if (hasProposal) {
        setFragments.push(`proposed_profile = NULL`);
        if (await hasColumn(pool, "deals", "proposed_profile_confidence")) setFragments.push(`proposed_profile_confidence = NULL`);
        if (await hasColumn(pool, "deals", "proposed_profile_sources")) setFragments.push(`proposed_profile_sources = NULL`);
        if (await hasColumn(pool, "deals", "proposed_profile_warnings")) setFragments.push(`proposed_profile_warnings = NULL`);
      }

      if (setFragments.length === 0) {
        return reply.status(400).send({ error: "No fields provided to confirm" });
      }

      const { rows } = await pool.query<DealRow>(
        `UPDATE deals SET ${setFragments.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
        params
      );

      if (!rows?.[0]) {
        return reply.status(404).send({ error: "Deal not found" });
      }

      return reply.status(200).send(mapDeal(rows[0], null, "full"));
    } catch {
      return reply.status(500).send({ error: "Failed to confirm profile" });
    }
  });

  app.post("/api/v1/deals", async (request, reply) => {
    const parsed = dealCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { name, stage, priority, trend, score, owner } = parsed.data;

    // Guard against accidental duplicates (common in bulk assignment / OCR scenarios).
    // We keep this lightweight (no schema changes) by normalizing and comparing in-app.
    const normalized = normalizeDealName(name);
    if (normalized) {
      const { rows: existing } = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM deals WHERE deleted_at IS NULL`
      );
      const match = existing.find((d: { id: string; name: string }) => normalizeDealName(d.name) === normalized);
      if (match) {
        return reply.status(409).send({
          error: "Deal already exists",
          existing_deal_id: match.id,
          existing_deal_name: match.name,
        });
      }
    }

    const { rows } = await pool.query<DealRow>(
      `INSERT INTO deals (name, stage, priority, trend, score, owner)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, stage, priority, trend ?? null, score ?? null, owner ?? null]
    );

    return mapDeal(rows[0], null, "full");
  });

  const dealMergeSchema = z.object({
    source_deal_id: z.string().uuid(),
    target_deal_id: z.string().uuid(),
    delete_source_dio: z.boolean().optional().default(false),
  });

  // Merge one deal into another by reassigning documents (and related rows) and soft-deleting the source deal.
  app.post("/api/v1/deals/merge", async (request, reply) => {
    const parsed = dealMergeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { source_deal_id, target_deal_id, delete_source_dio } = parsed.data;
    if (source_deal_id === target_deal_id) {
      return reply.status(400).send({ error: "source_deal_id and target_deal_id must be different" });
    }

    const client = await pool.connect?.();
    if (!client) return reply.status(500).send({ error: "Database connection unavailable" });
    try {
      await client.query("BEGIN");

      const { rows: sourceRows } = await client.query<DealRow>(
        `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
        [source_deal_id]
      );
      const { rows: targetRows } = await client.query<DealRow>(
        `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
        [target_deal_id]
      );

      if (sourceRows.length === 0) {
        await client.query("ROLLBACK");
        return reply.status(404).send({ error: "Source deal not found" });
      }
      if (targetRows.length === 0) {
        await client.query("ROLLBACK");
        return reply.status(404).send({ error: "Target deal not found" });
      }

      const source = sourceRows[0];
      const target = targetRows[0];

      const docsRes = await client.query(
        `UPDATE documents SET deal_id = $2, updated_at = now() WHERE deal_id = $1`,
        [source_deal_id, target_deal_id]
      );

      const evidenceRes = await client.query(
        `UPDATE evidence SET deal_id = $2 WHERE deal_id = $1`,
        [source_deal_id, target_deal_id]
      );
      const dealEvidenceRes = await client.query(
        `UPDATE deal_evidence SET deal_id = $2 WHERE deal_id = $1`,
        [source_deal_id, target_deal_id]
      );
      const jobsRes = await client.query(
        `UPDATE jobs SET deal_id = $2, updated_at = now() WHERE deal_id = $1`,
        [source_deal_id, target_deal_id]
      );

      let dioDeleted = 0;
      if (delete_source_dio) {
        const del = await client.query(
          `DELETE FROM deal_intelligence_objects WHERE deal_id = $1`,
          [source_deal_id]
        );
        dioDeleted = del.rowCount ?? 0;
      }

      await client.query(
        `UPDATE deals SET deleted_at = now(), updated_at = now() WHERE id = $1`,
        [source_deal_id]
      );

      await client.query("COMMIT");

      return reply.send({
        ok: true,
        source: { id: source.id, name: source.name },
        target: { id: target.id, name: target.name },
        moved: {
          documents: docsRes.rowCount ?? 0,
          evidence: evidenceRes.rowCount ?? 0,
          deal_evidence: dealEvidenceRes.rowCount ?? 0,
          jobs: jobsRes.rowCount ?? 0,
        },
        deleted: {
          source_dio_rows: dioDeleted,
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      const message = err instanceof Error ? err.message : "Merge failed";
      return reply.status(500).send({ error: message });
    } finally {
      client.release();
    }
  });

  app.get("/api/v1/deals/:deal_id/visual-assets", async (request, reply) => {
    const dealId = sanitizeText((request.params as { deal_id: string }).deal_id);
    if (!dealId) return reply.status(400).send({ error: "deal_id is required" });

    const groupWordRequested = parseBoolQ(((request.query as any) ?? {})?.group_word, false);
    const docHintRequested = parseBoolQ(((request.query as any) ?? {})?.doc_hint, false);

    const logCtx = { route: "deal_visual_assets", deal_id: dealId };

    try {
      const dealExistsRes = await pool.query("SELECT id FROM deals WHERE id = $1 LIMIT 1", [dealId]);
      const dealExists = Array.isArray(dealExistsRes?.rows) && dealExistsRes.rows.length > 0;
      if (!dealExists) {
        request.log?.warn?.({ ...logCtx }, "deal_visual_assets.not_found");
        return reply.status(404).send({ error: "deal_not_found", deal_id: dealId });
      }

      const assetsOk = await hasTable(pool, "public.visual_assets");
      const extractionsOk = await hasTable(pool, "public.visual_extractions");
      const documentsOk = await hasTable(pool, "public.documents");
      const aiAnalysesOk = await hasTable(pool, "public.visual_asset_ai_analyses");

      if (!assetsOk || !extractionsOk || !documentsOk) {
        request.log?.warn?.(
          { ...logCtx, assets_table: assetsOk, extractions_table: extractionsOk, documents_table: documentsOk },
          "deal_visual_assets.schema_missing"
        );
        return reply.send({ deal_id: dealId, visual_assets: [] });
      }

      const hasStructuredSummary = await hasColumn(pool, "visual_extractions", "structured_summary");
      const hasStructuredKind = await hasColumn(pool, "visual_extractions", "structured_kind");
      const hasOcrBlocks = await hasColumn(pool, "visual_extractions", "ocr_blocks");
      const hasUnits = await hasColumn(pool, "visual_extractions", "units");
      const structuredSummarySelect = hasStructuredSummary
        ? "ve.structured_summary AS structured_summary"
        : "NULL::jsonb AS structured_summary";

      request.log?.info?.(
        {
          ...logCtx,
          has_structured_summary: hasStructuredSummary,
          has_structured_kind: hasStructuredKind,
          has_ai_analyses: aiAnalysesOk,
        },
        "deal_visual_assets.schema_ready"
      );

      const aiInvestorSelect = aiAnalysesOk ? "aa_inv.last_at AS ai_analysis_investor_last_at" : "NULL::timestamptz AS ai_analysis_investor_last_at";
      const aiAnalystSelect = aiAnalysesOk ? "aa_an.last_at AS ai_analysis_analyst_last_at" : "NULL::timestamptz AS ai_analysis_analyst_last_at";
      const aiInvestorJoin = aiAnalysesOk
        ? "LEFT JOIN LATERAL (SELECT MAX(created_at) AS last_at FROM visual_asset_ai_analyses WHERE visual_asset_id = va.id AND audience = 'investor') aa_inv ON true"
        : "";
      const aiAnalystJoin = aiAnalysesOk
        ? "LEFT JOIN LATERAL (SELECT MAX(created_at) AS last_at FROM visual_asset_ai_analyses WHERE visual_asset_id = va.id AND audience = 'analyst') aa_an ON true"
        : "";

      const { rows } = await pool.query(
        `WITH latest_extraction AS (
           SELECT ve.visual_asset_id,
                  ${hasStructuredKind ? "ve.structured_kind AS structured_kind" : "NULL::text AS structured_kind"},
                  ${structuredSummarySelect},
                  ve.ocr_text,
                  ${hasOcrBlocks ? "ve.ocr_blocks AS ocr_blocks" : "NULL::jsonb AS ocr_blocks"},
                  ${hasUnits ? "ve.units AS units" : "NULL::jsonb AS units"},
                  ve.structured_json,
                  ROW_NUMBER() OVER (PARTITION BY ve.visual_asset_id ORDER BY ve.created_at DESC) AS rn
             FROM visual_extractions ve
        )
         SELECT
           va.id AS visual_asset_id,
           va.id,
           va.document_id,
           d.deal_id,
           va.page_index,
           va.bbox,
           va.image_uri,
           va.image_hash,
           va.created_at,
           va.asset_type,
           va.confidence,
           va.quality_flags,
           va.extractor_version,
           d.title AS document_title,
           d.type AS document_type,
           d.status AS document_status,
           d.page_count AS document_page_count,
           COALESCE(ev.count, 0) AS evidence_count,
           COALESCE(ev.sample_snippets, ARRAY[]::text[]) AS evidence_sample_snippets,
           (SELECT EXISTS (SELECT 1 FROM visual_extractions ve WHERE ve.visual_asset_id = va.id)) AS has_extraction,
           le.structured_kind,
           le.structured_summary,
           le.ocr_text,
           le.ocr_blocks,
           le.units,
           le.structured_json,
           ${aiInvestorSelect},
           ${aiAnalystSelect}
         FROM visual_assets va
         JOIN documents d ON d.id = va.document_id
         ${aiInvestorJoin}
         ${aiAnalystJoin}
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS count,
                  ARRAY(
                  SELECT LEFT(el.snippet, 200)
                   FROM evidence_links el
                  WHERE el.visual_asset_id = va.id AND el.snippet IS NOT NULL AND el.snippet <> ''
                  ORDER BY el.created_at DESC
                     LIMIT 3
                  ) AS sample_snippets
             FROM evidence_links el2
            WHERE el2.visual_asset_id = va.id
         ) ev ON true
         LEFT JOIN latest_extraction le ON le.visual_asset_id = va.id AND le.rn = 1
        WHERE d.deal_id = $1
        ORDER BY va.document_id ASC, va.page_index ASC, va.created_at ASC
        LIMIT 5000`,
        [dealId]
      );

      const rawAssets = rows ?? [];

      const brandModelByDocId = new Map<string, BrandModel>();
      const brandNameByDocId = new Map<string, { brand: string | null; confidence: number | null }>();

      const docIds = Array.from(
        new Set(
          rawAssets
            .map((r: any) => (typeof r?.document_id === "string" ? r.document_id : null))
            .filter((x: any): x is string => Boolean(x))
        )
      );

      for (const docId of docIds) {
        const pageInputs: PageInput[] = rawAssets
          .filter((r: any) => r?.document_id === docId)
          .map((r: any) => ({ ocr_blocks: (r as any).ocr_blocks ?? null, ocr_text: r?.ocr_text ?? null }));

        const brandModel = buildBrandModel(pageInputs);

        const brandInfo = inferDocumentBrandName(pageInputs);
        if (brandInfo.brand_name) {
          const normBrand = normalizePhrase(brandInfo.brand_name);
          if (normBrand) brandModel.phrases.add(normBrand);
        }

        brandModelByDocId.set(docId, brandModel);
        brandNameByDocId.set(docId, { brand: brandInfo.brand_name, confidence: brandInfo.confidence });
      }

      const segmentInputByVisualId = new Map<string, SegmentClassifierInput>();

      const visualAssetsPass1 = rawAssets.map((r: any) => {
        const visual_asset_id = r?.visual_asset_id ?? r?.id ?? null;
        const brandModel = brandModelByDocId.get(r?.document_id) ?? buildBrandModel([]);
        const blacklist = brandModel.phrases;
        const brandInfo = brandNameByDocId.get(r?.document_id) ?? { brand: null, confidence: null };

        const derivedStructure = deriveStructuredSummary((r as any)?.structured_json, (r as any)?.units ?? null);
        const structured_kind = (r as any)?.structured_kind ?? derivedStructure.structured_kind;
        const structured_summary = (r as any)?.structured_summary ?? derivedStructure.structured_summary;

        const titleDerived = inferSlideTitleForSlide({
          blocks: (r as any).ocr_blocks as any[],
          ocr_text: r?.ocr_text,
          page_width: null,
          page_height: null,
          brandModel,
          enableDebug: false,
        });

        // Segment resolution order (effective truth, non-destructive):
        // 1) human_override (quality_flags.segment_source === 'human_override' or 'human_override_*')
        // 2) promoted/persisted (quality_flags.segment_key)
        // 3) computed (API classifier)
        // 4) unknown
        // NOTE: structured_json.segment_key is treated as an input/persisted hint but does not override computed.
        const persistedFromQualityRaw = normalizeAnalystSegment((r as any)?.quality_flags?.segment_key);
        const persistedFromStructuredRaw = normalizeAnalystSegment((r as any)?.structured_json?.segment_key);
        const qualitySourceRaw =
          typeof (r as any)?.quality_flags?.source === "string" ? String((r as any).quality_flags.source) : null;
        const qualitySegmentSourceRawDirect =
          typeof (r as any)?.quality_flags?.segment_source === "string" ? String((r as any).quality_flags.segment_source) : null;
        const qualityPersistMarker = qualitySegmentSourceRawDirect ?? qualitySourceRaw;
        const allowQualityPersist = (() => {
          const s = typeof qualityPersistMarker === "string" ? qualityPersistMarker.trim() : "";
          if (!s) return false;
          if (s === "human_override" || s === "human_override_v1" || s.startsWith("human_override_")) return true;
          if (s.startsWith("promoted") || s.startsWith("promoted_")) return true;
          if (s.startsWith("structured_")) return true;
          return false;
        })();
        const persistedFromQuality =
          allowQualityPersist && persistedFromQualityRaw && persistedFromQualityRaw !== "unknown" ? persistedFromQualityRaw : null;
        const persistedFromStructured = persistedFromStructuredRaw && persistedFromStructuredRaw !== "unknown" ? persistedFromStructuredRaw : null;
        const persistedSegmentKey = persistedFromQuality ?? persistedFromStructured;
        const persistedSourceKey = persistedFromQuality
          ? "quality_flags.segment_key"
          : persistedFromStructured
            ? "structured_json.segment_key"
            : null;

        const qualitySegmentSourceRaw = qualityPersistMarker;

        const isHumanOverride = Boolean(
          persistedFromQuality &&
            (qualitySegmentSourceRaw === "human_override" ||
              qualitySegmentSourceRaw === "human_override_v1" ||
              Boolean(qualitySegmentSourceRaw?.startsWith("human_override_")))
        );

        const isStructuredAsset =
          String((r as any)?.extractor_version ?? "") === "structured_native_v1" ||
          (typeof (r as any)?.quality_flags?.source === "string" && String((r as any).quality_flags.source).startsWith("structured_")) ||
          (typeof (r as any)?.structured_json?.kind === "string" &&
            ["word_section", "powerpoint_slide", "excel_sheet"].includes(String((r as any).structured_json.kind)));

        // Prefer worker-provided structured_json.segment_key when present; otherwise fall back to promoted key.
        // Only pass hints for structured assets (vision should be hint-free).
        const hintSegment = isStructuredAsset ? (persistedFromStructured ?? persistedFromQuality) : null;

        const baseInput: SegmentClassifierInput = {
          ocr_text: r?.ocr_text,
          ocr_snippet: ocrSnippet(r?.ocr_text),
          structured_kind,
          structured_summary,
          structured_json: (r as any)?.structured_json,
          asset_type: r?.asset_type,
          page_index: r?.page_index,
          slide_title: titleDerived.slide_title,
          slide_title_confidence: titleDerived.slide_title_confidence,
          evidence_snippets: Array.isArray((r as any).evidence_sample_snippets) ? (r as any).evidence_sample_snippets : [],
          brand_blacklist: blacklist,
          brand_name: brandInfo.brand,
          extractor_version: (r as any)?.extractor_version,
          quality_source: (r as any)?.quality_flags?.source,
          enable_debug: false,
          include_debug_text_snippet: false,
          // Make computed_v1 deterministic and independent of worker-provided segment_key.
          disable_structured_segment_key_signal: true,
          disable_structured_segment_key_fallback: true,
        };

        if (typeof visual_asset_id === "string" && visual_asset_id.trim().length > 0) {
          segmentInputByVisualId.set(visual_asset_id.trim(), baseInput);
        }

        const computed = classifySegment({ ...baseInput, hint_segment: hintSegment });

        const effectiveSegment = isHumanOverride
          ? (persistedFromQuality ?? computed.segment)
          : persistedFromQuality
            ? persistedFromQuality
            : computed.segment;

        const persistedConfidenceRaw = (r as any)?.quality_flags?.segment_confidence;
        const persistedConfidence =
          typeof persistedConfidenceRaw === "number" && Number.isFinite(persistedConfidenceRaw)
            ? persistedConfidenceRaw
            : 1;
        const effectiveConfidence = persistedFromQuality ? persistedConfidence : computed.confidence;

        const effectiveSource = (() => {
          if (persistedFromQuality) {
            if (isHumanOverride) return qualitySegmentSourceRaw || "human_override_v1";
            return qualitySegmentSourceRaw || "persisted_v0";
          }
          return "computed_v1";
        })();

        const qf = ((r as any)?.quality_flags ?? {}) as Record<string, any>;

        return {
          ...r,
          visual_asset_id,
          structured_summary,
          structured_kind,
          slide_title: titleDerived.slide_title,
          slide_title_source: titleDerived.slide_title_source,
          slide_title_confidence: titleDerived.slide_title_confidence,
          slide_title_warnings: titleDerived.slide_title_warnings,
          // Backwards-compatible if any consumers use "segment" from this endpoint.
          segment: effectiveSegment,
          effective_segment: effectiveSegment,
          segment_source: effectiveSource,
          segment_confidence: effectiveConfidence,
          computed_segment: computed.segment,
          computed_confidence: computed.confidence,
          persisted_segment_key: persistedSegmentKey,
          persisted_segment_source: persistedSourceKey,
          segment_promoted_at: typeof qf.segment_promoted_at === "string" ? qf.segment_promoted_at : null,
          segment_overridden_at: typeof qf.segment_overridden_at === "string" ? qf.segment_overridden_at : null,
          segment_override_note: typeof qf.segment_override_note === "string" ? qf.segment_override_note : null,
          document: {
            id: r?.document_id ?? null,
            title: r?.document_title ?? null,
            type: r?.document_type ?? null,
            status: r?.document_status ?? null,
            page_count: r?.document_page_count ?? null,
          },
        };
      });

      // Option A: DOCX doc-level hint propagation for low-signal structured_word blocks.
      const docHintByDocId = computeDocHintSegmentByDocId(visualAssetsPass1 as any, { minMajorityPct: 0.6 });

      let visualAssets = visualAssetsPass1.map((v: any) => {
        if (!isStructuredWordSectionAsset(v)) return v;
        if (isEmptyStructuredWordSectionAsset(v)) return v;
        const docId = typeof v?.document_id === "string" ? v.document_id : null;
        if (!docId) return v;
        const hint = docHintByDocId.get(docId) ?? null;
        if (!hint) return v;

        const persisted = pickNonUnknownSegment(v?.persisted_segment_key);
        if (persisted) return v;

        const computedSeg = normalizeAnalystSegment(v?.computed_segment);
        if (computedSeg && computedSeg !== "unknown") return v;

        const src = typeof v?.segment_source === "string" ? String(v.segment_source) : "";
        if (src === "human_override" || src === "human_override_v1" || src.startsWith("human_override_")) return v;

        const id = typeof v?.visual_asset_id === "string" ? v.visual_asset_id : typeof v?.id === "string" ? v.id : null;
        if (!id) return v;
        const base = segmentInputByVisualId.get(id);
        if (!base) return v;

        const recomputed = classifySegment({ ...base, hint_segment: hint });
        const seg = normalizeAnalystSegment(recomputed.segment) ?? "unknown";
        if (seg === "unknown") return v;

        return {
          ...v,
          segment: seg,
          effective_segment: seg,
          segment_source: "doc_hint_v1",
          segment_confidence: recomputed.confidence,
          computed_segment: seg,
          computed_confidence: recomputed.confidence,
          ...(docHintRequested ? { doc_hint_segment: hint } : {}),
          computed_reason: {
            rule_id: "DOCX_DOC_HINT_FALLBACK",
            doc_hint_segment: hint,
          },
        };
      });

      // Option B: cue-based rescue for structured_word blocks that are still unknown.
      // Conservative: only runs when there is no persisted override and computed remains unknown.
      visualAssets = visualAssets.map((v: any) => {
        if (!isStructuredWordSectionAsset(v)) return v;
        if (isEmptyStructuredWordSectionAsset(v)) return v;

        const persisted = pickNonUnknownSegment(v?.persisted_segment_key);
        if (persisted) return v;

        const computedSeg = normalizeAnalystSegment(v?.computed_segment);
        if (computedSeg && computedSeg !== "unknown") return v;

        const inferred = inferStructuredWordCueSegment(v);
        if (!inferred) return v;

        return {
          ...v,
          segment: inferred.segment,
          effective_segment: inferred.segment,
          segment_source: "docx_cue_v1",
          segment_confidence: inferred.confidence,
          computed_segment: inferred.segment,
          computed_confidence: inferred.confidence,
          computed_reason: {
            rule_id: "DOCX_CUE_RULE_V1",
            matched: inferred.matched,
          },
        };
      });

      let wordGroupingStatsForVisualAssets: WordGroupingStats | null = null;

      const groupedVisualAssets = (() => {
        if (!groupWordRequested) return undefined;
        const { groups: rawGroups, stats } = groupWordVisualAssetsByDocumentWithStats(visualAssets as any, { maxBlocksPerGroup: 8, maxCapturedChars: 1500 });
        wordGroupingStatsForVisualAssets = stats;

        const byId = new Map<string, any>();
        for (const v of visualAssets as any[]) {
          const id = typeof v?.id === "string" ? v.id : typeof v?.visual_asset_id === "string" ? v.visual_asset_id : null;
          if (id) byId.set(id, v);
        }

        return rawGroups.map((g: any) => {
          const docId = typeof g?.document_id === "string" ? g.document_id : null;
          const membersRaw = Array.isArray(g?.member_visual_asset_ids) ? g.member_visual_asset_ids : [];
          const members = membersRaw
            .map((id: any) => (typeof id === "string" ? byId.get(id) : null))
            .filter((v: any) => v && typeof v === "object");

          members.sort((a: any, b: any) => {
            const pa = typeof a?.page_index === "number" ? a.page_index : 1e9;
            const pb = typeof b?.page_index === "number" ? b.page_index : 1e9;
            if (pa !== pb) return pa - pb;
            const ca = typeof a?.created_at === "string" ? a.created_at : "";
            const cb = typeof b?.created_at === "string" ? b.created_at : "";
            if (ca !== cb) return ca.localeCompare(cb);
            return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
          });

          const groupText = buildDeterministicGroupCapturedText(members, 1500);

          const hintSegment =
            majorityNonUnknownSegment([
              ...members.map((m: any) => m?.persisted_segment_key),
              ...members.map((m: any) => m?.effective_segment),
              ...members.map((m: any) => (m?.structured_json as any)?.segment_key),
              // Segment-bucketed grouping: even if members are low-signal, the group already has a segment_key.
              g?.segment_key,
            ]) ?? null;

          // Persisted must ONLY come from persisted member segments; never from computed/effective hints.
          const persistedSegmentKey = majorityNonUnknownSegment(members.map((m: any) => m?.persisted_segment_key)) ?? null;

          const brandModel = docId ? brandModelByDocId.get(docId) ?? buildBrandModel([]) : buildBrandModel([]);
          const blacklist = brandModel.phrases;
          const brandInfo = docId ? brandNameByDocId.get(docId) ?? { brand: null, confidence: null } : { brand: null, confidence: null };

          const computed = classifySegment({
            ocr_text: null,
            ocr_snippet: groupText ? groupText.slice(0, 140) : null,
            structured_kind: "word_section",
            structured_summary: null,
            structured_json: {
              kind: "word_section",
              heading: typeof g?.heading === "string" ? g.heading : null,
              paragraphs: groupText ? [groupText] : [],
              text_snippet: groupText,
              segment_key: hintSegment,
            },
            asset_type: "structured_word_group",
            page_index: typeof g?.page_index === "number" ? g.page_index : null,
            slide_title: null,
            slide_title_confidence: null,
            evidence_snippets: Array.isArray(g?.evidence_snippets) ? g.evidence_snippets : [],
            brand_blacklist: blacklist,
            brand_name: brandInfo.brand,
            extractor_version: "structured_native_v1",
            quality_source: "structured_word",
            hint_segment: hintSegment,
            enable_debug: false,
            include_debug_text_snippet: false,
            disable_structured_segment_key_signal: true,
            disable_structured_segment_key_fallback: true,
          });

          const computedReasonRaw = computed.debug && typeof computed.debug === "object" ? computed.debug : null;
          const unknownReasonCode = typeof (computedReasonRaw as any)?.unknown_reason_code === "string" ? String((computedReasonRaw as any).unknown_reason_code) : null;

          const computedSegment =
            computed.segment === "unknown" && hintSegment && (unknownReasonCode === "NO_TEXT" || unknownReasonCode === "LOW_SIGNAL")
              ? hintSegment
              : computed.segment;

          const computedConfidence =
            computed.segment === "unknown" && hintSegment && (unknownReasonCode === "NO_TEXT" || unknownReasonCode === "LOW_SIGNAL")
              ? Math.max(0.2, computed.confidence)
              : computed.confidence;

          const computedReason =
            computed.segment === "unknown" && hintSegment && (unknownReasonCode === "NO_TEXT" || unknownReasonCode === "LOW_SIGNAL")
              ? {
                  ...(computedReasonRaw ?? {}),
                  rule_id: "STRUCTURED_HINT_FALLBACK",
                  unknown_reason_code: null,
                }
              : computedReasonRaw;

          const hasHumanOverride = members.some((m: any) => {
            const seg = pickNonUnknownSegment(m?.persisted_segment_key);
            const src = typeof m?.segment_source === "string" ? String(m.segment_source) : "";
            if (!seg || !persistedSegmentKey) return false;
            return seg === persistedSegmentKey && (src === "human_override" || src === "human_override_v1" || src.startsWith("human_override_"));
          });

          const effectiveSegment = hasHumanOverride
            ? (persistedSegmentKey ?? computedSegment)
            : persistedSegmentKey
              ? persistedSegmentKey
              : computedSegment;

          const segmentSource = (() => {
            if (hasHumanOverride && persistedSegmentKey) return "human_override_v1";
            if (persistedSegmentKey) return "persisted_v0";
            return "computed_v1";
          })();

          const segmentConfidence = persistedSegmentKey ? 1 : computedConfidence;

          return {
            ...g,
            captured_text: groupText,
            persisted_segment_key: persistedSegmentKey,
            persisted_segment_source: persistedSegmentKey ? "group_majority" : null,
            computed_segment: computedSegment,
            computed_confidence: computedConfidence,
            computed_reason: computedReason,
            effective_segment: effectiveSegment,
            segment_source: segmentSource,
            segment_confidence: segmentConfidence,
            segment_promoted_at: null,
            segment_overridden_at: null,
            segment_override_note: null,
          };
        });
      })();

      // Option B: if grouping requested, inherit group segment to any remaining unknown raw members (non-destructive).
      if (groupWordRequested && Array.isArray(groupedVisualAssets)) {
        const memberToGroupMeta = new Map<string, { segment: AnalystSegment; visual_asset_group_id: string | null }>();
        for (const g of groupedVisualAssets as any[]) {
          const seg = pickNonUnknownSegment(g?.effective_segment);
          if (!seg) continue;
          const groupIdRaw = typeof g?.visual_asset_group_id === "string" ? g.visual_asset_group_id : typeof g?.group_id === "string" ? g.group_id : "";
          const groupId = groupIdRaw && groupIdRaw.trim().length > 0 ? groupIdRaw.trim() : null;
          const members = Array.isArray(g?.member_visual_asset_ids) ? g.member_visual_asset_ids : [];
          for (const mid of members) {
            if (typeof mid !== "string" || !mid.trim()) continue;
            if (!memberToGroupMeta.has(mid)) memberToGroupMeta.set(mid, { segment: seg, visual_asset_group_id: groupId });
          }
        }

        for (let i = 0; i < visualAssets.length; i++) {
          const v = visualAssets[i] as any;
          if (!isStructuredWordSectionAsset(v)) continue;
          const id = typeof v?.visual_asset_id === "string" ? v.visual_asset_id : typeof v?.id === "string" ? v.id : null;
          if (!id) continue;
          const meta = memberToGroupMeta.get(id) ?? null;
          if (!meta) continue;
          const groupSeg = meta.segment;
          const persisted = pickNonUnknownSegment(v?.persisted_segment_key);
          if (persisted) continue;
          const effective = normalizeAnalystSegment(v?.effective_segment);
          if (effective && effective !== "unknown") continue;
          const src = typeof v?.segment_source === "string" ? String(v.segment_source) : "";
          if (src === "human_override" || src === "human_override_v1" || src.startsWith("human_override_")) continue;
          if (isEmptyStructuredWordSectionAsset(v)) continue;

          visualAssets[i] = {
            ...v,
            segment: groupSeg,
            effective_segment: groupSeg,
            segment_source: "group_inherit_v1",
            segment_confidence: Math.max(typeof v?.segment_confidence === "number" ? v.segment_confidence : 0, 0.2),
            computed_segment: groupSeg,
            computed_confidence: Math.max(typeof v?.computed_confidence === "number" ? v.computed_confidence : 0, 0.2),
            computed_reason: {
              rule_id: "GROUP_MEMBER_INHERIT",
              inherited_from_visual_asset_group_id: meta.visual_asset_group_id,
            },
          };
        }
      }

      // Optional inspector UX: expose doc-level hint segment on structured_word blocks.
      if (docHintRequested) {
        for (let i = 0; i < visualAssets.length; i++) {
          const v = visualAssets[i] as any;
          if (!isStructuredWordSectionAsset(v)) continue;
          const docId = typeof v?.document_id === "string" ? v.document_id : null;
          if (!docId) continue;
          const hint = docHintByDocId.get(docId) ?? null;
          if (!hint) continue;
          if (typeof v?.doc_hint_segment === "string" && v.doc_hint_segment.trim().length > 0) continue;
          visualAssets[i] = { ...v, doc_hint_segment: hint };
        }
      }

      // DEV-only logging: remaining true-unknown structured_word blocks should correlate with empty blocks.
      const devLogUnknown = process.env.NODE_ENV !== "production" && process.env.DDAI_DEV_LOG_DOCX_UNKNOWN === "1";
      if (devLogUnknown) {
        try {
          const unknowns = (visualAssets as any[])
            .filter((v: any) => isStructuredWordSectionAsset(v))
            .filter((v: any) => {
              const eff = normalizeAnalystSegment(v?.effective_segment) ?? "unknown";
              return eff === "unknown";
            })
            .slice(0, 50)
            .map((v: any) => {
              const id = typeof v?.visual_asset_id === "string" ? v.visual_asset_id : typeof v?.id === "string" ? v.id : null;
              const docId = typeof v?.document_id === "string" ? v.document_id : null;
              const stats = structuredWordContentStats(v);
              const hint = docId ? docHintByDocId.get(docId) ?? null : null;
              const base = id ? segmentInputByVisualId.get(id) : null;
              const debug = base ? classifySegment({ ...base, hint_segment: hint, enable_debug: true, include_debug_text_snippet: false }).debug : undefined;
              return {
                id,
                document_id: docId,
                page_index: typeof v?.page_index === "number" ? v.page_index : null,
                text_snippet_len: stats.textSnippetLen,
                paragraphs_len: stats.paragraphsLen,
                unknown_reason_code: typeof (debug as any)?.unknown_reason_code === "string" ? (debug as any).unknown_reason_code : null,
                rule_id: typeof (debug as any)?.rule_id === "string" ? (debug as any).rule_id : null,
                doc_hint_segment: hint,
              };
            });
          // eslint-disable-next-line no-console
          console.log("[DEV docx_unknown structured_word]", { deal_id: dealId, n: unknowns.length, unknowns });
        } catch {
          // ignore
        }
      }

      const wordGroupingStatsFinal: WordGroupingStats = wordGroupingStatsForVisualAssets ?? { word_members_skipped_empty: 0, word_groups_skipped_empty: 0 };

      return reply.send({
        deal_id: dealId,
        visual_assets: visualAssets,
			...(groupWordRequested
				? {
					grouped_visual_assets: groupedVisualAssets,
					warnings_counters: {
						word_members_skipped_empty: wordGroupingStatsFinal.word_members_skipped_empty,
						word_groups_skipped_empty: wordGroupingStatsFinal.word_groups_skipped_empty,
					},
				}
				: {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load visual assets";
      const payload = { error: "internal_error", message, deal_id: dealId };
      const stack = err instanceof Error ? err.stack : undefined;
      request.log?.error?.(
        { ...logCtx, err: process.env.NODE_ENV !== "production" ? err : undefined, stack: process.env.NODE_ENV !== "production" ? stack : undefined },
        "deal_visual_assets.error"
      );
      return reply.status(500).send(payload);
    }
  });

  app.get("/api/v1/deals", async (request) => {
    const mode = parseDealApiMode(request);
    // Accept optional filters but ignore for now (TODO)
    const { rows } = await pool.query<DealRow & {
      dio_id: string | null;
      analysis_version: number | null;
      recommendation: string | null;
      overall_score: number | null;
      overall_score_resolved: number | null;
      last_analyzed_at: string | null;
      run_count: number | null;
		executive_summary_v1: any | null;
		executive_summary_v2: any | null;
		decision_summary_v1: any | null;
		phase1_coverage: any | null;
		phase1_business_archetype_v1: any | null;
		phase1_deal_overview_v2: any | null;
		phase1_update_report_v1: any | null;
		phase_b_latest_run: any | null;
    phase_b_history: any | null;
    }>(
      `SELECT d.*,
              latest.dio_id,
              latest.analysis_version,
              latest.recommendation,
              latest.overall_score,
              latest.overall_score_resolved,
              latest.updated_at as last_analyzed_at,
				  latest.executive_summary_v1,
				  latest.executive_summary_v2,
				  latest.decision_summary_v1,
				  latest.deal_overview_v2 as phase1_deal_overview_v2,
				  latest.update_report_v1 as phase1_update_report_v1,
				  latest.phase1_coverage,
              phaseb.phase_b_latest_run,
    					phaseb.phase_b_history,
              stats.run_count
         FROM deals d
         LEFT JOIN LATERAL (
           SELECT dio_id,
                  analysis_version,
                  recommendation,
                  overall_score,
                  COALESCE(
                    overall_score,
                    NULLIF((dio_data #>> '{overall_score}'), '')::double precision,
                    NULLIF((dio_data #>> '{score_explanation,totals,overall_score}'), '')::double precision
                  ) AS overall_score_resolved,
                  updated_at,
					  (dio_data #> '{dio,phase1,executive_summary_v1}') AS executive_summary_v1
					, (dio_data #> '{dio,phase1,executive_summary_v2}') AS executive_summary_v2
  					, (dio_data #> '{dio,phase1,decision_summary_v1}') AS decision_summary_v1
					, (dio_data #> '{dio,phase1,coverage}') AS phase1_coverage
          , (dio_data #> '{dio,phase1,business_archetype_v1}') AS phase1_business_archetype_v1
					, (dio_data #> '{dio,phase1,deal_overview_v2}') AS deal_overview_v2
					, (dio_data #> '{dio,phase1,update_report_v1}') AS update_report_v1
            , (dio_data #> '{dio,phase1,deal_summary_v2}') AS deal_summary_v2
             FROM deal_intelligence_objects
            WHERE deal_id = d.id
            ORDER BY analysis_version DESC
            LIMIT 1
         ) latest ON TRUE
         LEFT JOIN LATERAL (
           SELECT jsonb_build_object(
                    'id', id,
                    'deal_id', deal_id,
                    'version', version,
                    'phase_b_result', phase_b_result,
                    'phase_b_features', phase_b_features,
                    'source_run_id', source_run_id,
               'created_at', created_at
             ) AS phase_b_latest_run,
             (
             	SELECT jsonb_agg(run ORDER BY (run ->> 'created_at')::timestamptz DESC NULLS LAST)
             	FROM (
             		SELECT jsonb_build_object(
             			'id', id,
             			'deal_id', deal_id,
             			'version', version,
             			'phase_b_result', phase_b_result,
             			'phase_b_features', phase_b_features,
             			'source_run_id', source_run_id,
             			'created_at', created_at
             		) AS run
             		FROM deal_phase_b_runs
             		WHERE deal_id = d.id
             		ORDER BY COALESCE(
             			created_at,
             			NULLIF((phase_b_features ->> 'computed_at'), '')::timestamptz,
             			'1970-01-01'::timestamptz
             		) DESC,
             		version DESC,
             		id DESC
             		LIMIT 3
             	) t(run)
             ) AS phase_b_history
             FROM deal_phase_b_runs
            WHERE deal_id = d.id
            ORDER BY COALESCE(
              created_at,
              NULLIF((phase_b_features ->> 'computed_at'), '')::timestamptz,
              '1970-01-01'::timestamptz
            ) DESC,
            version DESC,
            id DESC
            LIMIT 1
         ) phaseb ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS run_count
             FROM deal_intelligence_objects
            WHERE deal_id = d.id
         ) stats ON TRUE
        WHERE d.deleted_at IS NULL
        ORDER BY d.created_at DESC`
    );
    return rows.map((row) => mapDeal(row, {
      dio_id: row.dio_id,
      analysis_version: row.analysis_version,
      recommendation: row.recommendation,
      overall_score: parseNullableNumber((row as any).overall_score_resolved) ?? row.overall_score,
      last_analyzed_at: row.last_analyzed_at,
      run_count: row.run_count,
		executive_summary_v1: row.executive_summary_v1,
    executive_summary_v2: row.executive_summary_v2,
		decision_summary_v1: row.decision_summary_v1,
		phase1_coverage: row.phase1_coverage,
		phase1_business_archetype_v1: (row as any).phase1_business_archetype_v1,
    phase1_deal_overview_v2: row.phase1_deal_overview_v2,
    phase1_update_report_v1: row.phase1_update_report_v1,
		phase1_deal_summary_v2: (row as any).deal_summary_v2,
    phase1_claims: null,
    phase_b_latest_run: (row as any).phase_b_latest_run,
		phase_b_history: (row as any).phase_b_history,
    }, mode));
  });

  app.get("/api/v1/deals/:deal_id", async (request, reply) => {
    const startTs = Date.now();
    const dealId = (request.params as { deal_id: string }).deal_id;
    request.log.info({ msg: "deal.detail.start", deal_id: dealId, start_ts: new Date(startTs).toISOString() });
    const mode = parseDealApiMode(request);
    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [dealId]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const deal = rows[0];

        try {
          deal.documents_digest_v1 = await buildDocumentsDigest({ dealId, pool });
        } catch (err: any) {
          request.log.warn({ err, deal_id: dealId }, "documents_digest_v1.failed");
        }

    const { rows: latestDioRows } = await pool.query<{
      dio_id: string;
      analysis_version: number | null;
      recommendation: string | null;
      overall_score: number | null;
      dio_data: any;
      updated_at: string | null;
    }>(
      `SELECT dio_id, analysis_version, recommendation, overall_score, dio_data, updated_at
         FROM deal_intelligence_objects
        WHERE deal_id = $1
        ORDER BY analysis_version DESC
        LIMIT 1`,
      [dealId]
    );

    const { rows: dioStatsRows } = await pool.query<{ run_count: number | null; last_analyzed_at: string | null }>(
      `SELECT COUNT(*)::int AS run_count, MAX(updated_at) AS last_analyzed_at
         FROM deal_intelligence_objects
        WHERE deal_id = $1`,
      [dealId]
    );

    const { rows: phaseBRows } = await pool.query<{
      id: string;
      deal_id: string;
      version: number | null;
      phase_b_result: any;
      phase_b_features: any;
      source_run_id: string | null;
      created_at: string | null;
    }>(
      `SELECT id, deal_id, version, phase_b_result, phase_b_features, source_run_id, created_at
         FROM deal_phase_b_runs
        WHERE deal_id = $1
        ORDER BY COALESCE(
          created_at,
          NULLIF((phase_b_features ->> 'computed_at'), '')::timestamptz,
          '1970-01-01'::timestamptz
        ) DESC,
        version DESC,
        id DESC
        LIMIT 3`,
      [dealId]
    );

    const dioRows: Array<DIOAggregateRow & { overall_score_resolved?: any }> = [];
    if (latestDioRows[0]) {
      const latest = latestDioRows[0];
      const dioData = (latest as any).dio_data ?? {};
      const overallScoreResolved =
        parseNullableNumber(latest.overall_score) ??
        parseNullableNumber((dioData as any)?.overall_score) ??
        parseNullableNumber((dioData as any)?.score_explanation?.totals?.overall_score);

      const phaseBLatest = phaseBRows[0]
        ? {
          id: phaseBRows[0].id,
          deal_id: phaseBRows[0].deal_id,
          version: phaseBRows[0].version,
          phase_b_result: phaseBRows[0].phase_b_result,
          phase_b_features: phaseBRows[0].phase_b_features,
          source_run_id: phaseBRows[0].source_run_id,
          created_at: phaseBRows[0].created_at,
        }
        : null;

      const phaseBHistory = phaseBRows.map((r) => ({
        id: r.id,
        deal_id: r.deal_id,
        version: r.version,
        phase_b_result: r.phase_b_result,
        phase_b_features: r.phase_b_features,
        source_run_id: r.source_run_id,
        created_at: r.created_at,
      }));

      dioRows.push({
        dio_id: (latest as any).dio_id,
        analysis_version: latest.analysis_version,
        recommendation: latest.recommendation,
        overall_score: latest.overall_score,
        overall_score_resolved: overallScoreResolved,
        executive_summary_v1: (dioData as any)?.dio?.phase1?.executive_summary_v1 ?? null,
        executive_summary_v2: (dioData as any)?.dio?.phase1?.executive_summary_v2 ?? null,
        decision_summary_v1: (dioData as any)?.dio?.phase1?.decision_summary_v1 ?? null,
        phase1_coverage: (dioData as any)?.dio?.phase1?.coverage ?? null,
        phase1_business_archetype_v1: (dioData as any)?.dio?.phase1?.business_archetype_v1 ?? null,
        phase1_deal_overview_v2: (dioData as any)?.dio?.phase1?.deal_overview_v2 ?? null,
        phase1_update_report_v1: (dioData as any)?.dio?.phase1?.update_report_v1 ?? null,
        phase1_deal_summary_v2: (dioData as any)?.dio?.phase1?.deal_summary_v2 ?? null,
        phase1_claims: (dioData as any)?.dio?.phase1?.claims ?? null,
        phase_b_latest_run: phaseBLatest,
        phase_b_history: phaseBHistory,
        last_analyzed_at: dioStatsRows[0]?.last_analyzed_at ?? null,
        run_count: dioStatsRows[0]?.run_count ?? 0,
      });
    }

    let sectionEvidenceSamples: Partial<Record<ScoreBreakdownSectionKey, string[]>> | undefined;

    if (dioRows[0]) {
      try {
        const execV2 = (dioRows[0] as any).executive_summary_v2;
        let claims = Array.isArray((dioRows[0] as any).phase1_claims) ? (dioRows[0] as any).phase1_claims : [];

        claims = await ensureEvidenceLinksForClaims({ pool, dealId, dioId: (dioRows[0] as any)?.dio_id ?? null, claims });
        (dioRows[0] as any).phase1_claims = claims;
        try {
          sectionEvidenceSamples = await fetchEvidenceSamplesBySection({ pool, dealId, dioId: dioRows[0]?.dio_id ?? null, limit: 60 });
        } catch (err) {
          request.log?.info?.({
            deal_id: dealId,
            error: err instanceof Error ? err.message : String(err),
          }, "deal.score_breakdown_samples.fail_open");
          sectionEvidenceSamples = {};
        }

        const sampleIds = Object.values(sectionEvidenceSamples ?? {})
          .flatMap((arr) => (Array.isArray(arr) ? arr : []))
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

        const evidenceIds = collectEvidenceIdsFromClaims(claims);
        const allEvidenceIds = Array.from(new Set([...evidenceIds, ...sampleIds]));
        const evidenceRows = allEvidenceIds.length > 0 ? await getEvidenceByIds(pool, allEvidenceIds) : [];
        const docIds = Array.from(
          new Set(
            evidenceRows
              .map((ev) => ev?.document_id)
              .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          )
        );
        const docIndex = docIds.length > 0 ? await getDocumentIndex(pool, docIds) : {};
        const evidenceById = new Map<string, EvidenceRow>();
        for (const ev of evidenceRows) {
          if (!ev?.id) continue;
          evidenceById.set(ev.id, ev);
        }

        const precomputedBreakdown = buildScoreBreakdownV1({
          accountability: (execV2 as any)?.accountability_v1,
          scoreAudit: (execV2 as any)?.score_audit_v1,
          coverage: (dioRows[0] as any)?.phase1_coverage,
          claims,
          sectionEvidenceSamples,
        });

        if (precomputedBreakdown) {
          // Path A telemetry: quantify how much of the score-linked evidence is actually node-backed.
          // This does not change the score yet; it makes the defensibility measurable and enables gating.
          try {
            for (const section of precomputedBreakdown.sections ?? []) {
              const linkedIds = Array.isArray(section.evidence_ids_linked)
                ? section.evidence_ids_linked.filter((v) => typeof v === "string" && v.trim().length > 0)
                : [];
              if (linkedIds.length === 0) {
                section.node_evidence_count_linked = 0;
                section.node_trace_coverage_pct = 0;
                section.node_coverage_pct = 0;
                continue;
              }

              let nodeBacked = 0;
              const missing: string[] = [];
              for (const id of linkedIds) {
                const row = evidenceById.get(id);
                const vaId = typeof (row as any)?.visual_asset_id === "string" ? String((row as any).visual_asset_id).trim() : "";
                if (vaId) nodeBacked += 1;
                else missing.push(id);
              }

              section.node_evidence_count_linked = nodeBacked;
              const pct = Math.min(1, Math.max(0, nodeBacked / linkedIds.length));
              section.node_trace_coverage_pct = pct;
              section.node_coverage_pct = Math.round(pct * 100);
              if (missing.length > 0) section.node_missing_linked_evidence_ids = missing.slice(0, 10);
            }
          } catch (err) {
            request.log?.info?.({
              deal_id: dealId,
              error: err instanceof Error ? err.message : String(err),
            }, "deal.node_evidence_coverage.fail_open");
          }

          // Path A gate: summarize node-backed coverage into a single readiness signal for UI and future enforcement.
          const nodeGate = computeNodeEvidenceGateV1(precomputedBreakdown.sections ?? []);
          (dioRows[0] as any).phase1_node_evidence_gate_v1 = nodeGate;
          if (execV2 && typeof execV2 === "object") {
            (execV2 as any).node_evidence_gate_v1 = nodeGate;
          }

          // Optional enforcement: degrade confidence + add a highlight when node-backed trace is poor.
          // This only affects the API response (does not persist to the DIO).
          const gateModeRaw = typeof process.env.DDAI_NODE_EVIDENCE_GATE_MODE === "string" ? process.env.DDAI_NODE_EVIDENCE_GATE_MODE : "off";
          const gateMode = gateModeRaw.toLowerCase();
          const enforce = gateMode === "enforce" || gateMode === "hard";
          const warnOnly = gateMode === "warn" || gateMode === "soft";
          if ((enforce || warnOnly) && execV2 && typeof execV2 === "object" && nodeGate.status !== "ok") {
            const signals = (execV2 as any)?.signals;
            if (signals && typeof signals === "object") {
              if (enforce && nodeGate.status === "block") {
                (signals as any).confidence = "low";
              }
            }
            const hl = Array.isArray((execV2 as any).highlights) ? (execV2 as any).highlights : [];
            const msg = `Node-backed scoring gate: ${nodeGate.status.toUpperCase()} (${nodeGate.node_coverage_pct}% node-locatable linked evidence).`;
            if (!hl.some((x: any) => typeof x === "string" && x.includes("Node-backed scoring gate"))) {
              hl.unshift(msg);
              (execV2 as any).highlights = hl.slice(0, 8);
            }
          }

          // Make the enriched breakdown visible to downstream mappers by attaching it to ES2.
          // (Some clients prefer execV2.score_breakdown_v1 from the persisted DIO payload.)
          if (execV2 && typeof execV2 === "object") {
            (execV2 as any).score_breakdown_v1 = precomputedBreakdown;
            if ((precomputedBreakdown as any).trace_audit_v1) {
              (execV2 as any).score_trace_audit_v1 = (precomputedBreakdown as any).trace_audit_v1;
            }
          }

          (dioRows[0] as any).computed_score_breakdown_v1 = precomputedBreakdown;
          const scoreEvidenceCanonical = buildScoreEvidenceFromBreakdown({
            sections: precomputedBreakdown.sections,
            evidenceById,
            docIndex,
          });
          (dioRows[0] as any).phase1_score_evidence = scoreEvidenceCanonical;
        } else {
          const scoreEvidence = buildPhase1ScoreEvidence({
            executiveSummaryV2: execV2,
            claims,
            evidenceById,
            docIndex,
          });
          if (scoreEvidence) (dioRows[0] as any).phase1_score_evidence = scoreEvidence;
        }
      } catch (err) {
        request.log?.info?.({
          deal_id: dealId,
          error: err instanceof Error ? err.message : String(err),
        }, "deal.score_evidence.fail_open");
      }
    }

    return mapDeal(rows[0], dioRows[0] ?? null, mode, { sectionEvidenceSamples });
  });

  app.put("/api/v1/deals/:deal_id", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const parsed = dealUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: "No fields to update" });
    }

    // Path A gate: optionally block manual transition to ready_decision when score-linked evidence isn't node-locatable.
    // This is a hard backstop for stage updates that bypass auto-progress.
    const nextStage = (updates as any)?.stage;
    if (nextStage === "ready_decision") {
      const gateModeRaw = typeof process.env.DDAI_NODE_EVIDENCE_GATE_MODE === "string" ? process.env.DDAI_NODE_EVIDENCE_GATE_MODE : "off";
      const gateMode = gateModeRaw.toLowerCase();
      const enforce = gateMode === "enforce" || gateMode === "hard";

      if (enforce) {
        const { rows: cur } = await pool.query<{ stage: string }>(
          `SELECT stage FROM deals WHERE id = $1 AND deleted_at IS NULL`,
          [dealId]
        );
        if (cur.length === 0) {
          return reply.status(404).send({ error: "Deal not found" });
        }

        // Only gate actual transitions into ready_decision (not idempotent updates).
        if (cur[0].stage !== "ready_decision") {
          const { gate } = await getNodeEvidenceGateForDeal(pool as any, dealId);
          if (gate.status === "block") {
            const msg = `Blocked from ready_decision. Node-backed scoring gate: ${gate.status.toUpperCase()} (${gate.node_coverage_pct}% node-locatable linked evidence).`;
            return reply.status(409).send({ error: "Stage transition blocked by node-backed scoring gate", message: msg, gate });
          }
        }
      }
    }

    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    let idx = 1;

    for (const key of Object.keys(updates) as Array<keyof typeof updates>) {
      fields.push(`${key} = $${idx}`);
      const val = updates[key];
      values.push((val as string | number | null | undefined) ?? null);
      idx += 1;
    }

    values.push(dealId);

    const { rows } = await pool.query<DealRow>(
      `UPDATE deals
         SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idx} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    return mapDeal(rows[0], null, "full");
  });

  app.delete("/api/v1/deals/:deal_id", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;

    const q = (request.query ?? {}) as any;
    const rawPurge = q?.purge;
    const purge =
      rawPurge === true ||
      rawPurge === "true" ||
      (Array.isArray(rawPurge) && String(rawPurge[0]).toLowerCase() === "true");
    if (!purge) {
      return reply.status(400).send({ error: "purge=true is required for hard delete" });
    }

    const auth = requireDestructiveAuth(request);
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: auth.error });
    }

    const actor_user_id =
      typeof (request.headers as any)?.["x-actor-user-id"] === "string"
        ? String((request.headers as any)["x-actor-user-id"]).trim()
        : null;

    try {
      const result = await purgeDealCascade({
        deal_id: dealId,
        actor_user_id,
        db: pool as any,
        logger: console as any,
      });

      return reply.send({ ok: true, deal_id: dealId, purge: result });
    } catch (err) {
      if (isPurgeDealNotFoundError(err)) {
        return reply.status(404).send({ error: "Deal not found" });
      }
      const message = err instanceof Error ? err.message : "Purge failed";
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/api/v1/deals/:deal_id/analyze", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;

    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [dealId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const job = await enqueueJob({ deal_id: dealId, type: "analyze_deal" });

    // After analysis job is enqueued, mark it so we can auto-progress when complete
    // (This would typically happen in a background worker after job completes)
    // For now, we queue the job and the worker will handle stage progression

    return reply.status(202).send({ job_id: job.job_id, status: job.status });
  });

  // Enqueue a best-effort visual extraction pass for all documents in the deal.
  // This does not re-render pages; it only uses already-rendered page images.
  app.post("/api/v1/deals/:deal_id/extract-visuals", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const forceResegment = Boolean((request.body as any)?.force_resegment);

    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [dealId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    // Single job; the worker resolves deal documents + rendered page image URIs.
    // force_resegment updates segment_key for existing structured synthetic assets (pptx/docx/xlsx)
    // before extracting visuals.
    const job = await enqueueJob({
      deal_id: dealId,
      type: "extract_visuals",
      payload: { force_resegment: forceResegment },
    });
    return reply.status(202).send({ job_id: job.job_id, status: job.status });
  });

  // Canonicalize extracted data (artifact cleanup) + re-verify documents.
  // This does NOT re-extract from original binaries (those are only available at upload time).
  app.post("/api/v1/deals/:deal_id/remediate-extraction", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;

    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [dealId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const includeWarnings = Boolean((request.body as any)?.include_warnings);

    const job = await enqueueJob({
      deal_id: dealId,
      type: "remediate_extraction",
      payload: { include_warnings: includeWarnings },
    });

    return reply.status(202).send({ job_id: job.job_id, status: job.status });
  });

  // Auto-check and progress deal stage based on metrics
  app.post("/api/v1/deals/:deal_id/auto-progress", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;

    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [dealId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const result = await autoProgressDealStage(pool as any, dealId);

    if (result.progressed) {
      return reply.status(200).send({
        progressed: true,
        newStage: result.newStage,
        message: result.reason
          ? `Deal automatically progressed from ${rows[0].stage} to ${result.newStage}. ${result.reason}`
          : `Deal automatically progressed from ${rows[0].stage} to ${result.newStage}`
      });
    }

    return reply.status(200).send({
      progressed: false,
      currentStage: rows[0].stage,
      message: result.reason ?? "Deal does not meet conditions for stage progression"
    });
  });

  // Recalculate priority for a single deal
  app.post<{ Params: { dealId: string } }>("/api/v1/deals/:dealId/recalculate-priority", async (request, reply) => {
    const { dealId } = request.params;
    const pool = getPool();

    try {
      // Verify deal exists
      const { rows } = await pool.query(
        `SELECT id, name, priority FROM deals WHERE id = $1 AND deleted_at IS NULL`,
        [dealId]
      );

      if (!rows.length) {
        return reply.status(404).send({ error: "Deal not found" });
      }

      const oldPriority = rows[0].priority;

      // Recalculate priority
      await updateDealPriority(dealId);

      // Get updated priority
      const { rows: updatedRows } = await pool.query(
        `SELECT priority FROM deals WHERE id = $1`,
        [dealId]
      );

      return reply.status(200).send({
        dealId,
        name: rows[0].name,
        oldPriority,
        newPriority: updatedRows[0].priority,
        message: `Priority recalculated for deal ${rows[0].name}`
      });
    } catch (error) {
      console.error(`Error recalculating priority for deal ${dealId}:`, error);
      return reply.status(500).send({ error: "Failed to recalculate priority" });
    }
  });

  // Recalculate priority for all deals
  app.post("/api/v1/deals/batch/recalculate-priorities", async (request, reply) => {
    const pool = getPool();

    try {
      const result = await updateAllDealPriorities();

      return reply.status(200).send({
        message: "All deal priorities recalculated",
        stats: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error recalculating all priorities:", error);
      return reply.status(500).send({ error: "Failed to recalculate priorities" });
    }
  });

  if (debugRoutesEnabled) {
    app.get<{ Params: { dealId: string } }>(
      "/api/v1/debug/deals/:dealId/phaseb",
      {
        schema: {
          tags: ["debug"],
          params: {
            type: "object",
            properties: { dealId: { type: "string" } },
            required: ["dealId"],
          },
        } as any,
      },
      async (request, reply) => {
        const parsed = z.string().uuid().safeParse(request.params.dealId);
        if (!parsed.success) {
          return reply.status(400).send({ error: "dealId must be a valid UUID" });
        }

        const dealId = parsed.data;

        let dealRow: { id: string; name: string } | null = null;
        let dealExists = false;

        try {
          const { rows } = await pool.query<{ id: string; name: string }>(
            `SELECT id, name FROM deals WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
            [dealId]
          );
          if (rows?.[0]) {
            dealRow = rows[0];
            dealExists = true;
          }
        } catch {
          // keep dealRow null
        }

        let latestRun: any = null;
        let runHistory: any[] = [];
        const hasPhaseBTable = await hasTable(pool, "public.deal_phase_b_runs");
        if (hasPhaseBTable) {
          try {
            const { rows } = await pool.query(
              `SELECT id, deal_id, version, created_at, source_run_id, phase_b_features, phase_b_result
                 FROM deal_phase_b_runs
                WHERE deal_id = $1
                ORDER BY created_at DESC NULLS LAST, version DESC, id DESC
                LIMIT 3`,
              [dealId]
            );
            runHistory = rows ?? [];
            latestRun = runHistory[0] ?? null;
          } catch {
            latestRun = null;
            runHistory = [];
          }
        }

        let db_identity = {
          current_database: null as string | null,
          inet_server_addr: null as string | null,
          inet_server_port: null as number | null,
          current_user: null as string | null,
        };
        try {
          const dbIdentityResult = await pool.query<{
            current_database: string | null;
            inet_server_addr: string | null;
            inet_server_port: number | null;
            current_user: string | null;
          }>(
            `SELECT current_database(), inet_server_addr(), inet_server_port(), current_user`
          );
          db_identity = dbIdentityResult?.rows?.[0] ?? db_identity;
        } catch {
          // keep nulls
        }

        let visuals_sanity: {
          visuals_count: number | null;
          evidence_count: number | null;
          visuals_count_db?: number | null;
          visuals_with_structured?: number | null;
          visuals_with_ocr?: number | null;
          ocr_chars_total?: number | null;
          visuals_source?: string | null;
          ocr_hint?: string | null;
        } | null = null;

        try {
          const summary = await fetchPhaseBVisualsFromDb(pool as any, dealId);
          if (summary) {
            const ocrHint = !summary.ocr_text_available
              ? "OCR text not stored; install/enable OCR to populate"
              : summary.ocr_quality_counts && summary.ocr_quality_counts.pytesseract_missing > 0
                ? "OCR missing for some visuals (pytesseract_missing flagged)"
                : null;

            visuals_sanity = {
              visuals_count: summary.visuals_count,
              evidence_count: summary.evidence_count,
              visuals_count_db: summary.visuals_count,
              visuals_with_structured: summary.visuals_with_structured,
              visuals_with_ocr: summary.visuals_with_ocr,
              ocr_chars_total: summary.ocr_chars_total,
              visuals_source: summary.source,
              ocr_hint: ocrHint,
            };
          }
        } catch {
          visuals_sanity = null;
        }

        app.log.info(
          {
            event: "debug_phaseb",
            deal_id: dealId,
            deal_exists: dealExists,
            has_latest_run: Boolean(latestRun),
          },
          "debug phaseb endpoint"
        );

        return reply.send({
          requested_deal_id: dealId,
          deal_exists: dealExists,
          deal: dealRow,
          db_identity,
          phase_b: {
            latest_run: latestRun,
            history: runHistory,
          },
          visuals_sanity,
        });
      }
    );
  }
}
