import { getPool } from "../lib/db";

import type { Pool } from "pg";
import type { UnderstandingPatch, UnderstandingVersion } from "./types";

export interface PersistedUnderstandingPatchRecord {
  id: string;
  deal_id: string;
  analysis_version: UnderstandingVersion;
  input_hash: string;
  created_at: string;
  patch: UnderstandingPatch;
}

export interface PersistUnderstandingPatchDeps {
  pool?: Pool;
}

function rowToRecord(row: any): PersistedUnderstandingPatchRecord {
  const patch: UnderstandingPatch =
    typeof row.patch_json === "string" ? (JSON.parse(row.patch_json) as UnderstandingPatch) : (row.patch_json as UnderstandingPatch);
  return {
    id: String(row.id),
    deal_id: String(row.deal_id),
    analysis_version: row.analysis_version as UnderstandingVersion,
    input_hash: String(row.input_hash),
    created_at: new Date(row.created_at).toISOString(),
    patch,
  };
}

export async function persistUnderstandingPatch(
  patch: UnderstandingPatch,
  deps: PersistUnderstandingPatchDeps = {}
): Promise<PersistedUnderstandingPatchRecord> {
  const pool = deps.pool ?? getPool();

  const insert = await pool.query(
    `
    INSERT INTO understanding_patches (deal_id, analysis_version, input_hash, created_at, patch_json)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    ON CONFLICT (deal_id, analysis_version, input_hash) DO NOTHING
    RETURNING id, deal_id, analysis_version, input_hash, created_at, patch_json
    `,
    [patch.deal_id, patch.analysis_version, patch.input_hash, patch.created_at, JSON.stringify(patch)]
  );

  if (insert.rows?.length) {
    return rowToRecord(insert.rows[0]);
  }

  const existing = await pool.query(
    `
    SELECT id, deal_id, analysis_version, input_hash, created_at, patch_json
    FROM understanding_patches
    WHERE deal_id = $1 AND analysis_version = $2 AND input_hash = $3
    ORDER BY id DESC
    LIMIT 1
    `,
    [patch.deal_id, patch.analysis_version, patch.input_hash]
  );

  if (!existing.rows?.length) {
    // Should not happen if unique constraint exists, but keep a deterministic error.
    throw new Error("Failed to persist understanding patch (conflict but missing row)");
  }

  return rowToRecord(existing.rows[0]);
}

export async function getLatestUnderstandingPatch(
  dealId: string,
  analysisVersion: UnderstandingVersion,
  deps: PersistUnderstandingPatchDeps = {}
): Promise<PersistedUnderstandingPatchRecord | null> {
  const pool = deps.pool ?? getPool();

  const res = await pool.query(
    `
    SELECT id, deal_id, analysis_version, input_hash, created_at, patch_json
    FROM understanding_patches
    WHERE deal_id = $1 AND analysis_version = $2
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [dealId, analysisVersion]
  );

  if (!res.rows?.length) return null;
  return rowToRecord(res.rows[0]);
}
