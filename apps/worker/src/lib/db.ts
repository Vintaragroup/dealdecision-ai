import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for worker DB access");
}

let pool: Pool | null = null;

export function getPool() {
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

export async function updateDocumentStatus(documentId: string, status: string) {
  const currentPool = getPool();
  await currentPool.query(
    `UPDATE documents
     SET status = $2,
         updated_at = now()
     WHERE document_id = $1`,
    [documentId, status]
  );
}

export async function insertEvidence(params: {
  deal_id: string;
  document_id?: string | null;
  source: string;
  kind: string;
  text: string;
  confidence?: number;
}) {
  const currentPool = getPool();
  await currentPool.query(
    `INSERT INTO evidence (deal_id, document_id, source, kind, text, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.deal_id,
      params.document_id ?? null,
      params.source,
      params.kind,
      params.text,
      params.confidence ?? 0.5,
    ]
  );
}

export type DocumentRow = {
  document_id: string;
  deal_id: string;
  title: string;
  type: string;
  status: string;
  uploaded_at: string;
  updated_at: string;
};

export async function getDocumentsForDeal(dealId: string): Promise<DocumentRow[]> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<DocumentRow>(
    `SELECT document_id, deal_id, title, type, status, uploaded_at, updated_at
       FROM documents
       WHERE deal_id = $1
       ORDER BY uploaded_at DESC
       LIMIT 100`,
    [dealId]
  );
  return rows;
}

export async function getEvidenceDocumentIds(dealId: string): Promise<Set<string>> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<{ document_id: string | null }>(
    `SELECT document_id
       FROM evidence
       WHERE deal_id = $1
         AND document_id IS NOT NULL
         AND source = 'fetch_evidence'`,
    [dealId]
  );
  return new Set(rows.map((row) => row.document_id as string));
}
