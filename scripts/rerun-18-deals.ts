import { Pool } from "pg";
import { runDealAnalysis } from "../packages/core/src/orchestration/factory";

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const analysisVersionArg = getArg("--analysis-version");
  if (analysisVersionArg) {
    process.env.DIO_ANALYSIS_ENGINE_VERSION = analysisVersionArg;
  }

  const expectedCount = Number(getArg("--expect") ?? "18");
  const limit = Number(getArg("--limit") ?? String(expectedCount));

  const pool = new Pool({ connectionString: databaseUrl });

  const startedAt = new Date();

  const { rows: deals } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name
       FROM deals
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC`
  );

  if (expectedCount > 0 && deals.length !== expectedCount) {
    console.warn(
      `[rerun-18-deals] Warning: expected ${expectedCount} deals, found ${deals.length} (continuing with limit=${limit}).`
    );
  }

  const targets = deals.slice(0, limit);
  console.log(
    `[rerun-18-deals] Running analysis for ${targets.length} deal(s). DIO_ANALYSIS_ENGINE_VERSION=${
      process.env.DIO_ANALYSIS_ENGINE_VERSION ?? "(default 1.0.0)"
    }`
  );

  let ok = 0;
  let failed = 0;
  let duplicates = 0;

  for (const deal of targets) {
    console.log(`\n[rerun-18-deals] deal=${deal.id} name=${deal.name}`);

    if (hasFlag("--dry-run")) {
      console.log("[rerun-18-deals] dry-run: skipping");
      continue;
    }

    const result = await runDealAnalysis(deal.id);

    if (!result.success) {
      failed += 1;
      console.log(`[rerun-18-deals] FAILED: ${result.error ?? "unknown error"}`);
      continue;
    }

    ok += 1;
    const storage = result.storage_result as
      | { version?: number; is_duplicate?: boolean; dio_id?: string }
      | undefined;
    if (storage?.is_duplicate) {
      duplicates += 1;
    }

    console.log(
      `[rerun-18-deals] OK dio_id=${storage?.dio_id ?? result.dio?.dio_id ?? ""} version=${
        storage?.version ?? "?"
      } duplicate=${storage?.is_duplicate ?? false}`
    );
  }

  // Verify how many DIO rows were created since start
  try {
    const { rows } = await pool.query<{ created: number }>(
      `SELECT COUNT(*)::int AS created
         FROM deal_intelligence_objects
        WHERE created_at >= $1::timestamptz`,
      [startedAt.toISOString()]
    );
    console.log(`\n[rerun-18-deals] Summary: ok=${ok} failed=${failed} duplicates=${duplicates}`);
    console.log(`[rerun-18-deals] deal_intelligence_objects created since start: ${rows[0]?.created ?? 0}`);
  } catch (err) {
    console.warn(
      `\n[rerun-18-deals] Summary: ok=${ok} failed=${failed} duplicates=${duplicates}`
    );
    console.warn(`[rerun-18-deals] Could not query deal_intelligence_objects: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await pool.end();
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[rerun-18-deals] Fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
});
