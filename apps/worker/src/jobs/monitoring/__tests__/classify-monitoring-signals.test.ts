/**
 * classify-monitoring-signals.test.ts — PR37
 *
 * Unit tests for classifyMonitoringSignals().
 *
 * Strategy:
 *   - Empty buckets produce empty event arrays
 *   - company_signals bucket maps to company_events with correct category
 *   - competitor_signals bucket maps to competitor_events with resolved company name
 *   - market_signals bucket maps to market_events with correct direction
 *   - founder_team_signals bucket maps to founder_signals with resolved name
 *   - High-impact keywords produce impact="high"
 *   - Medium-impact keywords produce impact="medium"
 *   - Fallback impact is "low"
 *   - Positive market keywords produce direction="positive"
 *   - Negative market keywords produce direction="negative"
 *   - Funding keywords produce category="funding"
 *   - Legal keywords produce category="legal"
 */

import { describe, it, expect } from "vitest";
import { classifyMonitoringSignals } from "../classify-monitoring-signals";
import type { MonitoringSearchBucket } from "../monitoring-schema";

function makeResult(
	title: string,
	snippet = "",
	url = "https://example.com/a",
	bucket: MonitoringSearchBucket["bucket"] = "company_signals"
) {
	return { title, snippet, url, published_date: null, score: 1.0, bucket };
}

function makeBucket(
	bucket: MonitoringSearchBucket["bucket"],
	results: ReturnType<typeof makeResult>[]
): MonitoringSearchBucket {
	return {
		bucket,
		query_used: `${bucket} test query`,
		results: results.map((r) => ({ ...r, bucket })),
		results_count: results.length,
		status: "ok",
	};
}

const emptyCtx = { competitor_names: [] as string[], founder_names: [] as string[], sector: null };

describe("classifyMonitoringSignals", () => {
	it("returns all 4 empty arrays when buckets are empty", () => {
		const result = classifyMonitoringSignals([], emptyCtx);
		expect(result.competitor_events).toHaveLength(0);
		expect(result.company_events).toHaveLength(0);
		expect(result.market_events).toHaveLength(0);
		expect(result.founder_signals).toHaveLength(0);
	});

	it("maps company_signals results to company_events", () => {
		const buckets = [makeBucket("company_signals", [makeResult("AcmeCorp launches new product")])];
		const result = classifyMonitoringSignals(buckets, emptyCtx);
		expect(result.company_events).toHaveLength(1);
		expect(result.company_events[0]!.event).toContain("AcmeCorp");
	});

	it("assigns category=funding for funding keywords", () => {
		const buckets = [
			makeBucket("company_signals", [makeResult("AcmeCorp raises $5M series A funding round")]),
		];
		const result = classifyMonitoringSignals(buckets, emptyCtx);
		expect(result.company_events[0]!.category).toBe("funding");
	});

	it("assigns category=legal for legal keywords", () => {
		const buckets = [
			makeBucket("company_signals", [makeResult("AcmeCorp faces SEC lawsuit over compliance")]),
		];
		const result = classifyMonitoringSignals(buckets, emptyCtx);
		expect(result.company_events[0]!.category).toBe("legal");
	});

	it("assigns category=product for product keywords", () => {
		const buckets = [
			makeBucket("company_signals", [makeResult("AcmeCorp launches new product feature update")]),
		];
		const result = classifyMonitoringSignals(buckets, emptyCtx);
		expect(result.company_events[0]!.category).toBe("product");
	});

	it("assigns impact=high for high-impact keywords (raises, million)", () => {
		const buckets = [
			makeBucket("company_signals", [makeResult("AcmeCorp raises $10 million series B")]),
		];
		const result = classifyMonitoringSignals(buckets, emptyCtx);
		expect(result.company_events[0]!.impact).toBe("high");
	});

	it("assigns impact=medium for medium-impact keywords (launches)", () => {
		const buckets = [
			makeBucket("company_signals", [makeResult("AcmeCorp launches new partnership")]),
		];
		const result = classifyMonitoringSignals(buckets, emptyCtx);
		expect(result.company_events[0]!.impact).toBe("medium");
	});

	it("assigns impact=low for neutral headlines", () => {
		const buckets = [
			makeBucket("company_signals", [makeResult("AcmeCorp opens new San Francisco office")]),
		];
		const result = classifyMonitoringSignals(buckets, emptyCtx);
		expect(result.company_events[0]!.impact).toBe("low");
	});

	it("resolves competitor name from known list", () => {
		const buckets = [
			makeBucket("competitor_signals", [
				makeResult("BetaCorp closes $20M acquisition deal", "", "https://news.com/1"),
			]),
		];
		const result = classifyMonitoringSignals(buckets, {
			...emptyCtx,
			competitor_names: ["BetaCorp", "GammaCo"],
		});
		expect(result.competitor_events[0]!.company).toBe("BetaCorp");
	});

	it("assigns direction=negative for negative market keywords", () => {
		const buckets = [
			makeBucket("market_signals", [makeResult("VC slowdown regulation uncertainty crisis")]),
		];
		const result = classifyMonitoringSignals(buckets, emptyCtx);
		expect(result.market_events[0]!.direction).toBe("negative");
	});

	it("assigns direction=positive for positive market keywords", () => {
		const buckets = [
			makeBucket("market_signals", [makeResult("VC activity surge investment up growth")]),
		];
		const result = classifyMonitoringSignals(buckets, emptyCtx);
		expect(result.market_events[0]!.direction).toBe("positive");
	});

	it("resolves founder name from list in founder_team_signals", () => {
		const buckets = [
			makeBucket("founder_team_signals", [makeResult("Alice Chen joins Andreessen Horowitz as advisor")]),
		];
		const result = classifyMonitoringSignals(buckets, {
			...emptyCtx,
			founder_names: ["Alice Chen"],
		});
		expect(result.founder_signals[0]!.name).toBe("Alice Chen");
	});

	it("uses sector in market event when context provides it", () => {
		const buckets = [
			makeBucket("market_signals", [makeResult("HealthTech market growing steadily")]),
		];
		const result = classifyMonitoringSignals(buckets, { ...emptyCtx, sector: "HealthTech" });
		expect(result.market_events[0]!.sector).toBe("HealthTech");
	});
});
