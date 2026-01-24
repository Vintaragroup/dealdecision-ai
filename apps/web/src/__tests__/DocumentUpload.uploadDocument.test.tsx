import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockAuthState: { isLoaded: boolean; isSignedIn: boolean; orgId: string | null } = {
  isLoaded: true,
  isSignedIn: true,
  orgId: 'org_test',
};

vi.mock('@clerk/clerk-react', () => {
  return {
    useAuth: () => ({
      isLoaded: mockAuthState.isLoaded,
      isSignedIn: mockAuthState.isSignedIn,
      orgId: mockAuthState.orgId,
    }),
  };
});

vi.mock('../lib/apiClient', () => {
  return {
    isLiveBackend: () => true,
    apiUploadDocument: vi.fn(),
  };
});

import * as apiClient from '../lib/apiClient';
import { DocumentUpload } from '../components/documents/DocumentUpload';

describe('DocumentUpload upload document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = { isLoaded: true, isSignedIn: true, orgId: 'org_test' };

    // jsdom does not implement createObjectURL; DocumentUpload uses it for previews.
    (globalThis as any).URL = (globalThis as any).URL || {};
    (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:mock');
  });

  it('calls apiUploadDocument when a file is selected in live mode', async () => {
    const apiUploadDocument = apiClient.apiUploadDocument as MockedFunction<
      typeof apiClient.apiUploadDocument
    >;

    apiUploadDocument.mockResolvedValue({
      document: {
        document_id: 'doc-1',
        title: 'Pitch Deck.pdf',
        type: 'other',
        status: 'pending',
        uploaded_at: new Date().toISOString(),
      },
    } as any);

    const onUploaded = vi.fn();

    const { container } = render(
      <DocumentUpload
        darkMode={true}
        dealId="deal-1"
        enableAIExtraction={true}
        onUploaded={onUploaded}
      />
    );

    const user = userEvent.setup();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(['hello'], 'Pitch Deck.pdf', { type: 'application/pdf' });
    await user.upload(input as HTMLInputElement, file);

    await waitFor(() => {
      expect(apiUploadDocument).toHaveBeenCalledTimes(1);
      const [dealId, uploadedFile, docType, title] = apiUploadDocument.mock.calls[0];
      expect(dealId).toBe('deal-1');
      expect(uploadedFile).toBe(file);
      expect(docType).toBe('other');
      expect(title).toBe('Pitch Deck.pdf');
    });

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1);
    });
  });

  it('does not upload and calls onError when org is not selected', async () => {
    const onError = vi.fn();
    const apiUploadDocument = apiClient.apiUploadDocument as MockedFunction<
      typeof apiClient.apiUploadDocument
    >;

    apiUploadDocument.mockResolvedValue({} as any);

    mockAuthState = { isLoaded: true, isSignedIn: true, orgId: null };

    const { container } = render(
      <DocumentUpload
        darkMode={true}
        dealId="deal-1"
        enableAIExtraction={true}
        onError={onError}
      />
    );

    const user = userEvent.setup();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(['hello'], 'Pitch Deck.pdf', { type: 'application/pdf' });
    await user.upload(input as HTMLInputElement, file);

    await waitFor(() => {
      expect(apiUploadDocument).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalled();
    });

    // Reset for other tests.
    mockAuthState = { isLoaded: true, isSignedIn: true, orgId: 'org_test' };
  });
});
