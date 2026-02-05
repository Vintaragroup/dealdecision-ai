import { describe, it, expect } from "vitest";

import { startNamedStepRunLedger, wrapProcessorWithRunLedger } from "../pipeline-run-ledger";

describe("pipeline run ledger", () => {
	it("inserts step ledger rows and updates on success", async () => {
		const queries: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				queries.push(String(sql));
				return { rows: [], rowCount: 1 };
			},
			connect: async () => {
				return {
					query: async (sql: string, _params?: any[]) => {
						queries.push(String(sql));
						const text = String(sql);
						if (text.includes("FROM pipeline_runs") && text.includes("FOR UPDATE")) {
							return { rows: [{ status: "running" }], rowCount: 1 };
						}
						if (text.includes("FROM pipeline_step_runs") && text.includes("COUNT(*)")) {
							return {
								rows: [
									{ total_steps: 1, nonterminal_steps: 0, failed_steps: 0, max_finished_at: new Date().toISOString() },
								],
								rowCount: 1,
							};
						}
						if (text.includes("FROM pipeline_step_runs") && text.includes("status = 'failed'")) {
							return { rows: [], rowCount: 0 };
						}
						return { rows: [], rowCount: 1 };
					},
					release: () => {},
				};
			},
		};

		const processor = async (_job: any) => ({ ok: true, n: 1 });
		const wrapped = wrapProcessorWithRunLedger(pool, processor as any);

		await wrapped({ id: "job1", name: "analyze_deal", data: { deal_id: "11111111-1111-1111-1111-111111111111" } } as any);

		expect(queries.some((q) => q.includes("INSERT INTO pipeline_runs"))).toBe(true);
		expect(queries.some((q) => q.includes("INSERT INTO pipeline_step_runs"))).toBe(true);
		expect(queries.some((q) => q.includes("UPDATE pipeline_step_runs"))).toBe(true);
		expect(queries.some((q) => q.includes("finalized_reason"))).toBe(true);
	});

	it("updates ledger on failure and rethrows", async () => {
		const queries: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				queries.push(String(sql));
				return { rows: [], rowCount: 1 };
			},
			connect: async () => {
				return {
					query: async (sql: string, _params?: any[]) => {
						queries.push(String(sql));
						// If finalize is attempted, pretend run is already failed.
						const text = String(sql);
						if (text.includes("FROM pipeline_runs") && text.includes("FOR UPDATE")) {
							return { rows: [{ status: "failed" }], rowCount: 1 };
						}
						return { rows: [], rowCount: 1 };
					},
					release: () => {},
				};
			},
		};

		const processor = async () => {
			throw new Error("boom");
		};
		const wrapped = wrapProcessorWithRunLedger(pool, processor as any);

		await expect(
			wrapped({ id: "job2", name: "extract_visuals", data: { deal_id: "11111111-1111-1111-1111-111111111111" } } as any)
		).rejects.toThrow("boom");

		expect(queries.some((q) => q.includes("UPDATE pipeline_step_runs"))).toBe(true);
	});

	it("does not finalize run while any step is blocked", async () => {
		const queries: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				queries.push(String(sql));
				return { rows: [], rowCount: 1 };
			},
			connect: async () => {
				return {
					query: async (sql: string, _params?: any[]) => {
						queries.push(String(sql));
						const text = String(sql);
						if (text.includes("FROM pipeline_runs") && text.includes("FOR UPDATE")) {
							return { rows: [{ status: "running" }], rowCount: 1 };
						}
						if (text.includes("FROM pipeline_step_runs") && text.includes("COUNT(*)")) {
							return {
								rows: [
									{ total_steps: 2, nonterminal_steps: 1, failed_steps: 0, max_finished_at: new Date().toISOString() },
								],
								rowCount: 1,
							};
						}
						return { rows: [], rowCount: 1 };
					},
					release: () => {},
				};
			},
		};

		const processor = async (_job: any) => ({ ok: true });
		const wrapped = wrapProcessorWithRunLedger(pool, processor as any);
		await wrapped({ id: "job3", name: "extract_visuals", data: { deal_id: "11111111-1111-1111-1111-111111111111" } } as any);

		// finalize helper should early-return; no UPDATE with finalized_reason should happen.
		expect(queries.some((q) => q.includes("finalized_reason"))).toBe(false);
	});

	it("can start an additional named step run", async () => {
		const queries: Array<{ sql: string; params: any[] | undefined }> = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				queries.push({ sql: String(sql), params });
				return { rows: [], rowCount: 1 };
			},
		};

		const ids = await startNamedStepRunLedger(pool, {
			run_id: "00000000-0000-0000-0000-000000000000",
			step_name: "document_intelligence_batch",
			job_id: "job-123",
			input: { deal_id: "11111111-1111-1111-1111-111111111111", document_ids: ["a", "b"] },
		});

		expect(ids?.run_id).toBe("00000000-0000-0000-0000-000000000000");
		expect(queries.some((q) => q.sql.includes("INSERT INTO pipeline_step_runs"))).toBe(true);
		const insert = queries.find((q) => q.sql.includes("INSERT INTO pipeline_step_runs"));
		expect(insert?.params?.includes("document_intelligence_batch")).toBe(true);
	});
});
