import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
        <button
          type="button"
          data-testid="rf-node-page-1"
          onClick={(evt) =>
            props?.onNodeClick?.(evt, {
              id: 'visual_asset_group:page-1',
              type: 'visual_asset_group',
              data: {
                __node_type: 'visual_asset_group',
                document_id: 'doc-1',
                page_index: 1,
                label: 'Page 2',
                member_visual_asset_ids: [],
                count_members: 0,
              },
            })
          }
        >
          Select page 2
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

vi.mock('../lib/apiClient', async (importOriginal: unknown) => {
  const actual = (await (importOriginal as unknown as () => Promise<unknown>)()) as typeof import('../lib/apiClient');

  return {
    ...actual,
    // Minimal baseline mocks for DealAnalystTab boot.
    getWebBackendRuntimeConfig: vi.fn(() => ({ backendMode: 'live', apiBaseUrl: 'http://localhost:9001' } as any)),
    isLiveBackend: vi.fn(() => true),

    apiGetDealLineage: vi.fn(async () => ({ nodes: [], edges: [] } as any)),
    apiGetDealVisualAssets: vi.fn(async () => ({ visual_assets: [] } as any)),
    apiGetDealDeterministicUnderstanding: vi.fn(async () => null),
    apiPostDealDeterministicUnderstanding: vi.fn(async () => ({
      analysis_version: 'deterministic_understanding_v1',
      input_hash: 'test',
      created_at: new Date(0).toISOString(),
      patch: { analysis_version: 'deterministic_understanding_v1', created_at: new Date(0).toISOString(), input_hash: 'test', deal_id: 'deal-1', pages: {}, documents: {} },
    } as any)),
    apiGetDocumentVisualAssets: vi.fn(async () => ({ visual_assets: [] } as any)),
    apiGetDocumentAnalysis: vi.fn(async () => ({
      deal_id: 'deal-1',
      document_id: 'doc-1',
      status: 'ok',
      structured_data: null,
      extraction_metadata: null,
      job_status: null,
      job_message: null,
      job_progress: null,
    } as any)),

    apiGetRenderedPageSignedUrl: vi.fn(async (_dealId: string, _docId: string, pageIndex: number) => ({
      deal_id: _dealId,
      document_id: _docId,
      page_index: pageIndex,
      provider: 'r2',
      key: `fake/${_docId}/page_${pageIndex}.png`,
      url: `https://signed.example/${_docId}/page_${pageIndex}.png`,
      expires_in_seconds: 3600,
    })),

    resolveApiAssetUrl: vi.fn((s: any) => (typeof s === 'string' ? s : null)),

    // Non-critical calls (keep as no-ops).
    apiDeleteVisualAssetSegmentOverride: vi.fn(async () => ({} as any)),
    apiPostExtractVisuals: vi.fn(async () => ({} as any)),
    apiRetryDocument: vi.fn(async () => ({} as any)),
    apiPostDealNodeAiAnalyze: vi.fn(async () => ({} as any)),
    apiPostVisualAssetAiAnalyze: vi.fn(async () => ({} as any)),
  };
});

import { DealAnalystTab } from '../components/deals/tabs/DealAnalystTab';
import { apiGetRenderedPageSignedUrl } from '../lib/apiClient';
import { __clearPageSnapshotUrlCacheForTests } from '../lib/pageSnapshots';

describe('DealAnalystTab Page snapshot preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearPageSnapshotUrlCacheForTests();
  });

  test('renders Page snapshot via signed-url endpoint and caches per page', async () => {
    const user = userEvent.setup();

    render(<DealAnalystTab dealId="deal-1" darkMode={false} />);

    await user.click(screen.getByTestId('rf-node-page-0'));

    const img0 = await screen.findByTestId('page-snapshot-img');
    await waitFor(() => {
      expect(img0).toHaveAttribute('src', 'https://signed.example/doc-1/page_0.png');
    });

    expect(apiGetRenderedPageSignedUrl).toHaveBeenCalledWith('deal-1', 'doc-1', 0);

    await user.click(screen.getByTestId('rf-node-page-1'));

    const img1 = await screen.findByTestId('page-snapshot-img');
    await waitFor(() => {
      expect(img1).toHaveAttribute('src', 'https://signed.example/doc-1/page_1.png');
    });

    expect(apiGetRenderedPageSignedUrl).toHaveBeenCalledWith('deal-1', 'doc-1', 1);
    expect(vi.mocked(apiGetRenderedPageSignedUrl)).toHaveBeenCalledTimes(2);

    // Switch back to page 0; should hit session cache (no additional signed-url call).
    await user.click(screen.getByTestId('rf-node-page-0'));

    const img0b = await screen.findByTestId('page-snapshot-img');
    await waitFor(() => {
      expect(img0b).toHaveAttribute('src', 'https://signed.example/doc-1/page_0.png');
    });

    expect(vi.mocked(apiGetRenderedPageSignedUrl)).toHaveBeenCalledTimes(2);
  });
});
