import { inferCapitalLogicProfileV1 } from '../capital-logic-profile.js';

describe('inferCapitalLogicProfileV1', () => {
	test('raise + use_of_funds + milestones present => coherent true, confidence high', () => {
		const res = inferCapitalLogicProfileV1({
			structured_summary: {
				raise: {
					value_json: { amount: { amount: 2_000_000 } },
					sources: [{ document_id: 'doc-1', page_index: 0, page: 1, source_path: 'doc:doc-1:page:1' }],
				},
			},
			promoted_facts: [
				{ fact_type: 'use_of_funds_v1', content_json: { provenance: { source_document_id: 'doc-1', page_index: 2 } } },
				{ fact_type: 'milestones_v1', content_json: { provenance: { source_document_id: 'doc-1', page_index: 3 } } },
			],
		});

		expect(res.raise.present).toBe(true);
		expect(res.prior_funding.present).toBe(false);
		expect(res.use_of_funds.present).toBe(true);
		expect(res.milestones.present).toBe(true);
		expect(res.coherence.appears_coherent).toBe(true);
		expect(res.confidence).toBe('high');
	});

	test('raise only => coherent false, confidence low', () => {
		const res = inferCapitalLogicProfileV1({
			structured_summary: {
				raise: { value_json: { amount: { amount: 1_000_000 } }, sources: [{ document_id: 'doc-1', page_index: 0 }] },
			},
			promoted_facts: [],
		});

		expect(res.raise.present).toBe(true);
		expect(res.prior_funding.present).toBe(false);
		expect(res.use_of_funds.present).toBe(false);
		expect(res.milestones.present).toBe(false);
		expect(res.coherence.appears_coherent).toBe(false);
		expect(res.confidence).toBe('low');
	});

	test('raise + use_of_funds => medium', () => {
		const res = inferCapitalLogicProfileV1({
			structured_summary: {
				raise: { value_json: { amount: { amount: 3_000_000 } }, sources: [{ document_id: 'doc-1', page_index: 0 }] },
			},
			promoted_facts: [
				{ fact_type: 'use_of_funds_distribution_v1', content_json: { provenance: { source_document_id: 'doc-1', page_index: 4 } } },
			],
		});

		expect(res.raise.present).toBe(true);
		expect(res.prior_funding.present).toBe(false);
		expect(res.use_of_funds.present).toBe(true);
		expect(res.milestones.present).toBe(false);
		expect(res.coherence.appears_coherent).toBe(false);
		expect(res.confidence).toBe('medium');
	});

	test('no raise but use_of_funds => low', () => {
		const res = inferCapitalLogicProfileV1({
			structured_summary: {},
			promoted_facts: [
				{ fact_type: 'use_of_funds_v1', content_json: { provenance: { source_document_id: 'doc-1', page_index: 2 } } },
			],
		});

		expect(res.raise.present).toBe(false);
		expect(res.prior_funding.present).toBe(false);
		expect(res.use_of_funds.present).toBe(true);
		expect(res.confidence).toBe('low');
	});

	test('use_of_funds can be inferred from page_texts when structured/promoted facts are missing', () => {
		const res = inferCapitalLogicProfileV1({
			structured_summary: {
				raise: { value_json: { amount: { amount: 2_000_000 } }, sources: [{ document_id: 'doc-1', page_index: 0 }] },
			},
			promoted_facts: [],
			page_texts: [
				'Capital raise details and assumptions',
				'Use of Funds: 45% product, 35% GTM, 20% operations',
			],
		});

		expect(res.raise.present).toBe(true);
		expect(res.use_of_funds.present).toBe(true);
		expect(res.use_of_funds.sources?.[0]?.source_path).toContain('dpu:page_text:1');
		expect(res.confidence).toBe('medium');
	});

	test('prior_funding can be inferred from historical raise language in page_texts', () => {
		const res = inferCapitalLogicProfileV1({
			structured_summary: {
				raise: { value_json: { amount: { amount: 2_000_000 } }, sources: [{ document_id: 'doc-1', page_index: 0 }] },
			},
			promoted_facts: [],
			page_texts: [
				'The company has already raised $425K in a pre-seed round and is now raising $2M.',
			],
		});

		expect(res.raise.present).toBe(true);
		expect(res.raise.amount).toBe(2_000_000);
		expect(res.prior_funding.present).toBe(true);
		expect(res.prior_funding.amount).toBe(425_000);
		expect(res.prior_funding.sources?.[0]?.source_path).toContain('dpu:page_text:0');
	});

	test('prior_funding is not inferred from valuation-only raise context', () => {
		const res = inferCapitalLogicProfileV1({
			structured_summary: {
				raise: { value_json: { amount: { amount: 2_000_000 } }, sources: [{ document_id: 'doc-1', page_index: 0 }] },
			},
			promoted_facts: [],
			page_texts: [
				'What we are seeking: to raise $2M pre-seed at a $4.5M pre-money valuation.',
			],
		});

		expect(res.prior_funding.present).toBe(false);
	});
});
