/**
 * dedupe-monitoring-events.test.ts — PR37
 *
 * Unit tests for dedupeMonitoringEvents().
 *
 * Strategy:
 *   - Distinct events pass through unchanged
 *   - Same URL deduplicates company/market/founder events and merges URLs
 *   - Similar title deduplicates company/market/founder events
 *   - Same company + similar event deduplicates competitor events
 *   - Higher impact wins when competitor events are merged
 *   - URL union is correct after merge
 */

import { describe, it, expect } from "vitest";
import { dedupeMonitoringEvents } from "../dedupe-monitoring-events";
import type { ClassifiedMonitoringEvents } from "../classify-monitoring-signals";
import type { CompetitorEvent, CompanyEvent, MarketEvent, FounderSignal } from "../monitoring-schema";

function emptyEvents(): ClassifiedMonitoringEvents {
	return {
		competitor_events: [],
		company_events: [],
		market_events: [],
		founder_signals: [],
	};
}

describe("dedupeMonitoringEvents", () => {
	it("passes through empty events unchanged", () => {
		const result = dedupeMonitoringEvents(emptyEvents());
		expect(result.competitor_events).toHaveLength(0);
		expect(result.company_events).toHaveLength(0);
		expect(result.market_events).toHaveLength(0);
		expect(result.founder_signals).toHaveLength(0);
	});

	it("passes through fully distinct company events unchanged", () => {
		const events: ClassifiedMonitoringEvents = {
			...emptyEvents(),
			company_events: [
				{ event: "AcmeCorp raises series A", category: "funding", impact: "high", evidence_urls: ["https://a.com"] },
				{ event: "BetaCorp launches mobile app", category: "product", impact: "medium", evidence_urls: ["https://b.com"] },
			],
		};
		const result = dedupeMonitoringEvents(events);
		expect(result.company_events).toHaveLength(2);
	});

	it("deduplicates company events with the same URL", () => {
		const events: ClassifiedMonitoringEvents = {
			...emptyEvents(),
			company_events: [
				{ event: "AcmeCorp raises series A", category: "funding", impact: "high", evidence_urls: ["https://same.com/article"] },
				{ event: "AcmeCorp raises series A funding", category: "funding", impact: "high", evidence_urls: ["https://same.com/article"] },
			],
		};
		const result = dedupeMonitoringEvents(events);
		expect(result.company_events).toHaveLength(1);
	});

	it("deduplicates company events with similar titles", () => {
		const events: ClassifiedMonitoringEvents = {
			...emptyEvents(),
			company_events: [
				{ event: "AcmeCorp announces partnership with Google", category: "press", impact: "medium", evidence_urls: ["https://a.com"] },
				{ event: "AcmeCorp announces partnership with Google Cloud", category: "press", impact: "medium", evidence_urls: ["https://b.com"] },
			],
		};
		const result = dedupeMonitoringEvents(events);
		// Titles are highly similar — should be merged
		expect(result.company_events).toHaveLength(1);
		// Both URLs merged
		expect(result.company_events[0]!.evidence_urls).toHaveLength(2);
	});

	it("deduplicates competitor events with same company and similar event", () => {
		const ev1: CompetitorEvent = { company: "AlphaInc", event: "AlphaInc raises $10M Series A funding round", impact: "high", evidence_urls: ["https://a.com"] };
		const ev2: CompetitorEvent = { company: "AlphaInc", event: "AlphaInc raises Series A funding $10M", impact: "medium", evidence_urls: ["https://b.com"] };
		const events: ClassifiedMonitoringEvents = { ...emptyEvents(), competitor_events: [ev1, ev2] };
		const result = dedupeMonitoringEvents(events);
		expect(result.competitor_events).toHaveLength(1);
	});

	it("keeps highest impact when merging competitor events", () => {
		const ev1: CompetitorEvent = { company: "BetaCo", event: "BetaCo raises one million dollars in funding round", impact: "low", evidence_urls: ["https://a.com"] };
		const ev2: CompetitorEvent = { company: "BetaCo", event: "BetaCo raises one million dollars funding", impact: "high", evidence_urls: ["https://b.com"] };
		const events: ClassifiedMonitoringEvents = { ...emptyEvents(), competitor_events: [ev1, ev2] };
		const result = dedupeMonitoringEvents(events);
		expect(result.competitor_events[0]!.impact).toBe("high");
	});

	it("does NOT merge competitor events with different companies", () => {
		const ev1: CompetitorEvent = { company: "AlphaInc", event: "raises $10M Series A", impact: "high", evidence_urls: ["https://a.com"] };
		const ev2: CompetitorEvent = { company: "BetaCo", event: "raises $10M Series A", impact: "high", evidence_urls: ["https://b.com"] };
		const events: ClassifiedMonitoringEvents = { ...emptyEvents(), competitor_events: [ev1, ev2] };
		const result = dedupeMonitoringEvents(events);
		expect(result.competitor_events).toHaveLength(2);
	});

	it("deduplicates market events by shared URL", () => {
		const events: ClassifiedMonitoringEvents = {
			...emptyEvents(),
			market_events: [
				{ description: "VC slowdown in 2025", sector: "Fintech", direction: "negative", evidence_urls: ["https://shared.com/report"] },
				{ description: "Investment activity declining 2025", sector: "Fintech", direction: "negative", evidence_urls: ["https://shared.com/report"] },
			],
		};
		const result = dedupeMonitoringEvents(events);
		expect(result.market_events).toHaveLength(1);
	});

	it("deduplicates founder signals by similar signal text", () => {
		const signals: ClassifiedMonitoringEvents = {
			...emptyEvents(),
			founder_signals: [
				{ name: "Alice Chen", signal: "Alice Chen steps down as CEO of AcmeCorp", impact: "high", evidence_urls: ["https://a.com"] },
				{ name: "Alice Chen", signal: "Alice Chen steps down from CEO role at AcmeCorp", impact: "high", evidence_urls: ["https://b.com"] },
			],
		};
		const result = dedupeMonitoringEvents(signals);
		expect(result.founder_signals).toHaveLength(1);
		expect(result.founder_signals[0]!.evidence_urls).toHaveLength(2);
	});
});
