import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { fetchPhaseBVisualsFromDb } from "../lib/phaseb-visuals";
import { getPool } from "../lib/db";
import type { Deal } from "@dealdecision/contracts";
import { enqueueJob } from "../services/jobs";
import { autoProgressDealStage } from "../services/stageProgression";
import { updateDealPriority, updateAllDealPriorities } from "../services/priorityClassification";
import { normalizeDealName } from "../lib/normalize-deal-name";
import { purgeDealCascade, isPurgeDealNotFoundError, sanitizeText } from "@dealdecision/core";
import { BrandModel, PageInput, buildBrandModel, inferDocumentBrandName, inferSlideTitleForSlide, normalizePhrase } from "../lib/slide-title";

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

  const [hasDocumentId, hasPage, hasPageNumber, hasValue] = await Promise.all([
    hasColumn(pool, "evidence", "document_id"),
    hasColumn(pool, "evidence", "page"),
    hasColumn(pool, "evidence", "page_number"),
    hasColumn(pool, "evidence", "value"),
  ]);

  const documentIdExpr = hasDocumentId ? "document_id" : "NULL::text AS document_id";
  const pageExpr = hasPage ? "page" : hasPageNumber ? "page_number" : "NULL::int AS page";
  const valueExpr = hasValue ? "value" : "NULL::jsonb AS value";

  const { rows } = await pool.query<EvidenceRow & { page_number?: number | null }>(
    `SELECT id,
      ${documentIdExpr},
      source,
      kind,
      text,
      ${valueExpr},
      confidence::float8 AS confidence,
      created_at,
      ${pageExpr}
     FROM evidence
    WHERE id = ANY($1::text[])`,
    [ids]
  );

  return rows ?? [];
}

async function getDocumentIndex(pool: DealRoutesPool, docIds: string[]): Promise<DocumentIndex> {
  if (!docIds || docIds.length === 0) return {};
  const hasDocs = await hasTable(pool, "documents");
  if (!hasDocs) return {};

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
     WHERE id = ANY($1::text[])`,
    [docIds]
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
        response: {
          200: {
            type: "object",
            properties: {
              deal_id: { type: "string" },
              nodes: { type: "array", items: { type: "object", additionalProperties: true } },
              edges: { type: "array", items: { type: "object", additionalProperties: true } },
              warnings: { type: "array", items: { type: "string" } },
            },
            required: ["deal_id", "nodes", "edges", "warnings"],
          },
        },
      },
    },
    async (request, reply) => {
    const dealIdRaw = (request.params as any)?.deal_id;
    const dealId = sanitizeText(typeof dealIdRaw === "string" ? dealIdRaw : String(dealIdRaw ?? ""));
    const warnings: string[] = [];

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

    type AnalystSegment =
      | "problem"
      | "solution"
      | "market"
      | "traction"
      | "business_model"
      | "distribution"
      | "team"
      | "competition"
      | "risks"
      | "financials"
      | "raise_terms"
      | "exit"
      | "overview"
      | "unknown";

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

    const canonicalSegments: AnalystSegment[] = [
      "overview",
      "problem",
      "solution",
      "market",
      "traction",
      "business_model",
      "distribution",
      "team",
      "competition",
      "risks",
      "financials",
      "raise_terms",
      "exit",
      "unknown",
    ];

    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      function classifySegment(input: {
        ocr_text?: string | null;
        ocr_snippet?: string | null;
        structured_kind?: string | null;
        structured_summary?: unknown;
        asset_type?: string | null;
        page_index?: number | null;
        slide_title?: string | null;
        slide_title_confidence?: number | null;
        evidence_snippets?: string[] | null;
        brand_blacklist?: Set<string> | string[] | null;
        brand_name?: string | null;
      }): { segment: AnalystSegment; confidence: number; debug?: Record<string, unknown> } {
        const MIN_SCORE = 0.55;
        const MIN_MARGIN = 0.1;
        const TITLE_MIN_CONF = 0.6;

        const normalized = (value: unknown): string | null => {
          if (typeof value !== "string") return null;
          const trimmed = value.trim();
          return trimmed ? trimmed.toLowerCase() : null;
        };

        const brandTokens: string[] = [];
        if (input.brand_blacklist instanceof Set) {
          brandTokens.push(...Array.from(input.brand_blacklist));
        } else if (Array.isArray(input.brand_blacklist)) {
          brandTokens.push(...input.brand_blacklist);
        }
        const bn = normalized(input.brand_name);
        if (bn) brandTokens.push(bn);

        const normalizedBrandTokens = Array.from(
          new Set(brandTokens.map(normalized).filter((t): t is string => typeof t === "string" && t.length >= 3))
        );

        const headingKeywords = [
          "traction",
          "business model",
          "pricing",
          "go-to-market",
          "go to market",
          "distribution",
          "market",
          "competition",
          "team",
          "meet our team",
          "financial",
          "financials",
          "financial strategy",
          "automation",
          "ai",
          "exit",
          "acquisition",
          "acquirer",
          "acquirers",
          "strategic buyers",
          "use of funds",
          "raise",
          "gtm",
        ];

        const findHeadingKeyword = (value: string | null): string | null => {
          if (!value) return null;
          const lower = value.toLowerCase();
          for (const kw of headingKeywords) {
            const idx = lower.indexOf(kw);
            if (idx >= 0) return value.slice(idx, idx + kw.length);
          }
          return null;
        };

        const stripBrands = (value: string, preserveHeading?: string | null): string => {
          let cleaned = value;
          for (const token of normalizedBrandTokens) {
            const pattern = new RegExp(`\\b${escapeRegExp(token.toLowerCase())}\\b`, "gi");
            cleaned = cleaned.replace(pattern, " ");
          }
          cleaned = cleaned.replace(/\s+/g, " ").trim();

          if (preserveHeading) {
            const lowerHeading = preserveHeading.toLowerCase();
            if (!cleaned.toLowerCase().includes(lowerHeading)) {
              cleaned = cleaned ? `${preserveHeading} ${cleaned}`.trim() : preserveHeading;
            }
          }

          return cleaned;
        };

        const isBrandish = (value: string | null): boolean => {
          if (!value) return false;
          const lower = value.toLowerCase();
          return normalizedBrandTokens.some((t) => lower.includes(t));
        };

        const isTitleUsable = (title: string | null): boolean => {
          if (typeof title !== "string") return false;
          const collapsed = title.trim().replace(/\s+/g, " ");
            if (!collapsed || collapsed.length < 3) return false;

          const alphaCount = (collapsed.match(/[A-Za-z]/g) || []).length;
          if (alphaCount / collapsed.length < 0.45) return false;

          const nonAlnumRatio = ((collapsed.match(/[^A-Za-z0-9\s]/g) || []).length) / Math.max(1, collapsed.length);
          if (nonAlnumRatio > 0.25) return false;
          if (/[~™©®]/.test(collapsed)) return false;

          const words = collapsed.split(/\s+/).filter(Boolean);
          const headingFromTitle = findHeadingKeyword(collapsed);
          if (words.length <= 2 && !headingFromTitle) return false;
          if (words.length === 1) {
            const token = words[0];
            const nonAlnum = (token.match(/[^A-Za-z0-9]/g) || []).length;
            if (token.length > 0 && nonAlnum / token.length > 0.4) return false;
          }

          const stripped = stripBrands(collapsed, headingFromTitle);
          if (!stripped) return false;
          const strippedAlpha = (stripped.match(/[A-Za-z]/g) || []).length;
          if (strippedAlpha === 0) return false;

          return true;
        };

        const slideTitle = typeof input.slide_title === "string" ? input.slide_title.trim() : "";
        const titleConf = typeof input.slide_title_confidence === "number" ? input.slide_title_confidence : null;
        const headingFromTitle = findHeadingKeyword(slideTitle);
        const evidenceSnippetRaw = Array.isArray(input.evidence_snippets)
          ? input.evidence_snippets.find((s) => typeof s === "string" && s.trim().length > 0)
          : null;

        const classificationText = (() => {
          const usableTitle = slideTitle && titleConf !== null && titleConf >= TITLE_MIN_CONF && isTitleUsable(slideTitle);
          if (usableTitle && !isBrandish(slideTitle)) return slideTitle;

          if (evidenceSnippetRaw && !isBrandish(evidenceSnippetRaw)) return evidenceSnippetRaw;

          if (input.ocr_snippet) return input.ocr_snippet;
          if (input.ocr_text) return input.ocr_text;
          return "";
        })();

        const rawText = normalized(classificationText) ?? "";

        const evidenceSnippet = Array.isArray(input.evidence_snippets)
          ? normalized(input.evidence_snippets.find((s) => typeof s === "string" && s.trim().length > 0))
          : null;

        const textParts: string[] = [];
        if (rawText) textParts.push(rawText);
        if (evidenceSnippet) textParts.push(evidenceSnippet);
        if (input.structured_summary != null) textParts.push(normalized(String(input.structured_summary)) || "");

        let text = textParts.join(" \n ").slice(0, 1400);
        text = stripBrands(text, headingFromTitle);

        const includes = (needle: string) => text.includes(needle);
        const matches = (needles: string[], weight = 1): number => needles.reduce((acc, n) => (includes(n) ? acc + weight : acc), 0);

        const scores: Record<Exclude<AnalystSegment, "overview" | "unknown">, number> = {
          problem: 0,
          solution: 0,
          market: 0,
          traction: 0,
          business_model: 0,
          distribution: 0,
          team: 0,
          competition: 0,
          risks: 0,
          financials: 0,
          raise_terms: 0,
          exit: 0,
        };

        const headingSets: Record<AnalystSegment, string[]> = {
          overview: ["overview", "summary", "executive summary"],
          problem: ["problem", "pain", "challenge", "issue", "gap", "why this matters"],
          solution: ["solution", "product", "how it works", "platform", "capabilities"],
          market: ["market", "tam", "sam", "som", "opportunity", "segment", "sizing", "cagr"],
          traction: ["traction", "growth", "users", "customers", "mrr", "arr", "revenue", "retention", "pipeline", "gmv", "kpi", "conversion", "demo-to-close", "demo to close", "lift"],
          business_model: ["business model", "pricing", "revenue model", "unit economics", "how we make money", "saas", "platform", "add-ons", "addons", "subscription"],
          distribution: ["distribution", "go-to-market", "go to market", "gtm", "channels", "sales", "partnerships", "marketing", "reseller", "partners", "channel"],
          team: ["team", "founder", "ceo", "cto", "cfo", "bio", "leadership", "advisors", "founders", "meet our team"],
          competition: ["competition", "competitor", "alternative", "compare", "landscape", "moat"],
          risks: ["risk", "challenge", "threat", "mitigation", "compliance", "regulation", "limitation"],
          financials: ["financial", "financial strategy", "profit", "loss", "p&l", "balance", "cash", "projection", "forecast", "projections", "ebitda", "budget", "expenses", "gross margin", "revenue", "margin", "unit economics"],
          raise_terms: ["raise", "funding", "round", "terms", "cap table", "valuation", "use of funds", "investment"],
          exit: ["exit", "exit strategy", "acquisition", "m&a", "strategic options", "acquirer", "acquirers", "strategic buyers"],
          unknown: [],
        };

        let hardHeadingSegment = (() => {
          const trimmed = text.trim();
          if (!trimmed) return null;
          const lower = trimmed.toLowerCase();
          for (const [seg, phrases] of Object.entries(headingSets) as Array<[AnalystSegment, string[]]>) {
            for (const phrase of phrases) {
              const p = phrase.toLowerCase();
              if (!p) continue;
              const anchored = new RegExp(`^(?:${escapeRegExp(p)})(?:\\b|:)`, "i");
              if (anchored.test(lower)) return seg;
            }
          }
          return null;
        })();

        if (hardHeadingSegment === "problem" && text.includes("why this matters")) {
          const solutionHints = matches(["solution", "product", "value", "impact", "approach", "benefit", "solve", "solving"], 1);
          if (solutionHints > 0) hardHeadingSegment = "solution";
        }

        scores.problem += matches(["problem", "pain", "challenge", "issue", "gap"], 1);
        if (text.includes("why this matters")) scores.problem += 0.9;

        const strongSolutionNeedles = [
          "how it works",
          "architecture",
          "demo",
          "features",
          "capabilities",
          "integrates",
          "api",
          "product",
          "automation",
          "ai",
          "intelligence",
          "predictive",
        ];
        const genericSolutionNeedles = ["platform", "solution", "service", "workflow", "system"];
        const strongSolutionHits = matches(strongSolutionNeedles, 1);
        const genericSolutionHits = matches(genericSolutionNeedles, 0);
        if (strongSolutionHits > 0) scores.solution += strongSolutionHits;
        if (strongSolutionHits > 0 && matches(genericSolutionNeedles, 1) > 0) {
          scores.solution += 0.4;
        }
        if (text.includes("why this matters") && matches(["solve", "value", "benefit", "impact"], 1) > 0) {
          scores.solution += 0.6;
        }

        const tamHits = matches(["tam", "sam", "som"], 1.4);
        scores.market += tamHits;
        scores.market += matches(["market", "opportunity", "segment", "sizing", "cagr"], 0.8);

        scores.traction += matches(["traction", "growth", "users", "customers", "mrr", "arr", "cohort", "retention", "pipeline", "gmv", "revenue", "kpi", "conversion", "demo to close", "demo-to-close", "lift"], 0.9);
        scores.business_model += matches(["pricing", "revenue model", "model", "plan", "subscription", "contract", "unit economics", "arpu", "take rate", "how we make money", "saas", "platform", "add-ons", "addons", "add ons"], 0.85);
        scores.distribution += matches(
          ["distribution", "go-to-market", "go to market", "gtm", "channels", "sales", "partnerships", "marketing", "reseller", "partners", "channel", "lender", "lenders", "borrower", "borrowers", "realtor", "realtors"],
          1.0
        );
        scores.team += matches(["team", "founder", "ceo", "cto", "cfo", "bio", "experience", "leadership", "advisors", "founders", "meet our team"], 1);
        scores.competition += matches(["competition", "competitor", "alternative", "compare", "landscape", "differentiation", "moat"], 1);
        scores.risks += matches(["risk", "challenge", "threat", "mitigation", "compliance", "regulation", "limitation"], 1);
        scores.financials += matches(
          ["financial", "financial strategy", "profit", "loss", "p&l", "balance", "cash", "projection", "forecast", "projections", "ebitda", "budget", "expenses", "gross margin", "revenue", "margin", "table", "unit economics"],
          0.9
        );
        scores.raise_terms += matches(["raise", "funding", "round", "terms", "cap table", "valuation", "use of funds", "investment"], 1.05);
        scores.exit += matches(["exit", "exit strategy", "acquisition", "m&a", "strategic options", "acquirer", "acquirers", "strategic buyers"], 1.05);

        // Structured-kind heuristics
        const structuredSummaryTable = (input.structured_summary as any)?.table;
        const sk = (input.structured_kind || (structuredSummaryTable ? "table" : "") || "").toLowerCase();
        const tableDetected = sk === "table" || Boolean(structuredSummaryTable) || (input.asset_type || "").toLowerCase() === "table";
        const financialHint =
          includes("revenue") ||
          includes("arr") ||
          includes("financial") ||
          includes("forecast") ||
          includes("margin") ||
          includes("income") ||
          includes("cash") ||
          includes("profit") ||
          includes("loss") ||
          includes("p&l");

        if (sk === "table") {
          scores.financials += financialHint ? 1.1 : 0.35;
          if (includes("retention") || includes("cohort") || includes("churn")) scores.traction += 0.6;
        }
        if (sk === "bar" || (input.asset_type || "").toLowerCase().includes("chart")) {
          if (tamHits > 0 || includes("tam") || includes("sam") || includes("som")) scores.market += 1.0;
          if (includes("revenue") || includes("arr") || includes("growth") || includes("cagr")) {
            scores.traction += 1.0;
            scores.market += 0.5;
          }
        }

        // Late pages often financials/risks, but avoid early-page solution bias.
        const p = typeof input.page_index === "number" ? input.page_index : null;
        if (p !== null) {
          if (p >= 8) scores.financials += 0.4;
        }

        const scoredSegments = Object.keys(scores) as Array<Exclude<AnalystSegment, "overview" | "unknown">>;
        const ranked = scoredSegments
          .map((seg) => ({ seg, val: scores[seg] }))
          .sort((a, b) => b.val - a.val);

        const best = ranked[0] ?? { seg: "unknown" as AnalystSegment, val: 0 };
        const second = ranked[1] ?? { seg: "unknown" as AnalystSegment, val: 0 };

        const bestScore = best.val;
        const margin = bestScore - second.val;

        const earlyPage = p !== null && p <= 1;
        const hardHeadingMatch = Boolean(hardHeadingSegment);
        const debugBase = {
          classification_text: text,
          top_scores: ranked,
          hard_heading_match: hardHeadingMatch,
          title_confidence: input.slide_title_confidence ?? null,
        };

        if (tableDetected && financialHint) {
          const confidence = Math.max(0.5, Math.min(1, (scores.financials + 1.5) / 3));
          return {
            segment: "financials",
            confidence,
            debug: { ...debugBase, forced: "table_financials" },
          };
        }

        if (hardHeadingMatch && hardHeadingSegment) {
          const confidence = Math.max(0.4, Math.min(1, bestScore > 0 ? bestScore / 3 : 0.6));
          return {
            segment: hardHeadingSegment as AnalystSegment,
            confidence,
            debug: debugBase,
          };
        }

        if (bestScore < 0.35) {
          return { segment: earlyPage ? "overview" : "unknown", confidence: 0, debug: debugBase };
        }

        if (bestScore >= MIN_SCORE) {
          if (margin >= MIN_MARGIN || bestScore >= 0.75) {
            if (earlyPage && (best.seg === "solution" || best.seg === "problem") && bestScore < MIN_SCORE + 0.2) {
              return { segment: "overview", confidence: 0, debug: debugBase };
            }

            const confidence = Math.max(0, Math.min(1, bestScore / 4));
            return {
              segment: best.seg as AnalystSegment,
              confidence: Number.isFinite(confidence) ? confidence : 0.2,
              debug: debugBase,
            };
          }

          return { segment: "overview", confidence: 0, debug: { ...debugBase, tie_break: "low_margin" } };
        }

        return { segment: "overview", confidence: 0, debug: debugBase };
      }

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

      const derivePageSummary = (input: {
        slide_title?: string | null;
        evidence_snippets?: string[] | null;
        ocr_text?: string | null;
      }): string | null => {
        const parts: string[] = [];
        const title = typeof input.slide_title === "string" ? input.slide_title.trim() : "";
        if (title) parts.push(title);

        const firstEvidence = Array.isArray(input.evidence_snippets)
          ? input.evidence_snippets.find((s) => typeof s === "string" && s.trim().length > 0)
          : null;
        if (firstEvidence) parts.push(firstEvidence.trim());

        if (!firstEvidence) {
          const snippet = ocrSnippet(input.ocr_text);
          if (snippet) parts.push(snippet);
        }

        const summary = parts.join(" — ").trim();
        if (!summary) return null;
        return summary.length > 240 ? summary.slice(0, 240) : summary;
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

        return signals;
      };

      const buildPageUnderstanding = (input: {
        slide_title?: string | null;
        evidence_snippets?: string[] | null;
        ocr_text?: string | null;
        structured_kind?: string | null;
        structured_summary?: any;
      }): PageUnderstanding => {
        const summary = derivePageSummary({
          slide_title: input.slide_title,
          evidence_snippets: input.evidence_snippets,
          ocr_text: input.ocr_text,
        });

        const key_points = deriveKeyPointsFromOcr(input.ocr_text).slice(0, 5);
        const extracted_signals = deriveExtractedSignals({
          structured_kind: input.structured_kind,
          structured_summary: input.structured_summary,
        });

        return normalizePageUnderstanding({
          summary,
          key_points,
          extracted_signals,
          score_contributions: [],
        });
      };

    let visuals: VisualRow[] = [];
    const slideTitleDebug = process.env.DDAI_DEV_SLIDE_TITLE_DEBUG === "1";
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

    const visualsWithSegments = visuals.map((v) => {
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
        enableDebug: slideTitleDebug,
      });

      const page_understanding = normalizePageUnderstanding((v as any)?.page_understanding);

      const classification = classifySegment({
        ocr_text: v.ocr_text,
        ocr_snippet: ocrSnippet(v.ocr_text),
        structured_kind,
        structured_summary,
        asset_type: v.asset_type,
        page_index: v.page_index,
        slide_title: titleDerived.slide_title,
          slide_title_confidence: titleDerived.slide_title_confidence,
        evidence_snippets: Array.isArray((v as any).evidence_sample_snippets) ? (v as any).evidence_sample_snippets : [],
        brand_blacklist: blacklist,
        brand_name: brandInfo.brand,
      });

      return {
        ...v,
        structured_summary,
        structured_kind,
        slide_title: titleDerived.slide_title,
        slide_title_source: titleDerived.slide_title_source,
        slide_title_confidence: titleDerived.slide_title_confidence,
        slide_title_warnings: titleDerived.slide_title_warnings,
        slide_title_debug: titleDerived.slide_title_debug,
        segment: classification.segment,
        segment_confidence: classification.confidence,
        segment_debug: classification.debug,
      } as VisualRow & { structured_summary?: unknown };
    });

    let didLogSlideTitle = false;

    // Create canonical segment nodes (system-defined, not user-editable)
    for (const seg of canonicalSegments) {
      const segNodeId = `segment:${dealId}:${seg}`;
      nodes.push({
        id: segNodeId,
        node_id: segNodeId,
        kind: "segment",
        type: "segment",
        node_type: "SEGMENT",
        label: seg.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        metadata: { segment: seg },
        data: {
          label: seg.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          segment: seg,
          segment_confidence: null,
        },
      });
      edges.push({
        id: `e:has_segment:${dealId}:${seg}`,
        source: dealNodeId,
        target: segNodeId,
        edge_type: "HAS_SEGMENT",
      });
    }

    for (const v of visualsWithSegments) {
      const docNodeId = `document:${v.document_id}`;
      const vaNodeId = `visual_asset:${v.id}`;
      const evNodeId = `evidence:${v.id}`;
      const conf = Number(v.confidence);
      const confidence = Number.isFinite(conf) ? conf : 0;
      const pageLabel = typeof v.page_index === "number" ? v.page_index + 1 : 0;

      const snippet = ocrSnippet(v.ocr_text);
      const structured = { structured_kind: v.structured_kind, structured_summary: (v as any)?.structured_summary };
      const extraction_confidence = deriveBestExtractionConfidence({ structuredJson: v.structured_json, fallback: v.extraction_confidence });
      const evidence_count = Number.isFinite(v.evidence_count) ? v.evidence_count : 0;
      let evidence_snippets = Array.isArray(v.evidence_sample_snippets)
        ? v.evidence_sample_snippets
        : typeof v.evidence_sample_snippets === "string"
          ? [v.evidence_sample_snippets]
          : [];

      // If the evidence link rows exist but were created before snippet text was available
      // (e.g. OCR enabled later), fall back to the extraction OCR snippet.
      if (evidence_snippets.length === 0 && evidence_count > 0 && snippet) {
        evidence_snippets = [snippet];
      }

      const titleDerived = {
        slide_title: (v as any)?.slide_title ?? null,
        slide_title_source: (v as any)?.slide_title_source ?? null,
        slide_title_confidence: (v as any)?.slide_title_confidence ?? null,
        slide_title_warnings: (v as any)?.slide_title_warnings,
        slide_title_debug: (v as any)?.slide_title_debug,
      };

      const page_understanding = buildPageUnderstanding({
        slide_title: titleDerived.slide_title,
        evidence_snippets,
        ocr_text: v.ocr_text,
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

      const segmentDebug = process.env.NODE_ENV !== "production" ? (v as any)?.segment_debug ?? null : null;

      nodes.push({
        id: vaNodeId,
        node_id: vaNodeId,
        kind: "visual_asset",
        type: "visual_asset",
        node_type: "VISUAL_ASSET",
        label: `Page ${pageLabel} • ${v.asset_type}`,
        metadata: {
          visual_asset_id: v.id,
          document_id: v.document_id,
          page_index: v.page_index,
          asset_type: v.asset_type,
          created_at: v.created_at,
        },
        data: {
          label: `Page ${pageLabel} • ${v.asset_type}`,
          visual_asset_id: v.id,
          document_id: v.document_id,
          page_index: v.page_index,
          asset_type: v.asset_type,
          bbox: v.bbox ?? {},
          image_uri: v.image_uri,
          image_hash: v.image_hash,
          confidence,
          extractor_version: v.extractor_version,

          ocr_text_snippet: snippet,
          slide_title: titleDerived.slide_title,
          slide_title_source: titleDerived.slide_title_source,
          slide_title_confidence: titleDerived.slide_title_confidence,
          ...(titleDerived.slide_title_warnings ? { slide_title_warnings: titleDerived.slide_title_warnings } : {}),
          ...(titleDerived.slide_title_debug ? { slide_title_debug: titleDerived.slide_title_debug } : {}),
          structured_kind: structured.structured_kind,
          structured_summary: structured.structured_summary,
          page_understanding,
          evidence_count,
          evidence_snippets: Array.isArray(evidence_snippets) ? evidence_snippets : [],
          extraction_confidence,
          extraction_method: typeof v.extraction_method === "string" ? v.extraction_method : null,
          segment: v.segment,
          segment_confidence: v.segment_confidence,
          ...(segmentDebug ? { segment_debug: segmentDebug } : {}),
        },
      });

      const segNodeId = `segment:${dealId}:${v.segment}`;
      edges.push({
        id: `e:has_visual_asset:${segNodeId}:${v.id}`,
        source: segNodeId,
        target: vaNodeId,
        edge_type: "HAS_VISUAL_ASSET",
      });
      edges.push({
        id: `e:has_visual_asset:doc:${v.document_id}:${v.id}`,
        source: docNodeId,
        target: vaNodeId,
        edge_type: "HAS_VISUAL_ASSET",
      });

      const count = evidence_count;
      nodes.push({
        id: evNodeId,
        node_id: evNodeId,
        kind: "evidence",
        type: "evidence",
        node_type: "EVIDENCE",
        label: `Evidence (${count})`,
        metadata: {
          visual_asset_id: v.id,
          count,
        },
        data: {
          label: `Evidence (${count})`,
          count,
          visual_asset_id: v.id,
        },
      });
      edges.push({
        id: `e:has_evidence:${v.id}`,
        source: vaNodeId,
        target: evNodeId,
        edge_type: "HAS_EVIDENCE",
      });
    }

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
      },
      "deal.lineage"
    );

    return reply.send({ deal_id: dealId, nodes, edges, warnings });
  });

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
    const mode = parseDealApiMode(request);
    const dealId = (request.params as { deal_id: string }).deal_id;
    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [dealId]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const { rows: dioRows } = await pool.query<(DIOAggregateRow & { overall_score_resolved?: any })>(
      `WITH stats AS (
         SELECT deal_id,
                COUNT(*)::int AS run_count,
                MAX(updated_at) AS last_analyzed_at
           FROM deal_intelligence_objects
          WHERE deal_id = $1
          GROUP BY deal_id
       )
       SELECT latest.dio_id,
              latest.analysis_version,
              latest.recommendation,
              latest.overall_score,
              latest.overall_score_resolved,
              latest.executive_summary_v1,
              latest.executive_summary_v2,
              latest.decision_summary_v1,
        latest.phase1_business_archetype_v1,
              latest.phase1_deal_overview_v2,
              latest.phase1_update_report_v1,
    			  latest.phase1_deal_summary_v2,
              latest.phase1_coverage,
              latest.phase1_claims,
                  phaseb.phase_b_latest_run,
        						phaseb.phase_b_history,
              stats.last_analyzed_at,
              stats.run_count
         FROM stats
         JOIN LATERAL (
           SELECT dio_id,
                  analysis_version,
                  recommendation,
                  overall_score,
                  COALESCE(
                    overall_score,
                    NULLIF((dio_data #>> '{overall_score}'), '')::double precision,
                    NULLIF((dio_data #>> '{score_explanation,totals,overall_score}'), '')::double precision
                  ) AS overall_score_resolved,
                  (dio_data #> '{dio,phase1,executive_summary_v1}') AS executive_summary_v1,
				  (dio_data #> '{dio,phase1,executive_summary_v2}') AS executive_summary_v2,
    				  (dio_data #> '{dio,phase1,decision_summary_v1}') AS decision_summary_v1,
                  (dio_data #> '{dio,phase1,coverage}') AS phase1_coverage,
      				  (dio_data #> '{dio,phase1,business_archetype_v1}') AS phase1_business_archetype_v1,
                  (dio_data #> '{dio,phase1,deal_overview_v2}') AS phase1_deal_overview_v2,
                  (dio_data #> '{dio,phase1,update_report_v1}') AS phase1_update_report_v1,
      				  (dio_data #> '{dio,phase1,deal_summary_v2}') AS phase1_deal_summary_v2,
                  (dio_data #> '{dio,phase1,claims}') AS phase1_claims
             FROM deal_intelligence_objects
            WHERE deal_id = $1
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
              WHERE deal_id = $1
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
            WHERE deal_id = $1
            ORDER BY COALESCE(
          created_at,
          NULLIF((phase_b_features ->> 'computed_at'), '')::timestamptz,
          '1970-01-01'::timestamptz
        ) DESC,
        version DESC,
        id DESC
            LIMIT 1
          ) phaseb ON TRUE` ,
      [dealId]
    );

    if (dioRows[0]) {
      (dioRows[0] as any).overall_score =
        parseNullableNumber((dioRows[0] as any).overall_score_resolved) ?? (dioRows[0] as any).overall_score;
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

    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [dealId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    // Single job; the worker resolves deal documents + rendered page image URIs.
    const job = await enqueueJob({ deal_id: dealId, type: "extract_visuals" });
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
        message: `Deal automatically progressed from ${rows[0].stage} to ${result.newStage}`
      });
    }

    return reply.status(200).send({
      progressed: false,
      currentStage: rows[0].stage,
      message: "Deal does not meet conditions for stage progression"
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
