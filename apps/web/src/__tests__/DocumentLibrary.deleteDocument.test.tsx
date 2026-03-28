import { describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DocumentLibrary } from '../components/documents/DocumentLibrary';

vi.mock('../lib/apiClient', () => {
  return {
    isLiveBackend: () => true,
    apiDeleteDocument: vi.fn(),
    apiGetDocumentDownloadUrl: vi.fn(),
  };
});

import * as apiClient from '../lib/apiClient';

describe('DocumentLibrary delete document', () => {
  it('calls apiDeleteDocument when confirming delete', async () => {
    const apiDeleteDocument = apiClient.apiDeleteDocument as MockedFunction<
      typeof apiClient.apiDeleteDocument
    >;
    apiDeleteDocument.mockResolvedValue({ ok: true } as any);

    const onDeleted = vi.fn();

    render(
      <DocumentLibrary
        darkMode={true}
        dealId="deal-1"
        onDeleted={onDeleted}
        documents={[
          {
            document_id: 'doc-1',
            title: 'Pitch Deck.pdf',
            type: 'other',
            status: 'completed',
            uploaded_at: new Date().toISOString(),
          } as any,
        ]}
      />
    );

    const user = userEvent.setup();

    // Select the document
    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);

    // Trigger delete request
    await user.click(screen.getByRole('button', { name: /move to trash \(1\)/i }));

    await waitFor(() => {
      expect(screen.getByText(/Move document to trash\?/i)).toBeInTheDocument();
      expect(screen.getByText(/This is a soft delete and can be restored by an admin/i)).toBeInTheDocument();
    });

    // Confirm delete
    await user.click(screen.getByRole('button', { name: /^move to trash$/i }));

    await waitFor(() => {
      expect(apiDeleteDocument).toHaveBeenCalledTimes(1);
      expect(apiDeleteDocument).toHaveBeenCalledWith(
        'deal-1',
        'doc-1',
        'Document soft-deleted by user from document library'
      );
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });
  });
});
