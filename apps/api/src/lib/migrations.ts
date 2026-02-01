import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

export type MigrationStatus = {
  migrationsDir: string;
  files: string[];
  applied: string[];
  pending: string[];
  latestApplied: string | null;
};

function resolveMigrationsDir(): string {
  const envDir = process.env.MIGRATIONS_DIR;
  if (typeof envDir === "string" && envDir.trim()) {
    const p = envDir.trim();
    if (fs.existsSync(p)) return p;
  }

  const candidates = [
    // Render (recommended): the repo is mounted at /app
    "/app/infra/migrations",
    path.resolve(process.cwd(), "infra/migrations"),
    // dist/src/lib -> ../../../.. -> repo root
    path.resolve(__dirname, "../../../../infra/migrations"),
    // src/lib -> ../../../ -> repo root
    path.resolve(__dirname, "../../../infra/migrations"),
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }

  throw new Error("Unable to locate infra/migrations. Set MIGRATIONS_DIR.");
}

async function ensureMigrationsTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM migrations ORDER BY id ASC");
  return rows.map((r) => r.name);
}

function listMigrationFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function applyMigration(pool: Pool, name: string, sql: string) {
  await pool.query("BEGIN");
  try {
    await pool.query(sql);
    await pool.query("INSERT INTO migrations (name) VALUES ($1)", [name]);
    await pool.query("COMMIT");
  } catch (err) {
    try {
      await pool.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function getMigrationStatus(pool: Pool): Promise<MigrationStatus> {
  const migrationsDir = resolveMigrationsDir();
  const files = listMigrationFiles(migrationsDir);

  await ensureMigrationsTable(pool);
  const applied = await getAppliedMigrations(pool);
  const appliedSet = new Set(applied);
  const pending = files.filter((f) => !appliedSet.has(f));

  return {
    migrationsDir,
    files,
    applied,
    pending,
    latestApplied: applied.length > 0 ? applied[applied.length - 1] : null,
  };
}

export async function applyPendingMigrations(pool: Pool): Promise<MigrationStatus> {
  const status = await getMigrationStatus(pool);
  for (const file of status.pending) {
    const fullPath = path.join(status.migrationsDir, file);
    const sql = fs.readFileSync(fullPath, "utf8");
    await applyMigration(pool, file, sql);
  }
  return await getMigrationStatus(pool);
}
