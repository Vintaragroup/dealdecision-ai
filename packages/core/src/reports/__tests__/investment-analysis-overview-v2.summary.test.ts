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
