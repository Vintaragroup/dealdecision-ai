/**
 * P5 Phase 2 — IAO v2 revenue binding and "Unknown" sentinel sanitization tests.
 *
 * Tests for:
 *   - revenue field binding to guarded structured_summary
 *   - sanitizeIaoText Rule 3: "Unknown" sentinel suppression
 *   - Regression: P3 $1 and BM guards not weakened
 */
import { buildInvestmentAnalysisOverviewV2 } from '../investment-analysis-overview-v2';

const emptyReport = {};
const emptyDio = { dio: { phase1: {} }, analyzer_results: {} } as any;

// ─── revenue field binding ────────────────────────────────────────────────────

describe('buildInvestmentAnalysisOverviewV2 — Phase 2: revenue binding', () => {
	it('surfaces revenue.value.raw from structured_summary', () => {
		const ss = {
			revenue: {
				value: { raw: '$1.2M', amount: 1_200_000, currency: 'USD' },
				sources: [],
			},
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue?.value).toBe('$1.2M');
		expect(result.revenue?.guarded).toBe(false);
		expect(result.revenue?.is_projected).toBe(false);
	});

	it('falls back to value_raw when value.raw is absent', () => {
		const ss = {
			revenue: { value_raw: '$800K', sources: [] },
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue?.value).toBe('$800K');
	});

	it('falls back to value string when both value.raw and value_raw are absent', () => {
		const ss = {
			revenue: { value: '$3M', sources: [] },
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue?.value).toBe('$3M');
	});

	it('returns revenue.guarded=true when nulled_by=final_publish_guard', () => {
		const ss = {
			revenue: { value: null, nulled_by: 'final_publish_guard', null_rule: 'revenue.guard_rule', sources: [] },
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue?.guarded).toBe(true);
		expect(result.revenue?.value).toBeNull();
	});

	it('returns revenue.guarded=true when null_rule is present', () => {
		const ss = {
			revenue: { value: null, null_rule: 'revenue.insufficient_evidence', sources: [] },
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue?.guarded).toBe(true);
	});

	it('returns revenue.is_projected=true when is_projected flag is set', () => {
		const ss = {
			revenue: {
				value: { raw: '$2M', amount: 2_000_000, currency: 'USD' },
				is_projected: true,
				is_provisional: true,
				sources: [],
			},
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue?.is_projected).toBe(true);
		expect(result.revenue?.value).toBe('$2M');
	});

	it('returns revenue.is_projected=true when only is_provisional is set', () => {
		const ss = {
			revenue: {
				value: { raw: '$1M' },
				is_provisional: true,
				sources: [],
			},
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue?.is_projected).toBe(true);
	});

	it('suppresses "Unknown" sentinel — revenue.value returns null', () => {
		const ss = {
			revenue: { value: 'Unknown', sources: [] },
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue?.value).toBeNull();
	});

	it('suppresses "Unknown" sentinel from value.raw', () => {
		const ss = {
			revenue: { value: { raw: 'Unknown' }, sources: [] },
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue?.value).toBeNull();
	});

	it('returns revenue=null when structured_summary is absent', () => {
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport });
		expect(result.revenue).toBeNull();
	});

	it('returns revenue=null when structured_summary has no revenue field', () => {
		const result = buildInvestmentAnalysisOverviewV2({
			dio: emptyDio,
			report: emptyReport,
			structured_summary: { raise: { value: '$5M' } },
		});
		expect(result.revenue).toBeNull();
	});

	it('returns revenue=null when revenue node is not an object', () => {
		const ss = { revenue: 'not-an-object' };
		const result = buildInvestmentAnalysisOverviewV2({ dio: emptyDio, report: emptyReport, structured_summary: ss });
		expect(result.revenue).toBeNull();
	});
});

// ─── sanitizeIaoText Rule 3: "Unknown" sentinel suppression ──────────────────

describe('buildInvestmentAnalysisOverviewV2 — Phase 2: "Unknown" sentinel sanitization', () => {
	function makeDioWithOneLiner(text: string) {
		return {
			dio: { phase1: { deal_summary_v2: { summary: { one_liner: text, paragraphs: [] } } } },
			analyzer_results: {},
		} as any;
	}

	it('removes "raise: Unknown" sentinel phrase', () => {
		const dio = makeDioWithOneLiner('Company seeking growth capital with raise: Unknown.');
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: {} });
		expect(result.summary).not.toMatch(/\braise\s*:\s*unknown\b/i);
	});

	it('replaces "raising an Unknown amount" with "raising an undisclosed amount"', () => {
		const dio = makeDioWithOneLiner('Innovation platform raising an Unknown amount as Series A.');
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: {} });
		expect(result.summary).not.toMatch(/raising an unknown/i);
		expect(result.summary).toContain('undisclosed');
	});

	it('replaces "raising Unknown round" → "raising an undisclosed amount"', () => {
		const dio = makeDioWithOneLiner('The startup is raising Unknown round to fund expansion.');
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: {} });
		expect(result.summary).not.toMatch(/raising unknown/i);
	});

	it('replaces "an Unknown raise" → "an undisclosed amount"', () => {
		const dio = makeDioWithOneLiner('Plans to close an Unknown raise in Q3.');
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: {} });
		expect(result.summary).not.toMatch(/unknown raise/i);
	});

	it('removes "of Unknown" value placeholder', () => {
		const dio = makeDioWithOneLiner('Capital of Unknown will support product expansion.');
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: {} });
		expect(result.summary).not.toMatch(/\bof Unknown\b/i);
	});

	it('removes "revenue: Unknown" sentinel phrase', () => {
		const dio = makeDioWithOneLiner('Early stage with revenue: Unknown at this stage.');
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: {} });
		expect(result.summary).not.toMatch(/\brevenue\s*:\s*unknown\b/i);
	});

	it('leaves natural-language "unknown" usage untouched', () => {
		const dio = makeDioWithOneLiner('The competitive landscape is largely unknown in this segment.');
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: {} });
		expect(result.summary).toContain('unknown');
	});

	it('leaves clean summary text unmodified', () => {
		const clean = 'AI diagnostics startup raising $5M Seed targeting enterprise clients.';
		const dio = makeDioWithOneLiner(clean);
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: {} });
		expect(result.summary).toBe(clean);
	});

	it('sanitizes Unknown in summary_medium and summary_long', () => {
		const dio = {
			dio: {
				phase1: {
					deal_summary_v2: {
						summary: {
							one_liner: 'Clean one-liner.',
							paragraphs: [
								'Seed stage company with revenue: Unknown at this point.',
								'Raising Unknown round targeting enterprise growth.',
							],
						},
					},
				},
			},
			analyzer_results: {},
		} as any;
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: {} });
		expect(result.summary_medium).not.toMatch(/\brevenue\s*:\s*unknown\b/i);
		expect(result.summary_long).not.toMatch(/raising unknown/i);
	});
});

// ─── Regression: P3 guards not weakened ──────────────────────────────────────

describe('buildInvestmentAnalysisOverviewV2 — Phase 2 regression: P3 guards intact', () => {
	function makeGuardedSs(opts: { raiseValue?: string | null; bmValue?: string | null; bmNulledBy?: string }) {
		return {
			raise: opts.raiseValue !== undefined ? { value: opts.raiseValue } : null,
			business_model: opts.bmValue !== undefined || opts.bmNulledBy
				? {
					value: opts.bmValue ?? null,
					nulled_by: opts.bmNulledBy ?? null,
					null_rule: opts.bmNulledBy ? 'test_rule' : null,
				}
				: null,
		};
	}

	it('StackFactor: BM stays nulled, wholesale/retail suppressed in summary', () => {
		const dio = {
			dio: {
				phase1: {
					deal_summary_v2: {
						summary: {
							one_liner: 'SaaS platform operating within the wholesale/retail sector.',
							paragraphs: [],
						},
					},
				},
			},
			analyzer_results: {},
		} as any;
		const ss = makeGuardedSs({ bmValue: null, bmNulledBy: 'final_publish_guard' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toMatch(/wholesale.*retail/i);
		expect(result.business_model?.value).toBeNull();
		expect(result.business_model?.guarded).toBe(true);
	});

	it('Albuquerque: BM stays nulled, wholesale and retail suppressed in summary', () => {
		const dio = {
			dio: {
				phase1: {
					deal_summary_v2: {
						summary: {
							one_liner: 'Medtech company focused on wholesale and retail distribution channels.',
							paragraphs: [],
						},
					},
				},
			},
			analyzer_results: {},
		} as any;
		const ss = makeGuardedSs({ bmValue: null, bmNulledBy: 'final_publish_guard' });
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toMatch(/wholesale and retail/i);
		expect(result.business_model?.value).toBeNull();
	});

	it('$1 artifact replacement still works alongside revenue binding', () => {
		const dio = {
			dio: {
				phase1: {
					deal_summary_v2: {
						summary: {
							one_liner: 'Company raising $1 Convertible Note with strong traction.',
							paragraphs: [],
						},
					},
				},
			},
			analyzer_results: {},
		} as any;
		const ss = {
			raise: { value: '$10M' },
			revenue: { value: { raw: '$500K' }, sources: [] },
		};
		const result = buildInvestmentAnalysisOverviewV2({ dio, report: emptyReport, structured_summary: ss });
		expect(result.summary).not.toContain('$1 Convertible');
		expect(result.summary).toContain('$10M');
		expect(result.revenue?.value).toBe('$500K');
	});
});
