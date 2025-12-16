import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for database operations");
  }
  if (!pool) {
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
