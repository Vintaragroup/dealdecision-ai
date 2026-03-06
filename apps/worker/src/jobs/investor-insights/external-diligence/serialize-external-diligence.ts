/**
 * PR35 — External Due Diligence: Serializer
 *
 * Converts an ExternalDiligenceV1 struct into a compact, structured plain-text
 * body suitable for LLM prompt injection.
 *
 * Design goals:
 *   - Human-readable (also shown in audit logs)
 *   - Compact — total output hard-capped at MAX_BODY_CHARS
 *   - No raw URLs in the LLM-visible portion (only domain + title)
 *   - Claim corroborations rendered as "Deck says X → Web says (verdict)"
 */

import type {
	ExternalDiligenceV1,
	ExternalDiligenceBucket,
	ClaimCorroboration,
} from "./external-diligence-schema";
import {
	MAX_BODY_CHARS,
} from "./external-diligence-schema";

// ─── Friendly bucket labels ───────────────────────────────────────────────────

const BUCKET_LABELS: Record<string, string> = {
	company_overview: "Company Overview",
	competitors: "Competitive Landscape",
	market_trends: "Market Trends",
	company_news: "Recent News",
	founder_team_signals: "Founder / Team",
	financial_market_context: "Financial Market Context",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
	try {
		const u = new URL(url);
		return u.hostname.replace(/^www\./, "");
	} catch {
		return url.slice(0, 40);
	}
}

function formatBucket(bucket: ExternalDiligenceBucket): string | null {
	if (bucket.status === "skipped" || bucket.results.length === 0) return null;
	const label = BUCKET_LABELS[bucket.bucket] ?? bucket.bucket;
	const lines = [`[${label}]`];
	for (const r of bucket.results) {
		const domain = extractDomain(r.url);
		const date = r.published_date ? ` (${r.published_date})` : "";
		lines.push(`• ${r.title}${date} [${domain}]: ${r.snippet}`);
	}
	return lines.join("\n");
}

function formatCorroborations(items: ClaimCorroboration[]): string | null {
	if (items.length === 0) return null;
	const lines = ["[Claim Corroboration]"];
	for (const c of items) {
		const verdictLabel =
			c.verdict === "corroborated"
				? "✓ corroborated"
				: c.verdict === "contradicted"
				? "✗ contradicted"
				: "? not confirmed";
		lines.push(`• ${c.claim_field}="${c.claim_value}" → ${verdictLabel}: ${c.web_signal}`);
	}
	return lines.join("\n");
}

// ─── Main export ──────────────────────────────────────────────────────────────

// ─── Render-section serializer (for UI parsing) ──────────────────────────────

const SECTION_JSON_DELIMITER = "---external_diligence_v1_json---\n";

/**
 * Serialise ExternalDiligenceV1 to a render-package section body.
 *
 * Embeds the structured JSON at the end under a delimiter so that the web UI
 * can parse it without making a separate API call.  The human-readable portion
 * precedes the delimiter for legibility in audit logs.
 */
export function serializeExternalDiligenceSectionBody(
	diligence: ExternalDiligenceV1
): string {
	const textPart = serializeExternalDiligenceBody(diligence) ?? `[External Diligence — ${diligence.run_status}]`;
	return `${textPart}\n\n${SECTION_JSON_DELIMITER}${JSON.stringify(diligence)}`;
}

/**
 * Parse an ExternalDiligenceV1 from a section body created by
 * serializeExternalDiligenceSectionBody.  Returns null on failure.
 */
export function parseExternalDiligenceSectionBody(body: string): ExternalDiligenceV1 | null {
	const idx = body.indexOf(SECTION_JSON_DELIMITER);
	if (idx === -1) return null;
	try {
		const json = body.slice(idx + SECTION_JSON_DELIMITER.length).trim();
		const parsed = JSON.parse(json) as ExternalDiligenceV1;
		if (parsed?.schema_version !== "external_diligence_v1") return null;
		return parsed;
	} catch {
		return null;
	}
}

// ─── LLM body serializer ──────────────────────────────────────────────────────

/**
 * Serialise ExternalDiligenceV1 to a compact text body for LLM injection.
 *
 * Returns null when:
 *   - run_status is "skipped" or "failed" with 0 results
 *   - all buckets are empty
 */
export function serializeExternalDiligenceBody(
	diligence: ExternalDiligenceV1
): string | null {
	if (
		diligence.run_status === "skipped" ||
		(diligence.run_status === "failed" && diligence.total_results_fetched === 0)
	) {
		return null;
	}

	const parts: string[] = [];

	// Header
	parts.push(
		`[External Diligence — ${diligence.company_name_used ?? "Company"}` +
			(diligence.sector_used ? `, ${diligence.sector_used}` : "") +
			`] (${diligence.total_results_fetched} results, ${diligence.queries_run} queries)`
	);

	// Buckets
	for (const bucket of diligence.buckets) {
		const formatted = formatBucket(bucket);
		if (formatted) parts.push(formatted);
	}

	// Claim coraborations at end
	const corrSection = formatCorroborations(diligence.claim_corroborations);
	if (corrSection) parts.push(corrSection);

	const body = parts.join("\n\n");

	// Hard cap to prevent prompt overflow
	if (body.length > MAX_BODY_CHARS) {
		return body.slice(0, MAX_BODY_CHARS) + "\n[truncated]";
	}
	return body;
}
