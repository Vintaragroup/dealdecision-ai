import { describe, expect, test } from 'vitest';

import { buildWorkspaceMirrorOverviewVM } from './workspaceMirrorPr2ViewModel';

describe('buildWorkspaceMirrorOverviewVM', () => {
  test('returns missing defaults for null-ish input', () => {
    const vm = buildWorkspaceMirrorOverviewVM(null);
    expect(vm.missing).toBe(true);
    expect(vm.one_liner).toBeNull();
    expect(vm.paragraphs).toEqual([]);
    expect(vm.strengths).toEqual([]);
    expect(vm.risks).toEqual([]);
    expect(vm.open_questions).toEqual([]);
    expect(vm.facts.product_solution.value).toBeNull();
    expect(vm.facts.market_icp.value).toBeNull();
    expect(vm.facts.business_model.value).toBeNull();
    expect(vm.facts.raise.value).toBeNull();
  });

  test('binds PR2 phase1 fields and filters obvious boilerplate as missing', () => {
    const vm = buildWorkspaceMirrorOverviewVM({
      overview: {
        overview_json: {
          phase1: {
            deal_summary_v2: {
              summary: {
                one_liner: 'A one-liner',
                paragraphs: ['Para 1', 'Para 2'],
              },
              strengths: ['Fast team'],
              risks: ['Crowded market'],
              open_questions: ['Retention?'],
            },
            deal_overview_v2: {
              product_solution: '© 2026 All rights reserved',
              market_icp: 'SMBs',
              business_model: 'SaaS',
              raise: '$2M seed',
              traction_signals: ['10 paying customers'],
              key_risks_detected: ['Sparse evidence'],
              sources: [{ type: 'doc', id: 'x' }],
            },
          },
        },
        summary_text: 'Product is definitely not this string',
      },
    });

    expect(vm.missing).toBe(false);
    if (vm.missing) throw new Error('expected non-missing');

    expect(vm.source).toBe('phase1');
    expect(vm.one_liner).toBe('A one-liner');
    expect(vm.paragraphs).toEqual(['Para 1', 'Para 2']);
    expect(vm.strengths).toEqual(['Fast team']);
    expect(vm.risks).toEqual(['Crowded market']);
    expect(vm.open_questions).toEqual(['Retention?']);

    // product_solution is boilerplate => treated as missing
    expect(vm.facts.product_solution.value).toBeNull();
    expect(vm.facts.market_icp.value).toBe('SMBs');
    expect(vm.facts.business_model.value).toBe('SaaS');
    expect(vm.facts.raise.value).toBe('$2M seed');

    // fact fields are never derived from summary_text
    expect(vm.facts.product_solution.value).toBeNull();
    expect(vm.sources).toEqual([{ type: 'doc', id: 'x' }]);
  });

  test('classifies fallback facts from sources[].note', () => {
    const vm = buildWorkspaceMirrorOverviewVM({
      overview_json: {
        phase1: {
          deal_summary_v2: {
            summary: { one_liner: 'Overlay one-liner', paragraphs: [] },
          },
          deal_overview_v2: {
            product_solution: 'Some derived product line',
            market_icp: 'Some market',
            sources: [
              { document_id: 'doc-1', page_range: [0, 0], note: 'du fallback_product_solution' },
              { document_id: 'doc-1', page_range: [1, 1], note: 'curated promoted_market_icp' },
            ],
          },
        },
      },
    });

    expect(vm.missing).toBe(false);
    if (vm.missing) throw new Error('expected non-missing');

    expect(vm.facts.product_solution.value).toBe('Some derived product line');
    expect(vm.facts.product_solution.quality).toBe('fallback');
    expect(vm.facts.market_icp.value).toBe('Some market');
    expect(vm.facts.market_icp.quality).toBe('promoted');
  });

  test('prefers llm_overview_v1 when present', () => {
    const vm = buildWorkspaceMirrorOverviewVM({
      overview_json: {
        llm_overview_v1: {
          deal_summary: {
            hero: 'Hero line',
            long: 'P1\n\nP2',
          },
          strengths_overlay: ['S1'],
          concerns_overlay: ['R1'],
          coverage_gaps_overlay: ['G1'],
          sources: [{ type: 'doc', id: 's' }],
        },
        phase1: {
          deal_summary_v2: {
            summary: { one_liner: 'Phase1 one-liner', paragraphs: [] },
          },
        },
      },
    });

    expect(vm.missing).toBe(false);
    if (vm.missing) throw new Error('expected non-missing');

    expect(vm.source).toBe('llm_overview_v1');
    expect(vm.one_liner).toBe('Hero line');
    expect(vm.paragraphs).toEqual(['P1', 'P2']);
    expect(vm.strengths).toEqual(['S1']);
    expect(vm.risks).toEqual(['R1']);
    expect(vm.key_risks_detected).toEqual(['G1']);
    expect(vm.sources).toEqual([{ type: 'doc', id: 's' }]);
  });

  test('binds display_facts_v1 evidence_ids when present (but keeps PR2 strings for display)', () => {
    const vm = buildWorkspaceMirrorOverviewVM({
      overview_json: {
        display_facts_v1: {
          product_solution: {
            text: 'Clean product statement',
            evidence_ids: ['ev-1', 'ev-2'],
            evidence_basis: 'direct_snippet',
          },
          market_icp: {
            text: null,
            evidence_ids: [],
            evidence_basis: 'no_evidence',
          },
          business_model: {
            text: 'Usage-based SaaS',
            evidence_ids: ['ev-3'],
            evidence_basis: 'direct_snippet',
          },
          raise: {
            text: 'Raising $2M seed',
            evidence_ids: ['ev-4'],
            evidence_basis: 'direct_snippet',
          },
        },
        phase1: {
          deal_summary_v2: {
            summary: { one_liner: 'Overlay one-liner', paragraphs: [] },
          },
          deal_overview_v2: {
            product_solution: 'Raw product',
            market_icp: 'Raw market',
            business_model: 'Raw BM',
            raise: 'Raw raise',
          },
        },
      },
    });

    expect(vm.missing).toBe(false);
    if (vm.missing) throw new Error('expected non-missing');

    // Display strings come from PR2 deal_overview_v2
    expect(vm.facts.product_solution.value).toBe('Raw product');
    expect(vm.facts.product_solution.evidence_ids).toEqual(['ev-1', 'ev-2']);
    expect(vm.facts.market_icp.value).toBe('Raw market');
    expect(vm.facts.market_icp.evidence_ids).toEqual([]);
    expect(vm.facts.business_model.value).toBe('Raw BM');
    expect(vm.facts.raise.value).toBe('Raw raise');
  });

  test('prefers phase1.governed_ui_copy_v1 for display strings and evidence_ids when present', () => {
    const vm = buildWorkspaceMirrorOverviewVM({
      overview_json: {
        display_facts_v1: {
          product_solution: { text: 'Clean product statement', evidence_ids: ['ev-old'], evidence_basis: 'direct_snippet' },
          market_icp: { text: null, evidence_ids: [], evidence_basis: 'no_evidence' },
          business_model: { text: null, evidence_ids: [], evidence_basis: 'no_evidence' },
          raise_terms: { text: null, evidence_ids: [], evidence_basis: 'no_evidence' },
        },
        phase1: {
          governed_ui_copy_v1: {
            schema_version: 'governed_ui_copy_v1',
            hero_summary: 'Governed hero summary.',
            product_solution: 'Governed product.',
            market_icp: 'Governed market.',
            business_model: 'Governed BM.',
            raise_terms: 'Governed raise.',
            evidence_ids: {
              hero_summary: ['ev-h'],
              product_solution: ['ev-ps'],
              market_icp: ['ev-mi'],
              business_model: ['ev-bm'],
              raise_terms: ['ev-r'],
            },
          },
          deal_summary_v2: {
            summary: { one_liner: 'Deterministic one-liner', paragraphs: [] },
          },
          deal_overview_v2: {
            product_solution: 'Raw product',
            market_icp: 'Raw market',
            business_model: 'Raw BM',
            raise: 'Raw raise',
          },
        },
      },
    });

    expect(vm.missing).toBe(false);
    if (vm.missing) throw new Error('expected non-missing');

    expect(vm.one_liner).toBe('Governed hero summary.');
    expect(vm.facts.product_solution.value).toBe('Governed product.');
    expect(vm.facts.product_solution.evidence_ids).toEqual(['ev-ps']);
    expect(vm.facts.market_icp.value).toBe('Governed market.');
    expect(vm.facts.raise.value).toBe('Governed raise.');
    expect(vm.facts.raise.evidence_ids).toEqual(['ev-r']);
  });

  test('falls back one_liner to summary_text when PR2 one_liner missing', () => {
    const vm = buildWorkspaceMirrorOverviewVM({
      overview: {
        summary_text: 'Fallback summary text',
        overview_json: {
          phase1: {
            deal_summary_v2: { summary: { one_liner: null, paragraphs: [] } },
          },
        },
      },
    });

    expect(vm.missing).toBe(false);
    if (vm.missing) throw new Error('expected non-missing');
    expect(vm.one_liner).toBe('Fallback summary text');
  });
});
