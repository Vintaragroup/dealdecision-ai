/**
 * PR37 — Deal Risk Radar: Body Serialiser + Parser
 *
 * Renders a DealRiskRadarV1 to a human-readable + machine-parseable section body.
 * Uses the same delimiter convention as PR35/PR36:
 *   ---deal_risk_radar_v1_json---
 *
 * The web-side parseMonitoringBody() extracts the JSON payload for typed access.
 * The text portion is human-readable for direct display in the body field.
 */

import type { DealRiskRadarV1, CompetitorEvent, MarketEvent, CompanyEvent, FounderSignal } from "./monitoring-schema";

export const MONITORING_BODY_DELIMITER = "---deal_risk_radar_v1_json---";

// ─── Impact badge ─────────────────────────────────────────────────────────────

function impactTag(impact: string): string {
	return impact === "high" ? "[HIGH]" : impact === "medium" ? "[MED]" : "[LOW]";
}

function directionTag(dir: string): string {
	return dir === "positive" ? "[+]" : dir === "negative" ? "[-]" : "[~]";
}

// ─── Serialiser ───────────────────────────────────────────────────────────────

/**
 * Serialise DealRiskRadarV1 to a human-readable section body with embedded JSON.
 */
export function serializeMonitoringBody(radar: DealRiskRadarV1): string {
	const lines: string[] = [];

	lines.push(`=== Deal Risk Radar ===`);
	lines.push(`Last scan: ${radar.ran_at}`);
	lines.push(`Next scan: ${radar.next_scheduled_at}`);
	lines.push(`Status: ${radar.run_status}`);
	lines.push(`Sources: ${radar.total_sources_fetched} results · ${radar.source_count} unique`);
	if (radar.company_name_used) {
		lines.push(`Company: ${radar.company_name_used}${radar.sector_used ? ` · ${radar.sector_used}` : ""}`);
	}
	lines.push("");

	// Competitor events
	if (radar.competitor_events.length > 0) {
		lines.push("--- Competitor Signals ---");
		for (const ev of radar.competitor_events) {
			lines.push(`${impactTag(ev.impact)} ${ev.company} — ${ev.event}`);
			lines.push(`  Sources: ${ev.evidence_urls.map(urlDomain).join(", ")}`);
		}
		lines.push("");
	}

	// Company events
	if (radar.company_events.length > 0) {
		lines.push("--- Company Signals ---");
		for (const ev of radar.company_events) {
			lines.push(`${impactTag(ev.impact)} [${ev.category}] ${ev.event}`);
			lines.push(`  Sources: ${ev.evidence_urls.map(urlDomain).join(", ")}`);
		}
		lines.push("");
	}

	// Market events
	if (radar.market_events.length > 0) {
		lines.push("--- Market Signals ---");
		for (const ev of radar.market_events) {
			lines.push(`${directionTag(ev.direction)} ${ev.description}`);
			lines.push(`  Sector: ${ev.sector}`);
			lines.push(`  Sources: ${ev.evidence_urls.map(urlDomain).join(", ")}`);
		}
		lines.push("");
	}

	// Founder signals
	if (radar.founder_signals.length > 0) {
		lines.push("--- Founder / Team Signals ---");
		for (const s of radar.founder_signals) {
			lines.push(`${impactTag(s.impact)} ${s.name} — ${s.signal}`);
			lines.push(`  Sources: ${s.evidence_urls.map(urlDomain).join(", ")}`);
		}
		lines.push("");
	}

	// Skipped / no signals
	const totalEvents =
		radar.competitor_events.length +
		radar.company_events.length +
		radar.market_events.length +
		radar.founder_signals.length;
	if (totalEvents === 0) {
		lines.push("No new signals detected in this monitoring run.");
		lines.push("");
	}

	lines.push(`Signal consensus: ${radar.signal_consensus.toUpperCase()}`);
	lines.push("");

	// Embedded JSON payload
	lines.push(MONITORING_BODY_DELIMITER);
	lines.push(JSON.stringify({ ...radar, schema_version: "deal_risk_radar_v1" }));

	return lines.join("\n");
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a DealRiskRadarV1 from a section body string.
 *
 * Returns null when:
 *   - Delimiter is absent (section is not a monitoring body).
 *   - JSON is invalid.
 *   - schema_version !== "deal_risk_radar_v1".
 */
export function parseMonitoringBody(body: string): DealRiskRadarV1 | null {
	const delimIdx = body.indexOf(MONITORING_BODY_DELIMITER);
	if (delimIdx === -1) return null;

	const jsonStr = body.slice(delimIdx + MONITORING_BODY_DELIMITER.length).trim();
	if (!jsonStr) return null;

	try {
		const raw = JSON.parse(jsonStr) as Record<string, unknown>;
		if (raw["schema_version"] !== "deal_risk_radar_v1") return null;
		return raw as unknown as DealRiskRadarV1;
	} catch {
		return null;
	}
}

// ─── Render section builder ───────────────────────────────────────────────────

/**
 * Build a render-package section from a DealRiskRadarV1.
 *
 * Returns null when the radar has run_status="skipped" and zero sources,
 * matching the same guard used in PR35's buildExternalDiligenceRenderSection().
 */
export function buildMonitoringRenderSection(
	radar: DealRiskRadarV1
): { key: string; title: string; kind: "message"; body: string; fallback: string } | null {
	if (radar.run_status === "skipped" && radar.total_sources_fetched === 0) {
		return null;
	}
	return {
		key: "deal_risk_radar_v1",
		title: "Deal Risk Radar",
		kind: "message",
		body: serializeMonitoringBody(radar),
		fallback: "Deal risk radar data unavailable.",
	};
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function urlDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url.slice(0, 40);
	}
}
