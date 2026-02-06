import type { Pool } from "pg";

export type PopulateDpuResult = {
	upserted: number;
	page_text_empty: number;
};

export type PopulateDpuParams =
	| { dealId: string; version?: string }
	| { documentId: string; dealId?: string; pageStart: number; pageEnd: number; version?: string };

function isMissingTableError(err: any): boolean {
	const code = String(err?.code ?? "");
	// 42P01 = undefined_table
	return code === "42P01";
}

async function backfillMissingDpuPlaceholdersForDocumentRange(
	pool: Pool,
	args: {
		documentId: string;
		pageStart: number;
		pageEnd: number;
		version: string;
	}
): Promise<number> {
	const documentId = args.documentId;
	const pageStart = Math.max(0, Math.floor(args.pageStart));
	const pageEnd = Math.max(pageStart, Math.floor(args.pageEnd));
	const version = args.version;

	if (!documentId || pageEnd <= pageStart) return 0;

	const sql = `WITH doc AS (
		SELECT id AS document_id, deal_id, status
		  FROM public.documents
		 WHERE id = $1::uuid
		 LIMIT 1
	),
	expected AS (
		SELECT generate_series($2::int, ($3::int) - 1) AS page_index
	),
	missing AS (
		SELECT e.page_index
		  FROM expected e
		  LEFT JOIN public.document_page_understanding dpu
		    ON dpu.document_id = $1::uuid
		   AND dpu.page_index = e.page_index
		   AND dpu.version = $4::text
		 WHERE dpu.page_index IS NULL
	),
	ins AS (
		INSERT INTO public.document_page_understanding (document_id, deal_id, page_index, version, payload)
		SELECT
			$1::uuid AS document_id,
			(SELECT deal_id FROM doc) AS deal_id,
			m.page_index AS page_index,
			$4::text AS version,
			jsonb_build_object(
				'metadata', jsonb_build_object(
					'is_placeholder', true,
					'placeholder_reason', 'missing_visual_extraction',
					'placeholder_created_at', now()
				),
				'source', jsonb_build_object(
					'document_id', $1::text,
					'deal_id', COALESCE((SELECT deal_id::text FROM doc), NULL),
					'page_index', m.page_index,
					'visual_asset_id', NULL,
					'image_uri', NULL,
					'extractor', NULL,
					'model_version', NULL,
					'extracted_at', NULL
				),
				'page_type', 'no_visual_extraction',
				'confidence', 0,
				'page_text', '',
				'normalized_text', '',
				'text_blocks', jsonb_build_object(
					'title', NULL,
					'bullets', NULL,
					'notes', NULL,
					'text_snippet', NULL,
					'ocr_text', NULL
				),
				'structured', NULL,
				'labels', NULL,
				'quality_flags', jsonb_build_object(
					'missing_visual_extraction', true,
					'page_text_empty', true,
					'is_placeholder', true
				)
			) AS payload
		  FROM missing m
		 WHERE (SELECT status FROM doc) = 'ready_for_analysis'
		ON CONFLICT (document_id, page_index, version) DO NOTHING
		RETURNING 1
	)
	SELECT COUNT(*)::bigint AS inserted FROM ins;`;

	const { rows } = await pool.query<{ inserted: string | number }>(sql, [documentId, pageStart, pageEnd, version]);
	const raw = rows?.[0]?.inserted ?? 0;
	const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Populate public.document_page_understanding from visual_extractions for PPTX documents.
 *
 * Deterministic rules:
 * - One row per (document_id, page_index, version='page_understanding_v1')
 * - Prefer structured_json for kind='powerpoint_slide'
 * - Fallback to ocr_text only when structured_json is missing/empty
 */
export async function populateDocumentPageUnderstandingFromVisualExtractions(
	pool: Pool,
	params: PopulateDpuParams
): Promise<PopulateDpuResult> {
	const version = (params.version ?? "page_understanding_v1").trim();
	const hasDocument = typeof (params as any)?.documentId === "string" && String((params as any).documentId).trim().length > 0;
	const dealId = !hasDocument && typeof (params as any)?.dealId === "string" ? String((params as any).dealId).trim() : "";
	const documentId = hasDocument ? String((params as any).documentId).trim() : "";
	const pageStartRaw = hasDocument ? (params as any).pageStart : null;
	const pageEndRaw = hasDocument ? (params as any).pageEnd : null;
	const pageStart =
		hasDocument && typeof pageStartRaw === "number" && Number.isFinite(pageStartRaw)
			? Math.max(0, Math.floor(pageStartRaw))
			: 0;
	const pageEnd =
		hasDocument && typeof pageEndRaw === "number" && Number.isFinite(pageEndRaw)
			? Math.max(pageStart, Math.floor(pageEndRaw))
			: pageStart;

	if (!hasDocument && !dealId) return { upserted: 0, page_text_empty: 0 };
	if (hasDocument && (!documentId || pageEnd <= pageStart)) return { upserted: 0, page_text_empty: 0 };

	try {
		console.log(
			JSON.stringify({
				event: "POPULATE_DOCUMENT_PAGE_UNDERSTANDING_START",
				deal_id: dealId || null,
				document_id: documentId || null,
				page_start: hasDocument ? pageStart : null,
				page_end: hasDocument ? pageEnd : null,
				version,
				ts: new Date().toISOString(),
			})
		);
	} catch {
		// ignore
	}

	const sqlDeal = `WITH docs AS (
		SELECT id, deal_id
		  FROM public.documents
		 WHERE deal_id = $1::uuid
	),
	candidate AS (
		SELECT
			d.id AS document_id,
			d.deal_id AS deal_id,
			va.page_index AS page_index,
			va.id AS visual_asset_id,
			va.image_uri AS image_uri,
			ve.extractor_version AS extractor_version,
			ve.model_version AS model_version,
			ve.created_at AS extracted_at,
			ve.confidence AS confidence,
			ve.labels AS labels,
			ve.structured_json AS structured_json,
			ve.ocr_text AS ocr_text
		  FROM docs d
		  JOIN public.visual_assets va ON va.document_id = d.id
		  JOIN public.visual_extractions ve
			ON ve.visual_asset_id = va.id
		   AND ve.extractor_version = va.extractor_version
	),
	prepared AS (
		SELECT
			document_id,
			deal_id,
			page_index,
			visual_asset_id,
			image_uri,
			extractor_version,
			model_version,
			extracted_at,
			confidence,
			labels,
			structured_json,
			ocr_text,
			CASE
				WHEN structured_json IS NOT NULL
					AND structured_json <> '{}'::jsonb
					AND COALESCE(structured_json->>'kind','') = 'powerpoint_slide'
				THEN true
				ELSE false
			END AS structured_ok,
			NULLIF(BTRIM(COALESCE(structured_json->>'title','')), '') AS title_text,
			NULLIF(BTRIM(COALESCE(structured_json->>'notes','')), '') AS notes_text,
			NULLIF(BTRIM(COALESCE(structured_json->>'text_snippet','')), '') AS snippet_text,
			CASE
				WHEN jsonb_typeof(structured_json->'bullets') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(NULLIF(BTRIM(b.value), ''), E'\n')), '')
					  FROM jsonb_array_elements_text(structured_json->'bullets') AS b(value)
				)
				ELSE NULL
			END AS bullets_text
		  FROM candidate
	),
	computed AS (
		SELECT
			document_id,
			deal_id,
			page_index,
			visual_asset_id,
			image_uri,
			extractor_version,
			model_version,
			extracted_at,
			confidence,
			labels,
			structured_json,
			ocr_text,
			structured_ok,
			title_text,
			notes_text,
			snippet_text,
			bullets_text,
			CASE
				WHEN structured_ok THEN NULLIF(BTRIM(concat_ws(E'\n', title_text, bullets_text, notes_text, snippet_text)), '')
				WHEN structured_json IS NULL OR structured_json = '{}'::jsonb THEN NULLIF(BTRIM(COALESCE(ocr_text, '')), '')
				ELSE NULL
			END AS page_text,
			COALESCE(
				NULLIF(COALESCE(structured_json->>'text_snippet', ''), ''),
				NULLIF(COALESCE(ocr_text, ''), ''),
				''
			) AS normalized_text
		  FROM prepared
	),
	best AS (
		SELECT DISTINCT ON (document_id, page_index)
			document_id,
			deal_id,
			page_index,
			visual_asset_id,
			image_uri,
			extractor_version,
			model_version,
			extracted_at,
			confidence,
			labels,
			structured_json,
			ocr_text,
			structured_ok,
			title_text,
			notes_text,
			snippet_text,
			bullets_text,
			page_text,
			normalized_text
		  FROM computed
		 ORDER BY
			document_id,
			page_index,
			structured_ok DESC,
			COALESCE(length(page_text), 0) DESC,
			COALESCE(confidence, 0) DESC,
			extracted_at DESC NULLS LAST,
			visual_asset_id
	),
	payloads AS (
		SELECT
			document_id,
			deal_id,
			page_index,
			$2::text AS version,
			jsonb_build_object(
				'source', jsonb_build_object(
					'document_id', document_id,
					'deal_id', deal_id,
					'page_index', page_index,
					'visual_asset_id', visual_asset_id,
					'image_uri', image_uri,
					'extractor', extractor_version,
					'model_version', model_version,
					'extracted_at', extracted_at
				),
				'page_type', COALESCE(structured_json->>'kind', 'powerpoint_slide'),
				'confidence', COALESCE(confidence, 0),
				'page_text', COALESCE(page_text, ''),
				'normalized_text', COALESCE(normalized_text, ''),
				'text_blocks', jsonb_build_object(
					'title', title_text,
					'bullets', structured_json->'bullets',
					'notes', notes_text,
					'text_snippet', snippet_text,
					'ocr_text', CASE WHEN structured_json IS NULL OR structured_json = '{}'::jsonb THEN NULLIF(BTRIM(COALESCE(ocr_text, '')), '') ELSE NULL END
				),
				'structured', structured_json,
				'labels', labels,
				'quality_flags', jsonb_build_object(
					'used_structured', structured_ok,
					'used_ocr_fallback', (NOT structured_ok) AND (structured_json IS NULL OR structured_json = '{}'::jsonb),
					'page_text_empty', page_text IS NULL
				)
			) AS payload
		  FROM best
	),
	upserted AS (
		INSERT INTO public.document_page_understanding (document_id, deal_id, page_index, version, payload)
		SELECT document_id, deal_id, page_index, version, payload
		  FROM payloads
		ON CONFLICT (document_id, page_index, version) DO UPDATE
		  SET payload = EXCLUDED.payload,
			  updated_at = now(),
			  deal_id = EXCLUDED.deal_id
		RETURNING payload
	),
	stats AS (
		SELECT
			COUNT(*)::bigint AS candidates_found,
			COUNT(*) FILTER (WHERE COALESCE(normalized_text, '') <> '')::bigint AS rows_with_text,
			COUNT(*) FILTER (WHERE COALESCE(normalized_text, '') = '')::bigint AS rows_missing_text
		  FROM best
	),
	final AS (
		SELECT
			COUNT(*)::bigint AS upserted,
			COUNT(*) FILTER (WHERE COALESCE(payload->>'page_text','') = '')::bigint AS page_text_empty
		  FROM upserted
	)
	SELECT
		final.upserted,
		final.page_text_empty,
		stats.candidates_found,
		stats.rows_with_text,
		stats.rows_missing_text
	  FROM final
	 CROSS JOIN stats;`;

	const sqlDocumentRange = `WITH doc AS (
		SELECT id, deal_id
		  FROM public.documents
		 WHERE id = $1::uuid
	),
	candidate AS (
		SELECT
			d.id AS document_id,
			d.deal_id AS deal_id,
			va.page_index AS page_index,
			va.id AS visual_asset_id,
			va.image_uri AS image_uri,
			ve.extractor_version AS extractor_version,
			ve.model_version AS model_version,
			ve.created_at AS extracted_at,
			ve.confidence AS confidence,
			ve.labels AS labels,
			ve.structured_json AS structured_json,
			ve.ocr_text AS ocr_text
		  FROM doc d
		  JOIN public.visual_assets va
			ON va.document_id = d.id
		   AND va.page_index >= $2
		   AND va.page_index < $3
		  JOIN public.visual_extractions ve
			ON ve.visual_asset_id = va.id
		   AND ve.extractor_version = va.extractor_version
	),
	prepared AS (
		SELECT
			document_id,
			deal_id,
			page_index,
			visual_asset_id,
			image_uri,
			extractor_version,
			model_version,
			extracted_at,
			confidence,
			labels,
			structured_json,
			ocr_text,
			CASE
				WHEN structured_json IS NOT NULL
					AND structured_json <> '{}'::jsonb
					AND COALESCE(structured_json->>'kind','') = 'powerpoint_slide'
				THEN true
				ELSE false
			END AS structured_ok,
			NULLIF(BTRIM(COALESCE(structured_json->>'title','')), '') AS title_text,
			NULLIF(BTRIM(COALESCE(structured_json->>'notes','')), '') AS notes_text,
			NULLIF(BTRIM(COALESCE(structured_json->>'text_snippet','')), '') AS snippet_text,
			CASE
				WHEN jsonb_typeof(structured_json->'bullets') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(NULLIF(BTRIM(b.value), ''), E'\n')), '')
					  FROM jsonb_array_elements_text(structured_json->'bullets') AS b(value)
				)
				ELSE NULL
			END AS bullets_text
		  FROM candidate
	),
	computed AS (
		SELECT
			document_id,
			deal_id,
			page_index,
			visual_asset_id,
			image_uri,
			extractor_version,
			model_version,
			extracted_at,
			confidence,
			labels,
			structured_json,
			ocr_text,
			structured_ok,
			title_text,
			notes_text,
			snippet_text,
			bullets_text,
			CASE
				WHEN structured_ok THEN NULLIF(BTRIM(concat_ws(E'\n', title_text, bullets_text, notes_text, snippet_text)), '')
				WHEN structured_json IS NULL OR structured_json = '{}'::jsonb THEN NULLIF(BTRIM(COALESCE(ocr_text, '')), '')
				ELSE NULL
			END AS page_text,
			COALESCE(
				NULLIF(COALESCE(structured_json->>'text_snippet', ''), ''),
				NULLIF(COALESCE(ocr_text, ''), ''),
				''
			) AS normalized_text
		  FROM prepared
	),
	best AS (
		SELECT DISTINCT ON (document_id, page_index)
			document_id,
			deal_id,
			page_index,
			visual_asset_id,
			image_uri,
			extractor_version,
			model_version,
			extracted_at,
			confidence,
			labels,
			structured_json,
			ocr_text,
			structured_ok,
			title_text,
			notes_text,
			snippet_text,
			bullets_text,
			page_text,
			normalized_text
		  FROM computed
		 ORDER BY
			document_id,
			page_index,
			structured_ok DESC,
			COALESCE(length(page_text), 0) DESC,
			COALESCE(confidence, 0) DESC,
			extracted_at DESC NULLS LAST,
			visual_asset_id
	),
	payloads AS (
		SELECT
			document_id,
			deal_id,
			page_index,
			$4::text AS version,
			jsonb_build_object(
				'source', jsonb_build_object(
					'document_id', document_id,
					'deal_id', deal_id,
					'page_index', page_index,
					'visual_asset_id', visual_asset_id,
					'image_uri', image_uri,
					'extractor', extractor_version,
					'model_version', model_version,
					'extracted_at', extracted_at
				),
				'page_type', COALESCE(structured_json->>'kind', 'powerpoint_slide'),
				'confidence', COALESCE(confidence, 0),
				'page_text', COALESCE(page_text, ''),
				'normalized_text', COALESCE(normalized_text, ''),
				'text_blocks', jsonb_build_object(
					'title', title_text,
					'bullets', structured_json->'bullets',
					'notes', notes_text,
					'text_snippet', snippet_text,
					'ocr_text', CASE WHEN structured_json IS NULL OR structured_json = '{}'::jsonb THEN NULLIF(BTRIM(COALESCE(ocr_text, '')), '') ELSE NULL END
				),
				'structured', structured_json,
				'labels', labels,
				'quality_flags', jsonb_build_object(
					'used_structured', structured_ok,
					'used_ocr_fallback', (NOT structured_ok) AND (structured_json IS NULL OR structured_json = '{}'::jsonb),
					'page_text_empty', page_text IS NULL
				)
			) AS payload
		  FROM best
	),
	upserted AS (
		INSERT INTO public.document_page_understanding (document_id, deal_id, page_index, version, payload)
		SELECT document_id, deal_id, page_index, version, payload
		  FROM payloads
		ON CONFLICT (document_id, page_index, version) DO UPDATE
		  SET payload = EXCLUDED.payload,
			  updated_at = now(),
			  deal_id = EXCLUDED.deal_id
		RETURNING payload
	),
	stats AS (
		SELECT
			COUNT(*)::bigint AS candidates_found,
			COUNT(*) FILTER (WHERE COALESCE(normalized_text, '') <> '')::bigint AS rows_with_text,
			COUNT(*) FILTER (WHERE COALESCE(normalized_text, '') = '')::bigint AS rows_missing_text
		  FROM best
	),
	final AS (
		SELECT
			COUNT(*)::bigint AS upserted,
			COUNT(*) FILTER (WHERE COALESCE(payload->>'page_text','') = '')::bigint AS page_text_empty
		  FROM upserted
	)
	SELECT
		final.upserted,
		final.page_text_empty,
		stats.candidates_found,
		stats.rows_with_text,
		stats.rows_missing_text
	  FROM final
	 CROSS JOIN stats;`;

	try {
		const sql = hasDocument ? sqlDocumentRange : sqlDeal;
		const queryParams = hasDocument ? [documentId, pageStart, pageEnd, version] : [dealId, version];
		const { rows } = await pool.query<{
			upserted: string | number;
			page_text_empty: string | number;
			candidates_found?: string | number;
			rows_with_text?: string | number;
			rows_missing_text?: string | number;
		}>(sql, queryParams);

		const upserted = rows?.[0]?.upserted ?? 0;
		const empty = rows?.[0]?.page_text_empty ?? 0;
		const candidatesFound = rows?.[0]?.candidates_found ?? 0;
		const rowsWithText = rows?.[0]?.rows_with_text ?? 0;
		const rowsMissingText = rows?.[0]?.rows_missing_text ?? 0;

		const upsertedNum = typeof upserted === "string" ? Number.parseInt(upserted, 10) : Number(upserted);
		const emptyNum = typeof empty === "string" ? Number.parseInt(empty, 10) : Number(empty);
		const candidatesFoundNum = typeof candidatesFound === "string" ? Number.parseInt(candidatesFound, 10) : Number(candidatesFound);
		const rowsWithTextNum = typeof rowsWithText === "string" ? Number.parseInt(rowsWithText, 10) : Number(rowsWithText);
		const rowsMissingTextNum = typeof rowsMissingText === "string" ? Number.parseInt(rowsMissingText, 10) : Number(rowsMissingText);

		try {
			console.log(
				JSON.stringify({
					event: "POPULATE_DOCUMENT_PAGE_UNDERSTANDING_RESULT",
					mode: hasDocument ? "document_range" : "deal_wide",
					deal_id: dealId || null,
					document_id: documentId || null,
					page_start: hasDocument ? pageStart : null,
					page_end: hasDocument ? pageEnd : null,
					version,
					upserted: Number.isFinite(upsertedNum) ? upsertedNum : 0,
					page_text_empty: Number.isFinite(emptyNum) ? emptyNum : 0,
					candidates_found: Number.isFinite(candidatesFoundNum) ? candidatesFoundNum : 0,
					rows_with_text: Number.isFinite(rowsWithTextNum) ? rowsWithTextNum : 0,
					rows_missing_text: Number.isFinite(rowsMissingTextNum) ? rowsMissingTextNum : 0,
					ts: new Date().toISOString(),
				})
			);
		} catch {
			// ignore
		}

		if (!Number.isFinite(upsertedNum) || upsertedNum === 0) {
			const reason =
				!Number.isFinite(candidatesFoundNum) || candidatesFoundNum <= 0
					? "no_candidates"
					: (!Number.isFinite(rowsWithTextNum) || rowsWithTextNum <= 0) && Number.isFinite(rowsMissingTextNum) && rowsMissingTextNum > 0
						? "candidates_missing_text"
						: "no_upsert";
			const wherePredicates = hasDocument
				? "documents.id = $1 AND visual_assets.page_index >= $2 AND visual_assets.page_index < $3"
				: "documents.deal_id = $1";
			try {
				console.log(
					JSON.stringify({
						event: "POPULATE_DOCUMENT_PAGE_UNDERSTANDING_ZERO",
						mode: hasDocument ? "document_range" : "deal_wide",
						deal_id: dealId || null,
						document_id: documentId || null,
						page_start: hasDocument ? pageStart : null,
						page_end: hasDocument ? pageEnd : null,
						version,
						reason,
						where_predicates: wherePredicates,
						candidates_found: Number.isFinite(candidatesFoundNum) ? candidatesFoundNum : 0,
						rows_with_text: Number.isFinite(rowsWithTextNum) ? rowsWithTextNum : 0,
						rows_missing_text: Number.isFinite(rowsMissingTextNum) ? rowsMissingTextNum : 0,
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// ignore
			}
		}

		if (hasDocument) {
			try {
				const inserted = await backfillMissingDpuPlaceholdersForDocumentRange(pool, {
					documentId,
					pageStart,
					pageEnd,
					version,
				});
				if (inserted > 0) {
					console.log(
						JSON.stringify({
							event: "POPULATE_DOCUMENT_PAGE_UNDERSTANDING_PLACEHOLDERS",
							document_id: documentId,
							deal_id: dealId || null,
							page_start: pageStart,
							page_end: pageEnd,
							version,
							inserted,
							ts: new Date().toISOString(),
						})
					)
				}
			} catch {
				// ignore: placeholders are best-effort
			}
		}

		return {
			upserted: upsertedNum,
			page_text_empty: emptyNum,
		};
	} catch (err: any) {
		if (isMissingTableError(err)) return { upserted: 0, page_text_empty: 0 };
		throw err;
	}
}
