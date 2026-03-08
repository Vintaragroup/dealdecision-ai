/**
 * PR37 — Deal Risk Radar: Monitoring Query Plan Builder
 *
 * Derives 4 Tavily query strings from deal context extracted from the most
 * recent investor_insight_report.
 *
 * Query buckets:
 *   1. company_signals      — recent press, news, product for the portfolio company
 *   2. competitor_signals   — funding, launches, news for named competitors
 *   3. market_signals       — regulation, macro, sector contraction/growth
 *   4. founder_team_signals — founder/team leadership movements, controversies
 *
 * All queries include a recency anchor ("2025 2026") to bias Tavily toward
 * recent results.  Pure function — no I/O.
 */

import type { MonitoringQueryPlan, MonitoringBucketKey } from "./monitoring-schema";

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * Context extracted from the most recent investor_insight_reports row.
 * All fields are nullable — query builder degrades gracefully.
 */
export interface MonitoringContext {
	/** Canonical company name from external diligence or deal metadata. */
	company_name: string | null;
	/** Sector/market term from external diligence. */
	sector: string | null;
	/** Named competitors parsed from LLM competitive_landscape field. */
	competitor_names: string[];
	/** Named founders/team members parsed from external diligence. */
	founder_names: string[];
}

// ─── Query template helpers ───────────────────────────────────────────────────

const RECENCY_ANCHOR = "news 2025 2026";

/**
 * Build company signal query.
 * Target: press coverage, product announcements, funding news for the company.
 */
function buildCompanyQuery(ctx: MonitoringContext): string {
	if (!ctx.company_name) {
		return ctx.sector
			? `${ctx.sector} startup news funding announcement ${RECENCY_ANCHOR}`
			: `startup news funding announcement ${RECENCY_ANCHOR}`;
	}
	const sectorPart = ctx.sector ? ` ${ctx.sector}` : "";
	return `"${ctx.company_name}"${sectorPart} news announcement funding product ${RECENCY_ANCHOR}`;
}

/**
 * Build competitor signal query.
 * Target: funding rounds, product launches, M&A events for named competitors.
 */
function buildCompetitorQuery(ctx: MonitoringContext): string {
	if (ctx.competitor_names.length === 0) {
		const base = ctx.company_name ?? ctx.sector ?? "startup";
		return `${base} competitor funding acquisition launch ${RECENCY_ANCHOR}`;
	}
	// Use up to 3 most prominent competitor names
	const comps = ctx.competitor_names.slice(0, 3);
	if (comps.length === 1) {
		return `"${comps[0]}" funding acquisition product launch ${RECENCY_ANCHOR}`;
	}
	const orPart = comps.map((c) => `"${c}"`).join(" OR ");
	return `(${orPart}) funding acquisition product launch ${RECENCY_ANCHOR}`;
}

/**
 * Build market signal query.
 * Target: regulatory changes, macro shifts, sector contraction/growth.
 */
function buildMarketQuery(ctx: MonitoringContext): string {
	const sector = ctx.sector ?? ctx.company_name ?? "technology";
	return `${sector} market regulation funding venture ${RECENCY_ANCHOR} industry trend`;
}

/**
 * Build founder/team signal query.
 * Target: founder movements, new hires, controversies, departures.
 */
function buildFounderQuery(ctx: MonitoringContext): string {
	if (ctx.founder_names.length === 0) {
		const base = ctx.company_name ?? ctx.sector ?? "startup";
		return `${base} founder CEO leadership hire departure ${RECENCY_ANCHOR}`;
	}
	const founder = ctx.founder_names[0]!;
	return `"${founder}" founder CEO leadership ${RECENCY_ANCHOR}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build a MonitoringQueryPlan from deal context.
 *
 * Returns 4 query strings — one per monitoring bucket.  If context is sparse,
 * queries fall back to generic sector/startup terms.
 *
 * @pure — no I/O, no side effects.
 */
export function buildMonitoringQueryPlan(ctx: MonitoringContext): MonitoringQueryPlan {
	const queries: Record<MonitoringBucketKey, string> = {
		company_signals: buildCompanyQuery(ctx),
		competitor_signals: buildCompetitorQuery(ctx),
		market_signals: buildMarketQuery(ctx),
		founder_team_signals: buildFounderQuery(ctx),
	};

	return {
		company_name: ctx.company_name,
		sector: ctx.sector,
		competitor_names: ctx.competitor_names,
		founder_names: ctx.founder_names,
		queries,
	};
}
