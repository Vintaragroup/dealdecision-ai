import type { Pool } from "pg";
import type { Job, Processor } from "bullmq";
import { createHash } from "crypto";

function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

function stableUuid(seed: string): string {
	const hex = sha256Hex(seed).slice(0, 32);
	const a = hex.slice(0, 8);
	const b = hex.slice(8, 12);
	const c = `4${hex.slice(13, 16)}`;
	const dNibble = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
	const d = `${dNibble}${hex.slice(17, 20)}`;
	const e = hex.slice(20, 32);
	return `${a}-${b}-${c}-${d}-${e}`;
}

function stableJsonStringify(value: unknown): string {
	const seen = new WeakSet<object>();

	const normalize = (v: any): any => {
		if (v === null) return null;
		if (v === undefined) return { __type: "undefined" };
		if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
		if (typeof v === "bigint") return { __type: "bigint", value: v.toString() };
		if (typeof v === "string" || typeof v === "boolean") return v;
		if (v instanceof Date) return { __type: "date", value: v.toISOString() };
		if (Array.isArray(v)) return v.map(normalize);
		if (v instanceof Set) return { __type: "set", value: Array.from(v).map(normalize) };
		if (v instanceof Map) {
			const entries = Array.from(v.entries()).map(([k, val]) => [normalize(k), normalize(val)]);
			entries.sort((a, b) => {
				const ak = JSON.stringify(a[0]);
				const bk = JSON.stringify(b[0]);
				return ak < bk ? -1 : ak > bk ? 1 : 0;
			});
			return { __type: "map", value: entries };
		}

		if (typeof v === "object") {
			if (seen.has(v)) return { __type: "circular" };
			seen.add(v);
			const out: Record<string, any> = {};
			for (const key of Object.keys(v).sort()) {
				out[key] = normalize(v[key]);
			}
			return out;
		}

		return { __type: typeof v, value: String(v) };
	};

	return JSON.stringify(normalize(value));
}

export type StepLedgerIds = {
	run_id: string;
	step_run_id: string;
};

let ledgerUpdatedAtTriggerShape: { runs: boolean; steps: boolean } | null = null;

async function getLedgerUpdatedAtTriggerShape(pool: Pool): Promise<{ runs: boolean; steps: boolean }> {
	if (ledgerUpdatedAtTriggerShape) return ledgerUpdatedAtTriggerShape;
	try {
		const res = await pool.query<{ tgname: string }>(
			`SELECT tgname
			   FROM pg_trigger
			  WHERE tgname IN ('trg_pipeline_runs_set_updated_at','trg_pipeline_step_runs_set_updated_at')
			    AND NOT tgisinternal`
		);
		const names = new Set((res.rows ?? []).map((r) => String((r as any).tgname ?? "")));
		ledgerUpdatedAtTriggerShape = {
			runs: names.has("trg_pipeline_runs_set_updated_at"),
			steps: names.has("trg_pipeline_step_runs_set_updated_at"),
		};
		return ledgerUpdatedAtTriggerShape;
	} catch {
		ledgerUpdatedAtTriggerShape = { runs: false, steps: false };
		return ledgerUpdatedAtTriggerShape;
	}
}

function isMissingTableError(err: any): boolean {
	const code = String(err?.code ?? "");
	// 42P01 = undefined_table
	return code === "42P01";
}

export function computeInputHash(job: Pick<Job, "name" | "data">): string {
	return sha256Hex(stableJsonStringify({ name: job.name, data: job.data }));
}

export function computeOutputHash(output: unknown): string {
	return sha256Hex(stableJsonStringify(output));
}

export async function startStepRunLedger(
	pool: Pool,
	job: Pick<Job, "id" | "name" | "data">,
	dealId: string | null | undefined
): Promise<StepLedgerIds | null> {
	const run_id = stableUuid(`pipeline-run:${job.name}:${String(job.id ?? "")}`);
	const step_run_id = stableUuid(`pipeline-step-run:${job.name}:${String(job.id ?? "")}`);
	const input_hash = computeInputHash(job as any);
	const triggerShape = await getLedgerUpdatedAtTriggerShape(pool);

	try {
		await pool.query(
			`INSERT INTO pipeline_runs (run_id, deal_id, trigger_type, trigger_job_id, input_hash, status)
			 VALUES ($1, $2, 'bullmq', $3, $4, 'running')
			 ON CONFLICT (run_id) DO UPDATE SET
				status = 'running',
				input_hash = EXCLUDED.input_hash${triggerShape.runs ? "" : ",\n\t\t\t\tupdated_at = now()"}`,
			[run_id, dealId, String(job.id ?? null), input_hash]
		);

		await pool.query(
			`INSERT INTO pipeline_step_runs (step_run_id, run_id, step_name, job_id, input_hash, status)
			 VALUES ($1, $2, $3, $4, $5, 'running')
			 ON CONFLICT (step_run_id) DO UPDATE SET
				status = 'running',
				input_hash = EXCLUDED.input_hash${triggerShape.steps ? "" : ",\n\t\t\t\tupdated_at = now()"}`,
			[step_run_id, run_id, job.name, String(job.id ?? null), input_hash]
		);

		return { run_id, step_run_id };
	} catch (err: any) {
		if (isMissingTableError(err)) return null;
		// Fail open; ledger should never block work.
		return null;
	}
}

export async function finishStepRunLedger(
	pool: Pool,
	ids: StepLedgerIds,
	status: "succeeded" | "failed",
	payload: { output?: unknown; summary?: any; error?: any }
): Promise<void> {
	try {
		const output_hash = payload.output === undefined ? null : computeOutputHash(payload.output);
		const triggerShape = await getLedgerUpdatedAtTriggerShape(pool);
		await pool.query(
			`UPDATE pipeline_step_runs
			 SET status = $3,
				 output_hash = $4,
				 summary = COALESCE($5::jsonb, '{}'::jsonb),
				 error = $6::jsonb,
				 finished_at = now()${triggerShape.steps ? "" : ",\n\t\t\t\t updated_at = now()"}
			 WHERE step_run_id = $1 AND run_id = $2`,
			[
				ids.step_run_id,
				ids.run_id,
				status,
				output_hash,
				payload.summary ? JSON.stringify(payload.summary) : "{}",
				payload.error ? JSON.stringify(payload.error) : null,
			]
		);

		await pool.query(
			`UPDATE pipeline_runs
			 SET status = CASE WHEN $2 = 'failed' THEN 'failed' ELSE status END,
				 finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE finished_at END${triggerShape.runs ? "" : ",\n\t\t\t\t updated_at = now()"}
			 WHERE run_id = $1`,
			[ids.run_id, status]
		);
	} catch (err: any) {
		if (isMissingTableError(err)) return;
		return;
	}
}

export function extractDealIdFromJob(job: Pick<Job, "data">): string | null {
	const d: any = job.data as any;
	const dealId = d?.deal_id ?? d?.dealId ?? d?.deal?.id ?? null;
	return typeof dealId === "string" ? dealId : null;
}

export function wrapProcessorWithRunLedger<T>(pool: Pool, processor: (job: Job<T>) => Promise<any>) {
	return async (job: Job<T>) => {
		const dealId = extractDealIdFromJob(job);
		const ids = await startStepRunLedger(pool, job as any, dealId);

		try {
			const output = await processor(job);
			if (ids) await finishStepRunLedger(pool, ids, "succeeded", { output, summary: { ok: true } });
			return output;
		} catch (err: any) {
			if (ids) await finishStepRunLedger(pool, ids, "failed", { error: { message: err?.message ?? String(err) } });
			throw err;
		}
	};
}

export function wrapBullmqProcessorWithRunLedger(
	getPool: () => Pool,
	processor: Processor<any, any, string>
): Processor<any, any, string> {
	return async (job, token) => {
		let pool: Pool | null = null;
		try {
			pool = getPool();
		} catch {
			pool = null;
		}

		if (!pool) return await processor(job, token);

		const dealId = extractDealIdFromJob(job);
		const ids = await startStepRunLedger(pool, job as any, dealId);
		if (ids) {
			try {
				// Attach provenance for downstream code (best-effort, in-memory only).
				(job.data as any).__pipeline_ledger = ids;
			} catch {
				// ignore
			}
		}
		try {
			const output = await processor(job, token);
			if (ids) await finishStepRunLedger(pool, ids, "succeeded", { output, summary: { ok: true } });
			return output;
		} catch (err: any) {
			if (ids)
				await finishStepRunLedger(pool, ids, "failed", {
					error: { message: err?.message ?? String(err) },
				});
			throw err;
		}
	};
}
