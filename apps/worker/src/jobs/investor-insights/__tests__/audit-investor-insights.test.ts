/**
 * audit-investor-insights.test.ts
 *
 * Unit tests for the audit helper functions.
 * No DB connection required — all tests operate on in-memory data.
 */

import { describe, it, expect } from "vitest";

import {
	parseEvidenceRef,
	resolveEvidenceRef,
	findSnippetInPageText,
	parseStoredSlotsBody,
	classifySlotFailure,
	printAuditMarkdown,
	parseDealListFile,
	pooledMap,
	computeDelta,
	checkGate,
	ReadOnlyViolationError,
	wrapPoolReadOnly,
	buildFixRecommendations,
} from "../audit-investor-insights";
import type { AuditDpuRow } from "../../../lib/db/audit-queries";
import type { AuditReport, DealAuditResult } from "../audit-investor-insights";

// ── parseEvidenceRef ──────────────────────────────────────────────────────────

describe("parseEvidenceRef", () => {
	it('parses a valid dpu ref "dpu:doc:ae9a45e5:page:10"', () => {
		const result = parseEvidenceRef("dpu:doc:ae9a45e5:page:10");
		expect(result.type).toBe("dpu");
		expect(result.docPrefix).toBe("ae9a45e5");
		expect(result.pageIndex).toBe(10);
		expect(result.itemPrefix).toBeNull();
	});

	it('parses a valid dpu ref with page index 0 "dpu:doc:00abcdef:page:0"', () => {
		const result = parseEvidenceRef("dpu:doc:00abcdef:page:0");
		expect(result.type).toBe("dpu");
		expect(result.docPrefix).toBe("00abcdef");
		expect(result.pageIndex).toBe(0);
	});

	it('parses an evidence item ref "evidence:item:abc123de"', () => {
		const result = parseEvidenceRef("evidence:item:abc123de");
		expect(result.type).toBe("evidence_item");
		expect(result.itemPrefix).toBe("abc123de");
		expect(result.docPrefix).toBeNull();
		expect(result.pageIndex).toBeNull();
	});

	it('returns type="unknown" for garbage input', () => {
		const result = parseEvidenceRef("garbage");
		expect(result.type).toBe("unknown");
		expect(result.docPrefix).toBeNull();
		expect(result.pageIndex).toBeNull();
		expect(result.itemPrefix).toBeNull();
	});

	it("returns unknown for empty string", () => {
		const result = parseEvidenceRef("");
		expect(result.type).toBe("unknown");
	});
});

// ── resolveEvidenceRef ────────────────────────────────────────────────────────

const SAMPLE_DPU_ROWS: AuditDpuRow[] = [
	{
		document_id: "ae9a45e5-1234-5678-9abc-def012345678",
		page_index: 10,
		page_text: "We are raising $5M series A round.",
		version: "v1",
		updated_at: "2026-01-01T00:00:00",
	},
	{
		document_id: "ae9a45e5-1234-5678-9abc-def012345678",
		page_index: 11,
		page_text: "Our TAM is $1B in the SaaS market.",
		version: "v1",
		updated_at: "2026-01-01T00:00:00",
	},
	{
		document_id: "bbbbbbbb-0000-0000-0000-000000000001",
		page_index: 1,
		page_text: "MRR is $120k and growing 20% month-over-month.",
		version: "v1",
		updated_at: "2026-01-01T00:00:00",
	},
];

describe("resolveEvidenceRef", () => {
	it("finds a matching DPU row by docPrefix + pageIndex", () => {
		const row = resolveEvidenceRef("dpu:doc:ae9a45e5:page:10", SAMPLE_DPU_ROWS);
		expect(row).not.toBeNull();
		expect(row?.page_index).toBe(10);
		expect(row?.document_id).toBe("ae9a45e5-1234-5678-9abc-def012345678");
	});

	it("returns null when page index does not match", () => {
		const row = resolveEvidenceRef("dpu:doc:ae9a45e5:page:99", SAMPLE_DPU_ROWS);
		expect(row).toBeNull();
	});

	it("returns null when docPrefix does not match any document", () => {
		const row = resolveEvidenceRef("dpu:doc:deadbeef:page:10", SAMPLE_DPU_ROWS);
		expect(row).toBeNull();
	});

	it("returns null for evidence:item refs (not DPU)", () => {
		const row = resolveEvidenceRef("evidence:item:ae9a45e5", SAMPLE_DPU_ROWS);
		expect(row).toBeNull();
	});

	it("returns null for garbage refs", () => {
		const row = resolveEvidenceRef("not-a-ref", SAMPLE_DPU_ROWS);
		expect(row).toBeNull();
	});
});

// ── findSnippetInPageText ─────────────────────────────────────────────────────

describe("findSnippetInPageText", () => {
	it("returns true when snippet appears exactly in page text", () => {
		const found = findSnippetInPageText(
			"raising $5M series A",
			"We are raising $5M series A round for our business."
		);
		expect(found).toBe(true);
	});

	it("returns true when snippet appears after normalization (case insensitive)", () => {
		const found = findSnippetInPageText(
			"MRR IS $120k",
			"MRR is $120k and growing 20% month-over-month."
		);
		expect(found).toBe(true);
	});

	it("returns false when snippet is completely absent", () => {
		const found = findSnippetInPageText(
			"series B round $20M",
			"We have no traction to speak of."
		);
		expect(found).toBe(false);
	});

	it("returns false for empty snippet", () => {
		const found = findSnippetInPageText("", "some page text with content");
		expect(found).toBe(false);
	});

	it("returns false for empty page text", () => {
		const found = findSnippetInPageText("raising $5M", "");
		expect(found).toBe(false);
	});

	it("returns true for a 40-char truncated stub match", () => {
		const longSnippet = "Retention ratio 60.00% as of last quarter measured over 12 months";
		const pageText    = "Retention ratio 60.00% as of last quarter measured over 12 months trailing";
		const found = findSnippetInPageText(longSnippet, pageText);
		expect(found).toBe(true);
	});

	// ── XLSX pipe-separator regression (WebMax BAD_EVIDENCE_REF fix) ──────────
	// The extraction pipeline writes '|' → '/' in slot values to avoid breaking
	// the pipe-delimited slot body format. XLSX page_text retains '|' as a cell
	// separator. findSnippetInPageText must bridge this gap.

	it("returns true when stored snippet has '/' but page_text has '|' (XLSX cell separator)", () => {
		// Mirrors the exact WebMax traction_signal case:
		//   page_text: "retention ratio | 60.00%"
		//   stored:    "Retention ratio / 60.00%"
		const found = findSnippetInPageText(
			"Retention ratio / 60.00%",
			"Sheet: Revenue\n- 1: retention ratio | 60.00%\n- 2: month 1 | month 2"
		);
		expect(found).toBe(true);
	});

	it("returns true for other slots where slot value slash came from XLSX pipe", () => {
		const found = findSnippetInPageText(
			"churn rate / 15%",
			"- 5: churn rate | 15% | month 1 | month 2"
		);
		expect(found).toBe(true);
	});

	it("still returns false when snippet is genuinely absent after pipe-normalization", () => {
		const found = findSnippetInPageText(
			"win rate / 80%",
			"Sheet: Revenue\n- 1: retention ratio | 60.00%\n- 2: churn | 5%"
		);
		expect(found).toBe(false);
	});

	it("returns true when '|' is not surrounded by spaces (OCR-adjacent text like 'xellejixel| double')", () => {
		// Mirrors Palm traction_signal case: formatSlotLine turns '|' → '/' with no
		// extra spaces — the haystack normalization must match the SAME behavior.
		const found = findSnippetInPageText(
			"Engagement pxelelléxellejixel/ double digit growth over the last 5 11%",
			"Engagement pxelelléxellejixel| double digit growth over the last 5 11%"
		);
		expect(found).toBe(true);
	});
});

// ── parseStoredSlotsBody ──────────────────────────────────────────────────────

describe("parseStoredSlotsBody", () => {
	it("parses a well-formed 5-slot body", () => {
		const body = [
			`raise_terms: Computable | value="raising $5M" | evidence=dpu:doc:ae9a45e5:page:10 | reason=none`,
			`market_claims: Computable | value="TAM $1B" | evidence=dpu:doc:ae9a45e5:page:11 | reason=none`,
			`traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION`,
			`valuation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION`,
			`use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`,
		].join("\n");

		const rows = parseStoredSlotsBody(body);
		expect(rows).toHaveLength(5);

		const rt = rows.find((r) => r.slot === "raise_terms");
		expect(rt?.status).toBe("Computable");
		expect(rt?.value).toBe("raising $5M");
		expect(rt?.evidence).toBe("dpu:doc:ae9a45e5:page:10");

		const ts = rows.find((r) => r.slot === "traction_signal");
		expect(ts?.status).toBe("NotComputable");
		expect(ts?.value).toBeNull();
		expect(ts?.evidence).toBeNull();
	});

	it("strips surrounding quotes from stored value", () => {
		const body = `raise_terms: Computable | value="some value here" | evidence=dpu:doc:ae9a45e5:page:1 | reason=none`;
		const rows = parseStoredSlotsBody(body);
		expect(rows[0].value).toBe("some value here");
	});

	it("handles a value that contains a pipe-sanitized slash", () => {
		const body = `traction_signal: Computable | value="Retention ratio / 60.00%" | evidence=dpu:doc:ae9a45e5:page:1 | reason=none`;
		const rows = parseStoredSlotsBody(body);
		expect(rows[0].value).toBe("Retention ratio / 60.00%");
	});

	it("returns empty array for empty string", () => {
		expect(parseStoredSlotsBody("")).toHaveLength(0);
	});
});

// ── classifySlotFailure ───────────────────────────────────────────────────────

describe("classifySlotFailure", () => {
	it("returns MISSING_DPU when dpuMissing=true", () => {
		const tag = classifySlotFailure({
			dpuMissing: true,
			dpuEmpty: false,
			storedComputable: false,
			recomputedComputable: false,
			evidenceResolves: null,
			snippetFound: null,
			hasParseHazard: false,
		});
		expect(tag).toBe("MISSING_DPU");
	});

	it("returns EMPTY_TEXT when pages exist but all have empty text", () => {
		const tag = classifySlotFailure({
			dpuMissing: false,
			dpuEmpty: true,
			storedComputable: false,
			recomputedComputable: false,
			evidenceResolves: null,
			snippetFound: null,
			hasParseHazard: false,
		});
		expect(tag).toBe("EMPTY_TEXT");
	});

	it("returns FALSE_NEGATIVE when stored=NotComputable but recomputed=Computable", () => {
		const tag = classifySlotFailure({
			dpuMissing: false,
			dpuEmpty: false,
			storedComputable: false,
			recomputedComputable: true,
			evidenceResolves: null,
			snippetFound: null,
			hasParseHazard: false,
		});
		expect(tag).toBe("FALSE_NEGATIVE");
	});

	it("returns BAD_EVIDENCE_REF when stored=Computable but evidenceResolves=false", () => {
		const tag = classifySlotFailure({
			dpuMissing: false,
			dpuEmpty: false,
			storedComputable: true,
			recomputedComputable: true,
			evidenceResolves: false,
			snippetFound: null,
			hasParseHazard: false,
		});
		expect(tag).toBe("BAD_EVIDENCE_REF");
	});

	it("returns BAD_EVIDENCE_REF when stored=Computable but snippet not found in page", () => {
		const tag = classifySlotFailure({
			dpuMissing: false,
			dpuEmpty: false,
			storedComputable: true,
			recomputedComputable: true,
			evidenceResolves: true,
			snippetFound: false,
			hasParseHazard: false,
		});
		expect(tag).toBe("BAD_EVIDENCE_REF");
	});

	it("returns PARSE_HAZARD when stored value contains a raw pipe", () => {
		const tag = classifySlotFailure({
			dpuMissing: false,
			dpuEmpty: false,
			storedComputable: true,
			recomputedComputable: true,
			evidenceResolves: true,
			snippetFound: true,
			hasParseHazard: true,
		});
		expect(tag).toBe("PARSE_HAZARD");
	});

	it("returns null when everything is fine", () => {
		const tag = classifySlotFailure({
			dpuMissing: false,
			dpuEmpty: false,
			storedComputable: true,
			recomputedComputable: true,
			evidenceResolves: true,
			snippetFound: true,
			hasParseHazard: false,
		});
		expect(tag).toBeNull();
	});

	it("returns null when both stored and recomputed are NotComputable (no signal to detect)", () => {
		const tag = classifySlotFailure({
			dpuMissing: false,
			dpuEmpty: false,
			storedComputable: false,
			recomputedComputable: false,
			evidenceResolves: null,
			snippetFound: null,
			hasParseHazard: false,
		});
		expect(tag).toBeNull();
	});
});

// ── AUDIT_QUERY_SQL structure check ──────────────────────────────────────────

describe("audit-queries SQL", () => {
	it("AUDIT_QUERY_SQL contains ordering clause for deterministic output", async () => {
		const { AUDIT_QUERY_SQL } = await import("../../../lib/db/audit-queries");
		expect(AUDIT_QUERY_SQL).toContain("ORDER BY document_id ASC, page_index ASC");
	});

	it("AUDIT_QUERY_SQL references deal_id parameter $1", async () => {
		const { AUDIT_QUERY_SQL } = await import("../../../lib/db/audit-queries");
		expect(AUDIT_QUERY_SQL).toContain("$1::uuid");
	});
});

// ── printAuditMarkdown smoke test ─────────────────────────────────────────────

describe("printAuditMarkdown", () => {
	it("produces a non-empty Markdown string with the expected headings", () => {
		const report: AuditReport = {
			generated_at: "2026-01-01T00:00:00.000Z",
			deals: [
				{
					deal_id: "00000000-0000-0000-0000-000000000001",
					deal_label: "Test Deal",
					audit_status: "ok",
					error: null,
					documents: [],
					dpu: {
						total_pages: 0,
						empty_text_pages: 0,
						non_empty_pages: 0,
						avg_text_len: 0,
						doc_coverage: [],
					},
					doc_coverage_diagnostics: [],
					report: {
						present: false,
						status: null,
						engine_version: null,
						updated_at: null,
						sections_present: [],
					},
					slots: [],
					failure_tags: [],
				},
			],
			summary: {
				total_deals: 1,
				deals_ok: 1,
				deals_partial: 0,
				deals_failed: 0,
				deals_not_found: 0,
				top_failure_tags: [],
				top_missing_slots: [],
			},
			fix_recommendations: [],
			delta: null,
		};

		const md = printAuditMarkdown(report);
		expect(md).toContain("# Investor Insights Audit Report");
		expect(md).toContain("## Portfolio Summary");
		expect(md).toContain("## Per-Deal Results");
		expect(md).toContain("Test Deal");
		expect(md).toContain(report.generated_at);
	});
});

// ── parseDealListFile ─────────────────────────────────────────────────────────

describe("parseDealListFile", () => {
	it("accepts a valid deal list", () => {
		const raw = {
			deals: [
				{ name: "Acme", deal_id: "00000000-0000-0000-0000-000000000001" },
				{ name: "Beta", deal_id: "00000000-0000-0000-0000-000000000002" },
			],
		};
		const result = parseDealListFile(raw);
		expect(result.deals).toHaveLength(2);
		expect(result.deals[0].name).toBe("Acme");
		expect(result.deals[1].deal_id).toBe("00000000-0000-0000-0000-000000000002");
	});

	it("throws on invalid UUID", () => {
		expect(() =>
			parseDealListFile({
				deals: [{ name: "Bad", deal_id: "not-a-uuid" }],
			})
		).toThrow(/valid UUID/);
	});

	it("throws when deals array is missing", () => {
		expect(() => parseDealListFile({ other: 123 })).toThrow(/"deals" array/);
	});

	it("throws on empty deals array", () => {
		expect(() => parseDealListFile({ deals: [] })).toThrow(/at least one entry/);
	});

	it("throws when input is not an object", () => {
		expect(() => parseDealListFile("hello")).toThrow();
		expect(() => parseDealListFile(null)).toThrow();
		expect(() => parseDealListFile(["a"])).toThrow();
	});

	it("trims whitespace from names", () => {
		const result = parseDealListFile({
			deals: [{ name: "  Trimmed  ", deal_id: "00000000-0000-0000-0000-000000000003" }],
		});
		expect(result.deals[0].name).toBe("Trimmed");
	});
});

// ── pooledMap ─────────────────────────────────────────────────────────────────

describe("pooledMap", () => {
	it("preserves output order regardless of async timing", async () => {
		const items = [0, 1, 2, 3, 4];
		// each task resolves after (4 - index) ms to invert natural completion order
		const results = await pooledMap(items, 3, async (n) => {
			await new Promise((r) => setTimeout(r, (4 - n) * 2));
			return n * 2;
		});
		expect(results).toEqual([0, 2, 4, 6, 8]);
	});

	it("handles concurrency === 1 (serial)", async () => {
		const order: number[] = [];
		await pooledMap([0, 1, 2], 1, async (n) => {
			order.push(n);
			return n;
		});
		expect(order).toEqual([0, 1, 2]);
	});

	it("handles concurrency > items.length without error", async () => {
		const results = await pooledMap(["a", "b"], 100, async (s) => s.toUpperCase());
		expect(results).toEqual(["A", "B"]);
	});

	it("returns empty array for empty input", async () => {
		const results = await pooledMap([], 4, async (n: number) => n);
		expect(results).toEqual([]);
	});
});

// ── computeDelta ──────────────────────────────────────────────────────────────

function makeMinimalReport(overrides: Partial<AuditReport> = {}): AuditReport {
	return {
		generated_at: "2026-01-01T00:00:00.000Z",
		deals: [],
		summary: {
			total_deals: 0,
			deals_ok: 0,
			deals_partial: 0,
			deals_failed: 0,
			deals_not_found: 0,
			top_failure_tags: [],
			top_missing_slots: [],
		},
		fix_recommendations: [],
		delta: null,
		...overrides,
	};
}

function makeMinimalDeal(overrides: Partial<DealAuditResult> = {}): DealAuditResult {
	return {
		deal_id: "00000000-0000-0000-0000-000000000001",
		deal_label: "Test",
		audit_status: "ok",
		error: null,
		documents: [],
		dpu: { total_pages: 0, empty_text_pages: 0, non_empty_pages: 0, avg_text_len: 0, doc_coverage: [] },
		doc_coverage_diagnostics: [],
		report: { present: false, status: null, engine_version: null, updated_at: null, sections_present: [] },
		slots: [],
		failure_tags: [],
		...overrides,
	};
}

describe("computeDelta", () => {
	it("reports zero change when both reports are identical", () => {
		const report = makeMinimalReport({ generated_at: "2026-01-02T00:00:00.000Z" });
		const delta = computeDelta(report, report);
		expect(delta.failures_reduced).toBe(0);
		expect(delta.failures_increased).toBe(0);
		expect(delta.new_failure_tags).toHaveLength(0);
		expect(delta.deals_newly_failing).toHaveLength(0);
		expect(delta.deals_newly_ok).toHaveLength(0);
	});

	it("detects deals_newly_failing when new tags appear", () => {
		const baseline = makeMinimalReport({
			deals: [makeMinimalDeal({ failure_tags: [] })],
		});
		const current = makeMinimalReport({
			generated_at: "2026-01-02T00:00:00.000Z",
			deals: [makeMinimalDeal({ failure_tags: ["MISSING_DPU"] })],
		});
		const delta = computeDelta(baseline, current);
		expect(delta.deals_newly_failing).toHaveLength(1);
		expect(delta.deals_newly_failing[0].new_tags).toContain("MISSING_DPU");
		expect(delta.failures_increased).toBeGreaterThan(0);
	});

	it("detects deals_newly_ok when all failures resolved", () => {
		const baseline = makeMinimalReport({
			deals: [makeMinimalDeal({ failure_tags: ["EMPTY_TEXT"] })],
		});
		const current = makeMinimalReport({
			generated_at: "2026-01-02T00:00:00.000Z",
			deals: [makeMinimalDeal({ failure_tags: [] })],
		});
		const delta = computeDelta(baseline, current);
		expect(delta.deals_newly_ok).toHaveLength(1);
		expect(delta.failures_reduced).toBeGreaterThan(0);
	});

	it("populates new_failure_tags for first-time failure classes", () => {
		const baseline = makeMinimalReport({ deals: [makeMinimalDeal({ failure_tags: [] })] });
		const current = makeMinimalReport({
			generated_at: "2026-01-02T00:00:00.000Z",
			deals: [makeMinimalDeal({ failure_tags: ["PARSE_HAZARD"] })],
		});
		const delta = computeDelta(baseline, current);
		expect(delta.new_failure_tags).toContain("PARSE_HAZARD");
	});

	it("records correct baseline and current generated_at timestamps", () => {
		const baseline = makeMinimalReport({ generated_at: "2026-01-01T00:00:00.000Z" });
		const current  = makeMinimalReport({ generated_at: "2026-01-02T00:00:00.000Z" });
		const delta = computeDelta(baseline, current);
		expect(delta.baseline_generated_at).toBe("2026-01-01T00:00:00.000Z");
		expect(delta.current_generated_at).toBe("2026-01-02T00:00:00.000Z");
	});
});

// ── checkGate ─────────────────────────────────────────────────────────────────

describe("checkGate", () => {
	it("passes when there are no failures", () => {
		const report = makeMinimalReport({ deals: [makeMinimalDeal()] });
		const gate = checkGate(report, { failOn: ["MISSING_DPU"], maxFailures: 0 });
		expect(gate.passed).toBe(true);
		expect(gate.violations).toHaveLength(0);
	});

	it("passes when count is within maxFailures", () => {
		const report = makeMinimalReport({
			deals: [
				makeMinimalDeal({ failure_tags: ["MISSING_DPU"] }),
				makeMinimalDeal({ deal_id: "00000000-0000-0000-0000-000000000002", failure_tags: ["MISSING_DPU"] }),
			],
		});
		const gate = checkGate(report, { failOn: ["MISSING_DPU"], maxFailures: 2 });
		expect(gate.passed).toBe(true);
	});

	it("fails when count exceeds maxFailures", () => {
		const report = makeMinimalReport({
			deals: [
				makeMinimalDeal({ failure_tags: ["EMPTY_TEXT"] }),
				makeMinimalDeal({ deal_id: "00000000-0000-0000-0000-000000000002", failure_tags: ["EMPTY_TEXT"] }),
			],
		});
		const gate = checkGate(report, { failOn: ["EMPTY_TEXT"], maxFailures: 0 });
		expect(gate.passed).toBe(false);
		expect(gate.violations).toHaveLength(1);
		expect(gate.violations[0].tag).toBe("EMPTY_TEXT");
		expect(gate.violations[0].count).toBe(2);
	});

	it("reports violations for multiple tags", () => {
		const report = makeMinimalReport({
			deals: [
				makeMinimalDeal({ failure_tags: ["MISSING_DPU", "FALSE_NEGATIVE"] }),
			],
		});
		const gate = checkGate(report, { failOn: ["MISSING_DPU", "FALSE_NEGATIVE"], maxFailures: 0 });
		expect(gate.passed).toBe(false);
		expect(gate.violations).toHaveLength(2);
	});

	it("only gates on tags listed in failOn", () => {
		const report = makeMinimalReport({
			deals: [makeMinimalDeal({ failure_tags: ["OTHER"] })],
		});
		const gate = checkGate(report, { failOn: ["MISSING_DPU"], maxFailures: 0 });
		expect(gate.passed).toBe(true);
	});
});

// ── wrapPoolReadOnly / ReadOnlyViolationError ─────────────────────────────────

describe("wrapPoolReadOnly", () => {
	function makePool(onQuery: (text: string) => void): import("pg").Pool {
		// minimal mock that records the query text
		return {
			query: (arg: unknown) => {
				const text = typeof arg === "string" ? arg : (arg as { text: string }).text;
				onQuery(text);
				return Promise.resolve({ rows: [] });
			},
		} as unknown as import("pg").Pool;
	}

	it("allows SELECT queries through", async () => {
		const called: string[] = [];
		const safe = wrapPoolReadOnly(makePool((t) => called.push(t)));
		await (safe.query as Function)("SELECT 1");
		expect(called).toContain("SELECT 1");
	});

	it("throws ReadOnlyViolationError on INSERT", () => {
		const safe = wrapPoolReadOnly(makePool(() => {}));
		expect(() => (safe.query as Function)("INSERT INTO x VALUES (1)")).toThrow(ReadOnlyViolationError);
	});

	it("throws ReadOnlyViolationError on UPDATE", () => {
		const safe = wrapPoolReadOnly(makePool(() => {}));
		expect(() => (safe.query as Function)("UPDATE x SET y=1")).toThrow(ReadOnlyViolationError);
	});

	it("throws ReadOnlyViolationError on DELETE", () => {
		const safe = wrapPoolReadOnly(makePool(() => {}));
		expect(() => (safe.query as Function)("DELETE FROM x WHERE id=1")).toThrow(ReadOnlyViolationError);
	});

	it("throws ReadOnlyViolationError on TRUNCATE", () => {
		const safe = wrapPoolReadOnly(makePool(() => {}));
		expect(() => (safe.query as Function)("TRUNCATE TABLE x")).toThrow(ReadOnlyViolationError);
	});

	it("error message contains the query prefix", () => {
		const safe = wrapPoolReadOnly(makePool(() => {}));
		try {
			(safe.query as Function)("INSERT INTO audit_log VALUES (1)");
		} catch (e) {
			expect(e).toBeInstanceOf(ReadOnlyViolationError);
			expect((e as Error).message).toContain("READ-ONLY VIOLATION");
			expect((e as Error).message).toContain("INSERT");
		}
	});
});

// ── buildFixRecommendations ───────────────────────────────────────────────────

describe("buildFixRecommendations", () => {
	it("returns empty array when no failure_tags exist", () => {
		const recs = buildFixRecommendations([makeMinimalDeal()]);
		expect(recs).toHaveLength(0);
	});

	it("returns one entry per distinct failure class present in slots", () => {
		const deal = makeMinimalDeal({
			slots: [
				{
					slot: "raise_terms",
					stored_status: "Missing",
					stored_value: null,
					stored_evidence: null,
					recomputed_status: "NotComputable",
					recomputed_value: null,
					recomputed_evidence: null,
					validation: { evidence_ref_resolves: null, snippet_found_in_page_text: null, page_text_len: null },
					failure_tag: "MISSING_DPU",
					notes: null,
				},
				{
					slot: "market_claims",
					stored_status: "Missing",
					stored_value: null,
					stored_evidence: null,
					recomputed_status: "NotComputable",
					recomputed_value: null,
					recomputed_evidence: null,
					validation: { evidence_ref_resolves: null, snippet_found_in_page_text: null, page_text_len: null },
					failure_tag: "MISSING_DPU",
					notes: null,
				},
			],
		});
		const recs = buildFixRecommendations([deal]);
		expect(recs).toHaveLength(1);
		expect(recs[0].failure_tag).toBe("MISSING_DPU");
		expect(recs[0].count).toBe(2);
	});

	it("sorts by count descending", () => {
		const deal = makeMinimalDeal({
			slots: [
				{ slot: "s1", stored_status: "Missing", stored_value: null, stored_evidence: null,
				  recomputed_status: "NotComputable", recomputed_value: null, recomputed_evidence: null,
				  validation: { evidence_ref_resolves: null, snippet_found_in_page_text: null, page_text_len: null },
				  failure_tag: "EMPTY_TEXT", notes: null },
				{ slot: "s2", stored_status: "Missing", stored_value: null, stored_evidence: null,
				  recomputed_status: "NotComputable", recomputed_value: null, recomputed_evidence: null,
				  validation: { evidence_ref_resolves: null, snippet_found_in_page_text: null, page_text_len: null },
				  failure_tag: "EMPTY_TEXT", notes: null },
				{ slot: "s3", stored_status: "Missing", stored_value: null, stored_evidence: null,
				  recomputed_status: "NotComputable", recomputed_value: null, recomputed_evidence: null,
				  validation: { evidence_ref_resolves: null, snippet_found_in_page_text: null, page_text_len: null },
				  failure_tag: "FALSE_NEGATIVE", notes: null },
			],
		});
		const recs = buildFixRecommendations([deal]);
		expect(recs[0].failure_tag).toBe("EMPTY_TEXT");
		expect(recs[0].count).toBe(2);
		expect(recs[1].failure_tag).toBe("FALSE_NEGATIVE");
		expect(recs[1].count).toBe(1);
	});

	it("includes subsystem and action for each entry", () => {
		const deal = makeMinimalDeal({
			slots: [
				{ slot: "s1", stored_status: "Missing", stored_value: null, stored_evidence: null,
				  recomputed_status: "NotComputable", recomputed_value: null, recomputed_evidence: null,
				  validation: { evidence_ref_resolves: null, snippet_found_in_page_text: null, page_text_len: null },
				  failure_tag: "BAD_EVIDENCE_REF", notes: null },
			],
		});
		const recs = buildFixRecommendations([deal]);
		expect(recs[0].subsystem.length).toBeGreaterThan(0);
		expect(recs[0].action.length).toBeGreaterThan(0);
	});
});
