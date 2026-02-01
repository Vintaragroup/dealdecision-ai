import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Manifest = {
  generatedAt: string;
  reports: Array<{
    title: string;
    path: string;
    dealId: string;
    analysisVersion?: number;
    createdAt?: string;
    recommendation?: string;
    overallScore?: number;
    runCount?: number;
  }>;
};

function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in out)) out[key] = value;
  }
  return out;
}

async function loadEnvFallback(repoRoot: string) {
  if (process.env.DATABASE_URL) return;
  const candidates = [path.join(repoRoot, ".env"), path.join(repoRoot, "apps/api/.env")];
  for (const candidate of candidates) {
    try {
      const txt = await fs.readFile(candidate, "utf8");
      const parsed = parseDotenv(txt);
      if (!process.env.DATABASE_URL && parsed.DATABASE_URL) {
        process.env.DATABASE_URL = parsed.DATABASE_URL;
        return;
      }
    } catch {
      // ignore
    }
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..");

  await loadEnvFallback(repoRoot);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Set it in your shell or in .env / apps/api/.env before running export."
    );
  }

  // Lazy import so this script doesn’t require pg types at build-time.
  const { Pool } = (await import("pg")) as unknown as {
    Pool: new (opts: { connectionString: string }) => {
      query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
      end: () => Promise<void>;
    };
  };

  const pool = new Pool({ connectionString });

  const outDir = path.join(repoRoot, "docs/dio-reports");
  const reportsDir = path.join(outDir, "reports");
  const manifestPath = path.join(outDir, "reports.json");

  await fs.mkdir(reportsDir, { recursive: true });

  type Row = {
    id: string;
    name: string;
    stage: string;
    priority: string;
    trend: string | null;
    score: number | null;
    owner: string | null;
    created_at: string;
    updated_at: string;
    dio_id: string | null;
    analysis_version: number | null;
    dio_created_at: string | null;
    recommendation: string | null;
    overall_score: string | number | null;
    dio_data: any | null;
    run_count: number | null;
  };

  const { rows } = await pool.query<Row>(
    `SELECT d.id, d.name, d.stage, d.priority, d.trend, d.score, d.owner, d.created_at, d.updated_at,
            latest.dio_id,
            latest.analysis_version,
            latest.created_at as dio_created_at,
            latest.recommendation,
            latest.overall_score,
            latest.dio_data,
            stats.run_count
       FROM deals d
       LEFT JOIN LATERAL (
         SELECT dio_id, analysis_version, created_at, recommendation, overall_score, dio_data
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

  const nowIso = new Date().toISOString();
  const manifest: Manifest = { generatedAt: nowIso, reports: [] };

  for (const row of rows) {
    const analysisVersion = row.analysis_version ?? undefined;
    const safeName = slugify(row.name || row.id);
    const fileBase = analysisVersion ? `${safeName}_v${analysisVersion}` : `${safeName}_no_dio`;
    const fileName = `${fileBase}.json`;
    const relPath = `reports/${fileName}`;

    const overallScoreNum =
      typeof row.overall_score === "string" ? Number(row.overall_score) : row.overall_score ?? undefined;

    const reportPayload = {
      exportedAt: nowIso,
      deal: {
        id: row.id,
        name: row.name,
        stage: row.stage,
        priority: row.priority,
        trend: row.trend ?? undefined,
        score: row.score ?? undefined,
        owner: row.owner ?? undefined,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      },
      latestDio: row.dio_id
        ? {
            dioId: row.dio_id,
            analysisVersion: row.analysis_version,
            createdAt: row.dio_created_at ? new Date(row.dio_created_at).toISOString() : undefined,
            recommendation: row.recommendation ?? undefined,
            overallScore: Number.isFinite(overallScoreNum as number) ? overallScoreNum : undefined,
            dio: row.dio_data ?? undefined,
          }
        : null,
      dioRunCount: row.run_count ?? 0,
    };

    await fs.writeFile(path.join(reportsDir, fileName), JSON.stringify(reportPayload, null, 2), "utf8");

    const title = analysisVersion
      ? `${row.name} — DIO v${analysisVersion}`
      : `${row.name} — (no DIO yet)`;

    manifest.reports.push({
      title,
      path: relPath,
      dealId: row.id,
      analysisVersion,
      createdAt: row.dio_created_at ? new Date(row.dio_created_at).toISOString() : undefined,
      recommendation: row.recommendation ?? undefined,
      overallScore: Number.isFinite(overallScoreNum as number) ? overallScoreNum : undefined,
      runCount: row.run_count ?? 0,
    });
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await pool.end();

  console.log(`[export-dio-reports] Exported ${manifest.reports.length} deal report(s) to ${reportsDir}`);
  console.log(`[export-dio-reports] Updated manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
