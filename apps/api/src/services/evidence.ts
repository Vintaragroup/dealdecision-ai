import { randomUUID } from "crypto";
import { sanitizeText } from "@dealdecision/core";
import { getPool } from "../lib/db";

type EvidenceInsertShape = {
  hasDocumentId: boolean;
  hasConfidence: boolean;
  idColumn: "id" | "evidence_id" | null;
};

let cachedEvidenceInsertShape: EvidenceInsertShape | null = null;

async function getEvidenceInsertShape(): Promise<EvidenceInsertShape> {
  if (cachedEvidenceInsertShape) return cachedEvidenceInsertShape;
  const pool = getPool();
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'evidence'`
  );
  const cols = new Set(rows.map((r) => r.column_name));
  const idColumn = cols.has("id") ? "id" : cols.has("evidence_id") ? "evidence_id" : null;
  cachedEvidenceInsertShape = {
    hasDocumentId: cols.has("document_id"),
    hasConfidence: cols.has("confidence"),
    idColumn,
  };
  return cachedEvidenceInsertShape;
}

export async function insertEvidence(params: {
  deal_id: string;
  document_id?: string | null;
  source: string;
  kind: string;
  text: string;
  confidence?: number;
}) {
  const pool = getPool();

  const shape = await getEvidenceInsertShape();
  const cols: string[] = [];
  const values: any[] = [];

  if (shape.idColumn) {
    cols.push(shape.idColumn);
    values.push(randomUUID());
  }

  cols.push("deal_id");
  values.push(sanitizeText(params.deal_id));

  if (shape.hasDocumentId) {
    cols.push("document_id");
    values.push(params.document_id ? sanitizeText(params.document_id) : null);
  }

  cols.push("source", "kind", "text");
  values.push(sanitizeText(params.source), sanitizeText(params.kind), sanitizeText(params.text));

  if (shape.hasConfidence) {
    cols.push("confidence");
    values.push(params.confidence ?? 0.5);
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  await pool.query(`INSERT INTO evidence (${cols.join(", ")}) VALUES (${placeholders})`, values);
}
