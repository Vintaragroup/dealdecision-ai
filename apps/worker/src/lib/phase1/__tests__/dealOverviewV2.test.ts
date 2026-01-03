import { describe, it, expect } from 'vitest';
import { buildPhase1DealOverviewV2, buildPhase1DealUnderstandingV1, buildPhase1UpdateReportV1 } from '../dealOverviewV2';
import type { OverviewDocumentInput } from '../dealOverviewV2';

type Word = { text: string; x: number; y: number };
type Page = { slideTitle?: string; title?: string; text?: string; words?: Word[] };

function docWithPages(document_id: string, pages: Page[], title = 'Pitch Deck'): OverviewDocumentInput {
	return {
		document_id,
		title,
		type: 'pitch_deck',
		full_content: { pages },
	};
}

describe('buildPhase1DealOverviewV2 (product_solution / market_icp extraction)', () => {
	it('prefers explicit company definition over cover tagline (3ICE regression)', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-3ice', [
				{ text: '3ICE\nTHE BEST PART OF HOCKEY' },
				{ text: "3ICE is a 'new media' company and the first ever 3-on-3 professional ice hockey league." },
				{ text: 'We are raising approximately $10M' },
			], 'PD - 3ICE'),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution ?? '').toMatch(/3ICE\s+is\s+a\s+'new\s+media'\s+company/i);
		expect(out.product_solution ?? '').toMatch(/3-on-3\s+professional\s+ice\s+hockey\s+league/i);
		expect(out.product_solution).not.toBe('THE BEST PART OF HOCKEY');
		expect(out.product_solution ?? '').not.toMatch(/best\s+part\s+of\s+hockey/i);
		expect(out.raise ?? '').toMatch(/approximately\s*\$?\s*10\s*m/i);
		expect(out.deal_type).toBe('startup_raise');
	});

	it('accepts ALL-CAPS tagline if it matches verb pattern', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc1', [
				{ text: 'ACME AI' },
				{ text: 'WE HELP TEAMS AUTOMATE INCIDENT RESPONSE' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toMatch(/help/i);
		expect(out.product_solution).not.toBeNull();
	});

	it('rejects roster/team blocks (fails closed to null)', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc1', [
				{ text: 'OVERVIEW:' },
				{ text: 'ON-AIR TALENT: Alice, Bob, Charlie, Dana, Evan' },
				{ text: 'EXTENDED TEAM: Advisors, Staff, Coaches' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toBeNull();
	});

	it('rejects metaphor candidates (fails closed to null)', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc1', [
				{ text: 'WHAT WE DO:' },
				{ text: "The Uber of compliance workflows for startups" },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toBeNull();
	});

	it("accepts anchored 'WHO WE SERVE' within next 6 lines", () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc1', [
				{
					text: [
						'WHO WE SERVE:',
						'Enterprise IT operations teams in regulated industries',
					].join('\n'),
				},
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.market_icp).toMatch(/teams/i);
		expect(out.market_icp).not.toBeNull();
	});

	it('uses DealUnderstanding fallback for WebMax-like comma-heavy OCR definitions', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-wm-fixture', [
				{ text: 'Cover' },
				{
					slideTitle: 'wm DIGITAL MORTGAGE SOLUTIONS',
					words: [
						// Header-like line (must not win)
						{ text: 'T', x: 10, y: 80 },
						{ text: '|=', x: 30, y: 80 },
						{ text: '3', x: 60, y: 80 },
						{ text: 'DIGITAL', x: 90, y: 80 },
						{ text: 'MORTGAGE', x: 170, y: 80 },
						{ text: 'SOLUTIONS', x: 280, y: 80 },

						// Short fragment candidate (should be upgraded by DU)
						{ text: 'We', x: 10, y: 350 },
						{ text: 'predict', x: 40, y: 350 },
						{ text: 'borrower', x: 110, y: 350 },
						{ text: 'readiness', x: 190, y: 350 },
						{ text: 'by', x: 280, y: 350 },
						{ text: 'unifying.', x: 310, y: 350 },

						// Longer coherent definition nearby (multi-line in OCR)
						{ text: 'We', x: 10, y: 390 },
						{ text: 'predict', x: 40, y: 390 },
						{ text: 'borrower', x: 110, y: 390 },
						{ text: 'readiness', x: 190, y: 390 },
						{ text: 'by', x: 280, y: 390 },
						{ text: 'fusing', x: 310, y: 390 },
						{ text: 'credit', x: 370, y: 390 },
						{ text: 'trends,', x: 430, y: 390 },
						{ text: 'income', x: 10, y: 430 },
						{ text: 'signals,', x: 80, y: 430 },
						{ text: 'rate', x: 160, y: 430 },
						{ text: 'sensitivity,', x: 210, y: 430 },
						{ text: 'shopping', x: 10, y: 470 },
						{ text: 'behavior,', x: 90, y: 470 },
						{ text: 'MLS', x: 10, y: 510 },
						{ text: 'listing', x: 50, y: 510 },
						{ text: 'engagement,', x: 120, y: 510 },
						{ text: 'and', x: 10, y: 550 },
						{ text: 'CRM/LOS', x: 50, y: 550 },
						{ text: 'activity', x: 130, y: 550 },
						{ text: 'into', x: 10, y: 590 },
						{ text: 'one', x: 60, y: 590 },
						{ text: 'continuously', x: 100, y: 590 },
						{ text: 'learning', x: 220, y: 590 },
						{ text: 'Intent', x: 10, y: 630 },
						{ text: '&', x: 70, y: 630 },
						{ text: 'Ability', x: 85, y: 630 },
						{ text: 'Score.', x: 140, y: 630 },
					],
				},
				{
					slideTitle: 'Who we serve',
					text: ['Realtors & Loan Officers', 'at mortgage lenders/brokerages', 'using CRM/LOS systems'].join('\n'),
				},
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).not.toBeNull();
		expect(out.market_icp).not.toBeNull();
		expect(out.product_solution ?? '').toMatch(/borrower readiness/i);
		expect(out.market_icp ?? '').toMatch(/Realtor|Loan\s+Officer/i);
	});
});

describe('buildPhase1DealUnderstandingV1 (best-effort understanding)', () => {
	it('extracts product and market with confidence + sources', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-understand-1', [
				{ text: 'OVERVIEW' },
				{ text: 'We help independent retail brands automate inventory forecasting.' },
				{ text: 'WHO WE SERVE' },
				{ text: 'Independent retail brands and DTC operators' },
			]),
		];

		const out = buildPhase1DealUnderstandingV1({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(typeof out.generated_at).toBe('string');
		expect(out.product_solution).toMatch(/help/i);
		expect(out.market_icp).toMatch(/retail|dtc/i);
		expect(['high', 'medium', 'low', 'missing']).toContain(out.confidence.product_solution);
		expect(['high', 'medium', 'low', 'missing']).toContain(out.confidence.market_icp);
		expect(Array.isArray(out.sources?.product_solution)).toBe(true);
		expect(Array.isArray(out.sources?.market_icp)).toBe(true);
	});

	it('prefers multi-line definition sentences over slide headers (words[] reconstruction)', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-webmax-words', [
				{ text: 'Cover' },
				{
					slideTitle: 'wm DIGITAL MORTGAGE SOLUTIONS',
					words: [
						// Header-like line (should be downscored)
						{ text: 'wm', x: 10, y: 80 },
						{ text: 'DIGITAL', x: 60, y: 80 },
						{ text: 'MORTGAGE', x: 150, y: 80 },
						{ text: 'SOLUTIONS', x: 260, y: 80 },

						// Real product definition (split across lines in OCR)
						{ text: 'We', x: 10, y: 400 },
						{ text: 'predict', x: 40, y: 400 },
						{ text: 'borrower', x: 110, y: 400 },
						{ text: 'readiness', x: 190, y: 400 },
						{ text: 'by', x: 280, y: 400 },
						{ text: 'unifying', x: 310, y: 400 },
						{ text: 'borrower', x: 390, y: 400 },

						{ text: 'intent', x: 10, y: 440 },
						{ text: '&', x: 70, y: 440 },
						{ text: 'ability', x: 85, y: 440 },
						{ text: 'into', x: 140, y: 440 },
						{ text: 'a', x: 180, y: 440 },
						{ text: 'single', x: 200, y: 440 },
						{ text: 'Intent', x: 10, y: 480 },
						{ text: '&', x: 70, y: 480 },
						{ text: 'Ability', x: 85, y: 480 },
						{ text: 'Score.', x: 140, y: 480 },
					],
				},
			]),
		];

		const out = buildPhase1DealUnderstandingV1({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toMatch(/We predict borrower readiness/i);
		expect(out.product_solution).not.toMatch(/wm\s+digital\s+mortgage\s+solutions/i);
	});

	it('upgrades short/header product_solution and finds Realtor/Loan Officer ICP (fixture)', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-wm-fixture', [
				{ text: 'Cover' },
				{
					slideTitle: 'wm DIGITAL MORTGAGE SOLUTIONS',
					words: [
						// Header-like line (must not win)
						{ text: 'T', x: 10, y: 80 },
						{ text: '|=', x: 30, y: 80 },
						{ text: '3', x: 60, y: 80 },
						{ text: 'DIGITAL', x: 90, y: 80 },
						{ text: 'MORTGAGE', x: 170, y: 80 },
						{ text: 'SOLUTIONS', x: 280, y: 80 },

						// Short fragment candidate (should be upgraded)
						{ text: 'We', x: 10, y: 350 },
						{ text: 'predict', x: 40, y: 350 },
						{ text: 'borrower', x: 110, y: 350 },
						{ text: 'readiness', x: 190, y: 350 },
						{ text: 'by', x: 280, y: 350 },
						{ text: 'unifying.', x: 310, y: 350 },

						// Longer coherent definition nearby (multi-line in OCR)
						{ text: 'We', x: 10, y: 390 },
						{ text: 'predict', x: 40, y: 390 },
						{ text: 'borrower', x: 110, y: 390 },
						{ text: 'readiness', x: 190, y: 390 },
						{ text: 'by', x: 280, y: 390 },
						{ text: 'fusing', x: 310, y: 390 },
						{ text: 'credit', x: 370, y: 390 },
						{ text: 'trends,', x: 430, y: 390 },
						{ text: 'income', x: 10, y: 430 },
						{ text: 'signals,', x: 80, y: 430 },
						{ text: 'rate', x: 160, y: 430 },
						{ text: 'sensitivity,', x: 210, y: 430 },
						{ text: 'shopping', x: 10, y: 470 },
						{ text: 'behavior,', x: 90, y: 470 },
						{ text: 'MLS', x: 10, y: 510 },
						{ text: 'listing', x: 50, y: 510 },
						{ text: 'engagement,', x: 120, y: 510 },
						{ text: 'and', x: 10, y: 550 },
						{ text: 'CRM/LOS', x: 50, y: 550 },
						{ text: 'activity', x: 130, y: 550 },
						{ text: 'into', x: 10, y: 590 },
						{ text: 'one', x: 60, y: 590 },
						{ text: 'continuously', x: 100, y: 590 },
						{ text: 'learning', x: 220, y: 590 },
						{ text: 'Intent', x: 10, y: 630 },
						{ text: '&', x: 70, y: 630 },
						{ text: 'Ability', x: 85, y: 630 },
						{ text: 'Score.', x: 140, y: 630 },
					],
				},
				{
					slideTitle: 'Who we serve',
					text: [
						'Realtors & Loan Officers',
						'at mortgage lenders/brokerages',
						'using CRM/LOS systems',
					].join('\n'),
				},
			]),
		];

		const out = buildPhase1DealUnderstandingV1({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).not.toBeNull();
		expect((out.product_solution ?? '').length).toBeGreaterThanOrEqual(80);
		expect(out.product_solution).toMatch(/borrower readiness/i);
		expect(out.product_solution).toMatch(/credit\s+trends|crm\/los|intent\s*&\s*ability\s+score/i);

		expect(out.market_icp).not.toBeNull();
		expect(out.market_icp).toMatch(/Realtor|Loan\s+Officer/i);
	});
});

describe('buildPhase1UpdateReportV1 (deterministic diffs)', () => {
	function basePrevDio(params?: {
		overrideOverview?: any;
		overridePhase1?: any;
	}): any {
		return {
			dio_id: '00000000-0000-0000-0000-000000000001',
			analysis_version: 1,
			dio: {
				phase1: {
					deal_overview_v2: {
						product_solution: 'We help teams automate incident response.',
						market_icp: 'Enterprise IT operations teams.',
						raise: 'Unknown',
						deal_type: 'Unknown',
						business_model: 'Unknown',
						traction_signals: [],
						key_risks_detected: [],
						sources: [],
						...(params?.overrideOverview ?? {}),
					},
					coverage: {
						sections: {
							market: 'partial',
						},
					},
					decision_summary_v1: {
						recommendation: 'Proceed',
						score: 0.72,
						confidence: 'medium',
						blockers: [],
					},
					executive_summary_v2: {
						missing: [],
					},
					...(params?.overridePhase1 ?? {}),
				},
			},
		};
	}

	function baseCurrentPhase1(params?: { override?: any }): any {
		return {
			coverage: {
				sections: {
					market: 'partial',
				},
			},
			decision_summary_v1: {
				recommendation: 'Proceed',
				score: 0.72,
				confidence: 'medium',
				blockers: [],
			},
			executive_summary_v2: {
				missing: [],
			},
			...(params?.override ?? {}),
		};
	}

	it('returns no changes when snapshots match', () => {
		const prev = basePrevDio();
		const currentOverview = {
			product_solution: 'We help teams automate incident response.',
			market_icp: 'Enterprise IT operations teams.',
			raise: 'Unknown',
			deal_type: 'Unknown',
			business_model: 'Unknown',
			traction_signals: [],
			key_risks_detected: [],
			sources: [],
		};
		const currentPhase1 = baseCurrentPhase1();
		const out = buildPhase1UpdateReportV1({
			previousDio: prev,
			currentOverview,
			currentPhase1,
			nowIso: '2025-01-01T00:00:00.000Z',
		});
		expect(out.changes).toHaveLength(0);
		expect(out.summary).toMatch(/no changes/i);
	});

	it('detects populated field (added) with category field_populated', () => {
		const prev = basePrevDio({ overrideOverview: { raise: undefined } });
		const currentOverview = {
			product_solution: 'We help teams automate incident response.',
			market_icp: 'Enterprise IT operations teams.',
			raise: 'Raising $2M',
			deal_type: 'Unknown',
			business_model: 'Unknown',
			traction_signals: [],
			key_risks_detected: [],
			sources: [],
		};
		const currentPhase1 = baseCurrentPhase1();
		const out = buildPhase1UpdateReportV1({ previousDio: prev, currentOverview, currentPhase1 });
		const change = out.changes.find((c) => c.field === 'deal_overview_v2.raise');
		expect(change?.change_type).toBe('added');
		expect(change?.category).toBe('field_populated');
	});

	it('detects lost field (removed) with category field_lost', () => {
		const prev = basePrevDio({ overrideOverview: { business_model: 'SaaS subscription' } });
		const currentOverview = {
			product_solution: 'We help teams automate incident response.',
			market_icp: 'Enterprise IT operations teams.',
			raise: 'Unknown',
			deal_type: 'Unknown',
			business_model: undefined,
			traction_signals: [],
			key_risks_detected: [],
			sources: [],
		};
		const currentPhase1 = baseCurrentPhase1();
		const out = buildPhase1UpdateReportV1({ previousDio: prev, currentOverview, currentPhase1 });
		const change = out.changes.find((c) => c.field === 'deal_overview_v2.business_model');
		expect(change?.change_type).toBe('removed');
		expect(change?.category).toBe('field_lost');
	});

	it('detects decision recommendation change and prioritizes it in summary', () => {
		const prev = basePrevDio({
			overridePhase1: { decision_summary_v1: { recommendation: 'Decline', score: 0.12, confidence: 'high', blockers: ['x'] } },
		});
		const currentOverview = {
			product_solution: 'We help teams automate incident response.',
			market_icp: 'Enterprise IT operations teams.',
			raise: 'Unknown',
			deal_type: 'Unknown',
			business_model: 'Unknown',
			traction_signals: [],
			key_risks_detected: [],
			sources: [],
		};
		const currentPhase1 = baseCurrentPhase1({
			override: { decision_summary_v1: { recommendation: 'Proceed', score: 0.72, confidence: 'medium', blockers: [] } },
		});
		const out = buildPhase1UpdateReportV1({ previousDio: prev, currentOverview, currentPhase1 });
		const change = out.changes.find((c) => c.field === 'decision_summary_v1.recommendation');
		expect(change?.category).toBe('decision_changed');
		expect(out.summary).toMatch(/Recommendation changed/i);
	});

	it('detects coverage section change with category coverage_changed', () => {
		const prev = basePrevDio({ overridePhase1: { coverage: { sections: { market: 'absent' } } } });
		const currentOverview = {
			product_solution: 'We help teams automate incident response.',
			market_icp: 'Enterprise IT operations teams.',
			raise: 'Unknown',
			deal_type: 'Unknown',
			business_model: 'Unknown',
			traction_signals: [],
			key_risks_detected: [],
			sources: [],
		};
		const currentPhase1 = baseCurrentPhase1({ override: { coverage: { sections: { market: 'partial' } } } });
		const out = buildPhase1UpdateReportV1({ previousDio: prev, currentOverview, currentPhase1 });
		const change = out.changes.find((c) => c.field === 'coverage.sections.market');
		expect(change?.category).toBe('coverage_changed');
	});
});
