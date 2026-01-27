import { beforeEach, describe, expect, it, vi } from "vitest";

const updateJobProgress = vi.fn(async () => undefined);
const getDocumentsForDealWithVerification = vi.fn();
const getDocumentsByIds = vi.fn();
const deleteExtractionEvidenceForDocument = vi.fn(async () => undefined);
const insertDocumentExtractionAudit = vi.fn(async () => undefined);
const updateDocumentStatus = vi.fn(async () => undefined);

const childJob = { id: "child", waitUntilFinished: vi.fn(async () => undefined) };
const add = vi.fn(async () => childJob);
const getQueue = vi.fn(() => ({ add }));

vi.mock("../../lib/job-progress", () => ({ updateJobProgress }));
vi.mock("../../lib/db", () => ({
	deleteExtractionEvidenceForDocument,
	getDocumentsByIds,
	getDocumentsForDealWithVerification,
	insertDocumentExtractionAudit,
	updateDocumentStatus,
}));
vi.mock("../../lib/queue", () => ({ getQueue }));

describe("reextractDocumentsProcessor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("forced reextract completes after enqueueing child jobs", async () => {
		(getDocumentsForDealWithVerification as any).mockResolvedValueOnce([
			{
				id: "doc1",
				deal_id: "deal1",
				title: "Doc 1",
				status: "completed",
				structured_data: null,
				extraction_metadata: null,
				full_content: null,
				full_text: null,
				verification_status: null,
				verification_result: null,
				updated_at: new Date().toISOString(),
			},
			{
				id: "doc2",
				deal_id: "deal1",
				title: "Doc 2",
				status: "failed",
				structured_data: null,
				extraction_metadata: null,
				full_content: null,
				full_text: null,
				verification_status: "failed",
				verification_result: { overall_score: 0.1 },
				updated_at: new Date().toISOString(),
			},
		]);

		const job = {
			id: "job1",
			data: { deal_id: "deal1", force: true },
			updateProgress: vi.fn(async () => undefined),
		} as any;

		const { reextractDocumentsProcessor } = await import("../reextract-documents.js");
		const res = await reextractDocumentsProcessor(job);

		expect(res).toEqual({ status: "enqueued", docs: 2 });
		expect(getQueue).toHaveBeenCalledWith("ingest_documents");
		expect(getQueue).not.toHaveBeenCalledWith("extract_visuals");
		expect(add).toHaveBeenCalledTimes(2);
		expect(childJob.waitUntilFinished).not.toHaveBeenCalled();
		expect(job.updateProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: "complete" }));
	});
});
