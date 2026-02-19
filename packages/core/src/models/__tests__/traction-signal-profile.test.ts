import { inferTractionSignalProfileV1 } from '../traction-signal-profile.js';

describe('inferTractionSignalProfileV1', () => {
  test('historical revenue present only comes from financial_coverage_v1', () => {
    const res = inferTractionSignalProfileV1({
      financial_coverage_v1: { coverage: { historical_revenue_present: true, forecast_revenue_present: false } },
      structured_summary: { market: { tam: '$1B' } },
      promoted_facts: [{ fact_type: 'market_size_v1', content_json: { value_json: { display: '$1B TAM' } } }],
    });

    expect(res.historical_revenue_present).toBe(true);
    expect(res.tam_only).toBe(false);
    expect(res.confidence).toBe('high');
  });

  test('tam_only true when no revenue and market has TAM-like fields', () => {
    const res = inferTractionSignalProfileV1({
      financial_coverage_v1: { coverage: { historical_revenue_present: false, forecast_revenue_present: false } },
      structured_summary: { market: { tam: '$5B', sam: '$500M' } },
      promoted_facts: null,
    });

    expect(res.tam_only).toBe(true);
    expect(res.confidence).toBe('low');
  });

  test('growth_rate_present ignores market sizing facts', () => {
    const res = inferTractionSignalProfileV1({
      financial_coverage_v1: { coverage: { historical_revenue_present: false, forecast_revenue_present: false } },
      structured_summary: {},
      promoted_facts: [
        { fact_type: 'market_size_v1', content_json: { value_json: { display: 'TAM grew 30% to $8B' } } },
        { fact_type: 'growth_v1', content_json: { value_json: { display: 'YoY growth 40%' } } },
      ],
    });

    expect(res.growth_rate_present).toBe(true);
  });
});
