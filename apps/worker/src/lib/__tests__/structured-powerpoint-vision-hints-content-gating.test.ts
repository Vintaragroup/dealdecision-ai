import { describe, it, expect, vi } from "vitest";

import { applyVisionHintsToStructuredPowerpointSlides } from "../visual-extraction";

describe("structured PowerPoint vision hints content gating", () => {
	it("skips contentful slides even when segment_key is unknown; runs once for contentless slides; reruns are idempotent", async () => {
		const existingPages = new Set<string>();

		type Row = {
			visual_asset_id: string;
			visual_extraction_id: string;
			page_index: number;
			quality_flags: any;
			structured_json: any;
		};

		let structuredJsonByPage: Record<number, any> = {
			// page 0: contentful (title + snippet) but unknown segment
			0: { kind: "powerpoint_slide", title: "Contact", bullets: [], notes: "", text_snippet: "Reach us at hello@x.com" },
			// page 1: contentless
			1: { kind: "powerpoint_slide", title: "", bullets: [], notes: "", text_snippet: "" },
		};

		const pool: any = {
			query: vi.fn(async (sql: string, params?: any[]) => {
				const q = String(sql);

				// Candidate query: emit rows for pages that still match SQL filter (unknown segment, no vu).
				if (q.includes("FROM visual_assets va") && q.includes("structured_powerpoint") && q.includes("LIMIT 200")) {
					const rows: Row[] = [];
					for (const pageIndex of [0, 1]) {
						const sj = structuredJsonByPage[pageIndex];
						const hasVu = sj && typeof sj === "object" && (sj as any).vision_understanding_v1 != null;
						if (hasVu) continue;
						rows.push({
							visual_asset_id: `va-${pageIndex}`,
							visual_extraction_id: `ve-${pageIndex}`,
							page_index: pageIndex,
							quality_flags: { source: "structured_powerpoint", segment_key: "unknown" },
							structured_json: sj,
						});
					}
					return { rows };
				}

				// Persisted hint update: store the value into the in-memory structured json.
				if (q.includes("UPDATE visual_extractions") && q.includes("'{vision_understanding_v1}'")) {
					const veId = String((params as any)?.[0] ?? "");
					const pageIndex = veId === "ve-0" ? 0 : veId === "ve-1" ? 1 : -1;
					if (pageIndex >= 0) {
						structuredJsonByPage[pageIndex] = {
							...(structuredJsonByPage[pageIndex] ?? {}),
							vision_understanding_v1: JSON.parse(String((params as any)?.[1] ?? "{}")),
						};
					}
					return { rows: [] };
				}

				// Existing visual_assets guard query
				if (q.includes("FROM visual_assets") && q.includes("extractor_version = ANY") && q.includes("LIMIT 1")) {
					const docId = String((params as any)?.[0] ?? "");
					const pageIndex = String((params as any)?.[1] ?? "");
					const versions = Array.isArray((params as any)?.[2]) ? (params as any)[2].map(String) : [];
					const hit = versions.some((v: string) => existingPages.has(`${docId}::${pageIndex}::${v}`));
					return { rows: hit ? [{ ok: 1 }] : [] };
				}

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
			// Simulate VISION_REQUEST_START/DONE logs.
			options?.logger?.log?.(
				JSON.stringify({
					event: "VISION_REQUEST_START",
					deal_id: options?.logMeta?.deal_id,
					job_id: options?.logMeta?.job_id,
					document_id: options?.logMeta?.document_id,
					page_index: req?.page_index,
				})
			);

			const base = String(req?.extractor_version ?? "").replace(/_force_vu$/, "");
			existingPages.add(`${String(req?.document_id ?? "")}::${String(req?.page_index ?? "")}::${base}`);

			options?.logger?.log?.(
				JSON.stringify({
					event: "VISION_REQUEST_DONE",
					deal_id: options?.logMeta?.deal_id,
					job_id: options?.logMeta?.job_id,
					document_id: options?.logMeta?.document_id,
					page_index: req?.page_index,
				})
			);

			return {
				response: {
					document_id: "doc-1",
					page_index: Number(req?.page_index ?? 0),
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
			pageImageUris: ["https://example.com/page_0.png", "https://example.com/page_1.png"],
			structuredExtractorVersion: "structured_native_v1",
			visionConfig: {
				enabled: true,
				visionWorkerUrl: "http://vision",
				extractorVersion: "vision_v1",
				timeoutMs: 1000,
				maxPages: 10,
			},
			env: {
				ENABLE_STRUCTURED_VISION_HINTS: "1",
				VISION_BASE_URL: "http://vision",
			},
			logger,
			callVisionWorkerWithRetries,
		};

		// First run: only contentless page should call vision.
		const first = await applyVisionHintsToStructuredPowerpointSlides(baseParams as any);
		expect(first.skipped_has_content).toBe(1);
		expect(first.attempted).toBe(1);
		expect(callVisionWorkerWithRetries).toHaveBeenCalledTimes(1);
		expect(loggerCalls.filter((e) => e?.event === "VISION_REQUEST_START").length).toBe(1);
		expect(loggerCalls.filter((e) => e?.event === "VISION_REQUEST_DONE").length).toBe(1);
		expect(loggerCalls.some((e) => e?.event === "VISION_REQUEST_START" && e?.page_index === 0)).toBe(false);
		expect(loggerCalls.some((e) => e?.event === "VISION_REQUEST_DONE" && e?.page_index === 0)).toBe(false);

		// Second run: no additional vision calls.
		const second = await applyVisionHintsToStructuredPowerpointSlides(baseParams as any);
		expect(second.attempted).toBe(0);
		expect(callVisionWorkerWithRetries).toHaveBeenCalledTimes(1);
	});
});
