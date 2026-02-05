import { describe, it, expect } from "@jest/globals";
import { CanonicalEvidenceServiceImpl } from "../canonical-evidence";

describe("canonical evidence ingest (schema compatibility)", () => {
	it("includes run_id/step_run_id when columns exist and provenance provided", async () => {
		const longPara = "A".repeat(180);
		const insertSqls: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				const q = String(sql);

				if (q.includes("SELECT 1 FROM evidence_items")) return { rows: [], rowCount: 1 };

				if (q.includes("information_schema.columns") && q.includes("table_name = 'evidence_items'")) {
					return {
						rows: [{ column_name: "run_id" }, { column_name: "step_run_id" }],
						rowCount: 2,
					};
				}

				if (q.includes("FROM pg_trigger t") && q.includes("trg_evidence_items_set_updated_at")) {
					return { rows: [{ ok: 1 }], rowCount: 1 };
				}

				if (q.includes("FROM documents")) {
					return {
						rows: [
							{
								id: "11111111-1111-1111-1111-111111111111",
								deal_id: "22222222-2222-2222-2222-222222222222",
								title: "Doc",
								type: "pitch_deck",
								full_text: `${longPara}\n\n${longPara}`,
								uploaded_at: new Date().toISOString(),
							},
						],
						rowCount: 1,
					};
				}

				if (q.includes("FROM understanding_patches")) return { rows: [], rowCount: 0 };
				if (q.includes("FROM visual_assets")) return { rows: [], rowCount: 0 };

				if (q.includes("INSERT INTO evidence_items")) {
					insertSqls.push(q);
					return { rows: [{ inserted: true }], rowCount: 1 };
				}

				return { rows: [], rowCount: 0 };
			},
		};

		const service = new CanonicalEvidenceServiceImpl(pool);
		await service.ingestExistingArtifacts("22222222-2222-2222-2222-222222222222", {
			run_id: "33333333-3333-3333-3333-333333333333",
			step_run_id: "44444444-4444-4444-4444-444444444444",
			maxDocs: 1,
			maxDocChunks: 1,
		});

		expect(insertSqls.length).toBeGreaterThan(0);
		const sql = insertSqls[0];
		expect(sql).toContain("run_id");
		expect(sql).toContain("step_run_id");
		expect(sql).toContain("COALESCE(evidence_items.run_id, EXCLUDED.run_id)");
		expect(sql).toContain("COALESCE(evidence_items.step_run_id, EXCLUDED.step_run_id)");
		// With trigger present, we should not require app-level updated_at.
		expect(sql).not.toContain("updated_at = now()");
	});

	it("adds updated_at on conflict when trigger is absent", async () => {
		const longPara = "B".repeat(180);
		const insertSqls: string[] = [];
		const pool: any = {
			query: async (sql: string, _params?: any[]) => {
				const q = String(sql);

				if (q.includes("SELECT 1 FROM evidence_items")) return { rows: [], rowCount: 1 };

				if (q.includes("information_schema.columns") && q.includes("table_name = 'evidence_items'")) {
					return { rows: [], rowCount: 0 };
				}

				if (q.includes("FROM pg_trigger t") && q.includes("trg_evidence_items_set_updated_at")) {
					return { rows: [], rowCount: 0 };
				}

				if (q.includes("FROM documents")) {
					return {
						rows: [
							{
								id: "11111111-1111-1111-1111-111111111111",
								deal_id: "22222222-2222-2222-2222-222222222222",
								title: "Doc",
								type: "pitch_deck",
								full_text: `${longPara}\n\n${longPara}`,
								uploaded_at: new Date().toISOString(),
							},
						],
						rowCount: 1,
					};
				}

				if (q.includes("FROM understanding_patches")) return { rows: [], rowCount: 0 };
				if (q.includes("FROM visual_assets")) return { rows: [], rowCount: 0 };

				if (q.includes("INSERT INTO evidence_items")) {
					insertSqls.push(q);
					return { rows: [{ inserted: true }], rowCount: 1 };
				}

				return { rows: [], rowCount: 0 };
			},
		};

		const service = new CanonicalEvidenceServiceImpl(pool);
		await service.ingestExistingArtifacts("22222222-2222-2222-2222-222222222222", { maxDocs: 1, maxDocChunks: 1 });

		expect(insertSqls.length).toBeGreaterThan(0);
		const sql = insertSqls[0];
		expect(sql).toContain("updated_at = now()");
		// No linkage columns => don't mention run_id/step_run_id.
		expect(sql).not.toContain("run_id");
		expect(sql).not.toContain("step_run_id");
	});
});
