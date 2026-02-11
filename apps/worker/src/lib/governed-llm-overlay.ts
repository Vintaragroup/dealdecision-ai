import type { Pool } from "pg";
import { createHash } from "crypto";

import type {
  EvidenceRefV1,
  GovernedLLMClaimV1,
  GovernedLLMOverviewV1,
  LLMPhaseMode,
} from "@dealdecision/contracts";

import { buildPhase1KpiReconciliationV1 } from "./phase1/kpiReconciliationV1";

const SCHEMA_VERSION = "governed_llm_overview_v1" as const;

type Disclosure = { code: string; message: string };

function stableJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null) return null;
    if (v === undefined) return { __type: "undefined" };
    if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
    if (typeof v === "bigint") return { __type: "bigint", value: v.toString() };
    if (typeof v === "string" || typeof v === "boolean") return v;
    if (v instanceof Date) return { __type: "date", value: v.toISOString() };
    if (Array.isArray(v)) return v.map(normalize);
    if (v instanceof Set) return { __type: "set", value: Array.from(v).map(normalize) };
    if (v instanceof Map) {
      const entries = Array.from(v.entries()).map(([k, val]) => [normalize(k), normalize(val)]);
      entries.sort((a, b) => {
        const ak = JSON.stringify(a[0]);
        const bk = JSON.stringify(b[0]);
        return ak < bk ? -1 : ak > bk ? 1 : 0;
      });
      return { __type: "map", value: entries };
    }

    if (typeof v === "object") {
      if (seen.has(v)) return { __type: "circular" };
      seen.add(v);
      const out: Record<string, any> = {};
      for (const key of Object.keys(v).sort()) out[key] = normalize(v[key]);
      return out;
    }

    return { __type: typeof v, value: String(v) };
  };

  return JSON.stringify(normalize(value));
}

function stripNonDeterministicFieldsDeep(value: unknown): unknown {
  const dropExact = new Set([
    "created_at",
    "updated_at",
    "generated_at",
    "computed_at",
    "ts",
    "timestamp",
    "start_ts",
    "end_ts",
  ]);

  const walk = (v: any): any => {
    if (v == null) return v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== "object") return v;
    const out: Record<string, any> = {};
    for (const key of Object.keys(v)) {
      if (dropExact.has(key)) continue;
      out[key] = walk(v[key]);
    }
    return out;
  };

  return walk(value);
}

export function computeGovernedLlmOverviewInputHash(deterministicInputs: unknown): string {
  return createHash("sha256").update(stableJsonStringify(deterministicInputs)).digest("hex");
}

function isNumericClaimWithoutEvidence(claim: GovernedLLMClaimV1): boolean {
  const hasNumber = typeof claim.value_number === "number" && Number.isFinite(claim.value_number);
  if (!hasNumber) return false;
  const refs = Array.isArray(claim.evidence_refs) ? claim.evidence_refs : [];
  return refs.length === 0;
}

function appendDisclosureOnce(disclosures: Disclosure[], code: string, message: string): Disclosure[] {
  if (disclosures.some((d) => d.code === code)) return disclosures;
  return [...disclosures, { code, message }];
}

export function enforcePhaseMode(
  overlay: GovernedLLMOverviewV1,
  phase: "exploratory" | "stabilizing" | "governed"
): GovernedLLMOverviewV1 {
  try {
    const originalClaims = Array.isArray(overlay.claims) ? overlay.claims : [];
    const originalDisclosures = Array.isArray(overlay.disclosures) ? overlay.disclosures : [];

    const numericWithoutEvidence = originalClaims.filter((c) => isNumericClaimWithoutEvidence(c));
    if (numericWithoutEvidence.length === 0) {
      return { ...overlay, claims: originalClaims, disclosures: originalDisclosures };
    }

    if (phase === "exploratory") {
      return {
        ...overlay,
        claims: originalClaims,
        disclosures: appendDisclosureOnce(
          originalDisclosures,
          "numeric_claim_missing_evidence",
          "Exploratory mode: numeric claims may be present without evidence; treat cautiously."
        ),
      };
    }

    if (phase === "stabilizing") {
      const filtered = originalClaims.filter((c) => !isNumericClaimWithoutEvidence(c));
      return {
        ...overlay,
        claims: filtered,
        disclosures: appendDisclosureOnce(
          originalDisclosures,
          "stabilizing_removed_numeric_without_evidence",
          "Stabilizing mode: removed numeric claims that lacked evidence."
        ),
      };
    }

    // governed
    return {
      ...overlay,
      claims: [],
      disclosures: appendDisclosureOnce(
        originalDisclosures,
        "governed_mode_validation_failed",
        "Governed mode: suppressed overlay claims due to numeric claims lacking evidence."
      ),
    };
  } catch {
    // Never throw; enforcement must be fail-open.
    return overlay;
  }
}

function isPhaseMode(v: unknown): v is LLMPhaseMode {
  return v === "exploratory" || v === "stabilizing" || v === "governed";
}

function isEvidenceRefV1(v: unknown): v is EvidenceRefV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if (typeof o.document_id !== "string" || !o.document_id.trim()) return false;
  if (typeof o.page_index !== "number" || !Number.isFinite(o.page_index) || Math.floor(o.page_index) !== o.page_index) return false;
  if (o.page_index < 0) return false;
  if (o.dpu_id != null && (typeof o.dpu_id !== "string" || !o.dpu_id.trim())) return false;
  if (o.block_id != null && (typeof o.block_id !== "string" || !o.block_id.trim())) return false;
  if (o.char_range != null) {
    if (!Array.isArray(o.char_range) || o.char_range.length !== 2) return false;
    const a = o.char_range[0];
    const b = o.char_range[1];
    if (typeof a !== "number" || typeof b !== "number") return false;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (Math.floor(a) !== a || Math.floor(b) !== b) return false;
    if (a < 0 || b < 0) return false;
  }
  return true;
}

function isGovernedClaimV1(v: unknown): v is GovernedLLMClaimV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if (o.claim_type !== "kpi" && o.claim_type !== "risk" && o.claim_type !== "summary" && o.claim_type !== "other") return false;
  if (typeof o.label !== "string" || !o.label.trim()) return false;
  if (o.value_string != null && typeof o.value_string !== "string") return false;
  if (o.value_number != null && (typeof o.value_number !== "number" || !Number.isFinite(o.value_number))) return false;
  if (o.unit != null && typeof o.unit !== "string") return false;
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) return false;
  if (!Array.isArray(o.evidence_refs)) return false;
  for (const e of o.evidence_refs) {
    if (!isEvidenceRefV1(e)) return false;
  }
  return true;
}

function isKpiLike(claim: GovernedLLMClaimV1): boolean {
  if (claim.claim_type === "kpi") return true;
  if (typeof claim.value_number === "number") return true;
  const label = String(claim.label ?? "").toLowerCase();
  return /\b(arr|mrr|revenue|runway|burn|gmv|cac|ltv|margin|growth)\b/.test(label);
}

export function validateGovernedLlmOverviewV1(
  candidate: GovernedLLMOverviewV1
): { ok: true; data: GovernedLLMOverviewV1 } | { ok: false; error: unknown } {
  if (!candidate || typeof candidate !== "object") return { ok: false as const, error: "candidate_not_object" };
  if ((candidate as any).schema_version !== SCHEMA_VERSION) return { ok: false as const, error: "invalid_schema_version" };
  if (typeof candidate.deal_id !== "string" || !candidate.deal_id.trim()) return { ok: false as const, error: "missing_deal_id" };
  if (typeof candidate.input_hash !== "string" || !candidate.input_hash.trim()) return { ok: false as const, error: "missing_input_hash" };
  if (!isPhaseMode((candidate as any).llm_phase_mode)) return { ok: false as const, error: "invalid_llm_phase_mode" };
  if (typeof candidate.summary_text !== "string") return { ok: false as const, error: "invalid_summary_text" };
  if (!Array.isArray(candidate.claims)) return { ok: false as const, error: "invalid_claims" };
  if (!Array.isArray(candidate.disclosures)) return { ok: false as const, error: "invalid_disclosures" };

  for (const c of candidate.claims as any[]) {
    if (!isGovernedClaimV1(c)) return { ok: false as const, error: "invalid_claim" };
    if (isKpiLike(c) && (!Array.isArray(c.evidence_refs) || c.evidence_refs.length === 0)) {
      return {
        ok: false as const,
        error: {
          code: "kpi_claim_missing_evidence",
          message: "Numeric/KPI-like claims must include >= 1 evidence_ref",
          claim_label: c.label,
        },
      };
    }
  }

  for (const d of candidate.disclosures as any[]) {
    if (!d || typeof d !== "object") return { ok: false as const, error: "invalid_disclosure" };
    if (typeof (d as any).code !== "string" || !(d as any).code.trim()) return { ok: false as const, error: "invalid_disclosure" };
    if (typeof (d as any).message !== "string" || !(d as any).message.trim()) return { ok: false as const, error: "invalid_disclosure" };
  }

  return { ok: true as const, data: candidate };
}

function validateGovernedLlmOverviewSchemaV1(
  candidate: GovernedLLMOverviewV1
): { ok: true; data: GovernedLLMOverviewV1 } | { ok: false; error: unknown } {
  if (!candidate || typeof candidate !== "object") return { ok: false as const, error: "candidate_not_object" };
  if ((candidate as any).schema_version !== SCHEMA_VERSION) return { ok: false as const, error: "invalid_schema_version" };
  if (typeof candidate.deal_id !== "string" || !candidate.deal_id.trim()) return { ok: false as const, error: "missing_deal_id" };
  if (typeof candidate.input_hash !== "string" || !candidate.input_hash.trim()) return { ok: false as const, error: "missing_input_hash" };
  if (!isPhaseMode((candidate as any).llm_phase_mode)) return { ok: false as const, error: "invalid_llm_phase_mode" };
  if (typeof candidate.summary_text !== "string") return { ok: false as const, error: "invalid_summary_text" };
  if (!Array.isArray(candidate.claims)) return { ok: false as const, error: "invalid_claims" };
  if (!Array.isArray(candidate.disclosures)) return { ok: false as const, error: "invalid_disclosures" };

  for (const c of candidate.claims as any[]) {
    if (!isGovernedClaimV1(c)) return { ok: false as const, error: "invalid_claim" };
  }

  for (const d of candidate.disclosures as any[]) {
    if (!d || typeof d !== "object") return { ok: false as const, error: "invalid_disclosure" };
    if (typeof (d as any).code !== "string" || !(d as any).code.trim()) return { ok: false as const, error: "invalid_disclosure" };
    if (typeof (d as any).message !== "string" || !(d as any).message.trim()) return { ok: false as const, error: "invalid_disclosure" };
  }

  return { ok: true as const, data: candidate };
}

function clamp01(n: unknown, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function buildSummaryText(input: {
  dealName?: string | null;
  dealOverviewV2?: any;
  businessArchetypeV1?: any;
}): string {
  const name = typeof input.dealName === "string" && input.dealName.trim() ? input.dealName.trim() : null;
  const overview = input.dealOverviewV2 && typeof input.dealOverviewV2 === "object" ? input.dealOverviewV2 : null;

  const raise = typeof (overview as any)?.raise === "string" ? String((overview as any).raise).trim() : "";
  const model = typeof (overview as any)?.business_model === "string" ? String((overview as any).business_model).trim() : "";
  const product = typeof (overview as any)?.product_solution === "string" ? String((overview as any).product_solution).trim() : "";
  const market = typeof (overview as any)?.market_icp === "string" ? String((overview as any).market_icp).trim() : "";

  const bits: string[] = [];
  if (name) bits.push(`Deal: ${name}.`);
  if (raise) bits.push(`Raise: ${raise}.`);
  if (model) bits.push(`Business model: ${model}.`);
  if (product) bits.push(`Product: ${product}.`);
  if (market) bits.push(`Market/ICP: ${market}.`);

  if (bits.length === 0) return "";
  return bits.join(" ");
}

function toEvidenceRefFromKpiClaim(claim: { document_id: string; page: number }): EvidenceRefV1 | null {
  const document_id = typeof claim.document_id === "string" ? claim.document_id.trim() : "";
  const page = typeof claim.page === "number" && Number.isFinite(claim.page) ? Math.floor(claim.page) : NaN;
  if (!document_id) return null;
  if (!Number.isFinite(page) || page <= 0) return null;
  return {
    document_id,
    page_index: page - 1,
    dpu_id: `dpu:${document_id}:p${page - 1}`,
  };
}

async function persistGovernedOverview(pool: Pool, overview: GovernedLLMOverviewV1): Promise<{ inserted: boolean }> {
  const res = await pool.query(
    `INSERT INTO governed_llm_overviews (deal_id, schema_version, llm_phase_mode, input_hash, run_id, step_run_id, summary_text, claims, disclosures)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     ON CONFLICT (deal_id, input_hash, schema_version) DO NOTHING`,
    [
      overview.deal_id,
      overview.schema_version,
      overview.llm_phase_mode,
      overview.input_hash,
      overview.run_id ?? null,
      overview.step_run_id ?? null,
      overview.summary_text,
      JSON.stringify(overview.claims ?? []),
      JSON.stringify(overview.disclosures ?? []),
    ]
  );

  return { inserted: (res as any)?.rowCount === 1 };
}

async function readDealPhaseMode(pool: Pool, dealId: string): Promise<LLMPhaseMode> {
  try {
    const { rows } = await pool.query<{ llm_phase_mode: string | null }>(
      `SELECT llm_phase_mode::text as llm_phase_mode
         FROM deals
        WHERE id = $1::uuid
          AND deleted_at IS NULL
        LIMIT 1`,
      [dealId]
    );
    const mode = String(rows?.[0]?.llm_phase_mode ?? "").trim();
    if (mode === "exploratory" || mode === "stabilizing" || mode === "governed") return mode;
  } catch {
    // ignore
  }
  return "exploratory";
}

async function hasTable(pool: Pool, table: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
           FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name=$1
       ) as exists`,
      [table]
    );
    return Boolean((rows as any)?.[0]?.exists);
  } catch {
    return false;
  }
}

export async function generateAndPersistGovernedLlmOverviewBestEffort(args: {
  pool: Pool;
  dealId: string;
  runId?: string | null;
  stepRunId?: string | null;
  dealName?: string | null;
  phase1_deal_overview_v2?: unknown;
  phase1_business_archetype_v1?: unknown;
  phase1_update_report_v1?: unknown;
  phase1_deal_summary_v2?: unknown;
  phase1_documents?: Array<{ document_id: string; type?: string | null }>;
}): Promise<{ ok: boolean; inserted: boolean; input_hash: string | null; validation_failed: boolean }> {
  const startedAt = Date.now();
  const pool = args.pool;

  try {
    const tableOk = await hasTable(pool, "governed_llm_overviews");
    if (!tableOk) {
      return { ok: true, inserted: false, input_hash: null, validation_failed: false };
    }

    const llm_phase_mode = await readDealPhaseMode(pool, args.dealId);

    const nowIso = new Date().toISOString();

    let kpiClaims: any[] = [];
    try {
      const docs = Array.isArray(args.phase1_documents) ? args.phase1_documents : [];
      const out = await buildPhase1KpiReconciliationV1({
        pool,
        dealId: args.dealId,
        documents: docs.map((d) => ({ document_id: String(d.document_id), type: d.type ?? null })),
        nowIso,
      });
      kpiClaims = Array.isArray(out?.claims) ? out.claims : [];
    } catch {
      kpiClaims = [];
    }

    const deterministicInputs = {
      schema_version: SCHEMA_VERSION,
      deal_id: args.dealId,
      llm_phase_mode,
      phase1: {
        deal_overview_v2: stripNonDeterministicFieldsDeep(args.phase1_deal_overview_v2 ?? null),
        business_archetype_v1: stripNonDeterministicFieldsDeep(args.phase1_business_archetype_v1 ?? null),
        update_report_v1: stripNonDeterministicFieldsDeep(args.phase1_update_report_v1 ?? null),
        deal_summary_v2: stripNonDeterministicFieldsDeep(args.phase1_deal_summary_v2 ?? null),
      },
      phase1_kpi_claims_v1: kpiClaims.map((c) => ({
        claim_id: (c as any)?.claim_id ?? null,
        metric: (c as any)?.metric ?? null,
        value: (c as any)?.value ?? null,
        document_id: (c as any)?.document_id ?? null,
        page: (c as any)?.page ?? null,
        confidence: (c as any)?.confidence ?? null,
      })),
    };

    const input_hash = computeGovernedLlmOverviewInputHash(deterministicInputs);

    const summary_text = buildSummaryText({
      dealName: args.dealName ?? null,
      dealOverviewV2: args.phase1_deal_overview_v2 ?? null,
      businessArchetypeV1: args.phase1_business_archetype_v1 ?? null,
    });

    const claims: GovernedLLMClaimV1[] = [];
    for (const c of kpiClaims) {
      const metric = typeof (c as any)?.metric === "string" ? String((c as any).metric) : "";
      const value = typeof (c as any)?.value === "number" && Number.isFinite((c as any).value) ? (c as any).value : null;
      const conf = clamp01((c as any)?.confidence, 0.7);
      const ev = toEvidenceRefFromKpiClaim({ document_id: String((c as any)?.document_id ?? ""), page: Number((c as any)?.page ?? NaN) });
      if (!metric || value == null) continue;
      if (!ev) continue;
      claims.push({
        claim_type: "kpi",
        label: metric,
        value_number: value,
        unit: "USD",
        confidence: conf,
        evidence_refs: [ev],
      });
    }

    const disclosures: Disclosure[] = [];

    const candidate: GovernedLLMOverviewV1 = {
      schema_version: SCHEMA_VERSION,
      deal_id: args.dealId,
      run_id: args.runId ?? undefined,
      step_run_id: args.stepRunId ?? undefined,
      input_hash,
      created_at: nowIso,
      llm_phase_mode,
      summary_text,
      claims,
      disclosures,
    };

    const schemaValidated = validateGovernedLlmOverviewSchemaV1(candidate);
    let toPersist: GovernedLLMOverviewV1;
    if (!schemaValidated.ok) {
      toPersist = {
        ...candidate,
        claims: [],
        disclosures: [
          ...disclosures,
          {
            code: "governed_llm_overlay_validation_failed",
            message: "Governed LLM overlay failed schema validation; claims omitted.",
          },
        ],
      };
    } else {
      const enforced = enforcePhaseMode(schemaValidated.data, llm_phase_mode);
      if (llm_phase_mode === "exploratory") {
        toPersist = enforced;
      } else {
        const strictValidated = validateGovernedLlmOverviewV1(enforced);
        toPersist = strictValidated.ok
          ? strictValidated.data
          : {
            ...enforced,
            claims: [],
            disclosures: [
              ...(Array.isArray(enforced.disclosures) ? enforced.disclosures : []),
              {
                code: "governed_llm_overlay_validation_failed",
                message: "Governed LLM overlay failed strict validation; claims omitted.",
              },
            ],
          };
      }
    }

    const persisted = await persistGovernedOverview(pool, toPersist);

    console.log(
      JSON.stringify({
        event: "GOVERNED_LLM_OVERLAY_V1",
        deal_id: args.dealId,
        schema_version: SCHEMA_VERSION,
        llm_phase_mode,
        input_hash,
        inserted: persisted.inserted,
        claims_count: Array.isArray(toPersist.claims) ? toPersist.claims.length : 0,
        validation_failed: !schemaValidated.ok,
        run_id: args.runId ?? null,
        step_run_id: args.stepRunId ?? null,
        duration_ms: Date.now() - startedAt,
        ts: new Date().toISOString(),
      })
    );

    return { ok: true, inserted: persisted.inserted, input_hash, validation_failed: !schemaValidated.ok };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err ?? "unknown_error");
    try {
      console.warn(
        JSON.stringify({
          event: "GOVERNED_LLM_OVERLAY_V1_FAILED",
          deal_id: args.dealId,
          run_id: args.runId ?? null,
          step_run_id: args.stepRunId ?? null,
          error: msg,
          ts: new Date().toISOString(),
        })
      );
    } catch {
      // ignore
    }
    // Fail-safe: never block deterministic pipeline.
    return { ok: false, inserted: false, input_hash: null, validation_failed: false };
  }
}
