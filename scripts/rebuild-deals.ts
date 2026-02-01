export {};

/**
 * Rebuild Analyzer State
 *
 * End-to-end rebuild for deals:
 * - True re-extract from stored originals (skips verified+success unless --force)
 * - Verify documents
 * - Fetch evidence
 * - Analyze deal (Phase 1 + analyzers + Phase1 LLM synthesis)
 *
 * Usage:
 *   pnpm rebuild:deals -- --deal <uuid> [--deal <uuid> ...] [--force] [--no-wait] [--api-url <url>]
 *
 * Env:
 *   API_URL=http://localhost:3001
 *
 * Flags:
 *   --api-url <url>   Overrides API_URL (highest precedence)
 */

type DealRow = { id: string; name?: string | null };

type Args = {
  apiUrl: string;
  apiUrlSource: "flag" | "env" | "default";
  dealIds: string[];
  limit: number;
  concurrency: number;
  wait: boolean;
  pollIntervalMs: number;
  timeoutMs: number;
  force: boolean;
  dryRun: boolean;
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

function parseArgs(argv: string[]): Args {
  const dealIds: string[] = [];
  let limit = envInt("LIMIT", 0);
  let concurrency = Math.max(1, envInt("CONCURRENCY", 2));
  let wait = envFlag("WAIT", true);
  let pollIntervalMs = Math.max(250, envInt("POLL_INTERVAL_MS", 2000));
  let timeoutMs = Math.max(1000, envInt("TIMEOUT_MS", 60 * 60 * 1000));
  let force = envFlag("FORCE", false);
  let dryRun = envFlag("DRY_RUN", false);

  let apiUrlOverride: string | null = null;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--deal" || a === "--deal-id") {
      const v = argv[i + 1];
      if (!v) throw new Error(`${a} requires a value`);
      dealIds.push(v);
      i += 1;
      continue;
    }
    if (a === "--api-url") {
      const v = argv[i + 1];
      if (!v) throw new Error("--api-url requires a value");
      apiUrlOverride = v;
      i += 1;
      continue;
    }
    if (a === "--limit") {
      const v = argv[i + 1];
      if (!v) throw new Error("--limit requires a value");
      limit = Number(v);
      i += 1;
      continue;
    }
    if (a === "--concurrency") {
      const v = argv[i + 1];
      if (!v) throw new Error("--concurrency requires a value");
      concurrency = Math.max(1, Number(v));
      i += 1;
      continue;
    }
    if (a === "--wait") {
      wait = true;
      continue;
    }
    if (a === "--no-wait") {
      wait = false;
      continue;
    }
    if (a === "--force") {
      force = true;
      continue;
    }
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--poll-interval-ms") {
      const v = argv[i + 1];
      if (!v) throw new Error("--poll-interval-ms requires a value");
      pollIntervalMs = Math.max(250, Number(v));
      i += 1;
      continue;
    }
    if (a === "--timeout-ms") {
      const v = argv[i + 1];
      if (!v) throw new Error("--timeout-ms requires a value");
      timeoutMs = Math.max(1000, Number(v));
      i += 1;
      continue;
    }

    throw new Error(`Unknown arg: ${a}`);
  }

  const defaultApiUrl = "http://localhost:3001";
  const envApiUrl = process.env.API_URL;
  const apiUrlRaw = (apiUrlOverride ?? envApiUrl ?? defaultApiUrl);
  const apiUrlSource: Args["apiUrlSource"] = apiUrlOverride
    ? "flag"
    : envApiUrl
      ? "env"
      : "default";
  const apiUrl = apiUrlRaw.replace(/\/$/, "");

  return {
    apiUrl,
    apiUrlSource,
    dealIds,
    limit,
    concurrency,
    wait,
    pollIntervalMs,
    timeoutMs,
    force,
    dryRun,
  };
}

async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}${text ? `: ${text.slice(0, 400)}` : ""}`);
  }
  return (await res.json()) as T;
}

async function listDeals(apiUrl: string): Promise<DealRow[]> {
  const data = await httpJson<{ deals: DealRow[] }>(`${apiUrl}/api/v1/deals`);
  return Array.isArray(data?.deals) ? data.deals : [];
}

async function enqueueReextract(apiUrl: string, dealId: string, force: boolean): Promise<string> {
  const body = force
    ? { threshold_low: 2, include_warnings: true }
    : { threshold_low: 0.75, include_warnings: false };

  const res = await httpJson<{ ok: boolean; job_id: string }>(`${apiUrl}/api/v1/deals/${dealId}/documents/re-extract`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return String(res.job_id);
}

async function enqueueVerify(apiUrl: string, dealId: string): Promise<string> {
  const res = await httpJson<{ job_id: string; status: string }>(`${apiUrl}/api/v1/deals/${dealId}/documents/verify`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return String(res.job_id);
}

async function enqueueEvidenceFetch(apiUrl: string, dealId: string): Promise<string> {
  const res = await httpJson<{ job_id: string; status: string }>(`${apiUrl}/api/v1/evidence/fetch`, {
    method: "POST",
    body: JSON.stringify({ deal_id: dealId }),
  });
  return String(res.job_id);
}

async function enqueueAnalyze(apiUrl: string, dealId: string): Promise<string> {
  const res = await httpJson<{ job_id: string; status: string }>(`${apiUrl}/api/v1/deals/${dealId}/analyze`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return String(res.job_id);
}

async function getJob(apiUrl: string, jobId: string): Promise<{ status: string; progress_pct?: number; message?: string } | null> {
  try {
    return await httpJson<{ status: string; progress_pct?: number; message?: string }>(`${apiUrl}/api/v1/jobs/${jobId}`);
  } catch {
    return null;
  }
}

async function waitForJob(params: {
  apiUrl: string;
  jobId: string;
  pollIntervalMs: number;
  timeoutMs: number;
}): Promise<void> {
  const deadlineMs = Date.now() + Math.max(1000, params.timeoutMs);
  while (true) {
    const job = await getJob(params.apiUrl, params.jobId);
    const status = job?.status;
    if (status === "succeeded") return;
    if (status === "failed") {
      throw new Error(`Job failed: ${params.jobId}${job?.message ? ` (${job.message})` : ""}`);
    }
    if (Date.now() >= deadlineMs) {
      throw new Error(`Timeout waiting for job ${params.jobId}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, params.pollIntervalMs));
  }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<void>): Promise<void> {
  const q = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (q.length > 0) {
      const idx = items.length - q.length;
      const item = q.shift();
      if (item == null) return;
      await fn(item, idx);
    }
  });
  await Promise.all(workers);
}

async function rebuildOneDeal(args: Args, deal: DealRow): Promise<void> {
  const dealId = String(deal.id);
  const name = deal.name ? ` (${deal.name})` : "";

  const steps = ["re-extract", "verify", "evidence", "analyze"];
  console.log(`[rebuild] deal=${dealId}${name} steps=${steps.join("→")} force=${args.force} wait=${args.wait} dry=${args.dryRun}`);

  if (args.dryRun) return;

  const reextractJobId = await enqueueReextract(args.apiUrl, dealId, args.force);
  if (args.wait) await waitForJob({ apiUrl: args.apiUrl, jobId: reextractJobId, pollIntervalMs: args.pollIntervalMs, timeoutMs: args.timeoutMs });

  const verifyJobId = await enqueueVerify(args.apiUrl, dealId);
  if (args.wait) await waitForJob({ apiUrl: args.apiUrl, jobId: verifyJobId, pollIntervalMs: args.pollIntervalMs, timeoutMs: args.timeoutMs });

  const evidenceJobId = await enqueueEvidenceFetch(args.apiUrl, dealId);
  if (args.wait) await waitForJob({ apiUrl: args.apiUrl, jobId: evidenceJobId, pollIntervalMs: args.pollIntervalMs, timeoutMs: args.timeoutMs });

  const analyzeJobId = await enqueueAnalyze(args.apiUrl, dealId);
  if (args.wait) await waitForJob({ apiUrl: args.apiUrl, jobId: analyzeJobId, pollIntervalMs: args.pollIntervalMs, timeoutMs: args.timeoutMs });

  console.log(`[rebuild] deal=${dealId} ok`);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.apiUrlSource === "default") {
    console.warn(
      "[rebuild] WARNING: API_URL is not set; defaulting to http://localhost:3001. "
        + "If your API is exposed on a different port (e.g. Docker), set API_URL or pass --api-url."
    );
  }

  let deals: DealRow[];
  if (args.dealIds.length > 0) {
    deals = args.dealIds.map((id) => ({ id }));
  } else {
    deals = await listDeals(args.apiUrl);
    if (args.limit > 0) deals = deals.slice(0, args.limit);
  }

  if (deals.length === 0) {
    console.log("No deals selected");
    return;
  }

  console.log(`[rebuild] selected deals=${deals.length} api=${args.apiUrl} concurrency=${args.concurrency}`);

  const failures: Array<{ deal_id: string; error: string }> = [];
  await runWithConcurrency(deals, args.concurrency, async (deal) => {
    try {
      await rebuildOneDeal(args, deal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ deal_id: String(deal.id), error: message });
      console.error(`[rebuild] deal=${deal.id} failed: ${message}`);
    }
  });

  if (failures.length > 0) {
    console.error(`[rebuild] failures=${failures.length}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
