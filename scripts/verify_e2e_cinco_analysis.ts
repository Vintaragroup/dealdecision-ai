/*
E2E verification harness: Cinco deal analysis contract.

Runs against dev stack:
- API: http://localhost:9001
- Postgres: localhost:55433

Usage:
  pnpm tsx scripts/verify_e2e_cinco_analysis.ts

Optional env:
  API_BASE_URL=http://localhost:9001
  DEAL_ID=0fcec035-9aa3-4f6e-88fa-818c323add09
  PG_URL=postgresql://postgres:postgres@localhost:55433/dealdecision
  TIMEOUT_MS=120000
*/

import { Pool } from "pg";
import { writeFile } from "node:fs/promises";

type JsonRecord = Record<string, any>;

type JobStatus = "queued" | "running" | "succeeded" | "succeeded_with_warnings" | "failed" | string;

type AnalyzeResponse = {
  job_id?: string;
  status?: string;
  error?: string;
  message?: string;
  blocked_reason?: string;
  poll_after_ms?: number;
  readiness?: any;
  enqueued?: any;
};

type JobGetResponse = {
  job_id: string;
  type?: string;
  status: JobStatus;
  progress_pct?: number;
  message?: string;
  deal_id?: string;
  document_id?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  status_detail?: any;
};

type ReportGetResponse = {
  ready?: boolean;
  reason?: string;
  version?: number;
  artifact?: {
    kind?: string;
    dio_id?: string;
    analysis_version?: number | null;
    updated_at?: string | null;
  };
  analysis_version?: number | null; // may also exist in spread report
};

type GovernedOverviewGetResponse = {
  overview: null | {
    schema_version: string;
    deal_id: string;
    input_hash: string;
    created_at: string;
    llm_phase_mode: string;
    summary_text: string;
    claims: any[];
    disclosures: any[];
    overview_json?: any;
    run_id?: string;
    step_run_id?: string;
  };
};

type DiagnosticsGetResponse = {
  diagnostics: null | {
    deal_id: string;
    report_id: string;
    llm_phase_mode: string;
    provider_error_count: number | null;
    model_output_not_json_count: number | null;
    guard_degraded_count: number | null;
    created_at: string;
    model_output_truncated_count?: number | null;
    citation_integrity_percent?: number | null;
    numeric_claims_without_evidence?: number | null;
    semantic_drift_score?: number | null;
    hallucination_count?: number | null;
    deterministic_coverage_ratio?: number | null;
  };
};

function nowIso() {
  return new Date().toISOString();
}

function msSince(startMs: number) {
  return Date.now() - startMs;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function parseIsoDate(s: string, fieldName: string): Date {
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) {
    throw new Error(`Invalid ISO date for ${fieldName}: ${JSON.stringify(s)}`);
  }
  return d;
}

function assert(condition: any, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function log(event: string, payload: JsonRecord = {}) {
  // All logs are structured JSON (one line each).
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event,
      ts: nowIso(),
      ...payload,
    })
  );
}

class HttpClient {
  private baseUrl: string;
  public readonly requests: Array<{ method: string; url: string; ts: string }> = [];

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private record(method: string, url: string) {
    this.requests.push({ method, url, ts: nowIso() });
  }

  private guardNoNarrate(url: string) {
    if (url.includes("/report?narrate=1") || url.includes("/report%3Fnarrate%3D1") || url.includes("narrate=1")) {
      throw new Error(`CONTRACT_VIOLATION: attempted request to legacy narrated report endpoint: ${url}`);
    }
  }

  async requestJson<T>(method: "GET" | "POST", path: string, init?: { body?: any; headers?: Record<string, string> }): Promise<{ status: number; json: T; text: string; url: string }> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    this.guardNoNarrate(url);
    this.record(method, url);

    const headers: Record<string, string> = { ...(init?.headers ?? {}) };
    let body: any = init?.body;
    if (body != null && typeof body === "object" && !(body instanceof ArrayBuffer)) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      body = JSON.stringify(body);
    }

    const res = await fetch(url, {
      method,
      headers,
      body,
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // keep raw
    }

    return { status: res.status, json: json as T, text, url };
  }

  getJson<T>(path: string) {
    return this.requestJson<T>("GET", path);
  }

  postJson<T>(path: string, body: any) {
    return this.requestJson<T>("POST", path, { body });
  }
}

function verdictFromJobStatus(status: string): "PASS" | "PASS_WITH_WARNINGS" | "FAIL" {
  if (status === "succeeded") return "PASS";
  if (status === "succeeded_with_warnings") return "PASS_WITH_WARNINGS";
  return "FAIL";
}

async function main() {
  const startedAtMs = Date.now();

  const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:9001";
  const DEAL_ID = process.env.DEAL_ID || "0fcec035-9aa3-4f6e-88fa-818c323add09";
  const PG_URL = process.env.PG_URL || "postgresql://postgres:postgres@localhost:55433/dealdecision";
  const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || "120000");

  const http = new HttpClient(API_BASE_URL);

  log("E2E_START", {
    api_base_url: API_BASE_URL,
    deal_id: DEAL_ID,
    pg_url: PG_URL.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@"),
    timeout_ms: TIMEOUT_MS,
  });

  // Step A — Trigger Full Analysis
  const triggerTs = nowIso();
  const analyzeBody = {
    // Required by user spec (wrapper)
    version: "page_understanding_v1",
    payload: { require_page_understanding: true },
    // Required by API implementation (top-level)
    require_page_understanding: true,
    page_understanding_version: "page_understanding_v1",
  };

  log("STEP_A_TRIGGER_ANALYSIS_START", { trigger_ts: triggerTs, request_body: analyzeBody });

  const analyzeRes = await http.postJson<AnalyzeResponse>(`/api/v1/deals/${DEAL_ID}/analyze`, analyzeBody);
  log("HTTP_RESPONSE", {
    step: "A",
    method: "POST",
    url: analyzeRes.url,
    status: analyzeRes.status,
    body_preview: analyzeRes.text.slice(0, 500),
  });

  assert(analyzeRes.status === 202, `Expected 202 from analyze, got ${analyzeRes.status}: ${analyzeRes.text}`);

  const jobId = asNonEmptyString((analyzeRes.json as any)?.job_id);
  assert(jobId, `Missing job_id in analyze response: ${analyzeRes.text}`);

  log("STEP_A_TRIGGER_ANALYSIS_OK", { job_id: jobId, trigger_ts: triggerTs });

  // Step B — Poll Job Until Terminal State
  log("STEP_B_POLL_JOB_START", { job_id: jobId, poll_interval_ms: 2000, timeout_ms: TIMEOUT_MS });

  const pollStartMs = Date.now();
  let lastJob: JobGetResponse | null = null;

  while (true) {
    const jobRes = await http.getJson<JobGetResponse>(`/api/v1/jobs/${jobId}`);
    log("HTTP_RESPONSE", {
      step: "B",
      method: "GET",
      url: jobRes.url,
      status: jobRes.status,
      body_preview: jobRes.text.slice(0, 500),
    });

    assert(jobRes.status === 200, `Expected 200 from job GET, got ${jobRes.status}: ${jobRes.text}`);

    lastJob = jobRes.json;
    const status = String(lastJob.status ?? "");
    const message = typeof lastJob.message === "string" ? lastJob.message : null;

    log("JOB_POLL_TICK", {
      job_id: jobId,
      status,
      message,
      progress_pct: typeof lastJob.progress_pct === "number" ? lastJob.progress_pct : null,
      created_at: lastJob.created_at ?? null,
      started_at: lastJob.started_at ?? null,
      updated_at: lastJob.updated_at ?? null,
      elapsed_ms: msSince(pollStartMs),
    });

    if (status === "succeeded" || status === "succeeded_with_warnings" || status === "failed") {
      break;
    }

    if (msSince(pollStartMs) > TIMEOUT_MS) {
      throw new Error(`Timed out waiting for job terminal status after ${TIMEOUT_MS}ms (job_id=${jobId}). Last: ${JSON.stringify(lastJob)}`);
    }

    await sleep(2000);
  }

  assert(lastJob, "Internal error: missing lastJob");
  const finalJobStatus = String(lastJob.status);
  const finalJobMessage = typeof lastJob.message === "string" ? lastJob.message : "";
  const jobTerminalAtIso = lastJob.updated_at || nowIso();

  log("STEP_B_POLL_JOB_DONE", {
    job_id: jobId,
    final_status: finalJobStatus,
    message: finalJobMessage,
    total_duration_ms: msSince(pollStartMs),
    job_terminal_at: jobTerminalAtIso,
  });

  assert(finalJobStatus !== "failed", `Job failed: job_id=${jobId} message=${finalJobMessage}`);

  // Step C — Verify Deterministic Artifact Exists
  log("STEP_C_VERIFY_REPORT_START", { deal_id: DEAL_ID });
  const reportRes = await http.getJson<ReportGetResponse>(`/api/v1/deals/${DEAL_ID}/report`);
  log("HTTP_RESPONSE", {
    step: "C",
    method: "GET",
    url: reportRes.url,
    status: reportRes.status,
    body_preview: reportRes.text.slice(0, 800),
  });
  assert(reportRes.status === 200, `Expected 200 from report, got ${reportRes.status}: ${reportRes.text}`);

  const report = reportRes.json;
  assert(report?.ready === true, `Expected report.ready===true, got: ${reportRes.text}`);
  assert(report?.version === 2, `Expected report.version===2, got ${String(report?.version)}: ${reportRes.text}`);
  assert(asNonEmptyString(report?.artifact?.dio_id), `Expected artifact.dio_id to exist: ${reportRes.text}`);
  assert(report?.artifact?.analysis_version === 2, `Expected artifact.analysis_version===2, got ${String(report?.artifact?.analysis_version)}: ${reportRes.text}`);

  log("STEP_C_VERIFY_REPORT_OK", {
    ready: report.ready,
    version: report.version,
    dio_id: report.artifact?.dio_id,
    analysis_version: report.artifact?.analysis_version,
    artifact_updated_at: report.artifact?.updated_at ?? null,
  });

  // Step D — Verify Governed LLM Overview Persisted
  log("STEP_D_VERIFY_GOVERNED_OVERVIEW_START", { deal_id: DEAL_ID });
  const ovRes = await http.getJson<GovernedOverviewGetResponse>(`/api/v1/deals/${DEAL_ID}/governed-llm-overview`);
  log("HTTP_RESPONSE", {
    step: "D",
    method: "GET",
    url: ovRes.url,
    status: ovRes.status,
    body_preview: ovRes.text.slice(0, 800),
  });
  assert(ovRes.status === 200, `Expected 200 from governed overview, got ${ovRes.status}: ${ovRes.text}`);

  const overview = ovRes.json?.overview;
  assert(overview, `Expected overview to exist (not null): ${ovRes.text}`);
  assert(asNonEmptyString(overview.input_hash), `Expected non-empty overview.input_hash: ${ovRes.text}`);
  assert(asNonEmptyString(overview.summary_text), `Expected non-empty overview.summary_text: ${ovRes.text}`);

  // Overlay-first UX depends on overview_json being persisted.
  const overviewJson = (overview as any).overview_json;
  assert(overviewJson && typeof overviewJson === "object", `Expected overview.overview_json to be an object: ${ovRes.text}`);

  const overlayOneLiner = asNonEmptyString((overviewJson as any)?.phase1?.deal_summary_v2?.summary?.one_liner);
  assert(overlayOneLiner, `Expected overview.overview_json.phase1.deal_summary_v2.summary.one_liner to exist: ${ovRes.text}`);

  const jobTerminalAt = parseIsoDate(jobTerminalAtIso, "job_terminal_at");
  const overviewCreatedAt = parseIsoDate(overview.created_at, "overview.created_at");
  const overviewSkewMs = Math.abs(overviewCreatedAt.getTime() - jobTerminalAt.getTime());

  assert(overviewSkewMs <= 2 * 60_000, `Expected overview.created_at within 2 minutes of job completion. skew_ms=${overviewSkewMs}`);

  log("STEP_D_VERIFY_GOVERNED_OVERVIEW_OK", {
    schema_version: overview.schema_version,
    input_hash: overview.input_hash,
    created_at: overview.created_at,
    llm_phase_mode: overview.llm_phase_mode,
    summary_len: overview.summary_text.length,
    overlay_one_liner_preview: overlayOneLiner.slice(0, 140),
    skew_ms_vs_job_terminal: overviewSkewMs,
  });

  // Step E — Verify Diagnostics Snapshot
  log("STEP_E_VERIFY_DIAGNOSTICS_START", { deal_id: DEAL_ID });
  const diagRes = await http.getJson<DiagnosticsGetResponse>(`/api/v1/deals/${DEAL_ID}/analysis-diagnostics`);
  log("HTTP_RESPONSE", {
    step: "E",
    method: "GET",
    url: diagRes.url,
    status: diagRes.status,
    body_preview: diagRes.text.slice(0, 800),
  });
  assert(diagRes.status === 200, `Expected 200 from diagnostics, got ${diagRes.status}: ${diagRes.text}`);

  const diagnostics = diagRes.json?.diagnostics;
  assert(diagnostics, `Expected diagnostics to exist (not null): ${diagRes.text}`);
  assert(diagnostics.report_id === overview.input_hash, `Expected diagnostics.report_id to match overview.input_hash (${overview.input_hash}), got ${diagnostics.report_id}`);
  assert(asNonEmptyString(diagnostics.llm_phase_mode), `Expected diagnostics.llm_phase_mode to be present: ${diagRes.text}`);

  // Required counters must exist (may be null on older DBs, but API selects them as null if absent).
  assert("provider_error_count" in diagnostics, "Expected provider_error_count field to exist");
  assert("model_output_not_json_count" in diagnostics, "Expected model_output_not_json_count field to exist");
  assert("guard_degraded_count" in diagnostics, "Expected guard_degraded_count field to exist");

  log("STEP_E_VERIFY_DIAGNOSTICS_OK", {
    report_id: diagnostics.report_id,
    llm_phase_mode: diagnostics.llm_phase_mode,
    provider_error_count: diagnostics.provider_error_count,
    model_output_not_json_count: diagnostics.model_output_not_json_count,
    guard_degraded_count: diagnostics.guard_degraded_count,
    created_at: diagnostics.created_at,
  });

  // Step F — Verify Database State Directly
  log("STEP_F_DB_VERIFY_START", { pg_url: PG_URL.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@") });
  const pool = new Pool({ connectionString: PG_URL });

  const dbJob = await pool.query<{
    job_id: string;
    status: string;
    message: string | null;
    created_at: Date | null;
    updated_at: Date | null;
    started_at: Date | null;
  }>(
    `SELECT job_id, status, message, created_at, updated_at, started_at
       FROM jobs
      WHERE job_id = $1
      LIMIT 1`,
    [jobId]
  );
  assert(dbJob.rows.length === 1, `Expected 1 jobs row for job_id=${jobId}`);

  const dbJobRow = dbJob.rows[0];
  assert(dbJobRow.status === finalJobStatus, `DB job status mismatch. api=${finalJobStatus} db=${dbJobRow.status}`);

  const dbOverview = await pool.query<{
    deal_id: string;
    input_hash: string;
    created_at: Date;
  }>(
    `SELECT deal_id::text as deal_id, input_hash, created_at
       FROM governed_llm_overviews
      WHERE deal_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [DEAL_ID]
  );
  assert(dbOverview.rows.length === 1, `Expected governed_llm_overviews row for deal_id=${DEAL_ID}`);

  const dbDiagnostics = await pool.query<{
    deal_id: string;
    report_id: string;
    created_at: Date;
  }>(
    `SELECT deal_id::text as deal_id, report_id, created_at
       FROM deal_analysis_diagnostics
      WHERE deal_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [DEAL_ID]
  );
  assert(dbDiagnostics.rows.length === 1, `Expected deal_analysis_diagnostics row for deal_id=${DEAL_ID}`);

  const jobCreatedAt = dbJobRow.created_at ? new Date(dbJobRow.created_at) : null;
  const overviewDbCreatedAt = new Date(dbOverview.rows[0].created_at);
  const diagnosticsDbCreatedAt = new Date(dbDiagnostics.rows[0].created_at);

  // Logical ordering assertion (most stable): job enqueue before overview before diagnostics.
  // Job updated_at may occur after overlay/diagnostics persistence (worker marks terminal status last).
  if (jobCreatedAt) {
    assert(jobCreatedAt.getTime() <= overviewDbCreatedAt.getTime(), `Expected job.created_at <= overview.created_at (db)`);
  }
  assert(overviewDbCreatedAt.getTime() <= diagnosticsDbCreatedAt.getTime(), `Expected overview.created_at <= diagnostics.created_at (db)`);

  log("STEP_F_DB_VERIFY_OK", {
    job: {
      job_id: dbJobRow.job_id,
      status: dbJobRow.status,
      message: dbJobRow.message,
      created_at: dbJobRow.created_at?.toISOString?.() ?? null,
      started_at: dbJobRow.started_at?.toISOString?.() ?? null,
      updated_at: dbJobRow.updated_at?.toISOString?.() ?? null,
    },
    overview: {
      deal_id: dbOverview.rows[0].deal_id,
      input_hash: dbOverview.rows[0].input_hash,
      created_at: dbOverview.rows[0].created_at.toISOString(),
    },
    diagnostics: {
      deal_id: dbDiagnostics.rows[0].deal_id,
      report_id: dbDiagnostics.rows[0].report_id,
      created_at: dbDiagnostics.rows[0].created_at.toISOString(),
    },
  });

  await pool.end();

  // Step G — Verify WebApp Would Render Governed Overlay (and no narrated call)
  log("STEP_G_WEBAPP_SIM_START", { deal_id: DEAL_ID });

  // In practice this repeats Step D, but we treat it as the explicit webapp simulation point.
  assert(overview.schema_version === "governed_llm_overview_v1", `Expected schema_version=governed_llm_overview_v1, got ${overview.schema_version}`);

  log("STEP_G_WEBAPP_SIM_OK", {
    http_200: true,
    schema_version: overview.schema_version,
    summary_preview: overview.summary_text.slice(0, 140),
  });

  // Ensure our harness never called /report?narrate=1.
  const narrateCalls = http.requests.filter((r) => r.url.includes("narrate=1"));
  assert(narrateCalls.length === 0, `CONTRACT_VIOLATION: detected narrated calls: ${JSON.stringify(narrateCalls)}`);

  log("NO_NARRATE_CALLS_OK", { total_requests: http.requests.length });

  const verdict = verdictFromJobStatus(finalJobStatus);
  const totalRuntimeMs = msSince(startedAtMs);

  const maskedPgUrl = PG_URL.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@");

  // Markdown report
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  const reportPath = `verification_e2e_cinco_analysis_${stamp}.md`;

  const md = `# Verification: E2E Cinco Analysis (${stamp})\n\n` +
    `- Deal ID: ${DEAL_ID}\n` +
    `- API Base URL: ${API_BASE_URL}\n` +
    `- PG URL (masked): ${maskedPgUrl}\n` +
    `- Timeout: ${TIMEOUT_MS} ms\n` +
    `- Job ID: ${jobId}\n` +
    `- Job Final Status: ${finalJobStatus}\n` +
    `- Job Message: ${finalJobMessage || "(none)"}\n` +
    `- Total Runtime: ${totalRuntimeMs} ms\n\n` +
    `## Deterministic Artifact (/report)\n\n` +
    `- ready: ${String(report.ready)}\n` +
    `- version: ${String(report.version)}\n` +
    `- artifact.dio_id: ${String(report.artifact?.dio_id)}\n` +
    `- artifact.analysis_version: ${String(report.artifact?.analysis_version)}\n\n` +
    `## Governed Overview (/governed-llm-overview)\n\n` +
    `- schema_version: ${overview.schema_version}\n` +
    `- input_hash: ${overview.input_hash}\n` +
    `- created_at: ${overview.created_at}\n` +
    `- llm_phase_mode: ${overview.llm_phase_mode}\n` +
    `- summary_text length: ${overview.summary_text.length}\n\n` +
    `- overview_json persisted: true\n` +
    `- overview_json.phase1.deal_summary_v2.summary.one_liner (preview): ${overlayOneLiner.slice(0, 140)}\n\n` +
    `## Diagnostics (/analysis-diagnostics)\n\n` +
    `- report_id: ${diagnostics.report_id}\n` +
    `- llm_phase_mode: ${diagnostics.llm_phase_mode}\n` +
    `- provider_error_count: ${String(diagnostics.provider_error_count)}\n` +
    `- model_output_truncated_count: ${String((diagnostics as any).model_output_truncated_count ?? null)}\n` +
    `- model_output_not_json_count: ${String(diagnostics.model_output_not_json_count)}\n` +
    `- guard_degraded_count: ${String(diagnostics.guard_degraded_count)}\n` +
    `- citation_integrity_percent: ${String((diagnostics as any).citation_integrity_percent ?? null)}\n` +
    `- numeric_claims_without_evidence: ${String((diagnostics as any).numeric_claims_without_evidence ?? null)}\n` +
    `- hallucination_count: ${String((diagnostics as any).hallucination_count ?? null)}\n` +
    `- semantic_drift_score: ${String((diagnostics as any).semantic_drift_score ?? null)}\n` +
    `- deterministic_coverage_ratio: ${String((diagnostics as any).deterministic_coverage_ratio ?? null)}\n` +
    `- created_at: ${diagnostics.created_at}\n\n` +
    `## DB Proof Snapshots\n\n` +
    "```sql\n" +
    `SELECT status, message FROM jobs WHERE job_id = '${jobId}';\n\n` +
    `SELECT deal_id, input_hash, created_at\nFROM governed_llm_overviews\nWHERE deal_id = '${DEAL_ID}'\nORDER BY created_at DESC\nLIMIT 1;\n\n` +
    `SELECT deal_id, report_id, created_at\nFROM deal_analysis_diagnostics\nWHERE deal_id = '${DEAL_ID}'\nORDER BY created_at DESC\nLIMIT 1;\n` +
    "```\n\n" +
    `## Request Audit (Harness)\n\n` +
    `- Total HTTP requests: ${http.requests.length}\n` +
    `- Narrated calls (/report?narrate=1): 0\n\n` +
    "```json\n" +
    JSON.stringify(http.requests, null, 2) +
    "\n```\n\n" +
    `## Final Verdict\n\n` +
    `**${verdict}**\n`;

  await writeFile(reportPath, md, "utf8");

  log("E2E_DONE", {
    verdict,
    report_path: reportPath,
    total_runtime_ms: totalRuntimeMs,
  });
}

main().catch((err) => {
  log("E2E_FAIL", {
    error: err instanceof Error ? err.message : String(err ?? "unknown_error"),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exitCode = 1;
});
