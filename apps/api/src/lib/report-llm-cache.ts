import type { Pool } from 'pg';

export type ReportLlmCacheKey = {
  deal_id: string;
  llm_phase_mode: string;
  inputs_hash: string;
  excerpt_hash: string;
  call: string;
  model: string;
  prompt_version: string;
};

export type ReportLlmCacheRow = {
  output_json: unknown;
  meta_json: unknown | null;
  error_json: unknown | null;
  created_at: string;
};

export async function getReportLlmCache(pool: Pool, key: ReportLlmCacheKey): Promise<ReportLlmCacheRow | null> {
  const { rows } = await pool.query<{
    output_json: unknown;
    meta_json: unknown | null;
    error_json: unknown | null;
    created_at: string;
  }>(
    `SELECT output_json, meta_json, error_json, created_at
       FROM deal_report_llm_cache
      WHERE deal_id = $1::uuid
        AND llm_phase_mode = $2
        AND inputs_hash = $3
        AND excerpt_hash = $4
        AND call = $5
        AND model = $6
        AND prompt_version = $7
      ORDER BY created_at DESC
      LIMIT 1`,
    [
      key.deal_id,
      key.llm_phase_mode,
      key.inputs_hash,
      key.excerpt_hash,
      key.call,
      key.model,
      key.prompt_version,
    ]
  );

  const r = rows?.[0];
  if (!r) return null;
  return {
    output_json: r.output_json,
    meta_json: r.meta_json ?? null,
    error_json: r.error_json ?? null,
    created_at: r.created_at,
  };
}

export async function upsertReportLlmCache(
  pool: Pool,
  key: ReportLlmCacheKey,
  value: { output_json: unknown; meta_json?: unknown | null; error_json?: unknown | null }
): Promise<void> {
  await pool.query(
    `INSERT INTO deal_report_llm_cache (
        deal_id,
        llm_phase_mode,
        inputs_hash,
        excerpt_hash,
        call,
        model,
        prompt_version,
        output_json,
        meta_json,
        error_json
      )
      VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)
      ON CONFLICT (deal_id, llm_phase_mode, inputs_hash, excerpt_hash, call, model, prompt_version)
      DO UPDATE SET
        output_json = EXCLUDED.output_json,
        meta_json = EXCLUDED.meta_json,
        error_json = EXCLUDED.error_json,
        created_at = now()`,
    [
      key.deal_id,
      key.llm_phase_mode,
      key.inputs_hash,
      key.excerpt_hash,
      key.call,
      key.model,
      key.prompt_version,
      JSON.stringify(value.output_json ?? null),
      JSON.stringify(value.meta_json ?? null),
      JSON.stringify(value.error_json ?? null),
    ]
  );
}
