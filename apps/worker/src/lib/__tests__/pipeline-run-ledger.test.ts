import { describe, it, expect } from "vitest";

import { wrapProcessorWithRunLedger } from "../pipeline-run-ledger";

describe("pipeline run ledger", () => {
	it("inserts step ledger rows and updates on success", async () => {
		const queries: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				queries.push(String(sql));
				return { rows: [], rowCount: 1 };
			},
		};

		const processor = async (_job: any) => ({ ok: true, n: 1 });
		const wrapped = wrapProcessorWithRunLedger(pool, processor as any);

		await wrapped({ id: "job1", name: "analyze_deal", data: { deal_id: "11111111-1111-1111-1111-111111111111" } } as any);

		expect(queries.some((q) => q.includes("INSERT INTO pipeline_runs"))).toBe(true);
		expect(queries.some((q) => q.includes("INSERT INTO pipeline_step_runs"))).toBe(true);
		expect(queries.some((q) => q.includes("UPDATE pipeline_step_runs"))).toBe(true);
	});

	it("updates ledger on failure and rethrows", async () => {
		const queries: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				queries.push(String(sql));
				return { rows: [], rowCount: 1 };
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
});
