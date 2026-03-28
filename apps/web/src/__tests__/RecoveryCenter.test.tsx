import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecoveryCenter } from '../components/admin/RecoveryCenter';

vi.mock('../lib/apiClient', () => ({
  apiAdminListDeletedDeals: vi.fn(),
  apiAdminListDeletedDocuments: vi.fn(),
  apiAdminRestoreDeal: vi.fn(),
  apiAdminRestoreDocument: vi.fn(),
  apiAdminPurgeDeal: vi.fn(),
  apiAdminPurgeDocument: vi.fn(),
}));

import * as apiClient from '../lib/apiClient';

describe('RecoveryCenter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    (apiClient.apiAdminListDeletedDeals as any).mockResolvedValue({
      records: [
        {
          id: 'deal-1',
          name: 'Deleted Deal',
          stage: 'intake',
          priority: 'medium',
          lifecycle_status: 'active',
          owner: 'owner@demo.com',
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      limit: 200,
      offset: 0,
      total: 1,
    });

    (apiClient.apiAdminListDeletedDocuments as any).mockResolvedValue({
      records: [
        {
          document_id: 'doc-1',
          deal_id: 'deal-1',
          deal_name: 'Deleted Deal',
          title: 'Pitch Deck.pdf',
          type: 'application/pdf',
          status: 'ready_for_analysis',
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deal_deleted_at: new Date().toISOString(),
        },
      ],
      limit: 200,
      offset: 0,
      total: 1,
    });
  });

  it('loads deleted deals/documents and restores a deal with reason', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('restore reason');

    render(<RecoveryCenter adminRole="admin" />);

    await waitFor(() => {
      expect(screen.getByText(/Restore and purge are governance actions/i)).toBeInTheDocument();
      expect(screen.getByText('owner@demo.com')).toBeInTheDocument();
      expect(screen.getByText(/Pitch Deck.pdf/i)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /^Restore$/i })[0]);

    await waitFor(() => {
      expect(apiClient.apiAdminRestoreDeal).toHaveBeenCalledTimes(1);
      expect(apiClient.apiAdminRestoreDeal).toHaveBeenCalledWith('deal-1', 'restore reason');
    });

    expect(promptSpy).toHaveBeenCalled();
  });

  it('restores a document with reason', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('document restore reason');

    render(<RecoveryCenter adminRole="admin" />);

    await waitFor(() => {
      expect(screen.getByText(/Pitch Deck.pdf/i)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /^Restore$/i })[1]);

    await waitFor(() => {
      expect(apiClient.apiAdminRestoreDocument).toHaveBeenCalledTimes(1);
      expect(apiClient.apiAdminRestoreDocument).toHaveBeenCalledWith('doc-1', 'document restore reason');
    });

    expect(promptSpy).toHaveBeenCalled();
  });

  it('disables purge buttons for non-super-admin users', async () => {
    render(<RecoveryCenter adminRole="admin" />);

    await waitFor(() => {
      expect(screen.getByText('owner@demo.com')).toBeInTheDocument();
    });

    const purgeButtons = screen.getAllByRole('button', { name: /^Purge$/i });
    expect(purgeButtons.length).toBeGreaterThan(0);
    purgeButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('calls purge API with reason and typed token for super_admin', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    promptSpy
      .mockReturnValueOnce('cleanup reason')
      .mockReturnValueOnce('PURGE DEAL deal-1');

    render(<RecoveryCenter adminRole="super_admin" />);

    await waitFor(() => {
      expect(screen.getByText('owner@demo.com')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /^Purge$/i })[0]);

    await waitFor(() => {
      expect(apiClient.apiAdminPurgeDeal).toHaveBeenCalledTimes(1);
      expect(apiClient.apiAdminPurgeDeal).toHaveBeenCalledWith('deal-1', {
        reason: 'cleanup reason',
        confirm_text: 'PURGE DEAL deal-1',
      });
    });
  });
});
