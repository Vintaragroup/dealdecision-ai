import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';

import { NewDealModal } from '../components/Modal_Legacy/NewDealModal';

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

  const flushMicrotasks = async (ticks = 5) => {
    for (let i = 0; i < ticks; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
  };

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

  it('treats HTTP 409 Deal already exists as success (opens existing deal)', async () => {
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: TimerHandler) => {
        if (typeof cb === 'function') cb();
        return 0 as any;
      }) as any);

    const existing = {
      id: 'b21b894e-4020-46bd-b753-93b2d2d5fa8f',
      name: 'Qredible',
      stage: 'intake',
      priority: 'medium',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner: 'Qredible',
    };

    const apiCreateDeal = apiClient.apiCreateDeal as MockedFunction<typeof apiClient.apiCreateDeal>;
    const apiGetDeal = apiClient.apiGetDeal as MockedFunction<typeof apiClient.apiGetDeal>;

    apiCreateDeal.mockRejectedValue(
      new Error(
        'HTTP 409 POST /api/v1/deals: {"error":"Deal already exists","existing_deal_id":"b21b894e-4020-46bd-b753-93b2d2d5fa8f","existing_deal_name":"Qredible"}'
      )
    );
    apiGetDeal.mockResolvedValue(existing as any);

    const onSuccess = vi.fn();

    render(
      <NewDealModal
        isOpen={true}
        darkMode={true}
        onClose={() => undefined}
        onSuccess={onSuccess}
      />
    );

    const user = userEvent.setup({ delay: null });

    await user.type(screen.getByPlaceholderText(/CloudScale SaaS Investment/i), 'Qredible');
    await user.type(screen.getByPlaceholderText(/CloudScale Inc\./i), 'Qredible');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const amount = screen.getByPlaceholderText('500000');
    await user.clear(amount);
    await user.type(amount, '500000');

    fireEvent.click(screen.getByRole('button', { name: /^create deal$/i }));

    // Flush promise chain: apiCreateDeal rejection -> catch -> apiGetDeal
    await flushMicrotasks();

    expect(apiCreateDeal).toHaveBeenCalledTimes(1);
    expect(apiGetDeal).toHaveBeenCalledWith('b21b894e-4020-46bd-b753-93b2d2d5fa8f');

    // apiGetDeal resolution -> proceedToWorkspace invokes onSuccess via setTimeout (mocked immediate).
    await flushMicrotasks();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    const created = onSuccess.mock.calls[0]?.[1];
    expect(created?.id).toBe('b21b894e-4020-46bd-b753-93b2d2d5fa8f');

    setTimeoutSpy.mockRestore();
  });
});
