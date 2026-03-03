import { describe, expect, it } from "vitest";

import {
	getVisualPageImagePersistConfig,
	planPdfRenderChunks,
	r2RenderedPageKey,
	persistRenderedPageImages,
	computeRenderDpiInfo,
	type VisualPageImagePersistConfig,
} from "../rendered-pages";

type MemFsFile = { type: "file"; data: Buffer };

type MemFsDir = { type: "dir" };

type MemFsNode = MemFsFile | MemFsDir;

function createMemFs(initial: Record<string, MemFsNode> = {}) {
	const store = new Map<string, MemFsNode>(Object.entries(initial));

	function normalize(p: string): string {
		return p.replace(/\\/g, "/");
	}

	return {
		async mkdir(dir: string) {
			store.set(normalize(dir), { type: "dir" });
		},
		async readdir(dir: string) {
			const prefix = normalize(dir).replace(/\/$/, "") + "/";
			const names = new Set<string>();
			for (const key of store.keys()) {
				if (key.startsWith(prefix)) {
					const rest = key.slice(prefix.length);
					const [first] = rest.split("/");
					if (first) names.add(first);
				}
			}
			return Array.from(names);
		},
		async stat(p: string) {
			const n = store.get(normalize(p));
			if (!n) throw new Error("ENOENT");
			return {
				isDirectory() {
					return n.type === "dir";
				},
			};
		},
		async copyFile(src: string, dst: string) {
			const n = store.get(normalize(src));
			if (!n || n.type !== "file") throw new Error("ENOENT");
			store.set(normalize(dst), { type: "file", data: Buffer.from(n.data) });
		},
		async writeFile(dst: string, data: Buffer) {
			store.set(normalize(dst), { type: "file", data: Buffer.from(data) });
		},
		has(p: string) {
			return store.has(normalize(p));
		},
		keys() {
			return Array.from(store.keys());
		},
	};
}

describe("rendered pages", () => {
	it("parses defaults and gating", () => {
		const cfg = getVisualPageImagePersistConfig({
			ENABLE_VISUAL_EXTRACTION: "1",
			VISUAL_PAGE_IMAGE_PERSIST: undefined,
			VISUAL_PAGE_IMAGE_MAX_PAGES: undefined,
			VISUAL_PAGE_IMAGE_DPI: undefined,
			VISUAL_PAGE_IMAGE_FORMAT: undefined,
		} as any);
		expect(cfg.enabled).toBe(true);
		expect(cfg.persist).toBe(true);
		expect(cfg.maxPages).toBe(10);
		expect(cfg.dpi).toBe(300); // default is 300 for OCR quality
		expect(cfg.format).toBe("png");
	});

	it("honours explicit VISUAL_PAGE_IMAGE_DPI env override", () => {
		const cfg200 = getVisualPageImagePersistConfig({
			ENABLE_VISUAL_EXTRACTION: "1",
			VISUAL_PAGE_IMAGE_PERSIST: "1",
			VISUAL_PAGE_IMAGE_DPI: "200",
		} as any);
		expect(cfg200.dpi).toBe(200);

		const cfg150 = getVisualPageImagePersistConfig({
			ENABLE_VISUAL_EXTRACTION: "1",
			VISUAL_PAGE_IMAGE_PERSIST: "1",
			VISUAL_PAGE_IMAGE_DPI: "150",
		} as any);
		expect(cfg150.dpi).toBe(150);

		// Clamped at min 72
		const cfgLow = getVisualPageImagePersistConfig({
			ENABLE_VISUAL_EXTRACTION: "1",
			VISUAL_PAGE_IMAGE_PERSIST: "1",
			VISUAL_PAGE_IMAGE_DPI: "10",
		} as any);
		expect(cfgLow.dpi).toBe(72);

		// Clamped at max 600
		const cfgHigh = getVisualPageImagePersistConfig({
			ENABLE_VISUAL_EXTRACTION: "1",
			VISUAL_PAGE_IMAGE_PERSIST: "1",
			VISUAL_PAGE_IMAGE_DPI: "1200",
		} as any);
		expect(cfgHigh.dpi).toBe(600);
	});

	it("default maxPixelsPerPage accommodates 300 DPI Letter pages without capping", () => {
		// US Letter at 300 DPI: 2550 x 3300 = 8,415,000 pixels
		// Old default 6.5 MP would have silently downscaled 300 DPI to ~258 DPI.
		const cfg = getVisualPageImagePersistConfig({
			ENABLE_VISUAL_EXTRACTION: "1",
			VISUAL_PAGE_IMAGE_PERSIST: "1",
		} as any);
		const letterAt300Dpi = 2550 * 3300; // 8,415,000
		expect(cfg.maxPixelsPerPage).toBeGreaterThanOrEqual(letterAt300Dpi);
	});

	it("plans chunk rendering and R2 keys for full PDFs", () => {
		const chunks = planPdfRenderChunks({ totalPages: 15, chunkSize: 10 });
		expect(chunks).toEqual([
			{ page_start: 0, page_end: 10 },
			{ page_start: 10, page_end: 15 },
		]);

		const keys = Array.from({ length: 15 }, (_, i) => r2RenderedPageKey("deals/d/documents/x/rendered_pages", i));
		expect(keys).toContain("deals/d/documents/x/rendered_pages/page_0014.png");
	});

	it("copies from /tmp debug dir when present", async () => {
		const fs = createMemFs({
			"/tmp/pdf_extract_debug/doc_1": { type: "dir" },
			"/tmp/pdf_extract_debug/doc_1/page_001_raw.png": { type: "file", data: Buffer.from("a") },
			"/tmp/pdf_extract_debug/doc_1/page_002_raw.png": { type: "file", data: Buffer.from("b") },
		});

		const cfg: VisualPageImagePersistConfig = {
			enabled: true,
			persist: true,
			maxPages: 50,
			format: "png",
			dpi: 200,
			maxPixelsPerPage: 6_500_000,
		};

		const res = await persistRenderedPageImages({
			buffer: Buffer.from("%PDF-FAKE"),
			documentId: "doc_1",
			pageCount: 2,
			uploadDir: "/data/uploads",
			config: cfg,
			fsImpl: fs as any,
			now: () => new Date("2025-01-01T00:00:00.000Z"),
			logger: { log() {}, warn() {}, error() {} },
		});

		expect(res.ok).toBe(true);
		expect(res.rendered_pages_dir).toBe("/data/uploads/rendered_pages/doc_1");
		expect(res.rendered_pages_count).toBe(2);
		expect(res.rendered_pages_created_at).toBe("2025-01-01T00:00:00.000Z");
		expect(fs.has("/data/uploads/rendered_pages/doc_1/page_0000.png")).toBe(true);
		expect(fs.has("/data/uploads/rendered_pages/doc_1/page_0001.png")).toBe(true);
	});
});

// ─── P3: computeRenderDpiInfo ────────────────────────────────────────────────
// Validates that the pure DPI derivation function correctly reports whether the
// pixel-cap would silently downscale a page, and what the effective DPI would be.

describe("computeRenderDpiInfo", () => {
	// US Letter: 8.5 × 11 inches → 612 × 792 PDF points (1 pt = 1/72 in).
	// At 300 DPI: scale = 300/72 ≈ 4.167 → output ≈ 2550 × 3300 px ≈ 8.4 MP.
	// With a 15 MP cap there is plenty of headroom — no downscale expected.
	it("300 DPI on US Letter is NOT downscaled at the 15 MP default cap", () => {
		const result = computeRenderDpiInfo({
			requestedDpi: 300,
			maxPixelsPerPage: 15_000_000,
			pageWidthPts: 612,
			pageHeightPts: 792,
		});
		expect(result.wasDownscaled).toBe(false);
		expect(result.effectiveDpi).toBe(300);
	});

	// A4: 595 × 842 PDF points. Same 300 DPI / 15 MP check.
	it("300 DPI on A4 is NOT downscaled at the 15 MP default cap", () => {
		const result = computeRenderDpiInfo({
			requestedDpi: 300,
			maxPixelsPerPage: 15_000_000,
			pageWidthPts: 595,
			pageHeightPts: 842,
		});
		expect(result.wasDownscaled).toBe(false);
		expect(result.effectiveDpi).toBe(300);
	});

	// Force downscale: old 6.5 MP cap cannot fit 300 DPI Letter (≈8.4 MP).
	it("300 DPI on US Letter IS downscaled when max pixels is 6.5 MP (old default)", () => {
		const result = computeRenderDpiInfo({
			requestedDpi: 300,
			maxPixelsPerPage: 6_500_000,
			pageWidthPts: 612,
			pageHeightPts: 792,
		});
		expect(result.wasDownscaled).toBe(true);
		expect(result.effectiveDpi).toBeLessThan(300);
	});

	// 72 DPI → scale = 1 exact; no cap needed.
	it("72 DPI (scale=1) is never downscaled regardless of page size", () => {
		const result = computeRenderDpiInfo({
			requestedDpi: 72,
			maxPixelsPerPage: 100_000,   // tight cap
			pageWidthPts: 100,
			pageHeightPts: 100,          // 100×100 pts → 100×100 px at 72dpi = 10 000 px < cap
		});
		expect(result.wasDownscaled).toBe(false);
		expect(result.effectiveDpi).toBe(72);
	});

	// Zero-area page guard: should not produce NaN/Infinity.
	it("zero-area page does not throw and effective scale is clamped to 0.1", () => {
		const result = computeRenderDpiInfo({
			requestedDpi: 300,
			maxPixelsPerPage: 15_000_000,
			pageWidthPts: 0,
			pageHeightPts: 0,
		});
		expect(Number.isFinite(result.effectiveDpi)).toBe(true);
		expect(result.effectiveScale).toBeGreaterThanOrEqual(0.1);
	});
});
