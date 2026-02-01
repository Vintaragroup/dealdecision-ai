export {};

type DealListItem = {
  id: string;
  name?: string;
};

type JobStatusResponse = {
  job_id: string;
  status: string;
  type?: string;
  deal_id?: string;
  progress_pct?: number;
  message?: string;
  created_at?: string;
  updated_at?: string;
};

type RecommendedAction = "proceed" | "remediate" | "re_extract" | "wait";

type ExtractionReportResponse = {
  deal_id: string;
  extraction_report: {
    recommended_action: RecommendedAction;
    recommendation_reason?: string;
    confidence_band?: string;
    overall_confidence_score?: number | null;
    counts?: Record<string, unknown>;
  };
  documents?: Array<{
    id: string;
    title?: string | null;
    confidence_band?: string;
    extraction_quality_score?: number | null;
    recommended_action?: RecommendedAction;
    recommendation_reason?: string;
  }>;
  last_updated?: string;
};

type RemediateResponse = {
  job_id: string;
  status: string;
};

type ReextractResponse = {
  ok: boolean;
  job_id: string;
};

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(raw.toLowerCase());
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function envFloat(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = s % 60;
  const mm = m % 60;
  if (h > 0) return `${h}h ${mm}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const isJsonBody = typeof init?.body === "string";

  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(hasBody && isJsonBody ? { "content-type": "application/json" } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} for ${url.toString()}${text ? `\n${text}` : ""}`
    );
  }

  return (await res.json()) as T;
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active -= 1;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

type Mode = "auto" | "report-only" | "remediate" | "re_extract";

function normalizeMode(raw: string | undefined): Mode {
  const v = (raw ?? "auto").toLowerCase();
  if (v === "auto") return "auto";
  if (v === "report-only" || v === "report" || v === "dry") return "report-only";
  if (v === "remediate" || v === "remediation") return "remediate";
  if (v === "re_extract" || v === "re-extract" || v === "reextract") return "re_extract";
  return "auto";
}

async function main() {
  const baseUrl = process.env.API_BASE_URL || "http://localhost:9000";
  const concurrency = Math.max(1, envInt("CONCURRENCY", 4));
  const limitDeals = envInt("LIMIT", 0);
  const dryRun = envFlag("DRY_RUN", false);
  const wait = envFlag("WAIT", false);
  const pollIntervalMs = Math.max(250, envInt("POLL_INTERVAL_MS", 2000));
  const timeoutMs = Math.max(1000, envInt("TIMEOUT_MS", 45 * 60 * 1000));

  const includeWarnings = envFlag("INCLUDE_WARNINGS", false);
  const thresholdLow = envFloat("THRESHOLD_LOW");
  const mode = normalizeMode(process.env.MODE);

  if (typeof fetch !== "function") {
    throw new Error("Global fetch() is not available. Use Node 18+.");
  }

  const base = new URL(baseUrl);
  const dealsUrl = new URL("/api/v1/deals", base);

  const deals = await fetchJson<DealListItem[]>(dealsUrl);
  const selectedDeals = limitDeals > 0 ? deals.slice(0, limitDeals) : deals;

  console.log(`Found ${deals.length} current deals (deleted_at IS NULL).`);
  if (limitDeals > 0) {
    console.log(`LIMIT is set; processing ${selectedDeals.length} deals.`);
  }
  console.log(`API_BASE_URL=${base.toString().replace(/\/$/, "")}`);
  console.log(
    `MODE=${mode} CONCURRENCY=${concurrency} DRY_RUN=${dryRun} WAIT=${wait} INCLUDE_WARNINGS=${includeWarnings}` +
      (thresholdLow != null ? ` THRESHOLD_LOW=${thresholdLow}` : "")
  );

  const limit = createLimiter(concurrency);

  const startedAt = Date.now();

  const results: Array<{
    deal_id: string;
    deal_name?: string;
    report_action?: RecommendedAction;
    effective_action?: RecommendedAction | "report-only";
    job_id?: string;
    ok: boolean;
    skipped?: boolean;
    error?: string;
    reason?: string;
  }> = [];

  await Promise.all(
    selectedDeals.map((deal) =>
      limit(async () => {
        if (!deal.id) {
          results.push({ deal_id: "", deal_name: deal.name, ok: false, error: "Missing deal id" });
          return;
        }

        try {
          const reportUrl = new URL(
            `/api/v1/deals/${encodeURIComponent(deal.id)}/documents/extraction-report`,
            base
          );
          const report = await fetchJson<ExtractionReportResponse>(reportUrl);

          const recommended = report?.extraction_report?.recommended_action;
          const reason = report?.extraction_report?.recommendation_reason;

          let effective: RecommendedAction | "report-only" = recommended;
          if (mode === "report-only") {
            effective = "report-only";
          } else if (mode === "remediate") {
            effective = "remediate";
          } else if (mode === "re_extract") {
            effective = "re_extract";
          }

          if (effective === "report-only") {
            results.push({
              deal_id: deal.id,
              deal_name: deal.name,
              report_action: recommended,
              effective_action: effective,
              ok: true,
              skipped: true,
              reason,
            });
            return;
          }

          if (effective === "proceed" || effective === "wait") {
            results.push({
              deal_id: deal.id,
              deal_name: deal.name,
              report_action: recommended,
              effective_action: effective,
              ok: true,
              skipped: true,
              reason,
            });
            return;
          }

          if (dryRun) {
            results.push({
              deal_id: deal.id,
              deal_name: deal.name,
              report_action: recommended,
              effective_action: effective,
              job_id: "(dry-run)",
              ok: true,
              reason,
            });
            return;
          }

          if (effective === "remediate") {
            const url = new URL(`/api/v1/deals/${encodeURIComponent(deal.id)}/remediate-extraction`, base);
            const resp = await fetchJson<RemediateResponse>(url, {
              method: "POST",
              body: JSON.stringify({ include_warnings: includeWarnings }),
            });
            results.push({
              deal_id: deal.id,
              deal_name: deal.name,
              report_action: recommended,
              effective_action: effective,
              job_id: resp.job_id,
              ok: true,
              reason,
            });
            return;
          }

          if (effective === "re_extract") {
            const url = new URL(`/api/v1/deals/${encodeURIComponent(deal.id)}/documents/re-extract`, base);
            const payload: { include_warnings?: boolean; threshold_low?: number } = {
              include_warnings: includeWarnings,
            };
            if (typeof thresholdLow === "number") payload.threshold_low = thresholdLow;

            const resp = await fetchJson<ReextractResponse>(url, {
              method: "POST",
              body: JSON.stringify(payload),
            });
            results.push({
              deal_id: deal.id,
              deal_name: deal.name,
              report_action: recommended,
              effective_action: effective,
              job_id: resp.job_id,
              ok: true,
              reason,
            });
            return;
          }

          results.push({
            deal_id: deal.id,
            deal_name: deal.name,
            report_action: recommended,
            effective_action: effective,
            ok: false,
            error: `Unknown effective action: ${String(effective)}`,
            reason,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({
            deal_id: deal.id,
            deal_name: deal.name,
            ok: false,
            error: message,
          });
        }
      })
    )
  );

  const elapsed = Date.now() - startedAt;

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const enqueued = results.filter((r) => r.ok && r.job_id && r.job_id !== "(dry-run)");

  const byAction = (action: string) => results.filter((r) => r.effective_action === (action as any)).length;

  console.log(
    `Processed ${results.length} deals in ${formatDuration(elapsed)}: ok=${okCount} failed=${failCount} enqueued=${enqueued.length}`
  );
  console.log(
    `Actions: remediate=${byAction("remediate")} re_extract=${byAction("re_extract")} proceed=${byAction("proceed")} wait=${byAction("wait")} report-only=${byAction("report-only")}`
  );

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const r of failures) {
      console.log(`- deal_id=${r.deal_id} name=${r.deal_name ?? ""} error=${r.error ?? "unknown"}`);
    }
  }

  const jobIds = enqueued.map((r) => r.job_id).filter((x): x is string => Boolean(x));
  if (!wait || dryRun || jobIds.length === 0) {
    console.log("Done.");
    return;
  }

  console.log(
    `Waiting on ${jobIds.length} jobs (poll every ${pollIntervalMs}ms, timeout ${formatDuration(timeoutMs)})...`
  );

  const terminalStates = new Set(["succeeded", "failed", "cancelled"]);
  const waitLimit = createLimiter(Math.min(concurrency, 8));

  const waitResults: Array<{ job_id: string; status: string; message?: string }> = [];

  await Promise.all(
    jobIds.map((jobId) =>
      waitLimit(async () => {
        const jobUrl = new URL(`/api/v1/jobs/${encodeURIComponent(jobId)}`, base);
        const waitStartedAt = Date.now();

        while (true) {
          const waited = Date.now() - waitStartedAt;
          if (waited > timeoutMs) {
            waitResults.push({ job_id: jobId, status: "timeout", message: `Timed out after ${formatDuration(waited)}` });
            return;
          }

          let job: JobStatusResponse;
          try {
            job = await fetchJson<JobStatusResponse>(jobUrl);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            waitResults.push({ job_id: jobId, status: "error", message });
            return;
          }

          if (terminalStates.has(job.status)) {
            waitResults.push({ job_id: jobId, status: job.status, message: job.message });
            return;
          }

          await sleep(pollIntervalMs);
        }
      })
    )
  );

  const succeeded = waitResults.filter((r) => r.status === "succeeded").length;
  const failed = waitResults.filter((r) => r.status === "failed").length;
  const cancelled = waitResults.filter((r) => r.status === "cancelled").length;
  const timeouts = waitResults.filter((r) => r.status === "timeout").length;
  const errors = waitResults.filter((r) => r.status === "error").length;

  console.log(
    `Wait complete: succeeded=${succeeded} failed=${failed} cancelled=${cancelled} timeout=${timeouts} error=${errors}`
  );

  const bad = waitResults.filter((r) => r.status !== "succeeded");
  if (bad.length > 0) {
    console.log("Non-succeeded jobs:");
    for (const r of bad) {
      console.log(`- job_id=${r.job_id} status=${r.status}${r.message ? ` message=${r.message}` : ""}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
