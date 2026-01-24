import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DocumentUpload } from '../components/documents/DocumentUpload';

vi.mock('../lib/apiClient', () => {
  return {
    isLiveBackend: () => true,
    apiUploadDocument: vi.fn(),
  };
});

import * as apiClient from '../lib/apiClient';

describe('DocumentUpload upload document', () => {
  it('calls apiUploadDocument when a file is selected in live mode', async () => {
    // jsdom does not implement createObjectURL; DocumentUpload uses it for previews.
    (globalThis as any).URL = (globalThis as any).URL || {};
    (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:mock');

    apiClient.apiUploadDocument.mockResolvedValue({
      document: {
        document_id: 'doc-1',
        title: 'Pitch Deck.pdf',
        type: 'other',
        status: 'pending',
        uploaded_at: new Date().toISOString(),
      },
    } as any);

    const { container } = render(
      <DocumentUpload
        darkMode={true}
        dealId="deal-1"
        enableAIExtraction={true}
      />
    );

    const user = userEvent.setup();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(['hello'], 'Pitch Deck.pdf', { type: 'application/pdf' });
    await user.upload(input as HTMLInputElement, file);

    await waitFor(() => {
      expect(apiClient.apiUploadDocument).toHaveBeenCalledTimes(1);
      const [dealId, uploadedFile, docType, title] = apiClient.apiUploadDocument.mock.calls[0];
      expect(dealId).toBe('deal-1');
      expect(uploadedFile).toBe(file);
      expect(docType).toBe('other');
      expect(title).toBe('Pitch Deck.pdf');
    });
  });
});
