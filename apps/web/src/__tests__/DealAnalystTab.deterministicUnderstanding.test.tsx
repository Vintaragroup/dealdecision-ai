import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi } from 'vitest';

// Mock ReactFlow to avoid DOM layout dependencies and to give us deterministic "nodes" to click.
vi.mock('@xyflow/react', async () => {
  const React = await import('react');

  function ReactFlow(props: any) {
    React.useEffect(() => {
      props?.onInit?.({
        fitView: () => undefined,
        getNodes: () => [],
        getEdges: () => [],
      });
    }, []);

    return (
      <div data-testid="reactflow-mock">
        <button
          type="button"
          data-testid="rf-node-page-0"
          onClick={(evt) =>
            props?.onNodeClick?.(evt, {
              id: 'visual_asset_group:page-0',
              type: 'visual_asset_group',
              data: {
                __node_type: 'visual_asset_group',
                document_id: 'doc-1',
                page_index: 0,
                label: 'Page 1',
                member_visual_asset_ids: [],
                count_members: 0,
              },
            })
          }
        >
          Select page 1
        </button>
        {props?.children}
      </div>
    );
  }

  const Background = () => null;
  const Controls = () => null;
  const MiniMap = () => null;
  const Panel = ({ children }: any) => <div>{children}</div>;

  const Position = {
    Top: 'top',
    Right: 'right',
    Bottom: 'bottom',
    Left: 'left',
  };

  const useNodesState = (initial: any) => {
    const [nodes, setNodes] = React.useState(initial);
    return [nodes, setNodes, () => undefined] as const;
  };

  const useEdgesState = (initial: any) => {
    const [edges, setEdges] = React.useState(initial);
    return [edges, setEdges, () => undefined] as const;
  };

  return {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Panel,
    Position,
    useNodesState,
    useEdgesState,
  };
});

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();

  return {
    ...actual,
    getWebBackendRuntimeConfig: vi.fn(() => ({ backendMode: 'live', apiBaseUrl: 'http://localhost:9000' } as any)),
    isLiveBackend: vi.fn(() => true),

    apiGetDealLineage: vi.fn(async () => ({ nodes: [], edges: [], warnings: [] } as any)),
    apiGetDealVisualAssets: vi.fn(async () => ({
      visual_assets: [
        {
          visual_asset_id: 'va-1',
          document_id: 'doc-1',
          page_index: 0,
          ocr_text: 'CEO: Jane Doe\nRevenue: $1M',
          document_title: 'Pitch Deck',
        },
      ],
    } as any)),

    apiGetDealDeterministicUnderstanding: vi.fn(async () => null),
    apiPostDealDeterministicUnderstanding: vi.fn(async () => ({
      analysis_version: 'deterministic_understanding_v1',
      input_hash: 'hash-1',
      created_at: '2026-01-31T00:00:00.000Z',
      patch: {
        analysis_version: 'deterministic_understanding_v1',
        created_at: '2026-01-31T00:00:00.000Z',
        input_hash: 'hash-1',
        deal_id: 'deal-1',
        pages: {
          'visual_asset_group:doc-1:0': {
            page_id: 'visual_asset_group:doc-1:0',
            document_id: 'doc-1',
            page_index: 0,
            page_type: 'team',
            confidence: 0.9,
            why: ['keyword: ceo'],
            evidence: [{ snippet: 'CEO: Jane Doe', score: 10, features: ['contains_entities'] }],
            key_numbers: [
              { metric_type: 'revenue', value_normalized: 1000000, raw_value: '$1M', unit: 'USD', context: 'Revenue: $1M', confidence: 0.8 },
            ],
            key_entities: [{ entity_type: 'PERSON', text: 'Jane Doe', confidence: 0.7 }],
            quality_flags: [],
          },
        },
        documents: {},
      },
    } as any)),

    // Non-critical calls.
    apiGetDocumentVisualAssets: vi.fn(async () => ({ visual_assets: [] } as any)),
    apiGetDocumentAnalysis: vi.fn(async () => ({ deal_id: 'deal-1', document_id: 'doc-1', status: 'ok' } as any)),
    apiGetRenderedPageSignedUrl: vi.fn(async () => ({
      deal_id: 'deal-1',
      document_id: 'doc-1',
      page_index: 0,
      provider: 'r2',
      key: 'test',
      url: 'http://localhost.test/page.png',
      expires_in_seconds: 60,
    } as any)),
    resolveApiAssetUrl: vi.fn((s: any) => (typeof s === 'string' ? s : null)),
    apiDeleteVisualAssetSegmentOverride: vi.fn(async () => ({} as any)),
    apiPostExtractVisuals: vi.fn(async () => ({} as any)),
    apiRetryDocument: vi.fn(async () => ({} as any)),
    apiPostDealNodeAiAnalyze: vi.fn(async () => ({} as any)),
    apiPostVisualAssetAiAnalyze: vi.fn(async () => ({} as any)),
  };
});

import { DealAnalystTab } from '../components/deals/tabs/DealAnalystTab';
import { apiGetDealDeterministicUnderstanding, apiGetDealVisualAssets, apiPostDealDeterministicUnderstanding } from '../lib/apiClient';

describe('DealAnalystTab deterministic understanding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('shows Compute button on missing patch and renders page type after compute', async () => {
    const user = userEvent.setup();

    render(<DealAnalystTab dealId="deal-1" darkMode={false} />);

    // Wait for the initial refresh to complete so state settles.
    await waitFor(() => {
      expect(vi.mocked(apiGetDealVisualAssets)).toHaveBeenCalled();
      expect(vi.mocked(apiGetDealDeterministicUnderstanding)).toHaveBeenCalled();
    });

    await user.click(screen.getByTestId('rf-node-page-0'));

    const computeBtn = await screen.findByRole('button', { name: /compute/i });
    await waitFor(() => expect(computeBtn).toBeEnabled());

    await user.click(computeBtn);

    await waitFor(() => {
      expect(vi.mocked(apiPostDealDeterministicUnderstanding)).toHaveBeenCalled();
    });

    expect(await screen.findByText(/team\s*·\s*90%/i)).toBeInTheDocument();

    // Acceptance (UI): Inspector displays page type + evidence + key numbers.
    expect(await screen.findByText(/CEO:\s*Jane Doe/i)).toBeInTheDocument();
    expect(await screen.findByText(/\$1M/i)).toBeInTheDocument();
  });
});
