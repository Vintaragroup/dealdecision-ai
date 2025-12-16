import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { getPool, closePool } from "../src/lib/db";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function ensureMigrationsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const pool = getPool();
  const { rows } = await pool.query<{ name: string }>(
    "SELECT name FROM migrations ORDER BY id ASC"
  );
  return new Set(rows.map((r) => r.name));
}

async function applyMigration(name: string, sql: string) {
  const pool = getPool();
  await pool.query("BEGIN");
  try {
    await pool.query(sql);
    await pool.query("INSERT INTO migrations (name) VALUES ($1)", [name]);
    await pool.query("COMMIT");
    console.log(`Applied migration: ${name}`);
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error(`Failed migration: ${name}`);
    throw err;
  }
}

async function main() {
  const migrationsDir = path.resolve(__dirname, "../../../infra/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping already applied migration: ${file}`);
      continue;
    }
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, "utf8");
    await applyMigration(file, sql);
  }

  console.log("Migrations complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
