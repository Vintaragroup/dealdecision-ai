export {};

type DealListItem = {
  id: string;
  name?: string;
};

type EnqueueResponse = {
  job_id: string;
  status: string;
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
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url.toString()}${text ? `\n${text}` : ""}`);
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

async function main() {
  const baseUrl = process.env.API_BASE_URL || "http://localhost:9000";
  const concurrency = Math.max(1, envInt("CONCURRENCY", 4));
  const limitDeals = envInt("LIMIT", 0);
  const dryRun = envFlag("DRY_RUN", false);
  const wait = envFlag("WAIT", false);
  const pollIntervalMs = Math.max(250, envInt("POLL_INTERVAL_MS", 2000));
  const timeoutMs = Math.max(1000, envInt("TIMEOUT_MS", 30 * 60 * 1000));

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
  console.log(`CONCURRENCY=${concurrency} DRY_RUN=${dryRun} WAIT=${wait}`);

  const limit = createLimiter(concurrency);

  const enqueueStartedAt = Date.now();
  const enqueued: Array<{ deal_id: string; deal_name?: string; job_id?: string; ok: boolean; error?: string }> = [];

  await Promise.all(
    selectedDeals.map((deal) =>
      limit(async () => {
        const dealName = deal.name;
        if (!deal.id) {
          enqueued.push({ deal_id: "", deal_name: dealName, ok: false, error: "Missing deal id" });
          return;
        }

        if (dryRun) {
          enqueued.push({ deal_id: deal.id, deal_name: dealName, ok: true, job_id: "(dry-run)" });
          return;
        }

        try {
          const analyzeUrl = new URL(`/api/v1/deals/${encodeURIComponent(deal.id)}/analyze`, base);
          const resp = await fetchJson<EnqueueResponse>(analyzeUrl, { method: "POST", body: "{}" });
          enqueued.push({ deal_id: deal.id, deal_name: dealName, ok: true, job_id: resp.job_id });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          enqueued.push({ deal_id: deal.id, deal_name: dealName, ok: false, error: message });
        }
      })
    )
  );

  const enqueueElapsed = Date.now() - enqueueStartedAt;

  const okCount = enqueued.filter((r) => r.ok).length;
  const failCount = enqueued.length - okCount;

  console.log(`Enqueue complete in ${formatDuration(enqueueElapsed)}: ok=${okCount} failed=${failCount}`);

  if (failCount > 0) {
    console.log("Failures:");
    for (const r of enqueued.filter((x) => !x.ok)) {
      console.log(`- deal_id=${r.deal_id} name=${r.deal_name ?? ""} error=${r.error ?? "unknown"}`);
    }
  }

  const jobIds = enqueued
    .map((r) => r.job_id)
    .filter((id): id is string => Boolean(id && id !== "(dry-run)"));

  if (!wait || dryRun || jobIds.length === 0) {
    console.log("Done.");
    return;
  }

  console.log(`Waiting on ${jobIds.length} jobs (poll every ${pollIntervalMs}ms, timeout ${formatDuration(timeoutMs)})...`);

  const terminalStates = new Set(["succeeded", "failed", "cancelled"]);
  const waitStartedAt = Date.now();

  const waitLimit = createLimiter(Math.min(concurrency, 8));

  const results: Array<{ job_id: string; status: string; message?: string }> = [];

  await Promise.all(
    jobIds.map((jobId) =>
      waitLimit(async () => {
        const jobUrl = new URL(`/api/v1/jobs/${encodeURIComponent(jobId)}`, base);
        const startedAt = Date.now();
        while (true) {
          const elapsed = Date.now() - startedAt;
          if (elapsed > timeoutMs) {
            results.push({ job_id: jobId, status: "timeout", message: `Timed out after ${formatDuration(elapsed)}` });
            return;
          }

          let job: JobStatusResponse;
          try {
            job = await fetchJson<JobStatusResponse>(jobUrl);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ job_id: jobId, status: "error", message });
            return;
          }

          if (terminalStates.has(job.status)) {
            results.push({ job_id: jobId, status: job.status, message: job.message });
            return;
          }

          await sleep(pollIntervalMs);
        }
      })
    )
  );

  const waitElapsed = Date.now() - waitStartedAt;
  const succeeded = results.filter((r) => r.status === "succeeded").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const cancelled = results.filter((r) => r.status === "cancelled").length;
  const timeouts = results.filter((r) => r.status === "timeout").length;
  const errors = results.filter((r) => r.status === "error").length;

  console.log(`Wait complete in ${formatDuration(waitElapsed)}: succeeded=${succeeded} failed=${failed} cancelled=${cancelled} timeout=${timeouts} error=${errors}`);

  const bad = results.filter((r) => r.status !== "succeeded");
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
