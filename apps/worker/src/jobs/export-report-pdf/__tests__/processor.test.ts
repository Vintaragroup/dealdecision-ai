import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mock database pool
// ─────────────────────────────────────────────────────────────────────────────

const mockPoolQuery = vi.fn();
vi.mock("../../../lib/db", () => ({
	getPool: () => ({ query: mockPoolQuery }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock R2
// ─────────────────────────────────────────────────────────────────────────────

const uploadToR2Mock = vi.fn(async () => undefined);
const getR2ObjectUrlMock = vi.fn(async () => "https://cdn.example.com/deals/test/exports/123.pdf");

vi.mock("../../../lib/r2", () => ({
	uploadToR2: uploadToR2Mock,
	getR2ObjectUrl: getR2ObjectUrlMock,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock buildOrchestratorReportV1
// ─────────────────────────────────────────────────────────────────────────────

const buildReportMock = vi.fn(() => ({ dealId: "deal-1", sections: [] }));
vi.mock("@dealdecision/core", () => ({
	buildOrchestratorReportV1: buildReportMock,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock html-renderer
// ─────────────────────────────────────────────────────────────────────────────

const renderHtmlMock = vi.fn(() => "<html><body>report</body></html>");
vi.mock("../html-renderer", () => ({
	renderReportHtml: renderHtmlMock,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock Playwright (intercepted via require() inside the lazy loader)
// ─────────────────────────────────────────────────────────────────────────────

const closeMock = vi.fn(async () => undefined);
const pdfMock = vi.fn(async () => Buffer.from("%PDF-1.4 test"));
const setContentMock = vi.fn(async () => undefined);
const newPageMock = vi.fn(async () => ({
	setContent: setContentMock,
	pdf: pdfMock,
}));
const launchMock = vi.fn(async () => ({
	newPage: newPageMock,
	close: closeMock,
}));

vi.mock("playwright", () => ({
	chromium: { launch: launchMock },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const DEAL_ID = "00000000-0000-0000-0000-000000000001";
const EXPORT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const VALID_RENDER_PACKAGE = {
	sections: [{ type: "executive_summary", content: {} }],
};

const VALID_CONFIG = {
	preset: "investor",
	format: "standard",
	sections: ["executive_summary"],
};

function makeJob(overrides: Partial<{ deal_id: string; export_id: string; config: any }> = {}) {
	return {
		id: "bullmq-job-1",
		data: {
			deal_id: DEAL_ID,
			export_id: EXPORT_ID,
			config: VALID_CONFIG,
			...overrides,
		},
		updateProgress: vi.fn(async () => undefined),
	} as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("exportReportPdfProcessor", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Default: markExportStatus UPDATE calls succeed, SELECT returns render_package
		mockPoolQuery.mockImplementation(async (sql: string) => {
			const s = sql.trim().toLowerCase();
			if (s.startsWith("update deal_report_exports")) {
				return { rows: [] };
			}
			if (s.startsWith("select") && s.includes("investor_insight_reports")) {
				return {
					rows: [
						{ render_package: VALID_RENDER_PACKAGE, deal_name: "Test Deal" },
					],
				};
			}
			return { rows: [] };
		});

		buildReportMock.mockReturnValue({ dealId: DEAL_ID, sections: [] });
		renderHtmlMock.mockReturnValue("<html><body>report</body></html>");
		pdfMock.mockResolvedValue(Buffer.from("%PDF-1.4 test"));
		uploadToR2Mock.mockResolvedValue(undefined);
		getR2ObjectUrlMock.mockResolvedValue("https://cdn.example.com/deals/test/exports/123.pdf");
	});

	it("successfully processes a job: marks processing → renders → uploads → marks completed", async () => {
		const { exportReportPdfProcessor } = await import("../processor.js");

		const job = makeJob();
		await exportReportPdfProcessor(job);

		// Verify processing was marked
		const updateCalls = (mockPoolQuery.mock.calls as any[][]).filter((c) =>
			String(c[0]).toLowerCase().includes("update deal_report_exports")
		);
		expect(updateCalls.length).toBeGreaterThanOrEqual(2);

		// First UPDATE should mark "processing"
		const firstUpdate = updateCalls[0] as any[];
		expect(firstUpdate[1]).toContain("processing");

		// Last UPDATE should mark "completed" with r2_key
		const lastUpdate = updateCalls[updateCalls.length - 1] as any[];
		expect(lastUpdate[1]).toContain("completed");
		const r2KeyValue = (lastUpdate[1] as any[]).find((v: any) => typeof v === "string" && v.includes(".pdf"));
		expect(r2KeyValue).toBeDefined();

		// Verify R2 upload was called
		expect(uploadToR2Mock).toHaveBeenCalledOnce();
		const uploadArgs = (uploadToR2Mock.mock.calls as any[][])[0];
		expect(uploadArgs[0]).toMatchObject({
			contentType: "application/pdf",
		});
		expect(Buffer.isBuffer(uploadArgs[0].body) || uploadArgs[0].body instanceof Uint8Array).toBe(true);

		// Verify download URL was fetched
		expect(getR2ObjectUrlMock).toHaveBeenCalledOnce();
	});

	it("calls buildOrchestratorReportV1 with the fetched render_package", async () => {
		const { exportReportPdfProcessor } = await import("../processor.js");

		await exportReportPdfProcessor(makeJob());

		expect(buildReportMock).toHaveBeenCalledOnce();
		const args = (buildReportMock.mock.calls as any[][])[0];
		expect(args[0]).toMatchObject({
			dealId: DEAL_ID,
			renderPackage: VALID_RENDER_PACKAGE,
		});
	});

	it("calls renderReportHtml with the built report and config", async () => {
		const { exportReportPdfProcessor } = await import("../processor.js");

		await exportReportPdfProcessor(makeJob());

		expect(renderHtmlMock).toHaveBeenCalledOnce();
		const args = (renderHtmlMock.mock.calls as any[][])[0];
		expect(args[0]).toHaveProperty("report");
		expect(args[0]).toHaveProperty("config");
		expect(args[0].config).toMatchObject(VALID_CONFIG);
		expect(args[0].dealName).toBe("Test Deal");
	});

	it("launches Playwright Chromium with no-sandbox args", async () => {
		const { exportReportPdfProcessor } = await import("../processor.js");

		await exportReportPdfProcessor(makeJob());

		expect(launchMock).toHaveBeenCalledOnce();
		const launchArgs = (launchMock.mock.calls as any[][])[0];
		expect(launchArgs[0].args).toContain("--no-sandbox");

		// Always closes the browser
		expect(closeMock).toHaveBeenCalledOnce();
	});

	it("throws and marks export as failed when render_package is missing", async () => {
		mockPoolQuery.mockImplementation(async (sql: string) => {
			const s = sql.trim().toLowerCase();
			if (s.startsWith("update deal_report_exports")) return { rows: [] };
			if (s.startsWith("select") && s.includes("investor_insight_reports")) {
				return { rows: [] }; // no rows
			}
			return { rows: [] };
		});

		const { exportReportPdfProcessor } = await import("../processor.js");

		await expect(exportReportPdfProcessor(makeJob())).rejects.toThrow(
			/No investor_insight_reports render_package found/
		);

		// Verify it tried to mark the row as failed
		const failCalls = (mockPoolQuery.mock.calls as any[][]).filter(
			(c) =>
				String(c[0]).toLowerCase().includes("update deal_report_exports") &&
				Array.isArray(c[1]) &&
				c[1].includes("failed")
		);
		expect(failCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("throws and marks failed when Playwright pdf() rejects", async () => {
		pdfMock.mockRejectedValueOnce(new Error("PDF generation crashed"));

		const { exportReportPdfProcessor } = await import("../processor.js");

		await expect(exportReportPdfProcessor(makeJob())).rejects.toThrow("PDF generation crashed");

		// Browser should still be closed (finally block)
		expect(closeMock).toHaveBeenCalledOnce();

		// Export row should be marked failed
		const failCalls = (mockPoolQuery.mock.calls as any[][]).filter(
			(c) =>
				String(c[0]).toLowerCase().includes("update deal_report_exports") &&
				Array.isArray(c[1]) &&
				c[1].includes("failed")
		);
		expect(failCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("throws when deal_id is missing in job payload", async () => {
		const { exportReportPdfProcessor } = await import("../processor.js");

		const job = makeJob({ deal_id: undefined as any });

		await expect(exportReportPdfProcessor(job)).rejects.toThrow(
			/Missing deal_id or export_id/
		);
	});
});
