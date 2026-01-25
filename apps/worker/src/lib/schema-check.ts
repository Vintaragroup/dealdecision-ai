export type DbFingerprint = {
  db: string | null;
  ip: string | null;
  port: number | null;
};

type PoolLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "evidence", column: "confidence" },
  { table: "jobs", column: "payload" },
  { table: "documents", column: "extraction_metadata" },
];

let cachedOk: boolean | null = null;

export async function assertSchema(input: {
  pool?: PoolLike;
  fingerprint: DbFingerprint;
}): Promise<void> {
  if (cachedOk === true) return;

  const pool: PoolLike =
    input.pool ??
    // Lazily import DB to avoid DATABASE_URL requirement in unit tests that inject a mock pool.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ((require("./db") as { getPool: () => any }).getPool() as PoolLike);

  const tableNames = Array.from(new Set(REQUIRED_COLUMNS.map((r) => r.table)));
  const columnNames = Array.from(new Set(REQUIRED_COLUMNS.map((r) => r.column)));

  const res = await pool.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
        AND column_name = ANY($2::text[]);`,
    [tableNames, columnNames]
  );

  const present = new Set<string>();
  for (const row of res.rows ?? []) {
    const t = typeof row?.table_name === "string" ? row.table_name : null;
    const c = typeof row?.column_name === "string" ? row.column_name : null;
    if (t && c) present.add(`${t}.${c}`);
  }

  const missing = REQUIRED_COLUMNS.map((r) => `${r.table}.${r.column}`).filter((k) => !present.has(k));

  if (missing.length > 0) {
    cachedOk = false;
    const err = new Error("schema_check_failed");
    (err as any).missing = missing;
    (err as any).fingerprint = input.fingerprint;
    throw err;
  }

  cachedOk = true;
}
