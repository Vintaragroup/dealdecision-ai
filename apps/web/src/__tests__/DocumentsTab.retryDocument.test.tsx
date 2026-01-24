import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DocumentsTab } from '../components/documents/DocumentsTab';

vi.mock('../components/documents/DocumentUpload', () => {
  return {
    DocumentUpload: ({ onUploaded }: { onUploaded?: (doc: any) => void }) => (
      <button
        type="button"
        onClick={() =>
          onUploaded?.({
            document_id: 'doc-uploaded',
            title: 'Uploaded.pdf',
            status: 'pending',
            uploaded_at: new Date().toISOString(),
          })
        }
      >
        Trigger Upload
      </button>
    ),
  };
});

vi.mock('../components/documents/ExtractionReportModal', () => {
  return {
    ExtractionReportModal: () => null,
  };
});

vi.mock('../components/documents/DocumentLibrary', () => {
  return {
    DocumentLibrary: ({ onRetry }: { onRetry: (documentId: string) => void }) => (
      <button type="button" onClick={() => onRetry('doc-1')}>
        Retry Document
      </button>
    ),
  };
});

vi.mock('../lib/apiClient', () => {
  return {
    isLiveBackend: () => true,
    apiGetDocuments: vi.fn(),
    apiRetryDocument: vi.fn(),
  };
});

import * as apiClient from '../lib/apiClient';

describe('DocumentsTab retry document', () => {
  it('calls apiRetryDocument and refreshes documents', async () => {
    vi.mocked(apiClient.apiGetDocuments).mockResolvedValue({ documents: [] } as any);
    vi.mocked(apiClient.apiRetryDocument).mockResolvedValue({ ok: true } as any);

    render(<DocumentsTab dealId="deal-1" darkMode={true} />);

    // initial load
    await waitFor(() => expect(apiClient.apiGetDocuments).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /retry document/i }));

    await waitFor(() => {
      expect(apiClient.apiRetryDocument).toHaveBeenCalledTimes(1);
      expect(apiClient.apiRetryDocument).toHaveBeenCalledWith('deal-1', 'doc-1');
    });

    // refresh after retry
    await waitFor(() => {
      expect(apiClient.apiGetDocuments).toHaveBeenCalledTimes(2);
    });
  });

  it('refreshes documents after a successful upload callback', async () => {
    vi.mocked(apiClient.apiGetDocuments).mockResolvedValue({ documents: [] } as any);

    render(<DocumentsTab dealId="deal-1" darkMode={true} />);

    await waitFor(() => expect(apiClient.apiGetDocuments).toHaveBeenCalled());
    const callsBefore = vi.mocked(apiClient.apiGetDocuments).mock.calls.length;

    const user = userEvent.setup();
    // DocumentUpload is rendered only when the Upload section is opened.
    await user.click(screen.getByRole('button', { name: /^upload$/i }));
    await user.click(screen.getByRole('button', { name: /trigger upload/i }));

    await waitFor(() => {
      const callsAfter = vi.mocked(apiClient.apiGetDocuments).mock.calls.length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });
});
