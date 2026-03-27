import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UploadDocModal from '../components/upload_doc_modal';

vi.mock('../lib/apiClient', () => {
  return {
    apiUploadDocument: vi.fn(),
  };
});

import * as apiClient from '../lib/apiClient';

describe('UploadDocModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads selected files and closes on success', async () => {
    const onClose = vi.fn();
    const onUploaded = vi.fn();
    vi.mocked(apiClient.apiUploadDocument).mockResolvedValue({ document: { document_id: 'doc-1' } } as any);

    render(
      <UploadDocModal
        isOpen={true}
        onClose={onClose}
        dealId="deal-1"
        onUploaded={onUploaded}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const user = userEvent.setup();
    await user.upload(input, new File(['x'], 'deck.pdf', { type: 'application/pdf' }));

    await user.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => {
      expect(apiClient.apiUploadDocument).toHaveBeenCalledTimes(1);
      expect(apiClient.apiUploadDocument).toHaveBeenCalledWith(
        'deal-1',
        expect.any(File),
        'pitch_deck',
        'deck.pdf',
        { duplicatePolicy: 'skip' }
      );
    });

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('auto-classifies upload type from filename/extension', async () => {
    const onClose = vi.fn();
    vi.mocked(apiClient.apiUploadDocument).mockResolvedValue({ document: { document_id: 'doc-2' } } as any);

    render(
      <UploadDocModal
        isOpen={true}
        onClose={onClose}
        dealId="deal-2"
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, [
      new File(['a'], 'company_model.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      new File(['b'], 'seed_pitch_deck.pdf', { type: 'application/pdf' }),
    ]);

    await user.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => {
      expect(apiClient.apiUploadDocument).toHaveBeenCalledTimes(2);
    });

    expect(apiClient.apiUploadDocument).toHaveBeenCalledWith(
      'deal-2',
      expect.any(File),
      'financials',
      'company_model.xlsx',
      { duplicatePolicy: 'skip' }
    );
    expect(apiClient.apiUploadDocument).toHaveBeenCalledWith(
      'deal-2',
      expect.any(File),
      'pitch_deck',
      'seed_pitch_deck.pdf',
      { duplicatePolicy: 'skip' }
    );
  });
});
