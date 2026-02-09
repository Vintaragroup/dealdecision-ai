type CitationRef = { page?: number; slide_title?: string; evidence_id?: string };

export type BuildOverviewPromptArgs = {
	reportExcerpt: unknown;
	citationCatalog?: CitationRef[];
	narration?: unknown;
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

	walk(excerpt?.structured_summary, 0);
	walk(excerpt?.deal_summary_v1, 0);
	walk(excerpt?.score_explanation, 0);
	walk(excerpt?.evidence_catalog, 0);
	walk(excerpt?.evidence, 0);

	return dedupeCitations(raw);
};

export function buildOverviewPrompt(args: BuildOverviewPromptArgs): { system: string; user: string } {
	const reportExcerptJson = JSON.stringify(args.reportExcerpt ?? null);
	const narrationJson = JSON.stringify(args.narration ?? null);

	const citationCatalog = dedupeCitations(
		Array.isArray(args.citationCatalog)
			? (args.citationCatalog as CitationRef[])
			: buildCitationCatalogFromExcerpt(args.reportExcerpt as any),
	);
	const citationCatalogJson = JSON.stringify(citationCatalog);
	const catalogEmpty = citationCatalog.length === 0;

	// Match schema bounds (see llm/overview-schema.ts)
	const system =
		"Output valid JSON ONLY. No markdown. No prose outside JSON. " +
		"You MUST output an object matching this schema exactly (no extra keys anywhere): " +
		"{version:\"llm_overview_v1\", hero_header:string, deal_summary:{hero:string,mid:string,long:string}, investment_analysis_overview:string, strengths_overlay:string[], concerns_overlay:string[], coverage_gaps_overlay:string[], citations:{page?:number, slide_title?:string, evidence_id?:string}[], quality_flags:string[]}. " +
		"Hard caps (must comply): " +
		"(A) hero_header length <= 900 chars. " +
		"(B) deal_summary.hero <= 400 chars; deal_summary.mid <= 1400 chars; deal_summary.long <= 3600 chars. " +
		"(C) investment_analysis_overview length <= 2400 chars. " +
		"(D) strengths_overlay.length <= 6; concerns_overlay.length <= 8; coverage_gaps_overlay.length <= 12. " +
		"(E) each bullet string length <= 320 chars. " +
		"(F) citations.length <= 80. " +
		"(G) quality_flags.length <= 24. " +
		"Hard rules (deterministic is the law): " +
		"(1) Do NOT invent facts, numbers, entities, customers, geographies, partners, competitors, timelines, or metrics not present in REPORT_EXCERPT_JSON. " +
		"(2) If you go beyond restatement (i.e., you infer implications, risks, or causality), you MUST use uncertainty language unless the statement is directly supported by cited evidence. Use words like may/might/likely/appears/suggests/possibly. " +
		"(3) Any KPI term OR any numeric token (including $ amounts, percentages, counts, dates/years) MUST be supported by citations chosen from CITATION_CATALOG_JSON. " +
		"(4) Citations MUST be chosen exactly from CITATION_CATALOG_JSON; do not invent citations. " +
		"(5) Add all citations you used anywhere into the top-level citations[] array (dedupe if repeated). " +
		"(6) Synthesize; reduce repetition. Do not just paraphrase deterministic text. Prefer investor-grade compression and clear decision-relevant implications. " +
		"(7) Style: smartest-person-in-the-room, concise, specific, investor memo tone. No hype. No vague praise. " +
		"(8) Allowed heading prefixes for overlay bullets (each bullet MUST start with one of these followed by ':'): " +
		"Product, ICP, Market, Traction, Business model, Go-to-market, Unit economics, Competition, Risks, Raise terms, Financials, Team, Operations, Legal. " +
		"Field instructions: " +
		"(H1) hero_header: 2–4 sentences max; high-signal; no filler; avoid numbers unless you can cite them; do not mention anything not in the excerpt. " +
		"(H2) deal_summary.hero: exactly 1 sentence; a crisp one-liner. " +
		"(H3) deal_summary.mid: ~3–5 sentences; compact narrative of what it is, who it serves, and current traction/risk posture. " +
		"(H4) deal_summary.long: ~8–12 sentences; deeper synthesis, still concise; avoid repeating the same claim in multiple ways. " +
		"(H5) investment_analysis_overview: NOT a summary. It is a reasoning artifact for an investment committee. " +
		"REASONING STRUCTURE (MANDATORY): Produce 2–4 points only. " +
		"Each point MUST start with the exact literal delimiter and label: '• Signal:' (U+2022 bullet, then a space, then Signal, then colon). " +
		"Within each point, you MUST include ALL four labels exactly once, each on its own line, and each line MUST begin with the exact literal label string including the bullet: " +
		"'• Signal:', '• Implication:', '• Uncertainty:', '• Decision Tension:'. " +
		"Do NOT use '-', '*', numbering, or any other bullet marker. Do NOT write 'Signal -' or 'Signal —'. " +
		"Point delimiter format: each point is exactly 4 lines (one per label) and points are separated by exactly one blank line. " +
		"Before responding, verify the output contains 2–4 points and each point contains all 4 labels exactly once. " +
		"If you cannot comply, output investment_analysis_overview as an empty string. " +
		"Use uncertainty language (may, might, suggests, appears) for all implications. " +
		"Do NOT assign or suggest a score, grade, recommendation, or decision. Do NOT repeat the deterministic score explanation verbatim. " +
		"Focus on asymmetry, irreversibility, and decision leverage. " +
		"(H6) strengths_overlay: 0–6 bullets; each bullet starts with an allowed heading prefix and is specific and evidence-respecting. " +
		"(H7) concerns_overlay: 0–8 bullets; same formatting; include decision-relevant risks/unknowns; use uncertainty language when not directly evidenced. " +
		"(H8) coverage_gaps_overlay: 0–12 bullets; make each gap actionable (what evidence is missing). " +
		"(H9) citations: include every citation you used; entries may include page and/or evidence_id; optional slide_title; do not include any citation not in CITATION_CATALOG_JSON. " +
		"(H10) quality_flags: include \"guard_degraded\" if you had to omit or soften content due to missing citations / grounding constraints; otherwise []. " +
		(catalogEmpty
			? "(9) CITATION_CATALOG_JSON is empty: you MUST avoid KPI terms and numeric tokens entirely; citations MUST be []. If you cannot produce a grounded overview without numbers, lean on qualitative synthesis and add quality_flags: [\"guard_degraded\"]."
			: "");

	const user =
		`REPORT_EXCERPT_JSON (deterministic allowlist; treat as law):\n${reportExcerptJson}\n\n` +
		`CITATION_CATALOG_JSON (allowlist; choose citations ONLY from this list):\n${citationCatalogJson}\n\n` +
		`OPTIONAL_LLM_NARRATION_JSON (style hint only; deterministic remains the law; ignore anything not supported by excerpt+citation allowlist):\n${narrationJson}`;

	return { system, user };
}
