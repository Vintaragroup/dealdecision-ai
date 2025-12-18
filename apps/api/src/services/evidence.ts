import { randomUUID } from "crypto";
import { sanitizeText } from "@dealdecision/core";
import { getPool } from "../lib/db";

export async function insertEvidence(params: {
  deal_id: string;
  document_id?: string | null;
  source: string;
  kind: string;
  text: string;
  confidence?: number;
}) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO evidence (deal_id, document_id, source, kind, text, confidence)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sanitizeText(params.deal_id),
      params.document_id ? sanitizeText(params.document_id) : null,
      sanitizeText(params.source),
      sanitizeText(params.kind),
      sanitizeText(params.text),
      params.confidence ?? 0.5,
    ]
  );
}
