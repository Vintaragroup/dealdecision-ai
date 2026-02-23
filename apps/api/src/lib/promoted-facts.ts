import type { Pool } from "pg";

export type PromotedFactRow = {
	evidence_id: string;
	deal_id: string;
	source_type: string;
	source_path: string;
	source_document_id: string | null;
	confidence: number;
	extracted_at: string;
	content_json: any;
	meta: any;
};

function isMissingTableError(err: any): boolean {
	const code = String(err?.code ?? "");
	return code === "42P01";
}

export async function loadPromotedFactsForDeal(pool: Pool, dealId: string): Promise<PromotedFactRow[]> {
	const id = typeof dealId === "string" ? dealId.trim() : "";
	if (!id) return [];

	try {
		await pool.query("SELECT 1 FROM evidence_items LIMIT 1");
	} catch (err: any) {
		if (isMissingTableError(err)) return [];
		return [];
	}

	try {
		const res = await pool.query(
			`SELECT evidence_id::text,
			        deal_id::text,
			        source_type,
			        source_path,
			        source_document_id::text as source_document_id,
			        confidence,
			        extracted_at::text,
			        content_json,
			        meta
			   FROM evidence_items
			  WHERE deal_id = $1::uuid
			    AND source_type IN ('promoted_slide_fact','business_model_fact')
			    AND content_json IS NOT NULL
			    AND (content_json->>'fact_type') IN ('raise_terms_v1','business_model_v1')

                         UNION ALL

                        SELECT evidence_id::text,
                                deal_id::text,
                                source_type,
                                source_path,
                                source_document_id::text as source_document_id,
                                confidence,
                                extracted_at::text,
                                content_json,
                                meta
                           FROM evidence_items
                          WHERE deal_id = $1::uuid
                            AND source_type = 'phaseb_visual'

                          ORDER BY confidence DESC, extracted_at DESC, evidence_id ASC`,
                        [id]
                );
                return (res.rows ?? []) as any;
        } catch {
                return [];
        }
}