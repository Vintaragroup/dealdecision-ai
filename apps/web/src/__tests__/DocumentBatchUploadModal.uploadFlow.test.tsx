import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DocumentBatchUploadModal } from '../components/documents/DocumentBatchUploadModal';

vi.mock('../lib/apiClient', () => {
  return {
    isLiveBackend: () => true,
    apiAnalyzeDocumentsBatch: vi.fn(),
    apiBulkAssignDocuments: vi.fn(),
    apiUploadDocument: vi.fn(),
  };
});

import * as apiClient from '../lib/apiClient';

describe('DocumentBatchUploadModal upload flow', () => {
  // Keep call-count assertions isolated per test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls analyze, bulk-assign, and uploads then closes on success', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    vi.mocked(apiClient.apiAnalyzeDocumentsBatch).mockResolvedValue({
      analysis: {
        summary: { totalFiles: 1, totalGroups: 1, matched: 1, new: 0 },
        duplicates: [],
        groups: [
          {
            company: 'Acme Co',
            status: 'matched',
            dealId: 'deal-1',
            dealName: 'Acme Co',
            documentType: 'other',
            fileCount: 1,
            files: ['pitch.pdf'],
          },
        ],
      },
    } as any);

    vi.mocked(apiClient.apiBulkAssignDocuments).mockResolvedValue({
      assignments: [{ filename: 'pitch.pdf', dealId: 'deal-1', dealName: 'Acme Co' }],
    } as any);

    vi.mocked(apiClient.apiUploadDocument).mockResolvedValue({ document: { id: 'doc-1' } } as any);

    render(<DocumentBatchUploadModal onClose={onClose} onSuccess={onSuccess} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const user = userEvent.setup();
    await user.upload(input, new File(['x'], 'pitch.pdf', { type: 'application/pdf' }));

    await waitFor(() => {
      expect(apiClient.apiAnalyzeDocumentsBatch).toHaveBeenCalledWith(['pitch.pdf']);
    });

    // Review step should appear
    await screen.findByText('Acme Co', { selector: 'p' });

    await user.click(screen.getByRole('button', { name: /upload documents/i }));

    await waitFor(() => {
      expect(apiClient.apiBulkAssignDocuments).toHaveBeenCalledTimes(1);
      expect(apiClient.apiUploadDocument).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call onSuccess/onClose when an upload fails', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    vi.mocked(apiClient.apiAnalyzeDocumentsBatch).mockResolvedValue({
      analysis: {
        summary: { totalFiles: 1, totalGroups: 1, matched: 1, new: 0 },
        duplicates: [],
        groups: [
          {
            company: 'Acme Co',
            status: 'matched',
            dealId: 'deal-1',
            dealName: 'Acme Co',
            documentType: 'other',
            fileCount: 1,
            files: ['pitch.pdf'],
          },
        ],
      },
    } as any);

    vi.mocked(apiClient.apiBulkAssignDocuments).mockResolvedValue({
      assignments: [{ filename: 'pitch.pdf', dealId: 'deal-1', dealName: 'Acme Co' }],
    } as any);

    vi.mocked(apiClient.apiUploadDocument).mockRejectedValue(new Error('upload failed'));

    render(<DocumentBatchUploadModal onClose={onClose} onSuccess={onSuccess} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, new File(['x'], 'pitch.pdf', { type: 'application/pdf' }));

    await screen.findByText('Acme Co', { selector: 'p' });

    await user.click(screen.getByRole('button', { name: /upload documents/i }));

    await waitFor(() => {
      expect(apiClient.apiUploadDocument).toHaveBeenCalledTimes(1);
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Non-blocking error surfaced via toast
    expect(screen.getByText(/upload incomplete/i)).toBeInTheDocument();
  });
});
