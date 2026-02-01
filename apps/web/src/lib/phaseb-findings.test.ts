import { describe, expect, it } from 'vitest';
import { derivePhaseBInsights } from './phaseb-findings';

const makeFeatures = (overrides: Record<string, any> = {}) => ({
  coverage: {
    documents_count: 3,
    segments_count: 12,
    visuals_count: 4,
    evidence_count: 3,
    evidence_per_visual: 0.75,
    ...overrides.coverage,
  },
  content_density: {
    pct_visuals_with_ocr: 0.8,
    pct_visuals_with_structured: 0.4,
    ...overrides.content_density,
  },
  structure: {
    pct_segments_with_visuals: 0.6,
    ...overrides.structure,
  },
  flags: {
    no_visuals: false,
    ...overrides.flags,
  },
});

describe('derivePhaseBInsights', () => {
  it('surfaces a high-severity finding when no visuals flag is set', () => {
    const latest = makeFeatures({ flags: { no_visuals: true }, coverage: { visuals_count: 0, evidence_count: 0 } });
    const { findings, actions, badges } = derivePhaseBInsights({ latest });

    const fv = findings.find((f) => f.code === 'phaseb_no_visuals');
    expect(fv).toBeTruthy();
    expect(fv?.severity).toBe('high');
    expect(actions.some((a) => a.code === 'phaseb_action_no_visuals')).toBe(true);
    expect(badges).toContain('Phase B: No visuals');
  });

  it('flags low evidence density with medium severity when below threshold', () => {
    const latest = makeFeatures({ coverage: { evidence_per_visual: 0.4 } });
    const { findings } = derivePhaseBInsights({ latest });

    const finding = findings.find((f) => f.code === 'phaseb_low_evidence_density');
    expect(finding).toBeTruthy();
    expect(finding?.severity).toBe('med');
  });

  it('bumps severity when OCR coverage drops materially vs prior', () => {
    const latest = makeFeatures({ content_density: { pct_visuals_with_ocr: 0.4 } });
    const prior = makeFeatures({ content_density: { pct_visuals_with_ocr: 0.9 } });

    const { findings } = derivePhaseBInsights({ latest, prior });
    const finding = findings.find((f) => f.code === 'phaseb_low_ocr');
    expect(finding).toBeTruthy();
    expect(finding?.severity).toBe('high');
    expect(finding?.detail).toContain('Drop vs prior');
  });
});
