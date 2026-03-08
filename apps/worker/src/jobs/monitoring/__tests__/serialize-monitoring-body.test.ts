/**
 * serialize-monitoring-body.test.ts — PR37
 *
 * Unit tests for serializeMonitoringBody(), parseMonitoringBody(),
 * and buildMonitoringRenderSection().
 *
 * Strategy:
 *   - serialize + parse round-trip restores the original DealRiskRadarV1
 *   - parseMonitoringBody returns null when delimiter is absent
 *   - parseMonitoringBody returns null when JSON is invalid
 *   - parseMonitoringBody returns null when schema_version is wrong
 *   - buildMonitoringRenderSection returns null when status=skipped and no sources
 *   - buildMonitoringRenderSection returns section when run_status=succeeded
 *   - section has correct key, title, kind
 *   - human-readable portion mentions company name and signal consensus
 */

import { describe, it, expect } from "vitest";
import {
	serializeMonitoringBody,
	parseMonitoringBody,
	buildMonitoringRenderSection,
	MONITORING_BODY_DELIMITER,
} from "../serialize-monitoring-body";
import type { DealRiskRadarV1 } from "../monitoring-schema";

function makeRadar(overrides: Partial<DealRiskRadarV1> = {}): DealRiskRadarV1 {
	return {
		schema_version: "deal_risk_radar_v1",
		deal_id: "deal-123",
		ran_at: "2026-01-15T10:00:00.000Z",
		next_scheduled_at: "2026-01-22T10:00:00.000Z",
		run_status: "succeeded",
		company_name_used: "AcmeCorp",
		sector_used: "SaaS",
		total_sources_fetched: 12,
		source_count: 8,
		signal_consensus: "mixed",
		competitor_events: [],
		market_events: [],
		company_events: [],
		founder_signals: [],
		...overrides,
	};
}

describe("serializeMonitoringBody", () => {
	it("includes the delimiter", () => {
		const body = serializeMonitoringBody(makeRadar());
		expect(body).toContain(MONITORING_BODY_DELIMITER);
	});

	it("includes company name in human-readable portion", () => {
		const body = serializeMonitoringBody(makeRadar());
		expect(body).toContain("AcmeCorp");
	});

	it("includes signal consensus in human-readable portion", () => {
		const body = serializeMonitoringBody(makeRadar());
		expect(body).toContain("MIXED");
	});

	it("renders competitor events section when events are present", () => {
		const radar = makeRadar({
			competitor_events: [
				{ company: "BetaCorp", event: "BetaCorp raises $10M", impact: "high", evidence_urls: ["https://news.com"] },
			],
		});
		const body = serializeMonitoringBody(radar);
		expect(body).toContain("Competitor Signals");
		expect(body).toContain("BetaCorp");
	});

	it("skips competitor section when no events", () => {
		const body = serializeMonitoringBody(makeRadar({ competitor_events: [] }));
		expect(body).not.toContain("Competitor Signals");
	});

	it("includes no signals message when all arrays empty", () => {
		const body = serializeMonitoringBody(makeRadar());
		expect(body).toContain("No new signals detected");
	});
});

describe("parseMonitoringBody", () => {
	it("returns null for empty string", () => {
		expect(parseMonitoringBody("")).toBeNull();
	});

	it("returns null when delimiter is absent", () => {
		expect(parseMonitoringBody("just some text without the delimiter")).toBeNull();
	});

	it("returns null for invalid JSON after delimiter", () => {
		const body = `preamble\n${MONITORING_BODY_DELIMITER}\n{not valid json`;
		expect(parseMonitoringBody(body)).toBeNull();
	});

	it("returns null when schema_version is wrong", () => {
		const body = `preamble\n${MONITORING_BODY_DELIMITER}\n${JSON.stringify({ schema_version: "wrong_v1" })}`;
		expect(parseMonitoringBody(body)).toBeNull();
	});

	it("round-trips a DealRiskRadarV1 faithfully", () => {
		const radar = makeRadar({
			company_events: [
				{ event: "AcmeCorp signs partnership", category: "press", impact: "medium", evidence_urls: ["https://example.com"] },
			],
			signal_consensus: "bullish",
		});
		const body = serializeMonitoringBody(radar);
		const parsed = parseMonitoringBody(body);
		expect(parsed).not.toBeNull();
		expect(parsed!.schema_version).toBe("deal_risk_radar_v1");
		expect(parsed!.deal_id).toBe("deal-123");
		expect(parsed!.signal_consensus).toBe("bullish");
		expect(parsed!.company_events).toHaveLength(1);
		expect(parsed!.company_events[0]!.event).toBe("AcmeCorp signs partnership");
	});

	it("round-trips competitor events with evidence_urls", () => {
		const radar = makeRadar({
			competitor_events: [
				{ company: "GammaCo", event: "GammaCo acquired by BigCorp", impact: "high", evidence_urls: ["https://a.com", "https://b.com"] },
			],
		});
		const parsed = parseMonitoringBody(serializeMonitoringBody(radar));
		expect(parsed!.competitor_events[0]!.evidence_urls).toEqual(["https://a.com", "https://b.com"]);
	});
});

describe("buildMonitoringRenderSection", () => {
	it("returns null when run_status=skipped and no sources", () => {
		const radar = makeRadar({ run_status: "skipped", total_sources_fetched: 0 });
		expect(buildMonitoringRenderSection(radar)).toBeNull();
	});

	it("returns a section when run_status=succeeded", () => {
		const section = buildMonitoringRenderSection(makeRadar());
		expect(section).not.toBeNull();
		expect(section!.key).toBe("deal_risk_radar_v1");
		expect(section!.title).toBe("Deal Risk Radar");
		expect(section!.kind).toBe("message");
	});

	it("returns a section when run_status=skipped but has sources (partial skip)", () => {
		const radar = makeRadar({ run_status: "skipped", total_sources_fetched: 5 });
		const section = buildMonitoringRenderSection(radar);
		expect(section).not.toBeNull();
	});

	it("returns a section when run_status=failed", () => {
		const radar = makeRadar({ run_status: "failed", total_sources_fetched: 0 });
		const section = buildMonitoringRenderSection(radar);
		expect(section).not.toBeNull();
	});

	it("section body is re-parseable", () => {
		const radar = makeRadar({ signal_consensus: "bearish" });
		const section = buildMonitoringRenderSection(radar)!;
		const parsed = parseMonitoringBody(section.body);
		expect(parsed!.signal_consensus).toBe("bearish");
	});
});
