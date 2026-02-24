import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { getPool, closePool } from "../src/lib/db";
import { applyPendingMigrations, getMigrationStatus } from "../src/lib/migrations";

// Load env from monorepo root; fallback to app-local .env if present
const rootEnvPath = path.resolve(__dirname, "../../../.env");
const appEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: fs.existsSync(rootEnvPath) ? rootEnvPath : appEnvPath });

async function main() {
  const pool = getPool();
  const before = await getMigrationStatus(pool);
  if (before.files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  for (const file of before.pending) {
    console.log(`Applying migration: ${file}`);
  }

  const after = await applyPendingMigrations(pool);
  console.log(`Migrations complete. applied=${after.applied.length} pending=${after.pending.length}`);

  // Post-migration verification: confirm investor_insight_reports table exists.
  // This ensures the 2026-02-23-001 migration (and any idempotent follow-ups) were applied.
  const { rows: regclassRows } = await pool.query<{ oid: string | null }>(
    "SELECT to_regclass('public.investor_insight_reports') AS oid"
  );
  if (!regclassRows[0]?.oid) {
    throw new Error(
      "investor_insight_reports migration not applied. " +
      "Ensure 2026-02-23-001-add-investor-insight-reports.sql is present in infra/migrations and re-run migrate."
    );
  }
  console.log("Verification passed: investor_insight_reports table exists.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
