import { describe, expect, it } from "vitest";

import {
	getVisualPageImagePersistConfig,
	persistRenderedPageImages,
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
		expect(cfg.maxPages).toBe(50);
		expect(cfg.dpi).toBe(200);
		expect(cfg.format).toBe("png");
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
		expect(fs.has("/data/uploads/rendered_pages/doc_1/page_000.png")).toBe(true);
		expect(fs.has("/data/uploads/rendered_pages/doc_1/page_001.png")).toBe(true);
	});
});
