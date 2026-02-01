import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/apiClient', () => {
  return {
    apiGetRenderedPageSignedUrl: vi.fn(),
    resolveApiAssetUrl: vi.fn((s: string | null) => (typeof s === 'string' ? s : null)),
  };
});

import { apiGetRenderedPageSignedUrl } from '../lib/apiClient';
import { getPageSnapshotUrl } from '../lib/pageSnapshots';

describe('getPageSnapshotUrl', () => {
  it('prefers rendered_pages_r2 via signed-url endpoint', async () => {
    (apiGetRenderedPageSignedUrl as any).mockResolvedValue({ url: 'https://signed.example/page_0000.png' });

    const url = await getPageSnapshotUrl({
      dealId: 'deal-1',
      document: {
        deal_id: 'deal-1',
        document_id: 'doc-1',
        extraction_metadata: {
          rendered_pages_r2: { bucket: 'b', prefix: 'deals/deal-1/documents/doc-1/rendered_pages', format: 'page_%04d.png' },
        },
      },
      pageIndex: 0,
      visualAsset: { image_uri: '/uploads/rendered_pages/doc-1/page_0000.png' } as any,
    });

    expect(apiGetRenderedPageSignedUrl).toHaveBeenCalledWith('deal-1', 'doc-1', 0);
    expect(url).toBe('https://signed.example/page_0000.png');
  });

  it('falls back to visualAsset.image_uri when signed url fails', async () => {
    (apiGetRenderedPageSignedUrl as any).mockRejectedValue(new Error('boom'));

    const url = await getPageSnapshotUrl({
      dealId: 'deal-1',
      document: {
        deal_id: 'deal-1',
        document_id: 'doc-1',
        extraction_metadata: {
          rendered_pages_r2: { bucket: 'b', prefix: 'deals/deal-1/documents/doc-1/rendered_pages', format: 'page_%04d.png' },
        },
      },
      pageIndex: 1,
      visualAsset: { image_uri: '/uploads/rendered_pages/doc-1/page_0001.png' } as any,
    });

    expect(url).toBe('/uploads/rendered_pages/doc-1/page_0001.png');
  });

  it('builds from legacy rendered_pages_url_prefix when present', async () => {
    const url = await getPageSnapshotUrl({
      dealId: 'deal-1',
      document: {
        deal_id: 'deal-1',
        document_id: 'doc-1',
        extraction_metadata: {
          rendered_pages_url_prefix: '/uploads/rendered_pages/doc-1',
        },
      },
      pageIndex: 2,
      visualAsset: null,
    });

    expect(url).toBe('/uploads/rendered_pages/doc-1/page_0002.png');
  });
});
