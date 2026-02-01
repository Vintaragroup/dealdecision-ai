import { describe, it, expect } from 'vitest';
import { buildPhase1BusinessArchetypeV1 } from '../businessArchetypeV1';
import type { BusinessArchetypeDocumentInput } from '../businessArchetypeV1';

type Page = { slideTitle?: string; title?: string; text?: string };

function docWithPages(document_id: string, pages: Page[], title = 'Pitch Deck'): BusinessArchetypeDocumentInput {
	return {
		document_id,
		title,
		type: 'pitch_deck',
		full_content: { pages },
	};
}

describe('buildPhase1BusinessArchetypeV1', () => {
	it('classifies SaaS when SaaS/ARR signals are present', () => {
		const docs: BusinessArchetypeDocumentInput[] = [
			docWithPages('doc1', [
				{ text: 'ACME' },
				{ text: 'We are a SaaS platform with $1.2M ARR and subscription revenue.' },
			]),
		];

		const out = buildPhase1BusinessArchetypeV1({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.value).toBe('saas');
		expect(out.confidence).toBeGreaterThan(0.3);
		expect(out.evidence.length).toBeGreaterThan(0);
	});

	it('classifies consumer product when CPG/DTC signals are present', () => {
		const docs: BusinessArchetypeDocumentInput[] = [
			docWithPages('doc1', [
				{ text: 'Brand Overview' },
				{ text: 'We are a CPG brand selling 12 SKUs. Strong retail distribution and DTC via Shopify.' },
			]),
		];

		const out = buildPhase1BusinessArchetypeV1({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.value).toBe('consumer_product');
		expect(out.evidence.length).toBeGreaterThan(0);
	});

	it('returns unknown when there is no usable text', () => {
		const docs: BusinessArchetypeDocumentInput[] = [
			{
				document_id: 'doc1',
				title: 'Empty',
				type: 'other',
				full_text: '',
				full_content: null,
			},
		];

		const out = buildPhase1BusinessArchetypeV1({ documents: docs, nowIso: '2025-01-01T00:00:00.000Z' });
		expect(out.value).toBe('unknown');
		expect(out.confidence).toBe(0);
		expect(out.evidence).toEqual([]);
	});
});
