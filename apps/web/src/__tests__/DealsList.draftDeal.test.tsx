/**
 * DealsList.draftDeal.test.tsx
 *
 * Tests that newly created draft deals (lifecycle_status = 'draft') appear
 * in the active pipeline view with a "Draft" badge.
 *
 * Root cause context: POST /api/v1/deals/draft sets lifecycle_status='draft'.
 * Before the fix, draft deals were excluded from the active pipeline query and
 * filtered out by the frontend matchesLifecycle check.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { DealsList } from '../components/pages/DealsList';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';

vi.mock('../components/ui/dropdown-menu', () => {
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children: React.ReactNode;
      onSelect?: (e: unknown) => void;
      disabled?: boolean;
    }) => (
      <button type="button" role="menuitem" disabled={disabled} onClick={(e) => onSelect?.(e)}>
        {children}
      </button>
    ),
  };
});

vi.mock('@clerk/clerk-react', () => {
  return {
    useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: 'org_1' }),
  };
});

vi.mock('../lib/apiClient', () => {
  return {
    isLiveBackend: () => true,
    apiGetDeals: vi.fn(),
    apiGetDocuments: vi.fn(),
    apiAutoProgressDeal: vi.fn(),
    apiDeleteDeal: vi.fn(),
    apiArchiveDeal: vi.fn(),
    apiUnarchiveDeal: vi.fn(),
  };
});

import * as apiClient from '../lib/apiClient';

function makeDraftDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deal-draft-1',
    name: 'Climatic Draft',
    stage: 'intake',
    priority: 'medium',
    trend: 'stable',
    lifecycle_status: 'draft',
    llm_phase_mode: 'exploratory',
    updated_at: new Date().toISOString(),
    ...overrides,
  } as any;
}

function makeActiveDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deal-active-1',
    name: 'Active Deal',
    stage: 'intake',
    priority: 'medium',
    trend: 'stable',
    lifecycle_status: 'active',
    llm_phase_mode: 'exploratory',
    updated_at: new Date().toISOString(),
    ...overrides,
  } as any;
}

describe('DealsList draft deal pipeline visibility', () => {
  it('shows a draft deal in the active pipeline view', async () => {
    const apiGetDeals = apiClient.apiGetDeals as MockedFunction<typeof apiClient.apiGetDeals>;
    const apiGetDocuments = apiClient.apiGetDocuments as MockedFunction<typeof apiClient.apiGetDocuments>;

    apiGetDeals.mockResolvedValue([makeDraftDeal()]);
    apiGetDocuments.mockResolvedValue({ documents: [] } as any);

    render(
      <ScoreSourceProvider>
        <DealsList darkMode={true} />
      </ScoreSourceProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Climatic Draft')).toBeInTheDocument();
    });
  });

  it('shows a "Draft" badge for draft deals', async () => {
    const apiGetDeals = apiClient.apiGetDeals as MockedFunction<typeof apiClient.apiGetDeals>;
    const apiGetDocuments = apiClient.apiGetDocuments as MockedFunction<typeof apiClient.apiGetDocuments>;

    apiGetDeals.mockResolvedValue([makeDraftDeal()]);
    apiGetDocuments.mockResolvedValue({ documents: [] } as any);

    render(
      <ScoreSourceProvider>
        <DealsList darkMode={true} />
      </ScoreSourceProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument();
    });
  });

  it('does not show "Draft" badge for active deals', async () => {
    const apiGetDeals = apiClient.apiGetDeals as MockedFunction<typeof apiClient.apiGetDeals>;
    const apiGetDocuments = apiClient.apiGetDocuments as MockedFunction<typeof apiClient.apiGetDocuments>;

    apiGetDeals.mockResolvedValue([makeActiveDeal()]);
    apiGetDocuments.mockResolvedValue({ documents: [] } as any);

    render(
      <ScoreSourceProvider>
        <DealsList darkMode={true} />
      </ScoreSourceProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Active Deal')).toBeInTheDocument();
    });

    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
  });

  it('shows both draft and active deals in the active pipeline view', async () => {
    const apiGetDeals = apiClient.apiGetDeals as MockedFunction<typeof apiClient.apiGetDeals>;
    const apiGetDocuments = apiClient.apiGetDocuments as MockedFunction<typeof apiClient.apiGetDocuments>;

    apiGetDeals.mockResolvedValue([makeDraftDeal(), makeActiveDeal()]);
    apiGetDocuments.mockResolvedValue({ documents: [] } as any);

    render(
      <ScoreSourceProvider>
        <DealsList darkMode={true} />
      </ScoreSourceProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Climatic Draft')).toBeInTheDocument();
      expect(screen.getByText('Active Deal')).toBeInTheDocument();
    });
  });

  it('shows a draft deal passed via createdDeal prop after fetch resolves', async () => {
    const apiGetDeals = apiClient.apiGetDeals as MockedFunction<typeof apiClient.apiGetDeals>;
    const apiGetDocuments = apiClient.apiGetDocuments as MockedFunction<typeof apiClient.apiGetDocuments>;

    const draftDeal = makeDraftDeal({ name: 'Newly Created Deal' });

    // Fetch returns the same deal (pipeline now includes draft deals)
    apiGetDeals.mockResolvedValue([draftDeal]);
    apiGetDocuments.mockResolvedValue({ documents: [] } as any);

    render(
      <ScoreSourceProvider>
        <DealsList darkMode={true} createdDeal={draftDeal} />
      </ScoreSourceProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Newly Created Deal')).toBeInTheDocument();
    });

    // Draft badge should be present
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('draft deal remains visible after fetch completes and returns it', async () => {
    const apiGetDeals = apiClient.apiGetDeals as MockedFunction<typeof apiClient.apiGetDeals>;
    const apiGetDocuments = apiClient.apiGetDocuments as MockedFunction<typeof apiClient.apiGetDocuments>;

    const draftDeal = makeDraftDeal({ name: 'Post-Analysis Draft Deal' });
    apiGetDeals.mockResolvedValue([draftDeal]);
    apiGetDocuments.mockResolvedValue({ documents: [] } as any);

    render(
      <ScoreSourceProvider>
        <DealsList darkMode={true} />
      </ScoreSourceProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Post-Analysis Draft Deal')).toBeInTheDocument();
    });

    // Draft badge also visible
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('archived deal is NOT shown in the active pipeline view', async () => {
    const apiGetDeals = apiClient.apiGetDeals as MockedFunction<typeof apiClient.apiGetDeals>;
    const apiGetDocuments = apiClient.apiGetDocuments as MockedFunction<typeof apiClient.apiGetDocuments>;

    // Archived lifecycle_status — API returns it if filter=all, but frontend should filter
    apiGetDeals.mockResolvedValue([
      {
        id: 'deal-archived-1',
        name: 'Archived Deal',
        stage: 'intake',
        priority: 'medium',
        trend: 'stable',
        lifecycle_status: 'archived',
        llm_phase_mode: 'exploratory',
        updated_at: new Date().toISOString(),
      } as any,
    ]);
    apiGetDocuments.mockResolvedValue({ documents: [] } as any);

    render(
      <ScoreSourceProvider>
        <DealsList darkMode={true} />
      </ScoreSourceProvider>
    );

    // Wait for fetch to complete
    await waitFor(() => {
      expect(apiGetDeals).toHaveBeenCalled();
    });

    // Archived deal must not appear in active view
    expect(screen.queryByText('Archived Deal')).not.toBeInTheDocument();
  });
});
