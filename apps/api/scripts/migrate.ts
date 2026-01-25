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
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
