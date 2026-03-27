import { describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  };
});

import * as apiClient from '../lib/apiClient';

describe('DealsList delete deal', () => {
  it('calls apiDeleteDeal after user confirms delete', async () => {
    const apiGetDeals = apiClient.apiGetDeals as MockedFunction<typeof apiClient.apiGetDeals>;
    const apiGetDocuments = apiClient.apiGetDocuments as MockedFunction<
      typeof apiClient.apiGetDocuments
    >;
    const apiDeleteDeal = apiClient.apiDeleteDeal as MockedFunction<typeof apiClient.apiDeleteDeal>;

    apiGetDeals.mockResolvedValue([
      {
        id: 'deal-1',
        name: 'Demo Deal',
        stage: 'intake',
        priority: 'medium',
        trend: 'stable',
        updated_at: new Date().toISOString(),
      } as any,
    ]);
    apiGetDocuments.mockResolvedValue({ documents: [] } as any);
    apiDeleteDeal.mockResolvedValue({ ok: true } as any);

    render(
      <ScoreSourceProvider>
        <DealsList darkMode={true} />
      </ScoreSourceProvider>
    );

    const user = userEvent.setup();

    // Wait for the deal to appear.
    await waitFor(() => {
      expect(screen.getByText(/Demo Deal/i)).toBeInTheDocument();
    });

    // Open actions menu and choose Delete.
    await user.click(screen.getAllByRole('menuitem', { name: /^Delete$/i })[0]);

    // Confirm modal
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Move Deal To Trash/i })).toBeInTheDocument();
      expect(screen.getByText(/The deal and its documents will be soft-deleted/i)).toBeInTheDocument();
    });

    const confirmInput = screen.getByPlaceholderText(/Demo Deal/i) as HTMLInputElement;
    fireEvent.change(confirmInput, { target: { value: 'DELETE' } });
    await user.click(screen.getByRole('button', { name: /move to trash/i }));

    await waitFor(() => {
      expect(apiDeleteDeal).toHaveBeenCalledTimes(1);
      expect(apiDeleteDeal).toHaveBeenCalledWith('deal-1', {
        purge: false,
        reason: 'Deal soft-deleted by user from deals list (Demo Deal)',
      });
    });
  });
});
