import type { Pool } from "pg";

export type PopulateDpuResult = {
	upserted: number;
	page_text_empty: number;
	candidates_found?: number;
	rows_with_text?: number;
	rows_missing_text?: number;
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
 * Populate public.document_page_understanding from visual_extractions.
 *
 * Deterministic rules:
 * - One row per (document_id, page_index, version='page_understanding_v1')
 * - Prefer structured text when it is sufficiently non-empty (min char threshold)
 * - Fallback to OCR text when structured text is missing/too short (even if structured_json exists)
 * - Derive basic title/bullets/snippet from OCR when structured fields are absent
 */
export async function populateDocumentPageUnderstandingFromVisualExtractions(
	pool: Pool,
	params: PopulateDpuParams
): Promise<PopulateDpuResult> {
	const version = (params.version ?? "page_understanding_v1").trim();
	const hasDocument = typeof (params as any)?.documentId === "string" && String((params as any).documentId).trim().length > 0;
	const dealId = !hasDocument && typeof (params as any)?.dealId === "string" ? String((params as any).dealId).trim() : "";
	const dealIdForLogs =
		hasDocument && typeof (params as any)?.dealId === "string" ? String((params as any).dealId).trim() : dealId;
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
				deal_id: dealIdForLogs || null,
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
			NULLIF(BTRIM(COALESCE(structured_json->>'title','')), '') AS title_text,
			NULLIF(BTRIM(COALESCE(structured_json->>'notes','')), '') AS notes_text,
			NULLIF(BTRIM(COALESCE(structured_json->>'text_snippet','')), '') AS snippet_text,
			NULLIF(BTRIM(COALESCE(structured_json #>> '{text_blocks,title}','')), '') AS tb_title_text,
			NULLIF(BTRIM(COALESCE(structured_json #>> '{text_blocks,notes}','')), '') AS tb_notes_text,
			NULLIF(BTRIM(COALESCE(structured_json #>> '{text_blocks,text_snippet}','')), '') AS tb_snippet_text,
			NULLIF(BTRIM(COALESCE(structured_json #>> '{text_blocks,ocr_text}','')), '') AS tb_ocr_text,
			CASE
				WHEN jsonb_typeof(structured_json->'bullets') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(NULLIF(BTRIM(b.value), ''), E'\n')), '')
					  FROM jsonb_array_elements_text(structured_json->'bullets') AS b(value)
				)
				ELSE NULL
			END AS bullets_text
			,
			CASE
				WHEN jsonb_typeof(structured_json #> '{text_blocks,bullets}') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(NULLIF(BTRIM(b.value), ''), E'\n')), '')
					  FROM jsonb_array_elements_text(structured_json #> '{text_blocks,bullets}') AS b(value)
				)
				ELSE NULL
			END AS tb_bullets_text
			-- excel_range: kind identifier + headers list + up to 12 preview rows
			,structured_json->>'kind' AS sj_kind
			,CASE
				WHEN jsonb_typeof(structured_json->'headers') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(NULLIF(BTRIM(h.value), ''), ', ')), '')
					  FROM jsonb_array_elements_text(structured_json->'headers') AS h(value)
				)
				ELSE NULL
			END AS excel_headers_text
			,CASE
				WHEN jsonb_typeof(structured_json->'rows_preview') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(row_line, E'\n')), '')
					  FROM (
						SELECT '- ' || (
							SELECT COALESCE(string_agg(COALESCE(NULLIF(BTRIM(c.value #>> '{}'), ''), ''), ' | ' ORDER BY c.ord), '')
							  FROM jsonb_array_elements(r.row_val) WITH ORDINALITY AS c(value, ord)
						) AS row_line
						  FROM jsonb_array_elements(structured_json->'rows_preview') WITH ORDINALITY AS r(row_val, rn)
						 WHERE r.rn <= 12
					  ) row_lines
				)
				ELSE NULL
			END AS excel_rows_text
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
			sj_kind,
			excel_headers_text,
			excel_rows_text,
			COALESCE(title_text, tb_title_text) AS title_text,
			COALESCE(notes_text, tb_notes_text) AS notes_text,
			COALESCE(snippet_text, tb_snippet_text) AS snippet_text,
			COALESCE(bullets_text, tb_bullets_text) AS bullets_text,
			NULLIF(
				BTRIM(
					concat_ws(
						E'\n',
						COALESCE(title_text, tb_title_text),
						COALESCE(bullets_text, tb_bullets_text),
						COALESCE(notes_text, tb_notes_text),
						COALESCE(snippet_text, tb_snippet_text)
					)
				),
				''
			) AS primary_text,
			NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') AS ocr_text_clean,
			CASE WHEN COALESCE(length(NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')), 0) >= 40 THEN true ELSE false END AS structured_ok,
			CASE
				WHEN sj_kind = 'excel_range'
					THEN NULLIF(BTRIM(concat_ws(E'\n',
						COALESCE(title_text, tb_title_text),
						CASE WHEN excel_headers_text IS NOT NULL THEN 'Headers: ' || excel_headers_text ELSE NULL END,
						excel_rows_text
					)), '')
				WHEN COALESCE(length(NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')), 0) >= 40
					THEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')
				WHEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') IS NOT NULL
					THEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '')
				WHEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '') IS NOT NULL
					THEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')
				ELSE NULL
			END AS page_text,
			COALESCE(
				COALESCE(snippet_text, tb_snippet_text),
				CASE
					WHEN COALESCE(length(NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')), 0) >= 40
						THEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')
					WHEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') IS NOT NULL
						THEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '')
					WHEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '') IS NOT NULL
						THEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')
					ELSE NULL
				END,
				''
			) AS normalized_text,
			CASE
				WHEN NULLIF(BTRIM(COALESCE(ocr_text, '')), '') IS NOT NULL THEN (
					SELECT NULLIF(BTRIM(x), '')
					  FROM unnest(regexp_split_to_array(NULLIF(BTRIM(COALESCE(ocr_text, '')), ''), E'\\r?\\n+')) WITH ORDINALITY AS t(x,n)
					 WHERE NULLIF(BTRIM(x), '') IS NOT NULL
					 ORDER BY n
					 LIMIT 1
				)
				ELSE NULL
			END AS ocr_title_text,
			CASE
				WHEN NULLIF(BTRIM(COALESCE(ocr_text, '')), '') IS NOT NULL THEN (
					SELECT jsonb_agg(line)
					  FROM (
						SELECT NULLIF(BTRIM(x), '') AS line
						  FROM unnest(regexp_split_to_array(NULLIF(BTRIM(COALESCE(ocr_text, '')), ''), E'\\r?\\n+')) WITH ORDINALITY AS t(x,n)
						 WHERE n >= 2
						   AND NULLIF(BTRIM(x), '') IS NOT NULL
						 ORDER BY n
						 LIMIT 8
					  ) s
				)
				ELSE NULL
			END AS ocr_bullets_json,
			COALESCE(title_text, tb_title_text,
				CASE
					WHEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') IS NOT NULL THEN (
						SELECT NULLIF(BTRIM(x), '')
						  FROM unnest(regexp_split_to_array(NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), ''), E'\\r?\\n+')) WITH ORDINALITY AS t(x,n)
						 WHERE NULLIF(BTRIM(x), '') IS NOT NULL
						 ORDER BY n
						 LIMIT 1
					)
					ELSE NULL
				END
			) AS resolved_title_text,
			CASE
				WHEN jsonb_typeof(structured_json->'bullets') = 'array' AND jsonb_array_length(structured_json->'bullets') > 0 THEN structured_json->'bullets'
				WHEN jsonb_typeof(structured_json #> '{text_blocks,bullets}') = 'array' AND jsonb_array_length(structured_json #> '{text_blocks,bullets}') > 0 THEN structured_json #> '{text_blocks,bullets}'
				WHEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') IS NOT NULL THEN (
					SELECT jsonb_agg(line)
					  FROM (
						SELECT NULLIF(BTRIM(x), '') AS line
						  FROM unnest(regexp_split_to_array(NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), ''), E'\\r?\\n+')) WITH ORDINALITY AS t(x,n)
						 WHERE n >= 2
						   AND NULLIF(BTRIM(x), '') IS NOT NULL
						 ORDER BY n
						 LIMIT 8
					  ) s
				)
				ELSE NULL
			END AS resolved_bullets_json
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
			normalized_text,
			ocr_text_clean,
			resolved_title_text,
			resolved_bullets_json,
			CASE
				WHEN COALESCE(length(page_text), 0) >= 40 THEN page_text
				ELSE NULLIF(BTRIM(concat_ws(E'\n', resolved_title_text, bullets_text, ocr_text_clean, normalized_text)), '')
			END AS page_text_final,
			NULLIF(BTRIM(LEFT(regexp_replace(COALESCE(
				CASE
					WHEN COALESCE(length(page_text), 0) >= 40 THEN page_text
					ELSE NULLIF(BTRIM(concat_ws(E'\n', resolved_title_text, bullets_text, ocr_text_clean, normalized_text)), '')
				END,
			''), E'\\s+', ' ', 'g'), 900)), '') AS text_snippet_final
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
				'page_type', COALESCE(structured_json->>'kind', 'page_image'),
				'confidence', COALESCE(confidence, 0),
				'page_text', COALESCE(page_text_final, ''),
				'normalized_text', COALESCE(normalized_text, ''),
				'text_blocks', jsonb_build_object(
					'title', resolved_title_text,
					'bullets', resolved_bullets_json,
					'notes', notes_text,
					'text_snippet', text_snippet_final,
					'ocr_text', ocr_text_clean
				),
				'structured', structured_json,
				'labels', labels,
				'quality_flags', jsonb_build_object(
					'used_structured', structured_ok,
					'used_ocr_fallback', (ocr_text_clean IS NOT NULL) AND ((NOT structured_ok) OR COALESCE(length(page_text), 0) < 40),
					'page_text_empty', COALESCE(page_text_final, '') = ''
				)
			) AS payload
		  FROM best
	),
	upserted AS (
		INSERT INTO public.document_page_understanding (document_id, deal_id, page_index, version, payload)
		SELECT document_id, deal_id, page_index, version, payload
		  FROM payloads
		ON CONFLICT (document_id, page_index, version) DO UPDATE
		  SET payload = CASE
			  WHEN COALESCE(document_page_understanding.payload->>'page_text', '') <> ''
			   AND COALESCE(EXCLUDED.payload->>'page_text', '') = ''
			  THEN document_page_understanding.payload
			  ELSE EXCLUDED.payload
			  END,
			  created_at = now(),
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
			COUNT(*) FILTER (
				WHERE COALESCE(payload->>'page_text','') = ''
				  AND COALESCE(payload->'text_blocks'->>'text_snippet','') = ''
			)::bigint AS page_text_empty
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
			NULLIF(BTRIM(COALESCE(structured_json->>'title','')), '') AS title_text,
			NULLIF(BTRIM(COALESCE(structured_json->>'notes','')), '') AS notes_text,
			NULLIF(BTRIM(COALESCE(structured_json->>'text_snippet','')), '') AS snippet_text,
			NULLIF(BTRIM(COALESCE(structured_json #>> '{text_blocks,title}','')), '') AS tb_title_text,
			NULLIF(BTRIM(COALESCE(structured_json #>> '{text_blocks,notes}','')), '') AS tb_notes_text,
			NULLIF(BTRIM(COALESCE(structured_json #>> '{text_blocks,text_snippet}','')), '') AS tb_snippet_text,
			NULLIF(BTRIM(COALESCE(structured_json #>> '{text_blocks,ocr_text}','')), '') AS tb_ocr_text,
			CASE
				WHEN jsonb_typeof(structured_json->'bullets') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(NULLIF(BTRIM(b.value), ''), E'\n')), '')
					  FROM jsonb_array_elements_text(structured_json->'bullets') AS b(value)
				)
				ELSE NULL
			END AS bullets_text
			,
			CASE
				WHEN jsonb_typeof(structured_json #> '{text_blocks,bullets}') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(NULLIF(BTRIM(b.value), ''), E'\n')), '')
					  FROM jsonb_array_elements_text(structured_json #> '{text_blocks,bullets}') AS b(value)
				)
				ELSE NULL
			END AS tb_bullets_text
			-- excel_range: kind identifier + headers list + up to 12 preview rows
			,structured_json->>'kind' AS sj_kind
			,CASE
				WHEN jsonb_typeof(structured_json->'headers') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(NULLIF(BTRIM(h.value), ''), ', ')), '')
					  FROM jsonb_array_elements_text(structured_json->'headers') AS h(value)
				)
				ELSE NULL
			END AS excel_headers_text
			,CASE
				WHEN jsonb_typeof(structured_json->'rows_preview') = 'array' THEN (
					SELECT NULLIF(BTRIM(string_agg(row_line, E'\n')), '')
					  FROM (
						SELECT '- ' || (
							SELECT COALESCE(string_agg(COALESCE(NULLIF(BTRIM(c.value #>> '{}'), ''), ''), ' | ' ORDER BY c.ord), '')
							  FROM jsonb_array_elements(r.row_val) WITH ORDINALITY AS c(value, ord)
						) AS row_line
						  FROM jsonb_array_elements(structured_json->'rows_preview') WITH ORDINALITY AS r(row_val, rn)
						 WHERE r.rn <= 12
					  ) row_lines
				)
				ELSE NULL
			END AS excel_rows_text
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
			sj_kind,
			excel_headers_text,
			excel_rows_text,
			COALESCE(title_text, tb_title_text) AS title_text,
			COALESCE(notes_text, tb_notes_text) AS notes_text,
			COALESCE(snippet_text, tb_snippet_text) AS snippet_text,
			COALESCE(bullets_text, tb_bullets_text) AS bullets_text,
			NULLIF(
				BTRIM(
					concat_ws(
						E'\n',
						COALESCE(title_text, tb_title_text),
						COALESCE(bullets_text, tb_bullets_text),
						COALESCE(notes_text, tb_notes_text),
						COALESCE(snippet_text, tb_snippet_text)
					)
				),
				''
			) AS primary_text,
			NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') AS ocr_text_clean,
			CASE WHEN COALESCE(length(NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')), 0) >= 40 THEN true ELSE false END AS structured_ok,
			CASE
				WHEN sj_kind = 'excel_range'
					THEN NULLIF(BTRIM(concat_ws(E'\n',
						COALESCE(title_text, tb_title_text),
						CASE WHEN excel_headers_text IS NOT NULL THEN 'Headers: ' || excel_headers_text ELSE NULL END,
						excel_rows_text
					)), '')
				WHEN COALESCE(length(NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')), 0) >= 40
					THEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')
				WHEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') IS NOT NULL
					THEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '')
				WHEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '') IS NOT NULL
					THEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')
				ELSE NULL
			END AS page_text,
			COALESCE(
				COALESCE(snippet_text, tb_snippet_text),
				CASE
					WHEN COALESCE(length(NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')), 0) >= 40
						THEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')
					WHEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') IS NOT NULL
						THEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '')
					WHEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '') IS NOT NULL
						THEN NULLIF(BTRIM(concat_ws(E'\n', COALESCE(title_text, tb_title_text), COALESCE(bullets_text, tb_bullets_text), COALESCE(notes_text, tb_notes_text), COALESCE(snippet_text, tb_snippet_text))), '')
					ELSE NULL
				END,
				''
			) AS normalized_text,
			COALESCE(title_text, tb_title_text,
				CASE
					WHEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') IS NOT NULL THEN (
						SELECT NULLIF(BTRIM(x), '')
						  FROM unnest(regexp_split_to_array(NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), ''), E'\\r?\\n+')) WITH ORDINALITY AS t(x,n)
						 WHERE NULLIF(BTRIM(x), '') IS NOT NULL
						 ORDER BY n
						 LIMIT 1
					)
					ELSE NULL
				END
			) AS resolved_title_text,
			CASE
				WHEN jsonb_typeof(structured_json->'bullets') = 'array' AND jsonb_array_length(structured_json->'bullets') > 0 THEN structured_json->'bullets'
				WHEN jsonb_typeof(structured_json #> '{text_blocks,bullets}') = 'array' AND jsonb_array_length(structured_json #> '{text_blocks,bullets}') > 0 THEN structured_json #> '{text_blocks,bullets}'
				WHEN NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), '') IS NOT NULL THEN (
					SELECT jsonb_agg(line)
					  FROM (
						SELECT NULLIF(BTRIM(x), '') AS line
						  FROM unnest(regexp_split_to_array(NULLIF(BTRIM(COALESCE(ocr_text, tb_ocr_text, structured_json->>'ocr_text', '')), ''), E'\\r?\\n+')) WITH ORDINALITY AS t(x,n)
						 WHERE n >= 2
						   AND NULLIF(BTRIM(x), '') IS NOT NULL
						 ORDER BY n
						 LIMIT 8
					  ) s
				)
				ELSE NULL
			END AS resolved_bullets_json
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
			normalized_text,
			ocr_text_clean,
			resolved_title_text,
			resolved_bullets_json,
			CASE
				WHEN COALESCE(length(page_text), 0) >= 40 THEN page_text
				ELSE NULLIF(BTRIM(concat_ws(E'\n', resolved_title_text, bullets_text, ocr_text_clean, normalized_text)), '')
			END AS page_text_final,
			NULLIF(BTRIM(LEFT(regexp_replace(COALESCE(
				CASE
					WHEN COALESCE(length(page_text), 0) >= 40 THEN page_text
					ELSE NULLIF(BTRIM(concat_ws(E'\n', resolved_title_text, bullets_text, ocr_text_clean, normalized_text)), '')
				END,
			''), E'\\s+', ' ', 'g'), 900)), '') AS text_snippet_final
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
				'page_type', COALESCE(structured_json->>'kind', 'page_image'),
				'confidence', COALESCE(confidence, 0),
				'page_text', COALESCE(page_text_final, ''),
				'normalized_text', COALESCE(normalized_text, ''),
				'text_blocks', jsonb_build_object(
					'title', resolved_title_text,
					'bullets', resolved_bullets_json,
					'notes', notes_text,
					'text_snippet', text_snippet_final,
					'ocr_text', ocr_text_clean
				),
				'structured', structured_json,
				'labels', labels,
				'quality_flags', jsonb_build_object(
					'used_structured', structured_ok,
					'used_ocr_fallback', (ocr_text_clean IS NOT NULL) AND ((NOT structured_ok) OR COALESCE(length(page_text), 0) < 40),
					'page_text_empty', COALESCE(page_text_final, '') = ''
				)
			) AS payload
		  FROM best
	),
	upserted AS (
		INSERT INTO public.document_page_understanding (document_id, deal_id, page_index, version, payload)
		SELECT document_id, deal_id, page_index, version, payload
		  FROM payloads
		ON CONFLICT (document_id, page_index, version) DO UPDATE
		  SET payload = CASE
			  WHEN COALESCE(document_page_understanding.payload->>'page_text', '') <> ''
			   AND COALESCE(EXCLUDED.payload->>'page_text', '') = ''
			  THEN document_page_understanding.payload
			  ELSE EXCLUDED.payload
			  END,
			  created_at = now(),
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
			COUNT(*) FILTER (
				WHERE COALESCE(payload->>'page_text','') = ''
				  AND COALESCE(payload->'text_blocks'->>'text_snippet','') = ''
			)::bigint AS page_text_empty
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
					deal_id: dealIdForLogs || null,
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
						deal_id: dealIdForLogs || null,
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
							deal_id: dealIdForLogs || null,
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

		// Enrich DPU rows where page_text is empty by pulling embedded text from
		// documents.full_content.pages[i].text. This is the authoritative source for
		// text PDFs (textProbe.decision='text_ok_skip_ocr') where vision extraction
		// skips OCR and leaves page_text empty.
		try {
			const enrichArgs = hasDocument
				? { documentId, dealId: dealIdForLogs || undefined, pageStart, pageEnd, version }
				: { dealId, version };
			const { enriched } = await enrichDpuWithEmbeddedPdfText(pool, enrichArgs);
			if (enriched > 0) {
				try {
					console.log(
						JSON.stringify({
							event: "POPULATE_DOCUMENT_PAGE_UNDERSTANDING_PDF_ENRICH",
							mode: hasDocument ? "document_range" : "deal_wide",
							deal_id: dealIdForLogs || null,
							document_id: documentId || null,
							page_start: hasDocument ? pageStart : null,
							page_end: hasDocument ? pageEnd : null,
							version,
							enriched,
							ts: new Date().toISOString(),
						})
					);
				} catch {
					// ignore
				}
			}
		} catch {
			// PDF text enrichment is best-effort; do not fail the main operation
		}

		return {
			upserted: upsertedNum,
			page_text_empty: emptyNum,
			candidates_found: Number.isFinite(candidatesFoundNum) ? candidatesFoundNum : 0,
			rows_with_text: Number.isFinite(rowsWithTextNum) ? rowsWithTextNum : 0,
			rows_missing_text: Number.isFinite(rowsMissingTextNum) ? rowsMissingTextNum : 0,
		};
	} catch (err: any) {
		if (isMissingTableError(err)) return { upserted: 0, page_text_empty: 0 };
		throw err;
	}
}

/**
 * Deterministic resolver for the "best" page text content to store in DPU.
 *
 * Priority order (highest → lowest):
 *   1. PDF embedded text (pdfText ≥ minPdfLength chars)
 *      → extractor = "worker.pdf", pageType = "pdf_text"   ← preferred for text PDFs
 *   2. Vision-structured text assembled from title/bullets/notes/snippet (≥ minStructuredLength)
 *      → extractor = visionExtractorVersion, pageType = "page_image"
 *   3. OCR text from visual_extractions.ocr_text (any non-empty length)
 *      → extractor = "ocr", pageType = "page_image"
 *   4. Raw vision page_text fallback
 *   5. Empty — no usable text found
 *
 * Mirrors the SQL priority chain inside populateDocumentPageUnderstandingFromVisualExtractions
 * as a testable TypeScript function.
 */
export function resolveBestDpuPageText(candidates: {
	/** Text from documents.full_content.pages[page_index].text (native PDF text layer) */
	pdfText?: string | null;
	/** Assembled text from visual extraction structured fields (title+bullets+notes+snippet) */
	structuredText?: string | null;
	/** Raw OCR text from visual_extractions.ocr_text */
	ocrText?: string | null;
	/** Fallback page_text from vision model output */
	visionPageText?: string | null;
	/** Minimum chars for PDF text to be usable (default: 25) */
	minPdfLength?: number;
	/** Minimum chars for structured text to be ok (default: 40) */
	minStructuredLength?: number;
	/** extractor label when vision/structured wins (default: "vision_v1") */
	visionExtractorVersion?: string;
}): {
	text: string;
	extractor: string;
	pageType: string;
	source: "pdf_text" | "structured" | "ocr" | "vision" | "empty";
} {
	const minPdf = typeof candidates.minPdfLength === "number" ? Math.max(0, candidates.minPdfLength) : 25;
	const minStructured = typeof candidates.minStructuredLength === "number" ? Math.max(0, candidates.minStructuredLength) : 40;
	const visionExtractor =
		typeof candidates.visionExtractorVersion === "string" && candidates.visionExtractorVersion.trim().length > 0
			? candidates.visionExtractorVersion.trim()
			: "vision_v1";

	const pdfText = (candidates.pdfText ?? "").trim();
	if (pdfText.length >= minPdf) {
		return { text: pdfText, extractor: "worker.pdf", pageType: "pdf_text", source: "pdf_text" };
	}

	const structuredText = (candidates.structuredText ?? "").trim();
	if (structuredText.length >= minStructured) {
		return { text: structuredText, extractor: visionExtractor, pageType: "page_image", source: "structured" };
	}

	const ocrText = (candidates.ocrText ?? "").trim();
	if (ocrText.length > 0) {
		return { text: ocrText, extractor: "ocr", pageType: "page_image", source: "ocr" };
	}

	const visionPageText = (candidates.visionPageText ?? "").trim();
	if (visionPageText.length > 0) {
		return { text: visionPageText, extractor: visionExtractor, pageType: "page_image", source: "vision" };
	}

	return { text: "", extractor: visionExtractor, pageType: "page_image", source: "empty" };
}

/**
 * Post-upsert enrichment: for DPU rows where page_text is currently empty, pull
 * per-page text from documents.full_content.pages[i].text and UPDATE the payload.
 *
 * Handles text PDFs (textProbe.decision = "text_ok_skip_ocr") where vision extraction
 * never produces OCR text. Safety rules enforced by SQL:
 *   - Only updates rows where payload->>'page_text' = '' (never overwrites existing text)
 *   - Only uses pdf pages where length(trim(text)) >= minPdfTextLength (default 25)
 *   - Sets source.extractor = "worker.pdf", page_type = "pdf_text"
 *   - Sets quality_flags.used_pdf_text = true, page_text_empty = false
 */
export async function enrichDpuWithEmbeddedPdfText(
	pool: Pool,
	args: {
		documentId?: string;
		dealId?: string;
		pageStart?: number;
		pageEnd?: number;
		version?: string;
		/** Minimum trimmed char count for PDF page text to be used (default: 25) */
		minPdfTextLength?: number;
	}
): Promise<{ enriched: number }> {
	const version = (args.version ?? "page_understanding_v1").trim();
	const minLen =
		typeof args.minPdfTextLength === "number" && Number.isFinite(args.minPdfTextLength)
			? Math.max(1, Math.floor(args.minPdfTextLength))
			: 25;
	const hasDocumentId = typeof args.documentId === "string" && args.documentId.trim().length > 0;
	const hasDealId = !hasDocumentId && typeof args.dealId === "string" && args.dealId.trim().length > 0;
	if (!hasDocumentId && !hasDealId) return { enriched: 0 };

	// Patch page_text, normalized_text, text_blocks.text_snippet, page_type, source.extractor,
	// and quality_flags in a single jsonb expression. The || merge at the top level replaces
	// quality_flags with the original flags augmented by used_pdf_text=true, page_text_empty=false.
	const jsonbSetChain = [
		`jsonb_set(`,
		`  jsonb_set(`,
		`    jsonb_set(`,
		`      jsonb_set(`,
		`        jsonb_set(`,
		`          dpu.payload,`,
		`          '{page_text}', to_jsonb(pp.pdf_text)`,
		`        ),`,
		`        '{normalized_text}', to_jsonb(pp.pdf_text)`,
		`      ),`,
		`      '{text_blocks,text_snippet}', to_jsonb(LEFT(pp.pdf_text, 900))`,
		`    ),`,
		`    '{page_type}', '"pdf_text"'::jsonb`,
		`  ),`,
		`  '{source,extractor}', '"worker.pdf"'::jsonb`,
		`) || jsonb_build_object(`,
		`  'quality_flags',`,
		`  COALESCE(dpu.payload->'quality_flags', '{}'::jsonb)`,
		`    || '{"used_pdf_text": true, "page_text_empty": false}'::jsonb`,
		`)`,
	].join("\n\t\t");

	let sql: string;
	let queryParams: Array<string | number>;

	if (hasDocumentId) {
		const docId = args.documentId!.trim();
		const pageStart =
			typeof args.pageStart === "number" && Number.isFinite(args.pageStart)
				? Math.max(0, Math.floor(args.pageStart))
				: 0;
		const pageEndRaw =
			typeof args.pageEnd === "number" && Number.isFinite(args.pageEnd)
				? Math.floor(args.pageEnd)
				: null;
		const hasRange = pageEndRaw !== null && pageEndRaw > pageStart;
		const versionParam = hasRange ? "$5" : "$3";
		sql = `WITH pdf_pages AS (
	SELECT
		d.id AS document_id,
		(p.ordinality - 1)::int AS page_index,
		NULLIF(BTRIM(COALESCE(p.value->>'text', '')), '') AS pdf_text
	  FROM public.documents d,
	  jsonb_array_elements(COALESCE(d.full_content->'pages', '[]'::jsonb)) WITH ORDINALITY AS p(value, ordinality)
	 WHERE d.id = $1::uuid
	   AND length(BTRIM(COALESCE(p.value->>'text', ''))) >= $2::int${hasRange ? `
	   AND (p.ordinality - 1) >= $3::int
	   AND (p.ordinality - 1) < $4::int` : ""}
),
updated AS (
	UPDATE public.document_page_understanding dpu
	  SET
		payload = ${jsonbSetChain},
		updated_at = now()
	  FROM pdf_pages pp
	 WHERE dpu.document_id = pp.document_id
	   AND dpu.page_index = pp.page_index
	   AND dpu.version = ${versionParam}::text
	   AND COALESCE(dpu.payload->>'page_text', '') = ''
	RETURNING 1
)
SELECT COUNT(*)::bigint AS enriched FROM updated;`;
		queryParams = hasRange
			? [docId, minLen, pageStart, pageEndRaw!, version]
			: [docId, minLen, version];
	} else {
		const dealId = args.dealId!.trim();
		sql = `WITH pdf_pages AS (
	SELECT
		d.id AS document_id,
		(p.ordinality - 1)::int AS page_index,
		NULLIF(BTRIM(COALESCE(p.value->>'text', '')), '') AS pdf_text
	  FROM public.documents d,
	  jsonb_array_elements(COALESCE(d.full_content->'pages', '[]'::jsonb)) WITH ORDINALITY AS p(value, ordinality)
	 WHERE d.deal_id = $1::uuid
	   AND length(BTRIM(COALESCE(p.value->>'text', ''))) >= $2::int
),
updated AS (
	UPDATE public.document_page_understanding dpu
	  SET
		payload = ${jsonbSetChain},
		updated_at = now()
	  FROM pdf_pages pp
	 WHERE dpu.document_id = pp.document_id
	   AND dpu.page_index = pp.page_index
	   AND dpu.version = $3::text
	   AND COALESCE(dpu.payload->>'page_text', '') = ''
	RETURNING 1
)
SELECT COUNT(*)::bigint AS enriched FROM updated;`;
		queryParams = [dealId, minLen, version];
	}

	try {
		const { rows } = await pool.query<{ enriched: string | number }>(sql, queryParams);
		const raw = rows?.[0]?.enriched ?? 0;
		const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
		return { enriched: Number.isFinite(n) ? n : 0 };
	} catch (err: any) {
		if (isMissingTableError(err)) return { enriched: 0 };
		throw err;
	}
}
