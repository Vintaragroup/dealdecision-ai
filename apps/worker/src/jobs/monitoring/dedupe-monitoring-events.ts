/**
 * PR37 — Deal Risk Radar: Event Deduplication
 *
 * Deduplicates classified monitoring events to prevent the radar from showing
 * the same signal multiple times due to overlapping Tavily search results.
 *
 * Deduplication strategy:
 *   - Two competitor events are duplicates when they share the same company
 *     AND their event titles are ≥ 80% similar (normalised).
 *   - Two company/market/founder events are duplicates when any evidence_url
 *     appears in both, OR their event titles are ≥ 80% similar.
 *   - When duplicates are merged, their evidence_urls are unioned.
 *
 * @pure — no I/O, no side effects.
 */

import type {
	CompetitorEvent,
	MarketEvent,
	CompanyEvent,
	FounderSignal,
} from "./monitoring-schema";
import type { ClassifiedMonitoringEvents } from "./classify-monitoring-signals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise a text string for similarity comparison.
 * Lowercases, strips punctuation, collapses whitespace.
 */
function normalise(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Checks if two normalised strings are "similar enough" to be considered
 * duplicates (share at least 60% of tokens).
 */
function isSimilar(a: string, b: string): boolean {
	if (a === b) return true;
	const tokensA = new Set(normalise(a).split(" ").filter((t) => t.length > 2));
	const tokensB = new Set(normalise(b).split(" ").filter((t) => t.length > 2));
	if (tokensA.size === 0 || tokensB.size === 0) return false;
	const intersection = [...tokensA].filter((t) => tokensB.has(t));
	const minSize = Math.min(tokensA.size, tokensB.size);
	return intersection.length / minSize >= 0.6;
}

/** Merge URL arrays and deduplicate. */
function mergeUrls(a: string[], b: string[]): string[] {
	return [...new Set([...a, ...b])];
}

/** Check if two URL sets share any URL. */
function sharesUrl(a: string[], b: string[]): boolean {
	const setA = new Set(a);
	return b.some((url) => setA.has(url));
}

// ─── Per-event-type dedup ─────────────────────────────────────────────────────

function dedupeCompetitorEvents(events: CompetitorEvent[]): CompetitorEvent[] {
	const result: CompetitorEvent[] = [];
	for (const ev of events) {
		const existingIdx = result.findIndex(
			(r) =>
				normalise(r.company) === normalise(ev.company) &&
				isSimilar(r.event, ev.event)
		);
		if (existingIdx >= 0) {
			// Merge URLs into existing event (keep higher impact)
			const existing = result[existingIdx]!;
			result[existingIdx] = {
				...existing,
				evidence_urls: mergeUrls(existing.evidence_urls, ev.evidence_urls),
				impact: impactRank(ev.impact) > impactRank(existing.impact) ? ev.impact : existing.impact,
			};
		} else {
			result.push(ev);
		}
	}
	return result;
}

function dedupeByUrlOrTitle<T extends { event?: string; description?: string; signal?: string; evidence_urls: string[] }>(
	events: T[],
	textKey: "event" | "description" | "signal"
): T[] {
	const result: T[] = [];
	for (const ev of events) {
		const text = (ev as Record<string, unknown>)[textKey] as string | undefined ?? "";
		const existingIdx = result.findIndex((r): boolean => {
			const rText = (r as Record<string, unknown>)[textKey] as string | undefined ?? "";
			return sharesUrl(r.evidence_urls, ev.evidence_urls) || isSimilar(rText, text);
		});
		if (existingIdx >= 0) {
			const existing = result[existingIdx]!;
			result[existingIdx] = {
				...existing,
				evidence_urls: mergeUrls(existing.evidence_urls, ev.evidence_urls),
			};
		} else {
			result.push(ev);
		}
	}
	return result;
}

function impactRank(impact: string): number {
	return impact === "high" ? 2 : impact === "medium" ? 1 : 0;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Deduplicate all classified monitoring events.
 *
 * Returns a new ClassifiedMonitoringEvents with merged/deduplicated entries.
 * Order is preserved: highest-scoring Tavily results appear first.
 *
 * @param events  Classification output from classifyMonitoringSignals()
 * @returns       Deduplicated events (safe to use in DealRiskRadarV1)
 */
export function dedupeMonitoringEvents(
	events: ClassifiedMonitoringEvents
): ClassifiedMonitoringEvents {
	return {
		competitor_events: dedupeCompetitorEvents(events.competitor_events),
		market_events: dedupeByUrlOrTitle(events.market_events, "description"),
		company_events: dedupeByUrlOrTitle(events.company_events, "event"),
		founder_signals: dedupeByUrlOrTitle(events.founder_signals, "signal"),
	};
}
