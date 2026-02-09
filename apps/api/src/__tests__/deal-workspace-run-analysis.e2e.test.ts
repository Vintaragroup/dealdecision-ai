import { test } from "node:test";
import assert from "node:assert/strict";

const E2E_API_BASE_URL = (process.env.E2E_API_BASE_URL || "").trim();
const E2E_DEAL_ID = (process.env.E2E_DEAL_ID || "").trim();
const E2E_BEARER_TOKEN = (process.env.E2E_BEARER_TOKEN || "").trim();

const shouldRun = Boolean(E2E_API_BASE_URL && E2E_DEAL_ID);
const e2e = shouldRun ? test : test.skip;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function fetchJson(path: string, init?: RequestInit): Promise<{ status: number; json: any; text: string }> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (E2E_BEARER_TOKEN) headers.Authorization = `Bearer ${E2E_BEARER_TOKEN}`;

  const res = await fetch(joinUrl(E2E_API_BASE_URL, path), {
    ...init,
    headers,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function unwrapReportEnvelope(body: any): any {
  if (!body || typeof body !== "object") return null;
  if (body.report && typeof body.report === "object") return body.report;
  return body;
}

function unwrapMetadata(body: any): any {
  const report = unwrapReportEnvelope(body);
  const meta = body?.metadata ?? report?.metadata;
  return meta && typeof meta === "object" ? meta : null;
}

function isReadyReportBody(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  if (typeof body.ready === "boolean") return body.ready;
  // Legacy: report payload without envelope.
  return typeof body.dealId === "string" && typeof body.version === "number";
}

function pickDeterministicSnapshot(body: any): {
  structured_summary: any;
  promoted_facts: any;
  score_explanation: any;
} {
  const report = unwrapReportEnvelope(body) ?? {};
  const meta = unwrapMetadata(body) ?? {};
  return {
    structured_summary: (report as any).structured_summary ?? null,
    promoted_facts: (report as any).promoted_facts ?? null,
    score_explanation: (meta as any).score_explanation ?? null,
  };
}

function normalizeJobStatus(status: unknown): string | null {
  if (typeof status !== "string") return null;
  const s = status.trim().toLowerCase();
  return s || null;
}

function isTerminalJobStatus(status: string | null): boolean {
  if (!status) return false;
  return [
    "succeeded",
    "succeeded_with_warnings",
    "failed",
    "cancelled",
    "canceled",
    "completed",
    "complete",
    "error",
  ].includes(status);
}

async function waitForReadiness(opts: {
  dealId: string;
  version: string;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    const res = await fetchJson(`/api/v1/deals/${opts.dealId}/readiness?page_understanding_version=${encodeURIComponent(opts.version)}`);
    assert.equal(res.status, 200, `readiness status=${res.status} body=${res.text}`);

    const ready = Boolean(res.json?.ready);
    if (ready) return;

    if (Date.now() - startedAt > opts.timeoutMs) {
      throw new Error(`Timed out waiting for readiness after ${opts.timeoutMs}ms: ${res.text}`);
    }

    const pollAfterMsRaw = res.json?.poll_after_ms;
    const pollAfterMs = typeof pollAfterMsRaw === "number" && Number.isFinite(pollAfterMsRaw) ? Math.max(500, Math.min(10_000, Math.floor(pollAfterMsRaw))) : 2000;
    await sleep(pollAfterMs);
  }
}

async function startAnalysisWithGate(opts: {
  dealId: string;
  version: string;
  readinessTimeoutMs: number;
}): Promise<{ job_id: string }> {
  // Try analyze first; if backend returns "preparing documents", poll readiness then retry.
  const payload = {
    require_page_understanding: true,
    page_understanding_version: opts.version,
  };

  const first = await fetchJson(`/api/v1/deals/${opts.dealId}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  assert.equal(first.status, 202, `analyze status=${first.status} body=${first.text}`);

  if (first.json?.error === "page_understanding_not_ready") {
    await waitForReadiness({ dealId: opts.dealId, version: opts.version, timeoutMs: opts.readinessTimeoutMs });

    const second = await fetchJson(`/api/v1/deals/${opts.dealId}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 202, `analyze(retry) status=${second.status} body=${second.text}`);

    const jobId = second.json?.job_id;
    assert.ok(typeof jobId === "string" && jobId.trim().length > 0, `missing job_id in analyze response: ${second.text}`);
    return { job_id: jobId };
  }

  const jobId = first.json?.job_id;
  assert.ok(typeof jobId === "string" && jobId.trim().length > 0, `missing job_id in analyze response: ${first.text}`);
  return { job_id: jobId };
}

async function waitForJobTerminal(opts: { jobId: string; timeoutMs: number }): Promise<{ normalizedStatus: string; payload: any }> {
  const startedAt = Date.now();
  while (true) {
    const res = await fetchJson(`/api/v1/jobs/${opts.jobId}`);
    assert.equal(res.status, 200, `job status=${res.status} body=${res.text}`);

    const normalized = normalizeJobStatus(res.json?.status);
    if (normalized && isTerminalJobStatus(normalized)) {
      return { normalizedStatus: normalized, payload: res.json };
    }

    if (Date.now() - startedAt > opts.timeoutMs) {
      throw new Error(`Timed out waiting for job ${opts.jobId} terminal status after ${opts.timeoutMs}ms: ${res.text}`);
    }

    await sleep(2000);
  }
}

async function waitForReportReady(opts: { dealId: string; timeoutMs: number; narrate: boolean }): Promise<any> {
  const startedAt = Date.now();
  const url = opts.narrate ? `/api/v1/deals/${opts.dealId}/report?narrate=1` : `/api/v1/deals/${opts.dealId}/report`;

  while (true) {
    const res = await fetchJson(url, { method: "GET" });
    assert.equal(res.status, 200, `report status=${res.status} body=${res.text}`);

    if (isReadyReportBody(res.json)) return res.json;

    if (Date.now() - startedAt > opts.timeoutMs) {
      throw new Error(`Timed out waiting for report ready after ${opts.timeoutMs}ms: ${res.text}`);
    }

    await sleep(5000);
  }
}

e2e(
  "E2E: Deal Workspace run analysis keeps deterministic report stable between /report and /report?narrate=1",
  { timeout: 40 * 60_000 },
  async () => {
    const dealId = E2E_DEAL_ID;
    const baseUrl = E2E_API_BASE_URL;

    assert.ok(baseUrl, "E2E_API_BASE_URL is required");
    assert.ok(dealId, "E2E_DEAL_ID is required");

    // Start analysis (mirrors UI behavior: require page understanding readiness).
    const { job_id } = await startAnalysisWithGate({
      dealId,
      version: "page_understanding_v1",
      readinessTimeoutMs: 10 * 60_000,
    });

    // Wait for analysis to complete.
    const jobTerminal = await waitForJobTerminal({ jobId: job_id, timeoutMs: 30 * 60_000 });
    assert.ok(
      ["succeeded", "succeeded_with_warnings", "completed", "complete"].includes(jobTerminal.normalizedStatus),
      `analysis job did not succeed: status=${jobTerminal.normalizedStatus} payload=${JSON.stringify(jobTerminal.payload ?? null)}`
    );

    // Wait for baseline report.
    const baseline = await waitForReportReady({ dealId, timeoutMs: 10 * 60_000, narrate: false });

    // Fetch narrated report (governed overlays additive-only; may degrade).
    const narrated = await waitForReportReady({ dealId, timeoutMs: 10 * 60_000, narrate: true });

    // Deterministic invariants: subtrees must not change with narrate=1.
    assert.deepEqual(pickDeterministicSnapshot(narrated), pickDeterministicSnapshot(baseline));

    // Narrated response should include either an attachment or a structured error/meta.
    const narrReport = unwrapReportEnvelope(narrated);
    const narrMeta = unwrapMetadata(narrated);
    assert.ok(narrMeta, "expected metadata in narrated report response");

    const narration = (narrReport as any)?.llm_narration_v1 ?? (narrated as any)?.llm_narration_v1;
    if (narration != null) {
      assert.equal((narration as any)?.version, "llm_narration_v1");
    } else {
      // Accept degradations: missing key, schema/guard failure, provider error, etc.
      const err = (narrMeta as any)?.llm_narration_v1_error ?? null;
      const meta = (narrMeta as any)?.llm_narration_v1_meta ?? null;
      assert.ok(err || meta, `expected llm_narration_v1_error or llm_narration_v1_meta when narration missing; meta=${JSON.stringify(narrMeta)}`);
    }
  }
);
