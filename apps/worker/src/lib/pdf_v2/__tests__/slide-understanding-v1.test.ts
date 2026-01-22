import { afterEach, describe, expect, test } from "vitest";
import { applySlideUnderstandingV1Shadow } from "../slide-understanding-v1";

function mkPdf(opts: { pages: Array<{ words?: any[]; text?: string }>; v2Pages: any[] }) {
	return {
		pages: opts.pages.map((p, i) => ({
			pageNumber: i + 1,
			text: p.text || "",
			words: p.words || [],
		})),
		pdf_v2: {
			status: "ok",
			pages: opts.v2Pages,
		},
	};
}

describe("slide-understanding-v1 (shadow)", () => {
	const PREV_MODE = process.env.PDF_SLIDE_UNDERSTANDING_MODE;

	afterEach(() => {
		if (PREV_MODE === undefined) delete process.env.PDF_SLIDE_UNDERSTANDING_MODE;
		else process.env.PDF_SLIDE_UNDERSTANDING_MODE = PREV_MODE;
	});

	test("does nothing when mode off", () => {
		const pdf = mkPdf({
			pages: [{ text: "" }],
			v2Pages: [{ page_index: 0, page_number: 1, native: { method: "pdfplumber", blocks: [{ text: "Use of Funds", bbox: { x: 0.1, y: 0.05, w: 0.8, h: 0.05 } }] }, final: { method: "native", text: "Use of Funds" } }],
		});
		process.env.PDF_SLIDE_UNDERSTANDING_MODE = "off";
		const res = applySlideUnderstandingV1Shadow(pdf as any, { now: "2026-01-20T00:00:00.000Z" });
		expect(res.applied).toBe(false);
		expect((pdf as any).pdf_v2.pages[0].understanding_v1).toBeUndefined();
	});

	test("attaches understanding_v1 and keeps it bounded", () => {
		const pdf = mkPdf({
			pages: [{ text: "" }],
			v2Pages: [
				{
					page_index: 0,
					page_number: 1,
					classification: { kind: "text" },
					native: {
						method: "pdfplumber",
						blocks: [
							{ text: "Use of Funds", bbox: { x: 0.1, y: 0.06, w: 0.7, h: 0.05 } },
							{ text: "$1.2M", bbox: { x: 0.12, y: 0.35, w: 0.2, h: 0.05 } },
							{ text: "Marketing", bbox: { x: 0.35, y: 0.35, w: 0.3, h: 0.05 } },
							{ text: "www.example.com", bbox: { x: 0.1, y: 0.92, w: 0.4, h: 0.03 } },
						],
					},
					final: { method: "native", text: "Use of Funds $1.2M Marketing" },
				},
			],
		});

		process.env.PDF_SLIDE_UNDERSTANDING_MODE = "shadow";
		const res = applySlideUnderstandingV1Shadow(pdf as any, { now: "2026-01-20T00:00:00.000Z" });
		expect(res.applied).toBe(true);

		const u = (pdf as any).pdf_v2.pages[0].understanding_v1;
		expect(u).toBeTruthy();
		expect(u.version).toBe("slide_understanding_v1");
		expect(u.title).toMatch(/Use of Funds/i);
		expect(u.title_candidates.length).toBeGreaterThan(0);
		expect(u.title_confidence).toBeGreaterThan(0);
		expect(u.slide_type).toBe("use_of_funds");
		expect(Array.isArray(u.evidence_signals)).toBe(true);
		expect(u.key_metrics.some((m: any) => String(m.value).includes("$1.2M"))).toBe(true);
		expect(u.regions.length).toBeGreaterThanOrEqual(3);
		expect(u.regions.length).toBeLessThanOrEqual(12);
	});

	test("classifies financials from keywords and extracts %", () => {
		const pdf = mkPdf({
			pages: [{ text: "" }],
			v2Pages: [
				{
					page_index: 0,
					page_number: 1,
					native: {
						method: "pdfplumber",
						blocks: [
							{ text: "Financial Overview", bbox: { x: 0.1, y: 0.05, w: 0.8, h: 0.05 } },
							{ text: "ARR $10M", bbox: { x: 0.1, y: 0.3, w: 0.4, h: 0.05 } },
							{ text: "Gross Margin 70%", bbox: { x: 0.1, y: 0.4, w: 0.6, h: 0.05 } },
						],
					},
					final: { method: "native", text: "Financial Overview ARR $10M Gross Margin 70%" },
				},
			],
		});

		process.env.PDF_SLIDE_UNDERSTANDING_MODE = "shadow";
		applySlideUnderstandingV1Shadow(pdf as any, { now: "2026-01-20T00:00:00.000Z" });
		const u = (pdf as any).pdf_v2.pages[0].understanding_v1;
		expect(u.slide_type).toBe("financials");
		expect(u.key_metrics.some((m: any) => String(m.value).includes("70%"))).toBe(true);
	});

	test('does not classify sports "OPENING ROUND" as raise_terms without financing context', () => {
		const pdf = mkPdf({
			pages: [{ text: "" }],
			v2Pages: [
				{
					page_index: 0,
					page_number: 1,
					native: {
						method: "pdfplumber",
						blocks: [
							{ text: "OPENING ROUND", bbox: { x: 0.1, y: 0.05, w: 0.8, h: 0.08 } },
							{ text: "3ICE LEAGUE PLAYOFFS", bbox: { x: 0.1, y: 0.14, w: 0.8, h: 0.06 } },
							{ text: "Season format and schedule", bbox: { x: 0.1, y: 0.28, w: 0.8, h: 0.05 } },
							{ text: "Team standings and matchups", bbox: { x: 0.1, y: 0.36, w: 0.8, h: 0.05 } },
						],
					},
					final: { method: "native", text: "OPENING ROUND PLAYOFFS Season format" },
				},
			],
		});

		process.env.PDF_SLIDE_UNDERSTANDING_MODE = "shadow";
		applySlideUnderstandingV1Shadow(pdf as any, { now: "2026-01-20T00:00:00.000Z" });

		const u = (pdf as any).pdf_v2.pages[0].understanding_v1;
		expect(u).toBeTruthy();
		expect(u.slide_type).not.toBe("raise_terms");
	});

	test("classifies financing context (seed round / raising / valuation / cap table) as raise_terms", () => {
		const pdf = mkPdf({
			pages: [{ text: "" }],
			v2Pages: [
				{
					page_index: 0,
					page_number: 1,
					native: {
						method: "pdfplumber",
						blocks: [
							{ text: "SEED ROUND", bbox: { x: 0.12, y: 0.06, w: 0.6, h: 0.08 } },
							{ text: "Raising $3.5M", bbox: { x: 0.12, y: 0.18, w: 0.6, h: 0.06 } },
							{ text: "Pre-money valuation: $18M", bbox: { x: 0.12, y: 0.26, w: 0.7, h: 0.06 } },
							{ text: "Cap table available upon request", bbox: { x: 0.12, y: 0.34, w: 0.8, h: 0.05 } },
						],
					},
					final: { method: "native", text: "SEED ROUND Raising $3.5M Pre-money valuation Cap table" },
				},
			],
		});

		process.env.PDF_SLIDE_UNDERSTANDING_MODE = "shadow";
		applySlideUnderstandingV1Shadow(pdf as any, { now: "2026-01-20T00:00:00.000Z" });

		const u = (pdf as any).pdf_v2.pages[0].understanding_v1;
		expect(u).toBeTruthy();
		expect(u.slide_type).toBe("raise_terms");
	});
});
