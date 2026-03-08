/**
 * PR37 — Deal Risk Radar: Main Entry Point
 *
 * Orchestrates continuous external signal monitoring for a deal.
 *
 * Pipeline:
 *   1. Load deal context from most-recent investor_insight_reports row
 *   2. Extract MonitoringContext (company name, sector, competitors, founders)
 *   3. Build MonitoringQueryPlan
 *   4. Run cost-bounded Tavily news searches
 *   5. Classify signals → DealRiskRadarV1 event types
 *   6. Deduplicate events
 *   7. Compute signal consensus
 *   8. Serialise → render-package section body
 *   9. Upsert deal_risk_radar_v1 section in investor_insight_reports.render_package
 *  10. Schedule next monitoring run (weekly by default)
 *
 * Safety contract:
 *   - Monitoring NEVER modifies canonical fields, gate_state, or LLM interpretation.
 *   - Only the `sections` array in render_package is touched.
 *   - External failures (Tavily errors, parse failures) are contained; the job
 *     always upserts a radar section (possibly with run_status="failed") rather
 *     than leaving the DB in an inconsistent state.
 *
 * Called from BullMQ − queue "monitor_deal_signals".
 */

import type { Job } from "bullmq";
import type { Pool } from "pg";

import { getPool } from "../../lib/db";
import { getQueue } from "../../lib/queue";
import { QUEUE_NAMES } from "@dealdecision/core";
import {
	MONITORING_REPEAT_INTERVAL_MS,
	type DealRiskRadarV1,
	type SignalConsensus,
} from "./monitoring-schema";
import type { MonitoringContext } from "./build-monitoring-query-plan";
import { buildMonitoringQueryPlan } from "./build-monitoring-query-plan";
import { runMonitoringSearches } from "./run-monitoring-searches";
import { classifyMonitoringSignals } from "./classify-monitoring-signals";
import { dedupeMonitoringEvents } from "./dedupe-monitoring-events";
import type { ClassifiedMonitoringEvents } from "./classify-monitoring-signals";
import { buildMonitoringRenderSection, parseMonitoringBody } from "./serialize-monitoring-body";
import {
	parseLlmInterpretationBody,
} from "../investor-insights/llm-interpretation-v1";
import { parseExternalDiligenceSectionBody } from "../investor-insights/external-diligence/serialize-external-diligence";

// ─── Result type ──────────────────────────────────────────────────────────────

export type MonitorDealSignalsResult =
	| { ok: true; radar: DealRiskRadarV1; report_id: string | null }
	| { ok: false; reason: "deal_not_found" | "no_report" | "tavily_skipped" | "error"; error?: string };

// ─── Context extraction helpers ───────────────────────────────────────────────

/**
 * Extract named competitor companies from the LLM competitive_landscape string.
 * Looks for Title-Case sequences (company names) in the prose.
 * Returns at most 5 names.
 */
export function extractCompetitorNamesFromText(text: string): string[] {
	if (!text.trim()) return [];

	// Patterns like: "WorkflowAI and FlowDash are primary comps"
	// or "Competitors include: WorkflowAI, FlowDash, AutoOps"
	const RE = /\b([A-Z][A-Za-z0-9]{1,30}(?:\s+[A-Z][A-Za-z0-9]{1,30})?)\b/g;
	const STOP_WORDS = new Set(["The", "This", "No", "In", "At", "On", "Of", "For",
		"By", "With", "From", "They", "Their", "These", "Those", "Its", "Our", "Your",
		"Some", "Any", "All", "Both", "Each", "Every", "Most", "None", "Such",
		"Series", "Market", "Inc", "LLC", "Ltd", "Corp", "Company", "Companies",
		"Product", "Platform", "Team", "Deck", "Claim", "Tech", "Technology",
	]);

	const found = new Set<string>();
	let match: RegExpExecArray | null;

	while ((match = RE.exec(text)) !== null) {
		const name = match[1]!.trim();
		if (!STOP_WORDS.has(name) && name.length >= 3 && !name.match(/^[A-Z]+$/)) {
			found.add(name);
		}
	}

	return [...found].slice(0, 5);
}

/**
 * Extract founder names from the external_diligence founder_team_signals bucket.
 * Returns names found in titles of founder signals.
 */
export function extractFounderNamesFromDiligence(sections: unknown[]): string[] {
	if (!Array.isArray(sections)) return [];

	for (const section of sections) {
		const s = section as Record<string, unknown>;
		if (s["key"] !== "external_diligence_v1") continue;
		const body = typeof s["body"] === "string" ? s["body"] : "";
		const diligence = parseExternalDiligenceSectionBody(body);
		if (!diligence) continue;

		const founderBucket = diligence.buckets.find(
			(b) => b.bucket === "founder_team_signals"
		);
		if (!founderBucket || founderBucket.results.length === 0) return [];

		// Extract capitalized names from result titles
		const FOUNDER_RE = /^([A-Z][a-z]+ [A-Z][a-z]+)/;
		const names: string[] = [];
		for (const result of founderBucket.results.slice(0, 5)) {
			const m = FOUNDER_RE.exec(result.title);
			if (m?.[1]) names.push(m[1]);
		}
		return [...new Set(names)].slice(0, 3);
	}
	return [];
}

/**
 * Extract MonitoringContext from the render package sections array.
 */
export function extractMonitoringContext(sections: unknown[]): MonitoringContext {
	const arr = Array.isArray(sections) ? sections : [];

	let company_name: string | null = null;
	let sector: string | null = null;
	let competitor_names: string[] = [];
	const founder_names = extractFounderNamesFromDiligence(arr);

	for (const section of arr) {
		const s = section as Record<string, unknown>;
		const body = typeof s["body"] === "string" ? s["body"] : "";

		if (s["key"] === "external_diligence_v1") {
			const diligence = parseExternalDiligenceSectionBody(body);
			if (diligence) {
				company_name = diligence.company_name_used ?? null;
				sector = diligence.sector_used ?? null;
			}
		}

		if (s["key"] === "llm_interpretation_v1") {
			const llm = parseLlmInterpretationBody(body);
			if (llm) {
				competitor_names = extractCompetitorNamesFromText(llm.competitive_landscape ?? "");
				// Use company context from external diligence if not already set
				if (!company_name) {
					const ctxMatch = /^([A-Z][A-Za-z0-9]{2,40})\b/.exec(llm.executive_summary ?? "");
					if (ctxMatch?.[1]) company_name = ctxMatch[1];
				}
			}
		}
	}

	return { company_name, sector, competitor_names, founder_names };
}

// ─── Signal consensus ─────────────────────────────────────────────────────────

export function computeSignalConsensus(
	events: ClassifiedMonitoringEvents,
	totalSources: number
): SignalConsensus {
	const total =
		events.competitor_events.length +
		events.company_events.length +
		events.market_events.length +
		events.founder_signals.length;

	if (total === 0 || totalSources < 3) return "insufficient_data";

	// Negative signal count: high-impact events + negative market direction
	const negativeCount =
		[...events.competitor_events, ...events.company_events, ...events.founder_signals].filter(
			(e) => e.impact === "high"
		).length + events.market_events.filter((e) => e.direction === "negative").length;

	// Positive signal count: positive market + funding events
	const positiveCount =
		events.market_events.filter((e) => e.direction === "positive").length +
		events.company_events.filter((e) => e.category === "funding").length;

	if (negativeCount === 0 && positiveCount > 0) return "bullish";
	if (negativeCount > positiveCount + 1) return "bearish";
	if (negativeCount > 0 && positiveCount > 0) return "mixed";
	return "neutral";
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

interface ReportRow {
	id: string;
	render_package: Record<string, unknown>;
}

async function loadLatestReport(pool: Pool, dealId: string): Promise<ReportRow | null> {
	const { rows } = await pool.query<{ id: string; render_package: unknown }>(
		`SELECT id, render_package
		 FROM public.investor_insight_reports
		 WHERE deal_id = $1::uuid
		 ORDER BY updated_at DESC
		 LIMIT 1`,
		[dealId]
	);
	if (rows.length === 0) return null;
	const row = rows[0]!;
	return {
		id: row.id,
		render_package: (row.render_package as Record<string, unknown>) ?? {},
	};
}

async function patchRenderPackageSections(
	pool: Pool,
	reportId: string,
	sections: unknown[]
): Promise<void> {
	await pool.query(
		`UPDATE public.investor_insight_reports
		 SET render_package = jsonb_set(render_package, '{sections}', $1::jsonb, true),
		     updated_at = now()
		 WHERE id = $2::uuid`,
		[JSON.stringify(sections), reportId]
	);
}

// ─── Scheduling helper ────────────────────────────────────────────────────────

async function scheduleNextRun(dealId: string): Promise<void> {
	try {
		const queue = getQueue(QUEUE_NAMES.monitor_deal_signals);
		await queue.add(
			"monitor_deal_signals",
			{ deal_id: dealId, scheduled: true },
			{
				delay: MONITORING_REPEAT_INTERVAL_MS,
				jobId: `monitor:${dealId}`,
				removeOnComplete: { count: 10 },
				removeOnFail: { count: 5 },
			}
		);
		console.log(
			JSON.stringify({
				event: "MONITORING_NEXT_RUN_SCHEDULED",
				deal_id: dealId,
				delay_ms: MONITORING_REPEAT_INTERVAL_MS,
				ts: new Date().toISOString(),
			})
		);
	} catch (err) {
		// Non-fatal: scheduling failure doesn't break the current run result.
		console.warn(
			JSON.stringify({
				event: "MONITORING_SCHEDULE_FAILED",
				deal_id: dealId,
				error: err instanceof Error ? err.message : String(err),
				ts: new Date().toISOString(),
			})
		);
	}
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Run a full monitoring cycle for a single deal.
 *
 * @param dealId  UUID of the deal to monitor
 * @param pool    PostgreSQL connection pool
 * @returns       MonitorDealSignalsResult (never throws)
 */
export async function runMonitorDealSignals(
	dealId: string,
	pool: Pool
): Promise<MonitorDealSignalsResult> {
	const ranAt = new Date().toISOString();
	const nextScheduledAt = new Date(Date.now() + MONITORING_REPEAT_INTERVAL_MS).toISOString();

	// 1. Load existing report
	let report: ReportRow | null = null;
	try {
		report = await loadLatestReport(pool, dealId);
	} catch (err) {
		return {
			ok: false,
			reason: "error",
			error: `DB load failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	if (!report) {
		return { ok: false, reason: "no_report" };
	}

	// 2. Extract monitoring context from existing sections
	const sections = Array.isArray(report.render_package["sections"])
		? (report.render_package["sections"] as unknown[])
		: [];
	const context = extractMonitoringContext(sections);

	// 3. Build query plan
	const queryPlan = buildMonitoringQueryPlan(context);

	console.log(
		JSON.stringify({
			event: "MONITORING_START",
			deal_id: dealId,
			company_name: context.company_name,
			sector: context.sector,
			competitor_count: context.competitor_names.length,
			founder_count: context.founder_names.length,
			ts: ranAt,
		})
	);

	// 4. Run Tavily searches
	const searchResult = await runMonitoringSearches(queryPlan, dealId);

	// Determine run_status from bucket statuses
	const allStatuses = searchResult.buckets.map((b) => b.status);
	const runStatus: DealRiskRadarV1["run_status"] =
		allStatuses.every((s) => s === "skipped")
			? "skipped"
			: allStatuses.every((s) => s === "failed" || s === "skipped")
			? "failed"
			: allStatuses.some((s) => s === "failed")
			? "partial"
			: "succeeded";

	// 5. Classify signals
	const classifiedRaw = classifyMonitoringSignals(searchResult.buckets, {
		competitor_names: context.competitor_names,
		founder_names: context.founder_names,
		sector: context.sector,
	});

	// 6. Deduplicate
	const classified = dedupeMonitoringEvents(classifiedRaw);

	// 7. Compute consensus + build radar
	const consensus = computeSignalConsensus(classified, searchResult.total_results_fetched);

	const radar: DealRiskRadarV1 = {
		schema_version: "deal_risk_radar_v1",
		deal_id: dealId,
		ran_at: ranAt,
		next_scheduled_at: nextScheduledAt,
		run_status: runStatus,
		total_sources_fetched: searchResult.total_results_fetched,
		source_count:
			classified.competitor_events.length +
			classified.company_events.length +
			classified.market_events.length +
			classified.founder_signals.length,
		signal_consensus: consensus,
		competitor_events: classified.competitor_events,
		market_events: classified.market_events,
		company_events: classified.company_events,
		founder_signals: classified.founder_signals,
		company_name_used: context.company_name,
		sector_used: context.sector,
	};

	// 8. Build render section
	const radarSection = buildMonitoringRenderSection(radar);

	// 9. Upsert section into render_package
	if (radarSection) {
		const updatedSections = [
			...sections.filter((s) => {
				const key = (s as Record<string, unknown>)["key"];
				return key !== "deal_risk_radar_v1";
			}),
			radarSection,
		];

		try {
			await patchRenderPackageSections(pool, report.id, updatedSections);
		} catch (err) {
			console.error(
				JSON.stringify({
					event: "MONITORING_PERSIST_FAILED",
					deal_id: dealId,
					report_id: report.id,
					error: err instanceof Error ? err.message : String(err),
					ts: new Date().toISOString(),
				})
			);
			// Return ok with the radar, but note the DB failure.
			return { ok: true, radar, report_id: null };
		}
	}

	console.log(
		JSON.stringify({
			event: "MONITORING_COMPLETE",
			deal_id: dealId,
			run_status: runStatus,
			competitor_events: radar.competitor_events.length,
			company_events: radar.company_events.length,
			market_events: radar.market_events.length,
			founder_signals: radar.founder_signals.length,
			source_count: radar.source_count,
			signal_consensus: consensus,
			ts: new Date().toISOString(),
		})
	);

	// 10. Schedule next run (non-fatal if it fails)
	await scheduleNextRun(dealId);

	return { ok: true, radar, report_id: report.id };
}

// ─── BullMQ processor ─────────────────────────────────────────────────────────

export async function monitorDealSignalsProcessor(job: Job): Promise<MonitorDealSignalsResult> {
	const dealId = typeof job.data?.deal_id === "string" ? job.data.deal_id.trim() : "";
	if (!dealId) {
		console.error(
			JSON.stringify({
				event: "MONITORING_INVALID_PAYLOAD",
				job_id: job.id,
				data: job.data,
				ts: new Date().toISOString(),
			})
		);
		throw new Error("monitor_deal_signals: missing deal_id in job payload");
	}

	const pool = getPool();
	const result = await runMonitorDealSignals(dealId, pool);

	if (!result.ok) {
		const isRetryable =
			result.reason === "error" || result.reason === "no_report";
		if (isRetryable) {
			throw new Error(
				`monitor_deal_signals failed: reason=${result.reason} error=${result.error ?? "none"}`
			);
		}
		// Non-retryable (e.g. deal_not_found) — complete job with ok=false
		return result;
	}

	return result;
}
