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
		expect(res.use_of_funds.present).toBe(true);
		expect(res.confidence).toBe('low');
	});
});
