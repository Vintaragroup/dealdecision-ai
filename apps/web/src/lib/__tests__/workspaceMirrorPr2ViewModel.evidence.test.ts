import { describe, expect, test } from 'vitest';
import { buildWorkspaceMirrorOverviewVM } from '../workspaceMirrorPr2ViewModel';

describe('buildWorkspaceMirrorOverviewVM evidence_map', () => {
  test('parses governed_ui_copy_v1.evidence_map into evidence_refs', () => {
    const overview = {
      overview: {
        overview_json: {
          phase1: {
            governed_ui_copy_v1: {
              schema_version: 'governed_ui_copy_v1',
              hero_summary: 'Hero summary',
              product_solution: 'Product',
              market_icp: 'Market',
              business_model: 'BM',
              raise_terms: 'Raise',
              strengths: ['S1'],
              concerns: ['C1'],
              open_questions: ['Q1'],
              traction: ['T1'],
              evidence_map: {
                deal_summary_mid: [{ source_document_id: 'doc-1', page_index: 0, snippet: 'Hero snippet' }],
                product_solution: [{ source_document_id: 'doc-1', page_index: 1, snippet: 'Product snippet' }],
                market_icp: [{ source_document_id: 'doc-2', page_index: 2, snippet: 'Market snippet' }],
                business_model: [],
                raise_terms: [],
                traction: [],
                strengths: [],
                concerns: [],
                open_questions: [],
              },
            },
            deal_summary_v2: {
              summary: { one_liner: 'fallback', paragraphs: [] },
              strengths: ['fallback-strength'],
              risks: ['fallback-risk'],
              open_questions: ['fallback-q'],
            },
            deal_overview_v2: {
              product_solution: 'fallback product',
              market_icp: 'fallback market',
              business_model: 'fallback bm',
              raise: 'fallback raise',
              traction_signals: ['fallback traction'],
              key_risks_detected: [],
              sources: [],
            },
          },
        },
      },
    };

    const vm = buildWorkspaceMirrorOverviewVM(overview);
    expect(vm.missing).toBe(false);
    if (vm.missing) return;

    expect(vm.facts.product_solution.evidence_refs?.[0]).toMatchObject({
      source_document_id: 'doc-1',
      page_index: 1,
      snippet: 'Product snippet',
    });

    expect(vm.evidence_refs.deal_one_liner[0]).toMatchObject({
      source_document_id: 'doc-1',
      page_index: 0,
      snippet: 'Hero snippet',
    });

    // Governed list fields are preferred when present.
    expect(vm.strengths).toEqual(['S1']);
    expect(vm.risks).toEqual(['C1']);
    expect(vm.open_questions).toEqual(['Q1']);
    expect(vm.traction_signals).toEqual(['T1']);
  });
});
