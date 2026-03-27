import { describe, expect, it, vi, beforeEach } from 'vitest';
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

describe('DocumentLibrary document actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('provides accessible action labels and titles for document controls', async () => {
    render(
      <DocumentLibrary
        darkMode={true}
        dealId="deal-1"
        onRetry={() => undefined}
        documents={[
          {
            document_id: 'doc-1',
            title: 'Pitch Deck.pdf',
            type: 'other',
            status: 'ready_for_analysis',
            uploaded_at: new Date().toISOString(),
          } as any,
        ]}
      />
    );

    expect(screen.getByLabelText('View document Pitch Deck.pdf')).toHaveAttribute('title', 'View document');
    expect(screen.getByLabelText('Re-run extraction for Pitch Deck.pdf')).toHaveAttribute('title', 'Re-run extraction');
    expect(screen.getByLabelText('Download document Pitch Deck.pdf')).toHaveAttribute('title', 'Download document');
    expect(screen.getByLabelText('Delete document Pitch Deck.pdf')).toHaveAttribute('title', 'Delete document');
  });

  it('starts download using signed URL endpoint', async () => {
    const apiGetDocumentDownloadUrl = apiClient.apiGetDocumentDownloadUrl as MockedFunction<
      typeof apiClient.apiGetDocumentDownloadUrl
    >;
    apiGetDocumentDownloadUrl.mockResolvedValue({
      deal_id: 'deal-1',
      document_id: 'doc-1',
      provider: 'r2',
      bucket: 'bucket',
      key: 'path/doc-1.pdf',
      signed_url: 'https://example.test/signed-download',
      expires_in_seconds: 300,
    });

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <DocumentLibrary
        darkMode={true}
        dealId="deal-1"
        documents={[
          {
            document_id: 'doc-1',
            title: 'Pitch Deck.pdf',
            type: 'other',
            status: 'ready_for_analysis',
            uploaded_at: new Date().toISOString(),
          } as any,
        ]}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Download document Pitch Deck.pdf'));

    await waitFor(() => {
      expect(apiGetDocumentDownloadUrl).toHaveBeenCalledTimes(1);
      expect(apiGetDocumentDownloadUrl).toHaveBeenCalledWith('deal-1', 'doc-1');
      expect(openSpy).toHaveBeenCalledWith('https://example.test/signed-download', '_blank', 'noopener,noreferrer');
    });
  });

  it('keeps download disabled when no deal is selected', () => {
    render(
      <DocumentLibrary
        darkMode={true}
        documents={[
          {
            document_id: 'doc-1',
            title: 'Pitch Deck.pdf',
            type: 'other',
            status: 'ready_for_analysis',
            uploaded_at: new Date().toISOString(),
          } as any,
        ]}
      />
    );

    const button = screen.getByLabelText('Download document Pitch Deck.pdf');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Select a deal to download this document');
  });

  it('renders human-readable file size when size_bytes is provided by API', () => {
    render(
      <DocumentLibrary
        darkMode={true}
        dealId="deal-1"
        documents={[
          {
            document_id: 'doc-1',
            title: 'Pitch Deck.pdf',
            type: 'other',
            status: 'ready_for_analysis',
            size_bytes: 2048,
            uploaded_at: new Date().toISOString(),
          } as any,
        ]}
      />
    );

    expect(screen.getAllByText('2 KB').length).toBeGreaterThan(0);
  });

  it('maps legacy completed status to Analysis Completed badge label', () => {
    render(
      <DocumentLibrary
        darkMode={true}
        dealId="deal-1"
        documents={[
          {
            document_id: 'doc-legacy',
            title: 'Legacy Deck.pdf',
            type: 'other',
            status: 'completed',
            uploaded_at: new Date().toISOString(),
          } as any,
        ]}
      />
    );

    expect(screen.getByText('Analysis Completed')).toBeInTheDocument();
  });
});
