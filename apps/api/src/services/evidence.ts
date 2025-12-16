import { randomUUID } from "crypto";
import { getPool } from "../lib/db";

export async function insertEvidence(params: {
  deal_id: string;
  document_id?: string | null;
  source: string;
  kind: string;
  text: string;
  excerpt?: string | null;
}) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO evidence (evidence_id, deal_id, document_id, source, kind, text, excerpt)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      params.deal_id,
      params.document_id ?? null,
      params.source,
      params.kind,
      params.text,
      params.excerpt ?? null,
    ]
  );
}
