import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("ingest low-content pdf needs_ocr enqueue", () => {
	it("uses enqueuePersistedJob for render_document_pages(force_ocr)", () => {
		const indexPath = path.join(__dirname, "..", "index.ts");
		const src = fs.readFileSync(indexPath, "utf8");
		const start = src.indexOf('if (decision.kind === "needs_ocr") {');
		expect(start).toBeGreaterThan(0);
		const end = src.indexOf("// decision.kind === \"fail\"", start);
		expect(end).toBeGreaterThan(start);
		const block = src.slice(start, end);

		expect(block).toContain('type: "render_document_pages"');
		expect(block).toContain("enqueuePersistedJob");
		expect(block).not.toContain("renderQueue.add");
	});
});
