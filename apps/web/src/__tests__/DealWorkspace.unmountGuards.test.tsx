import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DealWorkspace } from '../components/pages/DealWorkspace';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';
import { apiGetDeal, apiGetDealAnalysisDiagnostics, apiGetDealReport } from '../lib/apiClient';

vi.mock('../contexts/UserRoleContext', () => ({
  useUserRole: () => ({ isAnalyst: true, isInvestor: false }),
}));

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetDeal: vi.fn(),
    apiGetDealReport: vi.fn(async () => ({ ready: false, reason: 'not_generated_yet' } as any)),
    apiGetDealAnalysisDiagnostics: vi.fn(async () => ({ diagnostics: null } as any)),

    apiPostAnalyze: vi.fn(),
    apiPostAnalyzeWithStatus: vi.fn(),
    apiPostReextractDocuments: vi.fn(),
    apiPostExtractVisuals: vi.fn(),
    apiGetDealReadiness: vi.fn(),
    apiGetDealJobs: vi.fn(async () => []),
    apiGetJob: vi.fn(),
    isLiveBackend: vi.fn(() => true),

    // Non-critical calls: keep these as no-ops unless a test asserts on them.
    apiGetEvidence: vi.fn(async () => ({ evidence: [] } as any)),
    apiGetDocuments: vi.fn(async () => ({ documents: [] } as any)),
    apiGetDealReportNarrated: vi.fn(async () => ({ ready: false, reason: 'not_generated_yet' } as any)),
    apiGetDealGovernedOverlayPersisted: vi.fn(async () => ({ overview: null } as any)),
    apiGetDealDeterministicUnderstanding: vi.fn(async () => null as any),
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiPostDealDeterministicUnderstanding: vi.fn(async () => ({
      analysis_version: 'deterministic_understanding_v1',
      input_hash: 'test',
      created_at: new Date(0).toISOString(),
      patch: {
        analysis_version: 'deterministic_understanding_v1',
        created_at: new Date(0).toISOString(),
        input_hash: 'test',
        deal_id: 'deal-1',
        pages: {},
        documents: {},
      },
    } as any)),
    subscribeToEvents: vi.fn(() => () => undefined),
    apiResolveEvidence: vi.fn(async () => ({ results: [] } as any)),
  };
});

const baseDeal = {
  id: 'deal-1',
  name: 'Demo Deal',
  company: 'Demo Co',
  type: 'series-a',
  stage: 'Series A',
  investmentAmount: 1000000,
  industry: 'SaaS',
  targetMarket: 'Enterprise',
  fundingAmount: '$1M',
  revenue: '$0',
  customers: '0',
  teamSize: '5',
  description: 'Demo',
  estimatedSavings: { money: 1000, hours: 10 },
} as const;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function renderWorkspace(dealId: string) {
  return render(
    <ScoreSourceProvider>
      <DealWorkspace darkMode={false} dealId={dealId} dealData={baseDeal} />
    </ScoreSourceProvider>,
  );
}

function readyReportWithRaise(dealId: string, raiseValue: string) {
  return {
    ready: true,
    version: 1,
    artifact: { kind: 'deal_intelligence_object', dio_id: `dio-${dealId}`, analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
    report: {
      dealId,
      generatedAt: '2024-01-02T00:00:00.000Z',
      version: 1,
      overallScore: 50,
      recommendation: 'yes',
      sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
      structured_summary: {
        kpis: {
          raise: { value: raiseValue, sources: [] },
        },
      },
      metadata: {
        score_band_v2: { key: 'good', label: 'Good', overall_score: 50, thresholds_version: 'v2' },
      },
    },
  } as any;
}

describe('DealWorkspace unmount + dealId switch guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('unmount quickly: async report/diagnostics resolve after unmount without console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const dealA = deferred<any>();
    const reportA = deferred<any>();
    const diagA = deferred<any>();

    vi.mocked(apiGetDeal).mockImplementation((dealId: string) => {
      if (dealId === 'A') return dealA.promise;
      return Promise.resolve({ dioVersionId: 'v1.0.0', dioStatus: 'ready' } as any);
    });

    vi.mocked(apiGetDealReport).mockImplementation((dealId: string, _opts?: any) => {
      if (dealId === 'A') return reportA.promise;
      return Promise.resolve({ ready: false } as any);
    });

    vi.mocked(apiGetDealAnalysisDiagnostics).mockImplementation((dealId: string) => {
      if (dealId === 'A') return diagA.promise;
      return Promise.resolve({ diagnostics: null } as any);
    });

    const rendered = renderWorkspace('A');

    await waitFor(() => {
      expect(vi.mocked(apiGetDealAnalysisDiagnostics)).toHaveBeenCalledWith('A');
    });

    // Deal must resolve before the report request is initiated (so it can be version-pinned).
    await act(async () => {
      dealA.resolve({ dioVersionId: 'v1.0.0', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);
      await flushPromises();
    });

    await waitFor(() => {
      expect(vi.mocked(apiGetDealReport)).toHaveBeenCalledWith('A', expect.anything());
    });

    rendered.unmount();

    // Resolve after unmount.
    await act(async () => {
      reportA.resolve(readyReportWithRaise('A', '$A'));
      diagA.resolve({ diagnostics: { deal_id: 'A' } } as any);
      await flushPromises();
    });

    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  test('dealId switches: resolving A promises first does not overwrite B state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const dealA = deferred<any>();
    const dealB = deferred<any>();
    const reportA = deferred<any>();
    const reportB = deferred<any>();
    const diagA = deferred<any>();
    const diagB = deferred<any>();

    vi.mocked(apiGetDeal).mockImplementation((dealId: string) => {
      if (dealId === 'A') return dealA.promise;
      if (dealId === 'B') return dealB.promise;
      return Promise.resolve({ dioVersionId: 'v1.0.0', dioStatus: 'ready' } as any);
    });

    vi.mocked(apiGetDealReport).mockImplementation((dealId: string, _opts?: any) => {
      if (dealId === 'A') return reportA.promise;
      if (dealId === 'B') return reportB.promise;
      return Promise.resolve({ ready: false } as any);
    });

    vi.mocked(apiGetDealAnalysisDiagnostics).mockImplementation((dealId: string) => {
      if (dealId === 'A') return diagA.promise;
      if (dealId === 'B') return diagB.promise;
      return Promise.resolve({ diagnostics: null } as any);
    });

    const rendered = renderWorkspace('A');

    await waitFor(() => {
      expect(vi.mocked(apiGetDealAnalysisDiagnostics)).toHaveBeenCalledWith('A');
    });

    // Resolve deal A to initiate its pinned report fetch.
    await act(async () => {
      dealA.resolve({ dioVersionId: 'v1.0.0', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);
      await flushPromises();
    });

    await waitFor(() => {
      expect(vi.mocked(apiGetDealReport)).toHaveBeenCalledWith('A', expect.anything());
    });

    rendered.rerender(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId={'B'} dealData={baseDeal} />
      </ScoreSourceProvider>,
    );

    // Resolve deal B to initiate its pinned report fetch.
    await act(async () => {
      dealB.resolve({ dioVersionId: 'v1.0.0', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);
      await flushPromises();
    });

    await waitFor(() => {
      expect(vi.mocked(apiGetDealReport)).toHaveBeenCalledWith('B', expect.anything());
      expect(vi.mocked(apiGetDealAnalysisDiagnostics)).toHaveBeenCalledWith('B');
    });

    // Resolve A first (stale); component should ignore these.
    await act(async () => {
      reportA.resolve(readyReportWithRaise('A', '$A'));
      diagA.resolve({ diagnostics: { deal_id: 'A' } } as any);
      await flushPromises();
    });

    await waitFor(() => {
      expect(document.body.textContent).not.toContain('$A');
    });

    // Now resolve B; UI should reflect B only.
    await act(async () => {
      dealB.resolve({ dioVersionId: 'v1.0.0', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);
      reportB.resolve(readyReportWithRaise('B', '$B'));
      diagB.resolve({ diagnostics: { deal_id: 'B' } } as any);
      await flushPromises();
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('$B');
    });

    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    rendered.unmount();
  });
});
