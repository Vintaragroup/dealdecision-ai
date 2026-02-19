import { inferBusinessModelSignalProfileV1 } from '../business-model-signal-profile.js';

describe('inferBusinessModelSignalProfileV1', () => {
  test('complete business model object => high confidence', () => {
    const res = inferBusinessModelSignalProfileV1({
      structured_summary: {
        business_model: { value: 'Subscription SaaS (recurring ARR)', confidence: 0.8, sources: [{ document_id: 'doc-1', page_index: 0 }] },
        pricing_model: { value: 'Seat-based pricing', confidence: 0.7, sources: [{ document_id: 'doc-1', page_index: 1 }] },
        customers: { value: { count: 10, kind: 'b2b', raw: '10 enterprise customers' }, confidence: 0.6, sources: [] },
      },
      promoted_facts: [
        { fact_type: 'unit_economics_v1', content_json: { provenance: { source_document_id: 'doc-1', page_index: 2 } } },
      ],
    });

    expect(res.present).toBe(true);
    expect(res.pricing_present).toBe(true);
    expect(res.revenue_model_present).toBe(true);
    expect(res.customer_segment_present).toBe(true);
    expect(res.monetization_mechanics_present).toBe(true);
    expect(res.confidence).toBe('high');
  });

  test('partial => medium confidence', () => {
    const res = inferBusinessModelSignalProfileV1({
      structured_summary: {
        business_model: { value: 'SaaS subscription', confidence: 0.7, sources: [] },
        customers: { value: { count: null, kind: 'b2b', raw: null }, confidence: 0.4, sources: [] },
      },
      promoted_facts: [],
    });

    expect(res.present).toBe(true);
    expect(res.revenue_model_present).toBe(true);
    expect(res.customer_segment_present).toBe(true);
    expect(res.pricing_present).toBe(false);
    expect(res.monetization_mechanics_present).toBe(false);
    expect(res.confidence).toBe('medium');
  });

  test('none => low confidence', () => {
    const res = inferBusinessModelSignalProfileV1({
      structured_summary: {
        business_model: { value: null, confidence: 0, sources: [] },
      },
      promoted_facts: null,
    });

    expect(res.present).toBe(false);
    expect(res.pricing_present).toBe(false);
    expect(res.revenue_model_present).toBe(false);
    expect(res.customer_segment_present).toBe(false);
    expect(res.monetization_mechanics_present).toBe(false);
    expect(res.confidence).toBe('low');
  });
});
