import { describe, it, expect, vi } from "vitest";

import { applyVisionHintsToStructuredPowerpointSlides } from "../visual-extraction";

describe("structured PowerPoint vision hints rerun skip existing", () => {
	it("does not call vision worker on rerun when per-page vision asset already exists", async () => {
		let structuredJson: any = { kind: "powerpoint_slide" };
		const existingPages = new Set<string>();

		const pool: any = {
			query: vi.fn(async (sql: string, params?: any[]) => {
				const q = String(sql);

				// Candidate query: always return the same "unknown segment" structured PowerPoint slide.
				if (
					q.includes("FROM visual_assets va") &&
					q.includes("structured_powerpoint") &&
					q.includes("LIMIT 200")
				) {
					// Mimic SQL filter: once hints were written, it should no longer be a candidate.
					if (structuredJson && typeof structuredJson === "object" && (structuredJson as any).vision_understanding_v1 != null) {
						return { rows: [] };
					}
					return {
						rows: [
							{
								visual_asset_id: "va-1",
								visual_extraction_id: "ve-1",
								page_index: 0,
								quality_flags: { source: "structured_powerpoint", segment_key: "unknown" },
								structured_json: structuredJson,
							},
						],
					};
				}

				// Persisted hint update (we don't parse jsonb_set; just store the value).
				if (q.includes("UPDATE visual_extractions") && q.includes("'{vision_understanding_v1}'")) {
					structuredJson = {
						...(structuredJson ?? {}),
						vision_understanding_v1: JSON.parse(String((params as any)?.[1] ?? "{}")),
					};
					return { rows: [] };
				}

				// Strict rerun guard query: check for existing visual_assets entries.
				if (
					q.includes("FROM visual_assets") &&
					q.includes("extractor_version = ANY") &&
					q.includes("LIMIT 1")
				) {
					const docId = String((params as any)?.[0] ?? "");
					const pageIndex = String((params as any)?.[1] ?? "");
					const versions = Array.isArray((params as any)?.[2]) ? (params as any)[2].map(String) : [];
					const hit = versions.some((v: string) => existingPages.has(`${docId}::${pageIndex}::${v}`));
					return { rows: hit ? [{ ok: 1 }] : [] };
				}

				// All UPDATEs are best-effort; ignore in this unit test.
				return { rows: [] };
			}),
		};

		const loggerCalls: any[] = [];
		const logger: any = {
			log: (msg: any) => {
				try {
					loggerCalls.push(JSON.parse(String(msg)));
				} catch {
					loggerCalls.push({ raw: msg });
				}
			},
			warn: vi.fn(),
		};

		const callVisionWorkerWithRetries = vi.fn(async (_config: any, req: any, options: any) => {
			// Ensure log meta is never null.
			expect(options?.logMeta?.caller).toBe("structured_ppt_vision_hints");
			expect(options?.logMeta?.deal_id).toBe("deal-1");
			expect(options?.logMeta?.job_id).toBe("job-1");
			expect(options?.logMeta?.document_id).toBe("doc-1");
			expect(options?.logMeta?.deal_id).not.toBeNull();
			expect(options?.logMeta?.job_id).not.toBeNull();
			expect(options?.logMeta?.document_id).not.toBeNull();

			// Simulate VISION_REQUEST_START/DONE logs with the passed meta.
			options?.logger?.log?.(
				JSON.stringify({
					event: "VISION_REQUEST_START",
					deal_id: options?.logMeta?.deal_id,
					job_id: options?.logMeta?.job_id,
					document_id: options?.logMeta?.document_id,
					extractor_version: String(req?.extractor_version ?? ""),
				})
			);

			// Simulate the vision worker persisting a visual_asset so reruns can dedupe.
			const base = String(req?.extractor_version ?? "").replace(/_force_vu$/, "");
			existingPages.add(`${String(req?.document_id ?? "")}::${String(req?.page_index ?? "")}::${base}`);
			existingPages.add(`${String(req?.document_id ?? "")}::${String(req?.page_index ?? "")}::${String(req?.extractor_version ?? "")}`);

			options?.logger?.log?.(
				JSON.stringify({
					event: "VISION_REQUEST_DONE",
					deal_id: options?.logMeta?.deal_id,
					job_id: options?.logMeta?.job_id,
					document_id: options?.logMeta?.document_id,
					extractor_version: String(req?.extractor_version ?? ""),
				})
			);

			return {
				response: {
					document_id: "doc-1",
					page_index: 0,
					extractor_version: String(req?.extractor_version ?? ""),
					assets: [
						{
							asset_type: "image_text",
							bbox: { x: 0, y: 0, w: 1, h: 1 },
							confidence: 0.5,
							quality_flags: {},
							image_uri: null,
							image_hash: null,
							extraction: {
								ocr_text: "",
								ocr_blocks: [],
								structured_json: {
									vision_understanding_v1: { segment_hint: "traction", confidence: 0.9 },
								},
								units: null,
								labels: {},
								model_version: null,
								confidence: 0.5,
							},
						},
					],
				},
				attempts: [],
			};
		});

		const baseParams = {
			pool,
			dealId: "deal-1",
			jobId: "job-1",
			documentId: "doc-1",
			pageImageUris: ["https://example.com/page_0.png"],
			structuredExtractorVersion: "structured_native_v1",
			visionConfig: { enabled: true, visionWorkerUrl: "http://vision", extractorVersion: "vision_v1", timeoutMs: 1000, maxPages: 10 },
			visionRuntime: undefined,
			env: {
				ENABLE_STRUCTURED_VISION_HINTS: "1",
				VISION_BASE_URL: "http://vision",
			},
			logger,
			callVisionWorkerWithRetries,
		};

		const first = await applyVisionHintsToStructuredPowerpointSlides(baseParams as any);
		expect(first.attempted).toBe(1);
		expect(callVisionWorkerWithRetries).toHaveBeenCalledTimes(1);
		expect(
			loggerCalls.some(
				(e) => e?.event === "VISION_REQUEST_START" && e?.deal_id != null && e?.job_id != null && e?.document_id != null
			)
		).toBe(true);
		expect(
			loggerCalls.some(
				(e) => e?.event === "VISION_REQUEST_DONE" && e?.deal_id != null && e?.job_id != null && e?.document_id != null
			)
		).toBe(true);

		const second = await applyVisionHintsToStructuredPowerpointSlides(baseParams as any);
		expect(second.attempted).toBe(0);
		expect(callVisionWorkerWithRetries).toHaveBeenCalledTimes(1);
	});
});
