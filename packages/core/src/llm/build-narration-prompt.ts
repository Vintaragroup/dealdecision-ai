type CitationRef = { page?: number; slide_title?: string; evidence_id?: string };

type BuildNarrationPromptArgs = {
	excerpt: unknown;
};

const normalizeString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const dedupeCitations = (items: CitationRef[]): CitationRef[] => {
	const out: CitationRef[] = [];
	const seen = new Set<string>();
	for (const it of items) {
		const page = typeof it?.page === "number" && Number.isFinite(it.page) ? it.page : undefined;
		const slide_title = normalizeString(it?.slide_title) || undefined;
		const evidence_id = normalizeString(it?.evidence_id) || undefined;
		if (page == null && !evidence_id) continue;
		const key = `${page ?? ""}|${slide_title ?? ""}|${evidence_id ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ page, slide_title, evidence_id });
	}
	return out;
};

const buildCitationCatalogFromExcerpt = (excerpt: any): CitationRef[] => {
	const raw: CitationRef[] = [];

	const push = (c: CitationRef) => {
		raw.push({
			page: typeof c?.page === "number" && Number.isFinite(c.page) ? c.page : undefined,
			slide_title: normalizeString(c?.slide_title) || undefined,
			evidence_id: normalizeString(c?.evidence_id) || undefined,
		});
	};

	const visitSourceObject = (src: any) => {
		if (!src || typeof src !== "object") return;
		push({
			page: (src as any).page ?? (src as any).page_index,
			slide_title: (src as any).slide_title,
			evidence_id: (src as any).evidence_id,
		});
	};

	const visitSourcesArray = (sources: any) => {
		if (!Array.isArray(sources)) return;
		for (const s of sources) visitSourceObject(s);
	};

	const walk = (node: any, depth: number) => {
		if (depth > 8) return;
		if (!node || typeof node !== "object") return;

		if (node.source && typeof node.source === "object") visitSourceObject(node.source);
		if (Array.isArray(node.sources)) visitSourcesArray(node.sources);

		// Capture evidence_ids if present anywhere in score_explanation subtrees.
		if (Array.isArray((node as any).evidence_ids)) {
			for (const eid of (node as any).evidence_ids) {
				const s = normalizeString(eid);
				if (s) push({ evidence_id: s });
			}
		}

		for (const v of Object.values(node)) {
			if (v && typeof v === "object") walk(v, depth + 1);
		}
	};

	// Build catalog from the allowlisted excerpt subtrees.
	walk(excerpt?.structured_summary, 0);
	walk(excerpt?.deal_summary_v1, 0);
	walk(excerpt?.score_explanation, 0);

	return dedupeCitations(raw);
};

export function buildNarrationPrompt(args: BuildNarrationPromptArgs): { system: string; user: string } {
	const excerptJson = JSON.stringify(args.excerpt ?? null);
	const citationCatalog = buildCitationCatalogFromExcerpt(args.excerpt as any);
	const citationCatalogJson = JSON.stringify(citationCatalog);
	const catalogEmpty = citationCatalog.length === 0;

	const system =
		"Output valid JSON ONLY. No markdown. No prose outside JSON. " +
		"You MUST output an object matching this schema exactly (no extra keys anywhere): " +
		"{version:\"llm_narration_v1\", summary:string, sections:[{title:string, body:string, what_would_change_my_mind:string, citations?:[{page?:number, slide_title?:string, evidence_id?:string}], evidence_basis:\"cited\"|\"no_evidence\"}], insights:[{title:string, claim:string, tier:\"restatement\"|\"implication\"|\"hypothesis\", confidence:\"low\"|\"medium\"|\"high\", basis:[{page?:number, slide_title?:string, evidence_id?:string}], evidence_basis:\"cited\"|\"no_evidence\", what_would_change_my_mind:string}], suggestions:{gaps:[{key:string,rationale:string}], questions:string[]}, quality_flags:string[]}. " +
		"Hard caps (must comply): " +
		"(A) summary length <= 240 characters. " +
		"(B) sections.length <= 5. " +
		"(C) each sections[i].body length <= 450 characters. " +
		"(D) insights.length <= 6. " +
		"(E) suggestions.gaps.length <= 4 and suggestions.questions.length <= 4. " +
		"(F) quality_flags.length <= 6. " +
		"Hard rules: " +
		"(1) Do NOT add any numbers unless they appear verbatim in REPORT_EXCERPT_JSON. " +
		"(2) Do NOT use KPI terms in summary. Keep summary KPI-free. " +
		"(3) Every section MUST include what_would_change_my_mind as ONE sentence: a concrete decision trigger. " +
		"(3b) Every insight MUST include what_would_change_my_mind as ONE sentence: a concrete decision trigger. " +
		"(3c) Insight tier rules: restatement and implication MUST be cited (evidence_basis=\"cited\" with non-empty basis[]). Hypothesis MUST include an uncertainty marker (e.g., may/might/likely/appears/suggests). " +
		" (3d) Insight mix requirement: include at least 2 implication insights and at least 1 hypothesis insight when possible; do not exceed 2 hypothesis insights. " +
		" (3e) Make insights \"smart\": each insight must either (i) connect two or more cited facts into a concise implication, or (ii) surface a specific risk/constraint/assumption with a concrete decision trigger. Avoid generic praise. " +
		" (3f) Titles must be short and executive. Prefer one of: \"Deal Edge\", \"Primary Risk\", \"Execution Constraint\", \"Unit Economics\", \"Go-to-Market Wedge\", \"Forecast Credibility\", \"Customer Concentration\", \"Distribution Leverage\", \"Operating Discipline\", \"Brand Moat\". " +
		" (3g) KPI-token rule (insights): Do NOT use KPI tokens (revenue/arr/mrr/irr/moic/cap_rate/cac/ltv/margin/runway/burn) in any insights[*].claim unless you include at least one basis citation from CITATION_CATALOG_JSON that matches the KPI source. If you do not have a matching KPI citation, rewrite using non-KPI phrasing (e.g., \"top-line performance\" or \"sales performance\") and avoid numbers. " +
		"(4) If a section body contains any KPI term (revenue/arr/mrr/irr/moic/cap_rate/cac/ltv/margin/runway/burn), then that section MUST include at least one citation from CITATION_CATALOG_JSON and set evidence_basis=\"cited\". " +
		"(5) Citations MUST be chosen exactly from CITATION_CATALOG_JSON; do not invent citations. " +
		" (5b) If you cannot cite an implication, downgrade it to hypothesis with evidence_basis=\"no_evidence\" and include uncertainty language. " +
		"(6) If evidence_basis=\"cited\", you MUST include citations[] with at least 1 item (chosen from CITATION_CATALOG_JSON). " +
		"(7) If evidence_basis=\"no_evidence\", citations MUST be [] (or omitted) and what_would_change_my_mind should be phrased like: \"What I'd need to see next is ...\" " +
		" (7b) Banned fluff phrases (do not use): \"strong investor interest\", \"capitalizing on\", \"growing market\", \"strategic positioning\", \"enhancing market reach\", \"crucial for scaling\", \"reflecting optimism\". Replace with a specific, testable implication tied to cited facts. " +
		(catalogEmpty
			? "(8) CITATION_CATALOG_JSON is empty: ALL sections MUST set evidence_basis=\"no_evidence\" and citations MUST be [] (or omitted)."
			: "");

	const user =
		`REPORT_EXCERPT_JSON:\n${excerptJson}\n\n` +
		`CITATION_CATALOG_JSON (allowlist; choose citations ONLY from this list):\n${citationCatalogJson}`;

	return { system, user };
}
