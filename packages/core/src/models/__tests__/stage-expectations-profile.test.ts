import { inferStageExpectationsProfileV1 } from '../stage-expectations-profile.js';

describe('inferStageExpectationsProfileV1', () => {
	test('seed + missing burn/runway -> gap missing_burn_or_runway', () => {
		const res = inferStageExpectationsProfileV1({
			funding_stage_v1: { funding_stage: 'seed', confidence: 0.8 },
			financial_coverage_v1: {
				sources: [{ kind: 'deck' }],
				coverage: {
					historical_revenue_present: true,
					unit_economics_present: true,
					income_statement_present: false,
					burn_rate_present: false,
					runway_present: false,
				},
			},
			capital_logic_v1: {
				raise: { present: true },
				coherence: { appears_coherent: true },
			},
		});

		expect(res.stage).toBe('seed');
		expect(res.gaps.some((g) => g.code === 'missing_burn_or_runway')).toBe(true);
	});

	test('series_a + missing income_statement -> gap missing_income_statement (severity high)', () => {
		const res = inferStageExpectationsProfileV1({
			funding_stage_v1: { funding_stage: 'series_a', confidence: 0.7 },
			financial_coverage_v1: {
				sources: [{ kind: 'xlsx' }],
				coverage: {
					historical_revenue_present: true,
					unit_economics_present: true,
					income_statement_present: false,
					burn_rate_present: true,
					runway_present: true,
				},
			},
			capital_logic_v1: {
				raise: { present: true },
				coherence: { appears_coherent: true },
			},
		});

		const gap = res.gaps.find((g) => g.code === 'missing_income_statement');
		expect(gap).toBeTruthy();
		expect(gap?.severity).toBe('high');
	});

	test('growth + xlsx not present -> gap missing_xlsx_financials', () => {
		const res = inferStageExpectationsProfileV1({
			funding_stage_v1: { funding_stage: 'growth', confidence: 0.9 },
			financial_coverage_v1: {
				sources: [{ kind: 'deck' }],
				coverage: {
					historical_revenue_present: true,
					unit_economics_present: true,
					income_statement_present: true,
					burn_rate_present: true,
					runway_present: true,
				},
			},
			capital_logic_v1: {
				raise: { present: true },
				coherence: { appears_coherent: true },
			},
		});

		expect(res.stage).toBe('growth');
		expect(res.gaps.some((g) => g.code === 'missing_xlsx_financials')).toBe(true);
	});

	test('unknown stage -> confidence low, only capital logic required, minimal gaps', () => {
		const res = inferStageExpectationsProfileV1({
			funding_stage_v1: { funding_stage: 'unknown', confidence: 0.9 },
			financial_coverage_v1: {
				sources: [{ kind: 'deck' }],
				coverage: {
					historical_revenue_present: false,
					unit_economics_present: false,
					income_statement_present: false,
					burn_rate_present: false,
					runway_present: false,
				},
			},
			capital_logic_v1: {
				raise: { present: true },
				coherence: { appears_coherent: true },
			},
		});

		expect(res.stage).toBe('unknown');
		expect(res.confidence).toBe('low');
		expect(res.expectations.requires_capital_logic).toBe(true);
		expect(res.gaps.length).toBe(0);
	});
});
