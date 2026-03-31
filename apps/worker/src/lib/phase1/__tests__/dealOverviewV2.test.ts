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

	it('detects raise signal beyond first 10 pages', () => {
		const pages = Array.from({ length: 25 }, (_, i) => ({ text: i === 17 ? 'We are raising $10M to expand nationwide.' : `Slide ${i + 1}` }));
		const docs: OverviewDocumentInput[] = [docWithPages('doc-late-raise', pages, 'Late Raise Deck')];
		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.raise ?? '').toMatch(/\$\s?10\s*m/i);
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
		expect(out.product_solution ?? '').toMatch(/help/i);
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

	it('hard-rejects legal disclaimer boilerplate in product/market candidates', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-legal-1', [
				{
					text: [
						'OVERVIEW',
						'This presentation is for informational purposes only and does not constitute an offer to sell securities.',
						'WHO WE SERVE',
						'Not an offer or solicitation to any prospective investor.',
					].join('\n'),
				},
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toBeNull();
		expect(out.market_icp).toBeNull();
	});

	it('hard-rejects Albuquerque disclaimer phrase family for tagline candidates', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-legal-abq', [
				{
					text: [
						'OVERVIEW',
						'Whether to provide to Cross Development all or a portion of an investment is at the discretion of the recipient and subject to confidential submission terms.',
						'WHO WE SERVE',
						'The recipient may use this confidential information for limited use and must return this confidential submission upon request.',
					].join('\n'),
				},
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toBeNull();
		expect(out.market_icp).toBeNull();
	});

	it('rejects malformed OCR-like product fragments', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-bad-fragment', [
				{ text: 'OVERVIEW' },
				{ text: 'Fosters strong Automates borrower 52.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toBeNull();
	});

	it('suppresses duplicate weak text across product_solution and market_icp', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-dup', [
				{ text: 'OVERVIEW' },
				{ text: 'Built for growth 43.' },
				{ text: 'WHO WE SERVE' },
				{ text: 'Built for growth 43.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toBeNull();
		expect(out.market_icp).toBeNull();
	});

	it('suppresses candidates from low-quality placeholder-dominant pages', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-low-quality', [
				{ text: 'Slide 1\nConfidential\nTBD\nN/A\nPlaceholder' },
				{ text: 'OVERVIEW\nComing soon\nTBD\nN/A\nPlaceholder' },
				{ text: 'WHO WE SERVE\nTBD\nN/A\nPlaceholder' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toBeNull();
		expect(out.market_icp).toBeNull();
	});

	it('keeps short but valid startup tagline with clear target', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-good-short', [
				{ text: 'OVERVIEW\nAutomates underwriting workflows for lenders.' },
				{ text: 'WHO WE SERVE\nMortgage lenders and loan teams.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution ?? '').toMatch(/automates underwriting workflows for lenders/i);
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

// ---------------------------------------------------------------------------
// Regression: advisor/team text must not be accepted as product_solution
// ---------------------------------------------------------------------------
describe('buildPhase1DealOverviewV2 — advisor/team text rejection (upstream data fix)', () => {
	it('rejects advisory team slide text as product_solution (OVERVIEW heading scenario)', () => {
		// Page 16 of a pitch deck: an "Overview" heading followed by advisory team bios.
		// The text uses "helps" which would match TAGLINE_VERB_RE — the rejection must fire
		// on the team-type patterns before acceptance.
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-advisor-reject', [
				{ text: 'OVERVIEW\nOur advisory team helps companies raise $2B in enterprise value.' },
				{ text: 'Normal slide without product info' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		// Advisory team bios must not win the product_solution slot.
		expect(out.product_solution).toBeNull();
	});

	it('rejects leadership team slide text as product_solution', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-leadership-reject', [
				{ text: 'WHAT WE DO\nOur leadership team connects enterprise brands with end retail operators.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toBeNull();
	});

	it('still accepts genuine product descriptions that do NOT match team patterns', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-genuine-product', [
				{ text: 'OVERVIEW\nAcme provides an AI-powered platform that helps enterprises automate compliance workflows.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).not.toBeNull();
		expect(out.product_solution ?? '').toMatch(/compliance/i);
	});
});

// ---------------------------------------------------------------------------
// Regression: historical "raise" context must not produce a raise signal
// ---------------------------------------------------------------------------
describe('buildPhase1DealOverviewV2 — raise detection guards (upstream data fix)', () => {
	it('does not extract raise from "helped companies raise $2B" advisor bio text', () => {
		// Only advisor bios, no actual ask slide. Raise must be null or undefined.
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-no-raise-bio', [
				{ text: 'Our Team\nJohn Smith helped companies raise $2B in value over 20 years.' },
				{ text: 'Market Overview\nThe market is large and growing.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		// $2B from advisor track record must NOT become the raise signal.
		expect(out.raise ?? null).toBeNull();
	});

	it('does not extract raise from "created over $2B in enterprise value" outcome text', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-no-raise-outcome', [
				{ text: 'ADVISORS\nOur network has created over $2B in enterprise value for portfolio companies.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.raise ?? null).toBeNull();
	});

	it('STILL extracts a legitimate raise from an explicit ask slide', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-with-raise', [
				{ text: 'Our Team\nJohn Smith helped companies raise $2B in value over 20 years.' },
				{ text: 'The Ask\nWe are raising $5M in a SAFE note to expand sales.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		// Genuine raise from ask slide must survive.
		expect(out.raise ?? '').toMatch(/\$\s*5\s*m/i);
		// The $2B from advisor bio must not override the real raise.
		expect(out.raise ?? '').not.toMatch(/\$\s*2\s*b/i);
	});
});

// ---------------------------------------------------------------------------
// Regression: personal-bio and PE/VC-activity lines must not win product_solution
// via the tagline:verb_pattern path (Vermont advisor page regression)
// ---------------------------------------------------------------------------
describe('buildPhase1DealOverviewV2 — bio and PE/VC activity tagline rejection', () => {
	it('rejects "He is a CPA" personal-bio line as product_solution', () => {
		// Vermont-style advisor/bio slide: Daniela "also a CPA. source deals, raise capital..."
		// The line contains "deliver" but the "He is a" pronoun+copula signals a bio sentence.
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-bio-reject', [
				{
					text: 'Our Advisors\nArmando is an expert in corporate governance. He is also a CPA. source deals, raise capital and provide value to dealmakers.',
				},
				{ text: 'The Gin\nThe right amount of juniper delivers a balanced, aromatic spirit.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		// Bio/PE text must NOT win. Only the gin tagline (page 2) should be selected.
		expect(out.product_solution ?? '').not.toMatch(/CPA|source deals|raise capital/i);
		expect(out.product_solution ?? '').toMatch(/juniper/i);
	});

	it('rejects "source deals, raise capital" PE/VC advisor-activity line as product_solution', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-vc-activity-reject', [
				{ text: 'Team\nShe is a strategic deal connector. source deals, raise capital and provide value to dealmakers.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution).toBeNull();
	});

	it('does NOT reject genuine product descriptions with "delivers" or "provides"', () => {
		const docs: OverviewDocumentInput[] = [
			docWithPages('doc-genuine-delivers', [
				{ text: 'Our Product\nOur platform delivers real-time compliance monitoring for enterprise teams.' },
			]),
		];

		const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.product_solution ?? '').toMatch(/compliance/i);
	});
});
