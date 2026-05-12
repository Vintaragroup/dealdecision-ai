import { buildInvestmentAnalysisOverviewV2 } from '../investment-analysis-overview-v2';

describe('buildInvestmentAnalysisOverviewV2 — summary wiring', () => {
	const emptyReport = {};

	function makeDio(dealSummaryV2: unknown) {
		return {
			dio: {
				phase1: {
					deal_summary_v2: dealSummaryV2,
				},
			},
			analyzer_results: {},
		} as any;
	}

	test('populates summary from dio.phase1.deal_summary_v2.summary.one_liner', () => {
		const dio = makeDio({
			generated_at: '2025-01-01T00:00:00Z',
			model: 'gpt-4o',
			summary: {
				one_liner: 'Acme delivers enterprise SaaS for supply-chain automation.',
				paragraphs: ['Para 1.', 'Para 2.', 'Para 3.'],
			},
			strengths: [],
			risks: [],
			open_questions: [],
		});

		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });

		expect(result.summary).toBe('Acme delivers enterprise SaaS for supply-chain automation.');
	});

	test('returns null summary when deal_summary_v2 is absent', () => {
		const dio = makeDio(undefined);
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });
		expect(result.summary).toBeNull();
	});

	test('returns null summary when one_liner is blank', () => {
		const dio = makeDio({
			generated_at: '2025-01-01T00:00:00Z',
			model: 'gpt-4o',
			summary: { one_liner: '   ', paragraphs: ['A', 'B', 'C'] },
			strengths: [],
			risks: [],
			open_questions: [],
		});

		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });
		expect(result.summary).toBeNull();
	});

	test('trims whitespace from one_liner', () => {
		const dio = makeDio({
			generated_at: '2025-01-01T00:00:00Z',
			model: 'gpt-4o',
			summary: { one_liner: '  Trimmed description.  ', paragraphs: ['A', 'B', 'C'] },
			strengths: [],
			risks: [],
			open_questions: [],
		});

		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });
		expect(result.summary).toBe('Trimmed description.');
	});

	// ── summary_medium ──────────────────────────────────────────────────────

	test('populates summary_medium from paragraphs[0]', () => {
		const dio = makeDio({
			generated_at: '2025-01-01T00:00:00Z',
			model: 'gpt-4o',
			summary: {
				one_liner: 'Short one-liner.',
				paragraphs: ['First paragraph with detailed context.', 'Second paragraph.', 'Third paragraph.'],
			},
			strengths: [],
			risks: [],
			open_questions: [],
		});

		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });

		expect(result.summary_medium).toBe('First paragraph with detailed context.');
	});

	test('summary_medium is distinct from summary (one_liner)', () => {
		const dio = makeDio({
			generated_at: '2025-01-01T00:00:00Z',
			model: 'gpt-4o',
			summary: {
				one_liner: 'The one-liner.',
				paragraphs: ['A much longer paragraph about the deal context.', 'Para 2.', 'Para 3.'],
			},
			strengths: [],
			risks: [],
			open_questions: [],
		});

		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });

		expect(result.summary).toBe('The one-liner.');
		expect(result.summary_medium).toBe('A much longer paragraph about the deal context.');
		expect(result.summary_medium).not.toBe(result.summary);
	});

	test('returns null summary_medium when paragraphs is absent', () => {
		const dio = makeDio({
			generated_at: '2025-01-01T00:00:00Z',
			model: 'gpt-4o',
			summary: { one_liner: 'One-liner only, no paragraphs.' },
			strengths: [],
			risks: [],
			open_questions: [],
		});

		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });
		expect(result.summary_medium).toBeNull();
	});

	test('returns null summary_medium when deal_summary_v2 is absent', () => {
		const dio = makeDio(undefined);
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });
		expect(result.summary_medium).toBeNull();
	});

	// ── summary_long ────────────────────────────────────────────────────────

	test('populates summary_long from paragraphs[1] and paragraphs[2] joined', () => {
		const dio = makeDio({
			generated_at: '2025-01-01T00:00:00Z',
			model: 'gpt-4o',
			summary: {
				one_liner: 'Short.',
				paragraphs: ['Para 0.', 'Para 1 about context.', 'Para 2 about risks.'],
			},
			strengths: [],
			risks: [],
			open_questions: [],
		});

		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });

		expect(result.summary_long).toBe('Para 1 about context.\n\nPara 2 about risks.');
	});

	test('summary_long uses only paragraphs[1] when paragraphs[2] is absent', () => {
		const dio = makeDio({
			generated_at: '2025-01-01T00:00:00Z',
			model: 'gpt-4o',
			summary: {
				one_liner: 'Short.',
				paragraphs: ['Para 0.', 'Para 1 only.'],
			},
			strengths: [],
			risks: [],
			open_questions: [],
		});

		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });

		expect(result.summary_long).toBe('Para 1 only.');
	});

	test('returns null summary_long when only one paragraph exists', () => {
		const dio = makeDio({
			generated_at: '2025-01-01T00:00:00Z',
			model: 'gpt-4o',
			summary: {
				one_liner: 'Short.',
				paragraphs: ['Only para 0.'],
			},
			strengths: [],
			risks: [],
			open_questions: [],
		});

		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });

		expect(result.summary_long).toBeNull();
	});

	test('returns null summary_long when deal_summary_v2 is absent', () => {
		const dio = makeDio(undefined);
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });
		expect(result.summary_long).toBeNull();
	});
});

// ─── P3: IAO summary text sanitization ───────────────────────────────────────

describe('buildInvestmentAnalysisOverviewV2 — summary sanitization (P3)', () => {
	const emptyReport = {};

	function makeDioWithSummary(oneLiner: string, medium?: string, long?: string) {
		const paragraphs: string[] = [];
		if (medium) paragraphs.push(medium);
		if (long) paragraphs.push(long);
		return {
			dio: {
				phase1: {
					deal_summary_v2: {
						summary: { one_liner: oneLiner, paragraphs },
					},
				},
			},
			analyzer_results: {},
		} as any;
	}

	function makeStructuredSummary(opts: {
		raiseValue?: string | null;
		bmValue?: string | null;
		bmNulledBy?: string;
	}) {
		return {
			raise: opts.raiseValue !== undefined
				? { value: opts.raiseValue }
				: null,
			business_model: opts.bmValue !== undefined || opts.bmNulledBy
				? {
					value: opts.bmValue ?? null,
					nulled_by: opts.bmNulledBy ?? null,
					null_rule: opts.bmNulledBy ? 'business_model.generic_wholesale_tech_mismatch' : null,
				}
				: null,
		};
	}

	// ── $1 de-SPAC artifact replacement ───────────────────────────────────

	it('replaces "$1 Series A Convertible Note" with guarded raise value', () => {
		const dio = makeDioWithSummary(
			'The deal involves a $1 Series A Convertible Note in a de-SPAC transaction.',
		);
		const ss = makeStructuredSummary({ raiseValue: '$15MM' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toContain('$1 Series A');
		expect(result.summary).toContain('$15MM');
	});

	it('replaces "$1 Preferred Note" with guarded raise value', () => {
		const dio = makeDioWithSummary('Company raising a $1 Preferred Note at $50M valuation.');
		const ss = makeStructuredSummary({ raiseValue: '$10M' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toContain('$1 Preferred');
		expect(result.summary).toContain('$10M');
	});

	it('replaces "$1 Convertible" with guarded raise value', () => {
		const dio = makeDioWithSummary('Round structured as $1 Convertible preferred share.');
		const ss = makeStructuredSummary({ raiseValue: '$5M' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toContain('$1 Convertible');
		expect(result.summary).toContain('$5M');
	});

	it('does NOT replace $1 if no guarded raise value', () => {
		const dio = makeDioWithSummary('$1 Convertible Note round.');
		const ss = makeStructuredSummary({ raiseValue: null });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		// No replacement when guarded raise is null — leave as-is
		expect(result.summary).toContain('$1 Convertible');
	});

	it('does NOT modify summary with no structured_summary passed', () => {
		const dio = makeDioWithSummary(
			'The deal involves a $1 Series A Convertible Note.',
		);
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport });
		expect(result.summary).toContain('$1 Series A');
	});

	// ── Wholesale/Retail replacement ──────────────────────────────────────

	it('replaces "Wholesale/Retail" with guarded BM value when BM is non-null', () => {
		const dio = makeDioWithSummary(
			'The deal involves a de-SPAC transaction focused on the Wholesale/Retail business model.',
		);
		const ss = makeStructuredSummary({ bmValue: 'B2B2C' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toMatch(/wholesale.*retail/i);
		expect(result.summary).toContain('B2B2C');
	});

	it('replaces "wholesale and retail" (prose form) with guarded BM', () => {
		const dio = makeDioWithSummary(
			'A consumer e-commerce brand operating within the wholesale and retail sector.',
		);
		const ss = makeStructuredSummary({ bmValue: 'DTC Ecommerce' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toMatch(/wholesale and retail/i);
		expect(result.summary).toContain('DTC Ecommerce');
	});

	it('replaces stale "consumer e-commerce brand" phrase with guarded BM value', () => {
		const dio = makeDioWithSummary(
			'The deal presents a consumer e-commerce brand focused on wholesale/retail with traction signals.',
		);
		const ss = makeStructuredSummary({ bmValue: 'Marketplace / platform' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });

		expect(result.summary).not.toMatch(/consumer\s+e-?commerce\s+brand/i);
		expect(result.summary).toContain('Marketplace / platform');
	});

	it('removes "Wholesale/Retail" when BM was nulled by FPG', () => {
		const dio = makeDioWithSummary(
			'A startup focused on wholesale/retail with significant traction signals.',
		);
		const ss = makeStructuredSummary({ bmValue: null, bmNulledBy: 'final_publish_guard' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toMatch(/wholesale.*retail/i);
	});

	it('applies both $1 and BM substitutions in the same summary (Allurion case)', () => {
		const dio = makeDioWithSummary(
			'The deal involves a $1 Series A Convertible Note in a de-SPAC transaction focused on the Wholesale/Retail business model.',
		);
		const ss = makeStructuredSummary({ raiseValue: '$15MM', bmValue: 'B2B2C' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toContain('$1 Series A');
		expect(result.summary).toContain('$15MM');
		expect(result.summary).not.toMatch(/wholesale.*retail/i);
		expect(result.summary).toContain('B2B2C');
	});

	it('sanitizes summary_medium and summary_long as well', () => {
		const dio = makeDioWithSummary(
			'One liner with $1 Series A Convertible.',
			'Medium: operating within the wholesale and retail sector.',
			'Long: $1 Convertible Note details here.',
		);
		const ss = makeStructuredSummary({ raiseValue: '$8M', bmValue: 'SaaS' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).toContain('$8M');
		expect(result.summary_medium).not.toMatch(/wholesale and retail/i);
		expect(result.summary_medium).toContain('SaaS');
		expect(result.summary_long).not.toContain('$1 Convertible');
		expect(result.summary_long).toContain('$8M');
	});

	it('leaves clean summary text unmodified', () => {
		const cleanSummary = 'AI-powered compliance platform raising $5M Seed round targeting supply chain.';
		const dio = makeDioWithSummary(cleanSummary);
		const ss = makeStructuredSummary({ raiseValue: '$5M', bmValue: 'SaaS' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).toBe(cleanSummary);
	});

	// ── RC-S6-002: SPV bleed removal ──────────────────────────────────────

	it('RC-S6-002: removes "leveraging SPVs" bleed from non-fund deal summary', () => {
		const dio = makeDioWithSummary(
			'Weavstra is a DTC Ecommerce startup leveraging SPVs for non-dilutive funding.',
		);
		const ss = makeStructuredSummary({ bmValue: 'Enterprise AI platform' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toMatch(/\bspvs?\b/i);
		expect(result.summary).not.toMatch(/special\s+purpose\s+vehicle/i);
	});

	it('RC-S6-002: removes "using SPVs to" bleed from non-fund deal summary', () => {
		const dio = makeDioWithSummary(
			'The company is raising capital using SPVs to aggregate investors.',
		);
		const ss = makeStructuredSummary({ bmValue: 'SaaS' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toMatch(/\bspvs?\b/i);
	});

	it('RC-S6-002: preserves SPV language when BM is a fund/SPV model', () => {
		const spvSummary =
			'Climatic is raising via an SPV structure, leveraging SPVs for co-investment aggregation.';
		const dio = makeDioWithSummary(spvSummary);
		const ss = makeStructuredSummary({ bmValue: 'Fund / SPV investment vehicle' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).toMatch(/\bspvs?\b/i);
	});

	it('RC-S6-002: no crash when structured_summary is null', () => {
		const dio = makeDioWithSummary('Startup leveraging SPVs for scale.');
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: null });
		// Should not throw — SPV language is left untouched (no model context to guard against)
		expect(result.summary).toBeDefined();
	});
});
