import { describe, it, expect } from 'vitest';
import { buildPhase1DealOverviewV2, buildPhase1UpdateReportV1 } from '../dealOverviewV2';
import type { OverviewDocumentInput } from '../dealOverviewV2';

type Page = { slideTitle?: string; title?: string; text?: string };

function docWithPages(document_id: string, pages: Page[], title = 'Pitch Deck'): OverviewDocumentInput {
	return {
		document_id,
		title,
		type: 'pitch_deck',
		full_content: { pages },
	};
}

describe('buildPhase1DealOverviewV2 (product_solution / market_icp extraction)', () => {
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
