import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { getPool, closePool } from "../src/lib/db";

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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

// Load env from monorepo root; fallback to app-local .env if present
const rootEnvPath = path.resolve(__dirname, "../../../.env");
const appEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: fs.existsSync(rootEnvPath) ? rootEnvPath : appEnvPath });

async function main() {
  const pool = getPool();

  const outDir = path.resolve(__dirname, "../../../docs/dio-reports");
  const reportsDir = path.join(outDir, "reports");
  const manifestPath = path.join(outDir, "reports.json");

  fs.mkdirSync(reportsDir, { recursive: true });

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

    fs.writeFileSync(path.join(reportsDir, fileName), JSON.stringify(reportPayload, null, 2), "utf8");

    const title = analysisVersion ? `${row.name} — DIO v${analysisVersion}` : `${row.name} — (no DIO yet)`;

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

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`[export-dio-reports] Exported ${manifest.reports.length} deal report(s) to ${reportsDir}`);
  console.log(`[export-dio-reports] Updated manifest: ${manifestPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
