import { describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

describe('DealsList archive deal', () => {
  it('calls apiArchiveDeal when user selects Archive action', async () => {
    const apiGetDeals = apiClient.apiGetDeals as MockedFunction<typeof apiClient.apiGetDeals>;
    const apiGetDocuments = apiClient.apiGetDocuments as MockedFunction<typeof apiClient.apiGetDocuments>;
    const apiArchiveDeal = apiClient.apiArchiveDeal as MockedFunction<typeof apiClient.apiArchiveDeal>;

    apiGetDeals.mockResolvedValue([
      {
        id: 'deal-1',
        name: 'Archive Candidate',
        stage: 'intake',
        priority: 'medium',
        trend: 'stable',
        lifecycle_status: 'active',
        updated_at: new Date().toISOString(),
      } as any,
    ]);
    apiGetDocuments.mockResolvedValue({ documents: [] } as any);
    apiArchiveDeal.mockResolvedValue({ id: 'deal-1', lifecycle_status: 'archived' } as any);

    render(
      <ScoreSourceProvider>
        <DealsList darkMode={true} />
      </ScoreSourceProvider>
    );

    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText(/Archive Candidate/i)).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('menuitem', { name: /^Archive$/i })[0]);

    await waitFor(() => {
      expect(apiArchiveDeal).toHaveBeenCalledTimes(1);
      expect(apiArchiveDeal).toHaveBeenCalledWith('deal-1', 'Deal archived by user from deals list');
    });
  });
});
