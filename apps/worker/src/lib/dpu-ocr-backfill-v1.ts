/**
 * DPU OCR Backfill v1 — targeted Tesseract OCR for empty slide pages.
 *
 * Runs ONLY when:
 *   1. The evidence gate E2 coverage threshold is not yet met, AND
 *   2. There are DPU rows with empty page_text AND a stored image_uri, AND
 *   3. Those rows have not already been backfilled (quality_flags.dpu_ocr_backfilled !== true).
 *
 * Safety rules enforced by all UPDATE statements:
 *   - Only updates rows where COALESCE(payload->>'page_text','') = '' (never overwrites content)
 *   - Sets quality_flags.dpu_ocr_backfilled = true so reruns are idempotent
 *
 * Log events emitted:
 *   DPU_OCR_BACKFILL_START  — before any OCR is run
 *   DPU_OCR_BACKFILL_RESULT — after all pages attempted
 */

import type { Pool } from "pg";

import { safeTesseractRecognizeBuffer } from "./ocr/safe-tesseract";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum OCR result length to be worth persisting. Below this, we discard. */
export const DPU_OCR_BACKFILL_MIN_OCR_CHARS = 20;

/** Maximum pages we'll attempt per deal per run (safety cap). */
export const DPU_OCR_BACKFILL_MAX_PAGES = 60;

/** Per-page image fetch + OCR timeout in ms. */
export const DPU_OCR_BACKFILL_PAGE_TIMEOUT_MS = 120_000;

/**
 * Maximum page_text length for a DPU page to be considered OCR-eligible.
 * Pages with page_text shorter than this threshold (including empty pages)
 * are candidates for forced OCR from a rendered slide image.
 * Mirrors the Phase 1 rule: "page_text length < 20 → needsOcr = true".
 */
export const DPU_OCR_BACKFILL_TEXT_THRESHOLD = 20;

// ─── OCR text normalization + usefulness ─────────────────────────────────────

/**
 * Investment / pitch-deck keywords used by isOcrTextUseful.
 * Checked case-insensitively as whole-word matches.
 * Exported for testing.
 */
export const OCR_DECK_KEYWORDS_RE =
	/\b(?:revenue|market|customer|raise|funding|product|traction|growth|mrr|arr|tam|sam|som|pricing|team|technology|platform|solution|investors|valuation|sales|profit|roadmap|enterprise|startup|investment|acquisition|retention|churn|pipeline|model)\b/i;

/**
 * Normalize raw Tesseract OCR text.
 *
 * Steps (all deterministic, no content invented):
 *   1. Unify line endings: \r\n → \n, \r → \n, \f → \n.
 *   2. Split into lines; trim each line.
 *   3. Discard lines that contain zero alpha characters AND fewer than 2 digit
 *      characters — these are pure whitespace or symbol-only OCR noise.
 *      ("| - | - |" → discarded; "Q1" → kept because it has alpha chars)
 *   4. Re-join with \n; collapse 3+ consecutive blank lines to 2.
 *   5. Collapse runs of multiple spaces within each line to a single space.
 *   6. Final trim.
 *
 * Returns empty string when raw text contains no usable content.
 * Exported for testing.
 */
export function normalizeOcrText(rawText: string): string {
	if (typeof rawText !== "string" || !rawText) return "";

	// 1. Unify line endings.
	const unified = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\f/g, "\n");

	// 2–3. Split, trim, discard noise lines.
	const ALPHA_RE = /[a-zA-Z]/;
	const DIGIT_RE = /\d/g;

	const lines = unified.split("\n").reduce<string[]>((acc, rawLine) => {
		const line = rawLine.replace(/\s+/g, " ").trim(); // 5: collapse inline spaces too
		if (!line) {
			acc.push(""); // preserve blank line for later collapse
			return acc;
		}
		const hasAlpha = ALPHA_RE.test(line);
		const digitCount = (line.match(DIGIT_RE) ?? []).length;
		if (!hasAlpha && digitCount < 2) return acc; // discard pure-noise line
		acc.push(line);
		return acc;
	}, []);

	// 4. Collapse 3+ consecutive blank lines to 2.
	const collapsed: string[] = [];
	let blankRun = 0;
	for (const line of lines) {
		if (line === "") {
			blankRun++;
			if (blankRun <= 2) collapsed.push(line);
		} else {
			blankRun = 0;
			collapsed.push(line);
		}
	}

	return collapsed.join("\n").trim();
}

/**
 * Determine whether normalized OCR text is useful enough to persist as DPU page_text.
 *
 * Applies two complementary rules — either is sufficient:
 *   Rule A — Multi-word content:
 *     text.length >= minChars AND meaningfulAlphaTokens >= 3
 *     ("meaningfulAlphaToken" = token containing ≥1 alpha char AND length ≥ 2)
 *   Rule B — Metric-style content with investment keyword signal:
 *     text.length >= minChars AND meaningfulAlphaTokens >= 1
 *     AND numericTokens >= 1 AND hasInvestmentKeyword
 *     (catches "Revenue $2M", "ARR: $650K")
 *   Rule C — Data-table content (numbers with context words):
 *     text.length >= minChars AND meaningfulAlphaTokens >= 2 AND numericTokens >= 2
 *     (catches "Q1 $450K Q2 $720K" type tables)
 *
 * Returns false for:
 *   - Empty or length-below-threshold text.
 *   - All-noise text: "l l l l l" or "| | | |" (no meaningful alpha tokens).
 *   - Single-word non-keyword snippets.
 *
 * Exported for testing.
 */
export function isOcrTextUseful(
	normalizedText: string,
	opts?: { minChars?: number }
): boolean {
	const minChars = typeof opts?.minChars === "number" && opts.minChars > 0
		? opts.minChars
		: DPU_OCR_BACKFILL_MIN_OCR_CHARS;

	const text = normalizedText.trim();
	if (text.length < minChars) return false;

	const tokens = text.split(/\s+/).filter(Boolean);

	// "Meaningful" alpha token: has ≥1 letter AND length ≥2 (excludes single-char OCR noise).
	const meaningfulAlphaTokens = tokens.filter(
		(t) => /[a-zA-Z]/.test(t) && t.length >= 2
	).length;

	const numericTokens = tokens.filter((t) => /\d/.test(t)).length;

	const hasKeyword = OCR_DECK_KEYWORDS_RE.test(text);

	// Rule A: genuine paragraph / multi-word slide content.
	if (meaningfulAlphaTokens >= 3) return true;

	// Rule B: "Revenue $2M" style — 1 real word + 1 number + keyword signal.
	if (meaningfulAlphaTokens >= 1 && numericTokens >= 1 && hasKeyword) return true;

	// Rule C: data table — at least 2 context words + 2 numbers, no keyword needed.
	if (meaningfulAlphaTokens >= 2 && numericTokens >= 2) return true;

	return false;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type DpuEmptyPageCandidate = {
	document_id: string;
	deal_id: string;
	page_index: number;
	version: string;
	image_uri: string;
};

export type DpuOcrBackfillResult = {
	pages_attempted: number;
	pages_updated: number;
	pages_skipped_ocr_too_short: number;
	pages_failed: number;
	before_nonempty: number;
	after_nonempty: number;
	errors: Array<{ document_id: string; page_index: number; error: string }>;
};

// ─── Page selection ───────────────────────────────────────────────────────────

/**
 * Query DPU rows that are candidates for OCR backfill:
 *   - page_text is absent or shorter than DPU_OCR_BACKFILL_TEXT_THRESHOLD (< 20 chars)
 *   - an image_uri is resolvable: either stored in payload.source.image_uri (legacy)
 *     OR available from the associated visual_assets row (preferred path for rendered
 *     slide images such as deals/{id}/documents/{id}/rendered_pages/page_XXXX.png)
 *   - not already backfilled (quality_flags.dpu_ocr_backfilled != true)
 *
 * The LEFT JOIN with visual_assets is the key change introduced in PR28: rendered
 * slide images are stored in visual_assets.image_uri, not in the DPU payload itself.
 * Using COALESCE(dpu payload uri, va.image_uri) covers both storage paths.
 *
 * Results are ordered by document_id, page_index to ensure deterministic processing.
 */
export async function selectEmptyDpuPagesWithImage(
	pool: Pool,
	dealId: string,
	version: string,
	opts?: { maxPages?: number }
): Promise<DpuEmptyPageCandidate[]> {
	const limit = Math.min(
		typeof opts?.maxPages === "number" && opts.maxPages > 0 ? opts.maxPages : DPU_OCR_BACKFILL_MAX_PAGES,
		DPU_OCR_BACKFILL_MAX_PAGES
	);

	try {
		const { rows } = await pool.query<{
			document_id: string;
			deal_id: string;
			page_index: number;
			version: string;
			image_uri: string;
		}>(
			`SELECT
				dpu.document_id::text,
				dpu.deal_id::text,
				dpu.page_index,
				dpu.version,
				COALESCE(dpu.payload->'source'->>'image_uri', va.image_uri) AS image_uri
			  FROM public.document_page_understanding dpu
			  LEFT JOIN public.visual_assets va
			         ON va.document_id = dpu.document_id
			        AND va.page_index  = dpu.page_index
			 WHERE dpu.deal_id  = $1::uuid
			   AND dpu.version  = $2::text
			   AND COALESCE(length(dpu.payload->>'page_text'), 0) < ${DPU_OCR_BACKFILL_TEXT_THRESHOLD}
			   AND COALESCE(
			         length(TRIM(COALESCE(
			           dpu.payload->'source'->>'image_uri',
			           va.image_uri,
			           ''
			         ))),
			         0
			       ) > 0
			   AND COALESCE((dpu.payload->'quality_flags'->>'dpu_ocr_backfilled')::boolean, false) = false
			   AND COALESCE((dpu.payload->'quality_flags'->>'is_placeholder')::boolean, false) = false
			ORDER BY dpu.document_id, dpu.page_index
			LIMIT $3::int`,
			[dealId, version, limit]
		);

		return (rows ?? []).map((r) => ({
			document_id: String(r.document_id ?? ""),
			deal_id: String(r.deal_id ?? ""),
			page_index: Number(r.page_index ?? 0),
			version: String(r.version ?? version),
			image_uri: String(r.image_uri ?? ""),
		})).filter((r) => r.document_id && r.image_uri);
	} catch {
		return [];
	}
}

// ─── Nonempty count ───────────────────────────────────────────────────────────

/**
 * Count DPU pages with non-empty page_text for the deal.
 * Used to produce before/after metrics in the result log event.
 */
export async function countDpuNonemptyPages(
	pool: Pool,
	dealId: string,
	version: string
): Promise<number> {
	try {
		const { rows } = await pool.query<{ c: string }>(
			`SELECT COUNT(*)::bigint AS c
			   FROM public.document_page_understanding
			  WHERE deal_id = $1::uuid
			    AND version = $2::text
			    AND COALESCE(payload->>'page_text', '') <> ''`,
			[dealId, version]
		);
		return Number(rows?.[0]?.c ?? 0);
	} catch {
		return 0;
	}
}

// ─── Image fetch ──────────────────────────────────────────────────────────────

/**
 * Fetch the image bytes from an http/https/file/data URI.
 * Returns null on any error rather than throwing.
 */
async function fetchImageBuffer(uri: string): Promise<Buffer | null> {
	const u = String(uri || "").trim();
	if (!u) return null;

	try {
		if (u.startsWith("data:")) {
			const comma = u.indexOf(",");
			if (comma < 0) return null;
			const meta = u.slice(0, comma);
			const payload = u.slice(comma + 1);
			if (!/;base64$/i.test(meta)) return null;
			return Buffer.from(payload, "base64");
		}

		if (u.startsWith("file://")) {
			const { readFile } = await import("node:fs/promises");
			const p = decodeURIComponent(u.slice("file://".length));
			return await readFile(p);
		}

		if (!u.startsWith("http://") && !u.startsWith("https://")) return null;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), DPU_OCR_BACKFILL_PAGE_TIMEOUT_MS);
		try {
			const res = await fetch(u, { method: "GET", signal: controller.signal });
			if (!res.ok) return null;
			const ab = await res.arrayBuffer();
			return Buffer.from(ab);
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return null;
	}
}

// ─── DPU row update ───────────────────────────────────────────────────────────

/**
 * Persist OCR text into a DPU row.
 *
 * Safety: the SQL WHERE clause enforces page_text length < DPU_OCR_BACKFILL_TEXT_THRESHOLD
 * so this will silently no-op if the row was concurrently updated with meaningful text.
 *
 * The update sets:
 *   quality_flags.dpu_ocr_backfilled = true  — idempotency marker (reruns skip this page)
 *   quality_flags.ocr_forced = true          — PR28 provenance tag (page_text came from forced OCR)
 */
async function updateDpuPageWithOcrText(
	pool: Pool,
	documentId: string,
	pageIndex: number,
	version: string,
	ocrText: string
): Promise<boolean> {
	try {
		const { rowCount } = await pool.query(
			`UPDATE public.document_page_understanding
			    SET payload = (
			          jsonb_set(
			            jsonb_set(
			              jsonb_set(
			                jsonb_set(
			                  payload,
			                  '{page_text}', to_jsonb($4::text)
			                ),
			                '{normalized_text}', to_jsonb($4::text)
			              ),
			              '{text_blocks,ocr_text}', to_jsonb($4::text)
			            ),
			            '{quality_flags}',
			            COALESCE(payload->'quality_flags', '{}'::jsonb)
			              || '{"dpu_ocr_backfilled": true, "ocr_forced": true, "page_text_empty": false, "used_ocr_fallback": true}'::jsonb
			          )
			        ),
			        updated_at = now()
			  WHERE document_id = $1::uuid
			    AND page_index = $2::int
			    AND version = $3::text
			    AND COALESCE(length(payload->>'page_text'), 0) < 20`,
			[documentId, pageIndex, version, ocrText]
		);
		return (rowCount ?? 0) > 0;
	} catch {
		return false;
	}
}

/**
 * Mark a DPU page as attempted-but-skipped (OCR result too short or fetch failed).
 * Prevents infinite retry on reruns without overwriting any real text.
 */
async function markDpuPageOcrAttempted(
	pool: Pool,
	documentId: string,
	pageIndex: number,
	version: string
): Promise<void> {
	try {
		await pool.query(
			`UPDATE public.document_page_understanding
			    SET payload = (
			          payload
			            || jsonb_build_object(
			                 'quality_flags',
			                 COALESCE(payload->'quality_flags', '{}'::jsonb)
			                   || '{"dpu_ocr_backfilled": true, "ocr_force_attempted": true}'::jsonb
			               )
			        ),
			        updated_at = now()
			  WHERE document_id = $1::uuid
			    AND page_index = $2::int
			    AND version = $3::text
			    AND COALESCE(length(payload->>'page_text'), 0) < ${DPU_OCR_BACKFILL_TEXT_THRESHOLD}`,
			[documentId, pageIndex, version]
		);
	} catch {
		// best-effort
	}
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Run targeted OCR backfill for all empty DPU pages in `dealId` that have
 * a stored image_uri and have not already been backfilled.
 *
 * Intended to be called from the investor-insights processor before the E2
 * coverage gate is evaluated, under the `DPU_OCR_BACKFILL_V1=true` env flag.
 *
 * @param pool      DB connection pool
 * @param dealId    Deal UUID
 * @param version   DPU version string (default: "page_understanding_v1")
 * @param opts      Optional: maxPages cap, minOcrChars threshold
 */
export async function runDpuOcrBackfillForDeal(
	pool: Pool,
	dealId: string,
	version = "page_understanding_v1",
	opts?: {
		maxPages?: number;
		minOcrChars?: number;
	}
): Promise<DpuOcrBackfillResult> {
	const minOcrChars = Math.max(
		1,
		typeof opts?.minOcrChars === "number" ? opts.minOcrChars : DPU_OCR_BACKFILL_MIN_OCR_CHARS
	);

	const beforeNonempty = await countDpuNonemptyPages(pool, dealId, version);
	const candidates = await selectEmptyDpuPagesWithImage(pool, dealId, version, opts);

	console.log(
		JSON.stringify({
			event: "DPU_OCR_BACKFILL_START",
			deal_id: dealId,
			version,
			before_nonempty: beforeNonempty,
			candidates_found: candidates.length,
			ts: new Date().toISOString(),
		})
	);

	const errors: DpuOcrBackfillResult["errors"] = [];
	let pagesUpdated = 0;
	let pagesSkipped = 0;
	let pagesFailed = 0;

	for (const page of candidates) {
		let ocrText: string | null = null;
		let fetchError: string | null = null;

		try {
			const buf = await fetchImageBuffer(page.image_uri);
			if (!buf) {
				fetchError = "image_fetch_failed";
			} else {
				const result = await safeTesseractRecognizeBuffer({
					buffer: buf,
					lang: "eng",
					timeoutMs: DPU_OCR_BACKFILL_PAGE_TIMEOUT_MS,
				});
				const rawTxt = typeof result?.text === "string" ? result.text : "";
				const normalizedTxt = normalizeOcrText(rawTxt);
				ocrText = isOcrTextUseful(normalizedTxt, { minChars: minOcrChars })
					? normalizedTxt
					: null;
			}
		} catch (err) {
			fetchError = err instanceof Error ? err.message : String(err);
		}

		if (fetchError) {
			pagesFailed++;
			errors.push({
				document_id: page.document_id,
				page_index: page.page_index,
				error: fetchError,
			});
			// Mark as attempted to prevent reprocessing on next run.
			await markDpuPageOcrAttempted(pool, page.document_id, page.page_index, page.version);
			continue;
		}

		if (!ocrText) {
			// OCR ran but result was too short — mark as attempted and skip.
			pagesSkipped++;
			await markDpuPageOcrAttempted(pool, page.document_id, page.page_index, page.version);
			continue;
		}

		const updated = await updateDpuPageWithOcrText(
			pool,
			page.document_id,
			page.page_index,
			page.version,
			ocrText
		);
		if (updated) pagesUpdated++;
		else pagesSkipped++;
	}

	const afterNonempty = pagesUpdated > 0
		? await countDpuNonemptyPages(pool, dealId, version)
		: beforeNonempty;

	const result: DpuOcrBackfillResult = {
		pages_attempted: candidates.length,
		pages_updated: pagesUpdated,
		pages_skipped_ocr_too_short: pagesSkipped,
		pages_failed: pagesFailed,
		before_nonempty: beforeNonempty,
		after_nonempty: afterNonempty,
		errors,
	};

	console.log(
		JSON.stringify({
			event: "DPU_OCR_BACKFILL_RESULT",
			deal_id: dealId,
			version,
			...result,
			errors_count: errors.length,
			errors: errors.slice(0, 5), // limit to first 5 for log brevity
			ts: new Date().toISOString(),
		})
	);

	return result;
}
