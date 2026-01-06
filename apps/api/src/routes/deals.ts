import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getPool } from "../lib/db";
import type { Deal } from "@dealdecision/contracts";
import { enqueueJob } from "../services/jobs";
import { autoProgressDealStage } from "../services/stageProgression";
import { updateDealPriority, updateAllDealPriorities } from "../services/priorityClassification";
import { normalizeDealName } from "../lib/normalize-deal-name";
import { purgeDealCascade, isPurgeDealNotFoundError, sanitizeText } from "@dealdecision/core";

type QueryResult<T> = { rows: T[]; rowCount?: number };
type DealRoutesClient = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
  release: () => void;
};
type DealRoutesPool = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
  connect?: () => Promise<DealRoutesClient>;
};

type DealApiMode = "phase1" | "full";

async function hasTable(pool: DealRoutesPool, table: string) {
  try {
    const { rows } = await pool.query<{ oid: string | null }>(
      "SELECT to_regclass($1) as oid",
      [table]
    );
    return rows[0]?.oid !== null;
  } catch {
    return false;
  }
}

async function hasColumn(pool: DealRoutesPool, tableName: string, columnName: string) {
  try {
    const { rows } = await pool.query<{ ok: number }>(
      `SELECT 1 as ok
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
       LIMIT 1`,
      [tableName, columnName]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

function requireDestructiveAuth(request: any): { ok: true } | { ok: false; status: number; error: string } {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    if (process.env.NODE_ENV === "development") return { ok: true };
    return { ok: false, status: 403, error: "Admin token not configured" };
  }

  const authHeader = request?.headers?.authorization;
  const token = typeof authHeader === "string" ? authHeader.replace("Bearer ", "") : undefined;
  if (token !== adminToken) {
    return { ok: false, status: 403, error: "Unauthorized" };
  }
  return { ok: true };
}

function parseDealApiMode(request: any): DealApiMode {
  const q = (request?.query ?? {}) as any;
  const modeParam = q?.mode;
  const raw =
    typeof modeParam === "string"
      ? modeParam
      : Array.isArray(modeParam) && typeof modeParam[0] === "string"
        ? modeParam[0]
        : undefined;
  if (!raw) return "full";
  const m = raw.trim().toLowerCase();
  if (m === "phase1" || m === "p1") return "phase1";
  return "full";
}

function stripEvidenceFromExecutiveSummary(exec: any): any {
  if (!exec || typeof exec !== "object") return undefined;
  const { evidence, ...rest } = exec as any;
  return rest;
}

function stripEvidenceFromClaims(claims: any): any[] {
  const list = Array.isArray(claims) ? claims : [];
  return list
    .map((c: any) => {
      if (!c || typeof c !== "object") return null;
      const { evidence, ...rest } = c as any;
      return rest;
    })
    .filter(Boolean);
}

const dealStageSchema = z.enum(["intake", "under_review", "in_diligence", "ready_decision", "pitched"]);
const dealPrioritySchema = z.enum(["high", "medium", "low"]);
const dealTrendSchema = z.enum(["up", "down", "stable"]);

const dealCreateSchema = z.object({
  name: z.string().min(1),
  stage: dealStageSchema,
  priority: dealPrioritySchema,
  trend: dealTrendSchema.optional(),
  score: z.number().optional(),
  owner: z.string().optional(),
});

const dealDraftCreateSchema = z
  .object({
    name: z.string().min(1).optional(),
    stage: dealStageSchema.optional(),
    priority: dealPrioritySchema.optional(),
    owner: z.string().optional(),
  })
  .optional();

const dealConfirmProfileSchema = z.object({
  company_name: z.string().min(1).nullable().optional(),
  deal_name: z.string().min(1).nullable().optional(),
  investment_type: z.string().min(1).nullable().optional(),
  round: z.string().min(1).nullable().optional(),
  industry: z.string().min(1).nullable().optional(),
});

type AutoProfileDocRow = {
  id: string;
  title: string;
  full_text: string | null;
  structured_data: any | null;
  full_content: any | null;
};

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

function deriveNameFromFilenameLike(title: string): string | null {
  const raw = String(title || "").trim();
  if (!raw) return null;
  const noExt = raw.replace(/\.[A-Za-z0-9]{2,6}$/, "");
  const cleaned = noExt
    .replace(/[_]+/g, " ")
    .replace(/\b(pitch\s*deck|deck|presentation|data\s*room|dataroom|financials|model|term\s*sheet)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2) return null;
  const seg = cleaned.split(/\s[-–—|:]\s/)[0]?.trim();
  if (!seg) return null;
  return sanitizeProfileValue(seg);
}

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
    const base = `${d.title || ""}\n${fullText}`;
    return { id: d.id, text: base.slice(0, 80_000) };
  });

  for (const { id: docId, text } of docTexts) {
    if (!text.trim()) continue;

    const labeledCompany =
      extractLabeledValue(text, "Company Name") ||
      extractLabeledValue(text, "Company") ||
      extractLabeledValue(text, "Legal Name");

    if (labeledCompany) {
      candidates.company_name.push({ value: labeledCompany, score: 0.75, docId });
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
      const fromTitle = deriveNameFromFilenameLike(d.title);
      if (fromTitle) {
        candidates.company_name.push({ value: fromTitle, score: 0.35, docId: d.id });
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
};

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapDeal(row: DealRow, dio: DIOAggregateRow | null | undefined, mode: DealApiMode): Deal {
  const safeExec = stripEvidenceFromExecutiveSummary((dio as any)?.executive_summary_v1);
  const execV2 = (dio as any)?.executive_summary_v2;
  const decision = (dio as any)?.decision_summary_v1;
  const coverage = (dio as any)?.phase1_coverage;
	const businessArchetypeV1 = (dio as any)?.phase1_business_archetype_v1;
  const dealOverviewV2 = (dio as any)?.phase1_deal_overview_v2;
  const updateReportV1 = (dio as any)?.phase1_update_report_v1;
	const dealSummaryV2 = (dio as any)?.phase1_deal_summary_v2;
  const topClaims = stripEvidenceFromClaims((dio as any)?.phase1_claims).slice(0, 8);

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
	}

	// Additive field: UI can render summary without extra calls.
	if (safeExec) out.executive_summary_v1 = safeExec;
  if (execV2 && typeof execV2 === "object") out.executive_summary_v2 = execV2;
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
			unknowns: Array.isArray(safeExec?.unknowns) ? safeExec.unknowns : [],
			top_claims: topClaims,
		};
	}
	return out as Deal;
}

export async function registerDealRoutes(app: FastifyInstance, poolOverride?: any) {
  const pool = (poolOverride ?? getPool()) as DealRoutesPool;

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

    // Load deal label if it exists; keep endpoint read-only and resilient.
    let dealName: string | null = null;
    try {
      const { rows } = await pool.query<{ id: string; name: string }>(
        "SELECT id, name FROM deals WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
        [dealId]
      );
      if (rows?.[0]?.name) dealName = rows[0].name;
      else warnings.push("deal not found");
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
    };

    let docs: DocRow[] = [];
    try {
      const { rows } = await pool.query<DocRow>(
        `SELECT id, title, type, page_count, uploaded_at
           FROM documents
          WHERE deal_id = $1
          ORDER BY uploaded_at ASC, id ASC`,
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
        type: "deal",
        data: {
          label: dealName || `Deal ${dealId}`,
          deal_id: dealId,
          name: dealName,
        },
      },
    ];
    const edges: any[] = [];

    for (const d of docs) {
      const docNodeId = `doc:${d.id}`;
      nodes.push({
        id: docNodeId,
        type: "document",
        data: {
          label: d.title,
          document_id: d.id,
          title: d.title,
          type: d.type ?? undefined,
          page_count: typeof d.page_count === "number" ? d.page_count : 0,
        },
      });
      edges.push({
        id: `e:deal-doc:${dealId}:${d.id}`,
        source: dealNodeId,
        target: docNodeId,
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
      evidence_count: number;
    };

    let visuals: VisualRow[] = [];
    try {
      const { rows } = await pool.query<VisualRow>(
        `SELECT
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
           COALESCE(ev.count, 0) AS evidence_count
         FROM visual_assets va
         JOIN documents d ON d.id = va.document_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS count
           FROM evidence_links el
           WHERE el.visual_asset_id = va.id
         ) ev ON true
         WHERE d.deal_id = $1
         ORDER BY va.document_id ASC, va.page_index ASC, va.created_at ASC`,
        [dealId]
      );
      visuals = rows ?? [];
    } catch {
      warnings.push("visual asset lookup failed");
      visuals = [];
    }

    for (const v of visuals) {
      const docNodeId = `doc:${v.document_id}`;
      const vaNodeId = `va:${v.id}`;
      const evNodeId = `evagg:${v.id}`;
      const conf = Number(v.confidence);
      const confidence = Number.isFinite(conf) ? conf : 0;
      const pageLabel = typeof v.page_index === "number" ? v.page_index + 1 : 0;

      nodes.push({
        id: vaNodeId,
        type: "visual_asset",
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
        },
      });

      edges.push({
        id: `e:doc-va:${v.document_id}:${v.id}`,
        source: docNodeId,
        target: vaNodeId,
      });

      const count = Number.isFinite(v.evidence_count) ? v.evidence_count : 0;
      nodes.push({
        id: evNodeId,
        type: "evidence",
        data: {
          label: `Evidence (${count})`,
          count,
          visual_asset_id: v.id,
        },
      });
      edges.push({
        id: `e:va-evagg:${v.id}`,
        source: vaNodeId,
        target: evNodeId,
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
      const res = await pool.query<AutoProfileDocRow>(
        `SELECT id, title, full_text, structured_data, full_content
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
      (await hasColumn(pool, "deals", "proposed_profile_sources"));

    if (canPersist) {
      try {
        await pool.query(
          `UPDATE deals
           SET proposed_profile = $2,
               proposed_profile_confidence = $3,
               proposed_profile_sources = $4,
               proposed_profile_warnings = $5,
               updated_at = now()
           WHERE id = $1`,
          [dealId, computed.proposed_profile, computed.confidence, computed.sources, warnings]
        );
      } catch {
        warnings.push("failed to persist proposed profile (non-fatal)");
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
         ) latest ON TRUE`,
      [dealId]
    );

    if (dioRows[0]) {
      (dioRows[0] as any).overall_score =
        parseNullableNumber((dioRows[0] as any).overall_score_resolved) ?? (dioRows[0] as any).overall_score;
    }

    return mapDeal(rows[0], dioRows[0] ?? null, mode);
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
}
