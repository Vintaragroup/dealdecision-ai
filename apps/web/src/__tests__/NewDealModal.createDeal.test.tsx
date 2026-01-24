import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';

import { NewDealModal } from '../components/NewDealModal';

vi.mock('../lib/apiClient', () => {
  return {
    isLiveBackend: () => true,
    apiCreateDeal: vi.fn(),
    apiCreateDealDraft: vi.fn(),
    apiGetDeal: vi.fn(),
    apiUploadDocument: vi.fn(),
  };
});

import * as apiClient from '../lib/apiClient';

describe('NewDealModal create deal', () => {
  beforeEach(() => {
    const apiCreateDeal = apiClient.apiCreateDeal as MockedFunction<typeof apiClient.apiCreateDeal>;
    apiCreateDeal.mockReset();
  });

  it('calls apiCreateDeal on final Create Deal click', async () => {
    const created = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'CloudScale SaaS Investment',
      stage: 'intake',
      priority: 'medium',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner: 'CloudScale Inc.',
    };

    const apiCreateDeal = apiClient.apiCreateDeal as MockedFunction<typeof apiClient.apiCreateDeal>;
    apiCreateDeal.mockResolvedValue(created as any);

    const onSuccess = vi.fn();

    render(
      <NewDealModal
        isOpen={true}
        darkMode={true}
        onClose={() => undefined}
        onSuccess={onSuccess}
      />
    );

    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/CloudScale SaaS Investment/i), 'CloudScale SaaS Investment');
    await user.type(screen.getByPlaceholderText(/CloudScale Inc\./i), 'CloudScale Inc.');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2
    const amount = screen.getByPlaceholderText('500000');
    await user.clear(amount);
    await user.type(amount, '500000');

    await user.click(screen.getByRole('button', { name: /^create deal$/i }));

    await waitFor(() => {
      expect(apiCreateDeal).toHaveBeenCalledTimes(1);
    });
  });
});
