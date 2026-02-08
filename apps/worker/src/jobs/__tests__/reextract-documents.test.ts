import { beforeEach, describe, expect, it, vi } from "vitest";

const updateJobProgress = vi.fn(async () => undefined);
const getDocumentsForDealWithVerification = vi.fn();
const getDocumentsByIds = vi.fn();
const getDocumentOriginalFileMeta = vi.fn();
const deleteExtractionEvidenceForDocument = vi.fn(async () => undefined);
const insertDocumentExtractionAudit = vi.fn(async () => undefined);
const updateDocumentStatus = vi.fn(async () => undefined);

const enqueuePersistedJob = vi.fn(async (input: any) => ({ job_id: String(input?.job_id ?? "job") }));

vi.mock("../../lib/job-progress", () => ({ updateJobProgress }));
vi.mock("../../lib/db", () => ({
	deleteExtractionEvidenceForDocument,
	getDocumentOriginalFileMeta,
	getDocumentsByIds,
	getDocumentsForDealWithVerification,
	insertDocumentExtractionAudit,
	updateDocumentStatus,
}));
vi.mock("../../lib/job-enqueue", () => ({ enqueuePersistedJob }));

describe("reextractDocumentsProcessor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("forced reextract completes after enqueueing child jobs", async () => {
		(getDocumentOriginalFileMeta as any).mockResolvedValue(null);
		(getDocumentOriginalFileMeta as any).mockResolvedValue(null);

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
		expect(enqueuePersistedJob).toHaveBeenCalledTimes(2);
		const c0 = (enqueuePersistedJob as any).mock.calls[0][0];
		const c1 = (enqueuePersistedJob as any).mock.calls[1][0];
		expect(c0.type).toBe("ingest_documents");
		expect(c1.type).toBe("ingest_documents");
		expect(String(c0.job_id)).toContain("ingest_documents__");
		expect(String(c1.job_id)).toContain("ingest_documents__");
		expect(String(c0.job_id)).not.toEqual(String(c1.job_id));
		expect(job.updateProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: "complete" }));
	});
});
