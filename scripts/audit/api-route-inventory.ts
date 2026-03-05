/**
 * scripts/audit/api-route-inventory.ts
 *
 * Static inventory generator for the `apps/api` Fastify route surface.
 *
 * Approach: Careful regex scanning (TypeScript AST via ts-morph is not a
 * workspace dependency; this script uses Node built-ins only and can be run
 * with `tsx` without installing additional packages).
 *
 * Limitations documented here so readers understand confidence level:
 *   - Routes registered via sub-plugin `fastify.register()` patterns would be
 *     missed (none currently exist in this codebase).
 *   - Handler names are extracted on a best-effort basis; most handlers are
 *     anonymous arrow functions and will show as "inline".
 *   - DB table / queue dependency scanning is a keyword heuristic; it may
 *     produce false positives or miss dynamic queries.
 *
 * Run:
 *   pnpm audit:api-routes            # generate + write files
 *   pnpm audit:api-routes:update     # alias for same
 *
 * Output:
 *   docs/audits/api-route-inventory.json
 *   docs/audits/api-route-inventory-YYYY-MM-DD.md   (today's date)
 */

import fs from "fs";
import path from "path";

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "../..");
const API_ROUTES_DIR = path.join(REPO_ROOT, "apps/api/src/routes");
const API_INDEX = path.join(REPO_ROOT, "apps/api/src/index.ts");
const OUT_DIR = path.join(REPO_ROOT, "docs/audits");

// Route files that are actually imported in apps/api/src/index.ts (registration
// order preserved — it matters for Fastify route resolution).
const REGISTERED_FILES: readonly string[] = [
  "health.ts",
  "deals.ts",
  "jobs.ts",
  "events.ts",
  "documents.ts",
  "orchestration.ts",
  "reports.ts",
  "dashboard.ts",
  "chat.ts",
  "evidence.ts",
  "analytics.ts",
  "admin.ts",
  "visual-assets.ts",
  "node-ai-analyze.ts",
  "understanding.ts",
  "export-pdf.ts",
  "financial-facts.ts",
  "pages.ts",
  "deal-facts.ts",
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RouteEntry {
  /** HTTP verb in uppercase */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Full path as declared in source (e.g. "/api/v1/deals/:deal_id") */
  path: string;
  /** Workspace-relative source file */
  source_file: string;
  /** 1-based line number of the route declaration */
  source_line: number;
  /** "inline" for anonymous handlers; function name otherwise */
  handler: string;
  /**
   * Applied auth layers.
   * - "clerk_auth"   — Clerk JWT checked via the global preHandler hook
   * - "admin_token"  — ADMIN_TOKEN header/env check via requireAdminAuth
   * - "public"       — no auth required
   * - "dashboard"    — internal dev dashboard; no Clerk auth, no public guarantee
   */
  auth: string[];
  /** Human-readable notes on this route */
  notes: string;
  /** Best-effort: DB tables touched by handler body (keyword scan) */
  db_tables: string[];
  /** Best-effort: queue names referenced by handler body */
  queues: string[];
}

export interface RouteInventory {
  generated_at: string;
  schema_version: "1";
  framework: "fastify";
  auth_plugin: string;
  registration_order: string[];
  unregistered_route_files: string[];
  total_routes: number;
  routes: RouteEntry[];
}

// ── Auth logic (mirrors apps/api/src/plugins/clerk-auth.ts) ──────────────────

function isPublicPath(urlPath: string): boolean {
  return (
    urlPath === "/" ||
    urlPath.startsWith("/healthz") ||
    urlPath.startsWith("/docs") ||
    urlPath === "/api/v1/health" ||
    urlPath.startsWith("/api/v1/health") ||
    urlPath === "/health" ||
    urlPath.startsWith("/health/")
  );
}

function resolveAuth(routePath: string): string[] {
  if (isPublicPath(routePath)) return ["public"];
  if (routePath.startsWith("/api/v1/admin/")) return ["clerk_auth", "admin_token"];
  if (routePath.startsWith("/api/v1/")) return ["clerk_auth"];
  if (routePath.startsWith("/api/dashboard")) return ["dashboard"];
  // /visual-assets/*, /health (no prefix), etc.
  return ["public"];
}

// ── DB / queue dependency extraction (best-effort) ───────────────────────────

const TABLE_PATTERNS = [
  /\bFROM\s+([a-z_][a-z_0-9]*)\b/gi,
  /\bINTO\s+([a-z_][a-z_0-9]*)\b/gi,
  /\bUPDATE\s+([a-z_][a-z_0-9]*)\b/gi,
  /\bJOIN\s+([a-z_][a-z_0-9]*)\b/gi,
];

const QUEUE_PATTERN = /(?:QUEUE_NAMES\.|["'`])([a-z_][a-z_0-9]*)(?:["'`])/g;

const KNOWN_TABLES = new Set([
  "deals", "documents", "jobs", "visual_assets", "evidence", "deal_facts",
  "financial_facts", "document_page_understanding", "deal_fact_registry",
  "financial_fact_registry", "page_registry", "document_intelligence_jobs",
  "dio_storage", "analytics_events", "feature_flags", "reports", "pages",
  "pipeline_runs",
]);

const KNOWN_QUEUES = new Set([
  "ingest_documents", "extract_visuals", "render_document_pages",
  "populate_document_page_understanding", "analyze_deal",
  "export_report_pdf", "investor_insights",
  "document_intelligence_extract", "fetch_evidence",
]);

function extractDepsFromBody(body: string): { tables: string[]; queues: string[] } {
  const tables = new Set<string>();
  const queues = new Set<string>();

  for (const pattern of TABLE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(body)) !== null) {
      const t = m[1]!.toLowerCase();
      if (KNOWN_TABLES.has(t)) tables.add(t);
    }
  }

  QUEUE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QUEUE_PATTERN.exec(body)) !== null) {
    const q = m[1]!.toLowerCase();
    if (KNOWN_QUEUES.has(q)) queues.add(q);
  }

  return {
    tables: [...tables].sort(),
    queues: [...queues].sort(),
  };
}

// ── Route extraction ──────────────────────────────────────────────────────────

// Matches: app.get("path"  OR  app.get<Type...>("path"  (handles generics)
const ROUTE_DECL_RE = /\bapp\.(get|post|put|patch|delete)(?:<[^>]*>)?\s*\(/gi;

function extractHandlerName(afterPath: string): string {
  // afterPath is the text after the closing quote of the path,
  // which could be:
  //   , async (request, reply) => {      → inline
  //   , { schema: ... }, handlerFn)      → handlerFn
  //   , handlerFn)                        → handlerFn
  //   , myFn                              → myFn
  const trimmed = afterPath.trimStart().replace(/^,\s*/, "");
  // If it starts with { or async or function keyword → inline
  if (/^[\{]/.test(trimmed)) return "inline";
  if (/^async\b/.test(trimmed)) return "inline";
  if (/^function\b/.test(trimmed)) return "inline";
  // Otherwise try to grab identifier
  const identM = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed);
  if (identM) return identM[1]!;
  return "inline";
}

function scanRouteFile(
  absolutePath: string,
  relPath: string
): RouteEntry[] {
  const src = fs.readFileSync(absolutePath, "utf8");
  const lines = src.split("\n");
  const entries: RouteEntry[] = [];

  ROUTE_DECL_RE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = ROUTE_DECL_RE.exec(src)) !== null) {
    const method = m[1]!.toUpperCase() as RouteEntry["method"];
    const matchStart = m.index;

    // Compute 1-based line number
    const textBefore = src.slice(0, matchStart);
    const lineNum = textBefore.split("\n").length;

    // Find the opening paren of the route call
    const parenIdx = src.indexOf("(", matchStart + m[0].length - 1);
    if (parenIdx === -1) continue;

    // Scan ahead up to 5 lines to find the path string
    const scanWindow = src.slice(parenIdx, parenIdx + 400);
    const pathM = /"(\/[^"]*)"/.exec(scanWindow) || /'(\/[^']*)'\s*/.exec(scanWindow);
    if (!pathM) continue;

    const routePath = pathM[1]!;

    // Extract handler name from text following path
    const afterPathIdx = parenIdx + pathM.index! + pathM[0].length;
    const handlerHint = src.slice(afterPathIdx, afterPathIdx + 200);
    const handler = extractHandlerName(handlerHint);

    // Rough body extraction: find the function body up to ~8000 chars
    const bodyStart = parenIdx;
    const bodySnippet = src.slice(bodyStart, bodyStart + 8000);

    const deps = extractDepsFromBody(bodySnippet);
    const auth = resolveAuth(routePath);

    entries.push({
      method,
      path: routePath,
      source_file: relPath,
      source_line: lineNum,
      handler,
      auth,
      notes: buildNotes(routePath, method, relPath),
      db_tables: deps.tables,
      queues: deps.queues,
    });
  }

  return entries;
}

function buildNotes(routePath: string, method: string, sourceFile: string): string {
  const notes: string[] = [];

  if (routePath.startsWith("/api/v1/admin/")) notes.push("admin-only");
  if (routePath.startsWith("/api/dashboard")) notes.push("dev-dashboard-internal");
  if (routePath.startsWith("/visual-assets/")) notes.push("no-clerk-auth-warning");
  if (routePath.startsWith("/api/v1/debug/")) notes.push("debug-endpoint");
  if (routePath.includes("/events")) notes.push("SSE");
  if (routePath.includes("/export-pdf") || routePath.includes("/report/export")) notes.push("async-export");
  if (routePath.includes("/investor-insights")) notes.push("investor-insights");
  if (routePath.includes("/readiness")) notes.push("polling-endpoint");
  if (routePath.includes("/jobs")) notes.push("job-status");

  return notes.join(", ");
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function generateInventory(): RouteInventory {
  const allRouteFiles = fs
    .readdirSync(API_ROUTES_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort();

  const registeredSet = new Set(REGISTERED_FILES);
  const unregistered = allRouteFiles.filter((f) => !registeredSet.has(f));

  const allRoutes: RouteEntry[] = [];

  // Process in registration order (matters for Fastify route resolution)
  for (const fname of REGISTERED_FILES) {
    const absPath = path.join(API_ROUTES_DIR, fname);
    if (!fs.existsSync(absPath)) {
      console.warn(`[api-route-inventory] Missing registered file: ${fname}`);
      continue;
    }
    const relPath = path.relative(REPO_ROOT, absPath);
    const entries = scanRouteFile(absPath, relPath);
    allRoutes.push(...entries);
  }

  // Sort for stable JSON: by path then method
  const sorted = [...allRoutes].sort((a, b) => {
    const pa = a.path.toLowerCase();
    const pb = b.path.toLowerCase();
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.method < b.method ? -1 : 1;
  });

  return {
    generated_at: new Date().toISOString(),
    schema_version: "1",
    framework: "fastify",
    auth_plugin:
      "Clerk JWT preHandler hook (apps/api/src/plugins/clerk-auth.ts); protects all /api/v1/* except /api/v1/health*",
    registration_order: REGISTERED_FILES.slice(),
    unregistered_route_files: unregistered,
    total_routes: sorted.length,
    routes: sorted,
  };
}

// ── Markdown generation ───────────────────────────────────────────────────────

function fmtSource(entry: RouteEntry): string {
  return `${entry.source_file}:${entry.source_line}`;
}

function fmtAuth(entry: RouteEntry): string {
  return entry.auth.join(", ");
}

function generateMarkdown(inv: RouteInventory, date: string): string {
  const lines: string[] = [];

  lines.push(`# API Route Inventory — ${date}`);
  lines.push(``);
  lines.push(`> **Generated:** ${inv.generated_at}  `);
  lines.push(`> **Approach:** Regex scan of \`apps/api/src/routes/\` — behavior-preserving, no AST  `);
  lines.push(`> **Framework:** Fastify  `);
  lines.push(`> **Auth plugin:** ${inv.auth_plugin}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total registered routes | **${inv.total_routes}** |`);
  lines.push(`| Route files registered | ${inv.registration_order.length} |`);
  lines.push(`| Unregistered (dead) route files | ${inv.unregistered_route_files.length} |`);
  lines.push(`| Clerk-authenticated routes | ${inv.routes.filter(r => r.auth.includes("clerk_auth")).length} |`);
  lines.push(`| Public / unauthenticated routes | ${inv.routes.filter(r => r.auth.includes("public")).length} |`);
  lines.push(`| Admin-token-required routes | ${inv.routes.filter(r => r.auth.includes("admin_token")).length} |`);
  lines.push(`| Dashboard (internal, no Clerk) | ${inv.routes.filter(r => r.auth.includes("dashboard")).length} |`);
  lines.push(``);

  if (inv.unregistered_route_files.length > 0) {
    lines.push(`## ⚠️  Unregistered (Dead) Route Files`);
    lines.push(``);
    lines.push(`These files exist in \`routes/\` but are **NOT imported** in \`apps/api/src/index.ts\`.`);
    lines.push(`Their routes are never served. They should either be registered or removed.`);
    lines.push(``);
    for (const f of inv.unregistered_route_files) {
      lines.push(`- \`apps/api/src/routes/${f}\``);
    }
    lines.push(``);
  }

  // A) Master route table
  lines.push(`## A) Master Route Table`);
  lines.push(``);
  lines.push(`| # | Method | Path | Source | Handler | Auth | Notes |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  inv.routes.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | \`${r.method}\` | \`${r.path}\` | [\`${fmtSource(r)}\`](/${fmtSource(r)}) | ${r.handler} | ${fmtAuth(r)} | ${r.notes} |`
    );
  });
  lines.push(``);

  // B) Grouped by domain
  lines.push(`## B) Routes Grouped by Domain`);
  lines.push(``);

  const groups: Array<{ title: string; filter: (r: RouteEntry) => boolean }> = [
    {
      title: "Deal Core (CRUD)",
      filter: (r) =>
        ["/api/v1/deals", "/api/v1/deals/:deal_id"].some((p) => r.path === p) ||
        (r.path.includes("/deals") &&
          !r.path.includes("/analysis") &&
          !r.path.includes("/investor-insights") &&
          !r.path.includes("/extract-visuals") &&
          !r.path.includes("/deep-scan") &&
          !r.path.includes("/remediate") &&
          !r.path.includes("/prepare") &&
          !r.path.includes("/analyze") &&
          !r.path.includes("/readiness") &&
          !r.path.includes("/segments") &&
          !r.path.includes("/lineage") &&
          !r.path.includes("/scoring") &&
          !r.path.includes("/auto-") &&
          !r.path.includes("/jobs") &&
          !r.path.includes("/documents") &&
          !r.path.includes("/evidence") &&
          !r.path.includes("/visual-assets") &&
          !r.path.includes("/governed") &&
          !r.path.includes("/orchestrator") &&
          !r.path.includes("/diagnostics") &&
          !r.path.includes("/deal-facts") &&
          !r.path.includes("/financial-facts") &&
          !r.path.includes("/pages") &&
          !r.path.includes("/understanding") &&
          !r.path.includes("/debug") &&
          !r.path.includes("/recalculate")),
    },
    {
      title: "Deal Ingestion & Document Management",
      filter: (r) =>
        r.path.includes("/documents") ||
        r.path.includes("/extract-visuals") ||
        r.path.includes("/deep-scan") ||
        r.path.includes("/remediate-extraction") ||
        r.path.includes("/prepare") ||
        r.path.includes("/render") ||
        r.path.includes("/pages") ||
        r.path.includes("/visual-assets"),
    },
    {
      title: "Deal Analysis",
      filter: (r) =>
        r.path.includes("/analysis/") ||
        r.path.includes("/analyze") ||
        r.path.includes("/readiness") ||
        r.path.includes("/segments") ||
        r.path.includes("/lineage") ||
        r.path.includes("/scoring-input") ||
        r.path.includes("/analysis-diagnostics") ||
        r.path.includes("/understanding") ||
        r.path.startsWith("/api/v1/analysis/"),
    },
    {
      title: "Investor Insights",
      filter: (r) =>
        r.path.includes("/investor-insights") ||
        r.path.includes("/orchestrator-report") ||
        r.path.includes("/governed-llm-overview"),
    },
    {
      title: "Reporting & Export",
      filter: (r) =>
        r.path.includes("/report") ||
        r.path.includes("/report_diagnostics") ||
        r.path.includes("/export-pdf"),
    },
    {
      title: "Orchestration",
      filter: (r) => r.path.startsWith("/api/v1/orchestration"),
    },
    {
      title: "Evidence & Facts",
      filter: (r) =>
        r.path.includes("/evidence") ||
        r.path.includes("/deal-facts") ||
        r.path.includes("/financial-facts"),
    },
    {
      title: "Jobs & Events",
      filter: (r) =>
        (r.path.includes("/jobs") && !r.path.includes("/documents")) ||
        r.path.includes("/events"),
    },
    {
      title: "Chat & AI",
      filter: (r) => r.path.includes("/chat") || r.path.includes("/ai-analyze"),
    },
    {
      title: "Analytics (LLM Metrics)",
      filter: (r) => r.path.startsWith("/api/v1/analytics"),
    },
    {
      title: "Admin & Health",
      filter: (r) =>
        r.path.startsWith("/api/v1/admin") ||
        r.path.startsWith("/api/v1/system") ||
        r.path.startsWith("/api/v1/health") ||
        r.path === "/" ||
        r.path === "/health" ||
        r.path === "/healthz",
    },
    {
      title: "Dashboard (Internal Dev Tool)",
      filter: (r) => r.path.startsWith("/api/dashboard"),
    },
    {
      title: "Debug Endpoints",
      filter: (r) => r.path.includes("/debug/") || r.path.includes("/scoring-input") || r.path.includes("/diagnostics"),
    },
  ];

  const assigned = new Set<string>();

  for (const group of groups) {
    const groupRoutes = inv.routes.filter(
      (r) => group.filter(r) && !assigned.has(`${r.method}:${r.path}`)
    );
    if (groupRoutes.length === 0) continue;

    groupRoutes.forEach((r) => assigned.add(`${r.method}:${r.path}`));

    lines.push(`### ${group.title} (${groupRoutes.length} routes)`);
    lines.push(``);
    lines.push(`| Method | Path | Source |`);
    lines.push(`|---|---|---|`);
    for (const r of groupRoutes) {
      lines.push(`| \`${r.method}\` | \`${r.path}\` | [\`${fmtSource(r)}\`](/${fmtSource(r)}) |`);
    }
    lines.push(``);
  }

  // Unassigned routes
  const unassigned = inv.routes.filter((r) => !assigned.has(`${r.method}:${r.path}`));
  if (unassigned.length > 0) {
    lines.push(`### Uncategorized (${unassigned.length} routes)`);
    lines.push(``);
    lines.push(`| Method | Path | Source |`);
    lines.push(`|---|---|---|`);
    for (const r of unassigned) {
      lines.push(`| \`${r.method}\` | \`${r.path}\` | [\`${fmtSource(r)}\`](/${fmtSource(r)}) |`);
    }
    lines.push(``);
  }

  // C) Status-sensitive endpoints
  lines.push(`## C) Status-Sensitive / Polling Endpoints`);
  lines.push(``);
  lines.push(`These endpoints are used by the frontend for real-time status, polling, and report fetching.`);
  lines.push(``);

  const statusEndpoints = [
    {
      path: "/api/v1/deals/:deal_id/readiness",
      method: "GET",
      description: "Deal readiness signal — polled by frontend before analysis. Returns { is_ready, block_reason?, pending_jobs }.",
    },
    {
      path: "/api/v1/deals/:deal_id/jobs",
      method: "GET",
      description: "List jobs for a deal — used to show job status in UI pipeline view.",
    },
    {
      path: "/api/v1/jobs/:job_id",
      method: "GET",
      description: "Single job status lookup — polled for active job progress.",
    },
    {
      path: "/api/v1/deals/:deal_id/investor-insights",
      method: "GET",
      description: "Get investor insights for a deal, includes status_summary for gate display.",
    },
    {
      path: "/api/v1/deals/:deal_id/report",
      method: "GET",
      description: "Fetch decision report (latest version).",
    },
    {
      path: "/api/v1/deals/:deal_id/report/:version",
      method: "GET",
      description: "Fetch versioned decision report.",
    },
    {
      path: "/api/v1/deals/:deal_id/report/export-pdf/:export_id",
      method: "GET",
      description: "Poll async PDF export status + retrieve download URL.",
    },
    {
      path: "/api/v1/events",
      method: "GET",
      description: "Server-Sent Events (SSE) stream — real-time job progress events. Requires Clerk auth.",
    },
    {
      path: "/api/v1/deals/:deal_id/analysis-diagnostics",
      method: "GET",
      description: "Phase 1 analysis diagnostics — used by developer dashboard to inspect DIO state.",
    },
  ];

  lines.push(`| Method | Path | Usage |`);
  lines.push(`|---|---|---|`);
  for (const ep of statusEndpoints) {
    lines.push(`| \`${ep.method}\` | \`${ep.path}\` | ${ep.description} |`);
  }
  lines.push(``);

  // D) Breaking-change risk map
  lines.push(`## D) Breaking-Change Risk Map`);
  lines.push(``);

  const risks = [
    {
      group: "deals.ts (11 000+ lines)",
      risks: [
        "Largest file — contains 36 routes across 6+ logical domains.",
        "Many routes share helper imports: `getPool`, `getAuth`, `enqueuePersistedJob`, `updateJobProgress`, `sanitizeText`.",
        "Routes reference deep lib modules: `lib/visual-extraction`, `lib/job-progress`, `lib/document-intelligence-batch`, `lib/pipeline-run-ledger`.",
        "POST /api/v1/deals and POST /api/v1/deals/draft share deal creation logic — splitting incorrectly could diverge behavior.",
        "`recalculate-priority` and `batch/recalculate-priorities` share priority scoring logic.",
        "Investor-insights routes (generate/regenerate/GET) share a runtime state machine — must stay in same module or share transactional lock.",
      ],
    },
    {
      group: "documents.ts",
      risks: [
        "18 routes — tightly coupled to the ingest pipeline.",
        "`POST /upload` and `POST /documents` both create DB rows and enqueue jobs — must not split without shared transaction handling.",
        "`POST /re-extract` and `POST /reconcile-ingest` call into worker queues — queue name constants must stay synchronized.",
      ],
    },
    {
      group: "/api/v1/events (events.ts)",
      risks: [
        "SSE route is auth-sensitive: bearer token is often stripped by proxies. Has special diagnostic logging in clerk-auth plugin — do not move without updating isProtectedPath().",
      ],
    },
    {
      group: "visual-assets.ts",
      risks: [
        "Routes mounted under /visual-assets/:id — NOT under /api/v1/ — bypasses Clerk auth. If moved under /api/v1/ the auth behavior changes.",
        "Three routes share a single file; low complexity.",
      ],
    },
    {
      group: "dashboard.ts (9 650+ lines)",
      risks: [
        "All routes under /api/dashboard — NOT covered by Clerk auth.",
        "GET /api/dashboard/deals/:deal_id/summary calls into deterministic scoring in-process — heavy computation.",
        "dashboard.ts reads directly from DB pool (passed as arg to registerDashboardRoutes).",
      ],
    },
    {
      group: "orchestration.ts",
      risks: [
        "9 routes wrapping the DIO (Deal Intelligence Object) storage layer.",
        "Tightly coupled to `lib/orchestration` and `lib/dio-storage` — verify those imports if reorganizing.",
      ],
    },
    {
      group: "admin.ts",
      risks: [
        "ADMIN_TOKEN check is applied via app.addHook() scoped to /api/v1/admin/* paths.",
        "GET /api/v1/system/env-check is in admin.ts but does NOT have admin_token protection (only Clerk auth).",
      ],
    },
  ];

  for (const r of risks) {
    lines.push(`### ${r.group}`);
    lines.push(``);
    for (const bullet of r.risks) {
      lines.push(`- ${bullet}`);
    }
    lines.push(``);
  }

  // E) PR12 split plan
  lines.push(`## E) PR12 Split Plan Seed`);
  lines.push(``);
  lines.push(`> **DO NOT IMPLEMENT in this PR.** This is a seed for PR12 planning.`);
  lines.push(``);
  lines.push(`Proposed module split of \`apps/api/src/routes/deals.ts\`:`);
  lines.push(``);

  const splitPlan = [
    {
      module: "deal-core.routes.ts",
      routes: [
        "POST /api/v1/deals",
        "POST /api/v1/deals/draft",
        "POST /api/v1/deals/claim",
        "POST /api/v1/deals/merge",
        "GET  /api/v1/deals",
        "GET  /api/v1/deals/:deal_id",
        "PUT  /api/v1/deals/:deal_id",
        "PATCH /api/v1/deals/:deal_id/llm-phase",
        "DELETE /api/v1/deals/:deal_id",
        "POST /api/v1/deals/:deal_id/auto-profile",
        "POST /api/v1/deals/:deal_id/confirm-profile",
        "POST /api/v1/deals/:deal_id/recalculate-priority",
        "POST /api/v1/deals/batch/recalculate-priorities",
        "POST /api/v1/deals/:deal_id/auto-progress",
      ],
    },
    {
      module: "deal-ingestion.routes.ts",
      routes: [
        "GET  /api/v1/deals/:deal_id/readiness",
        "POST /api/v1/deals/:deal_id/prepare",
        "POST /api/v1/deals/:deal_id/extract-visuals",
        "POST /api/v1/deals/:deal_id/deep-scan-visuals",
        "POST /api/v1/deals/:deal_id/remediate-extraction",
        "GET  /api/v1/deals/:deal_id/visual-assets",
        // documents.ts remains separate (already separate file)
      ],
    },
    {
      module: "deal-analysis.routes.ts",
      routes: [
        "POST /api/v1/deals/:deal_id/analyze",
        "POST /api/v1/deals/:deal_id/analysis/deal-terms",
        "POST /api/v1/deals/:deal_id/analysis/market",
        "POST /api/v1/deals/:deal_id/analysis/financial-analysis",
        "POST /api/v1/deals/:deal_id/analysis/risk-verification",
        "GET  /api/v1/deals/:deal_id/analysis-diagnostics",
        "GET  /api/v1/deals/:deal_id/governed-llm-overview",
        "GET  /api/v1/deals/:deal_id/lineage",
        "GET  /api/v1/deals/:deal_id/scoring-input",
        "GET  /api/v1/deals/:deal_id/segments/features",
        "POST /api/v1/deals/:deal_id/segments/promote",
        "GET  /api/v1/debug/deals/:dealId/phaseb",
      ],
    },
    {
      module: "investor-insights.routes.ts",
      routes: [
        "POST /api/v1/deals/:deal_id/investor-insights/generate",
        "POST /api/v1/deals/:deal_id/investor-insights/regenerate",
        "GET  /api/v1/deals/:deal_id/investor-insights",
        "GET  /api/v1/deals/:deal_id/orchestrator-report",
      ],
    },
    {
      module: "_shared/services/ (helpers to extract)",
      routes: [
        "Deal auth helper (request.auth?.userId checks)",
        "enqueuePersistedJob wrappers",
        "Priority calculator (shared by recalculate-priority routes)",
        "Type guards for deal status transitions",
      ],
    },
  ];

  for (const plan of splitPlan) {
    lines.push(`### \`${plan.module}\``);
    lines.push(``);
    for (const r of plan.routes) {
      lines.push(`- ${r}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Report generated by \`scripts/audit/api-route-inventory.ts\`. Re-run with \`pnpm audit:api-routes\`.*`);

  return lines.join("\n");
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  const inv = generateInventory();

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // Write stable JSON
  const jsonPath = path.join(OUT_DIR, "api-route-inventory.json");
  fs.writeFileSync(jsonPath, JSON.stringify(inv, null, 2) + "\n");
  console.log(`[api-route-inventory] Wrote ${jsonPath}`);

  // Write dated markdown
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  }); // YYYY-MM-DD
  const mdPath = path.join(OUT_DIR, `api-route-inventory-${today}.md`);
  const md = generateMarkdown(inv, today);
  fs.writeFileSync(mdPath, md + "\n");
  console.log(`[api-route-inventory] Wrote ${mdPath}`);

  console.log(`[api-route-inventory] Total routes: ${inv.total_routes}`);
  console.log(
    `[api-route-inventory] Unregistered files: ${inv.unregistered_route_files.join(", ") || "(none)"}`
  );
}
