import { describe, expect, it } from "vitest";
import { parseIngestDocumentsJobData, validateIngestDocumentsPayload } from "./ingest-payload";

describe("ingest_documents payload validation", () => {
	it("passes in from_storage mode without fileName/fileBufferB64", () => {
		const parsed = parseIngestDocumentsJobData({
			document_id: "doc-123",
			deal_id: "deal-456",
			mode: "from_storage",
		});

		const result = validateIngestDocumentsPayload(parsed);
		expect(result.ok).toBe(true);
	});

	it("fails in upload mode when required fields are missing", () => {
		const parsed = parseIngestDocumentsJobData({
			documentId: "doc-123",
			dealId: "deal-456",
			// upload mode default
			fileName: "test.pdf",
			// missing fileBufferB64
		});

		const result = validateIngestDocumentsPayload(parsed);
		expect(result.ok).toBe(false);
		expect(result.missing).toContain("fileBufferB64");
	});
});
