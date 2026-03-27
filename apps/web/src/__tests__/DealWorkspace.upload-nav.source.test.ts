import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('DealWorkspace upload nav wiring (source guards)', () => {
  const source = readFileSync(
    resolve(__dirname, '../components/pages/DealWorkspace.tsx'),
    'utf8'
  );

  it('includes Documents in primary tabs and excludes it from More tabs', () => {
    const primarySliceStart = source.indexOf('const primaryTabs = [');
    const moreSliceStart = source.indexOf('const moreTabs = [');
    expect(primarySliceStart).toBeGreaterThan(-1);
    expect(moreSliceStart).toBeGreaterThan(-1);

    const primarySlice = source.slice(primarySliceStart, moreSliceStart);
    const moreSlice = source.slice(moreSliceStart, source.indexOf('];', moreSliceStart) + 2);

    expect(primarySlice).toContain("{ id: 'documents', label: 'Documents'");
    expect(moreSlice).not.toContain("{ id: 'documents', label: 'Documents'");
  });

  it('routes both upload entry points to the upload modal', () => {
    expect(source).toContain("onUploadDocument={() => setShowUploadDocModal(true)}");
    expect(source).toContain('setShowUploadDocModal(true);');
  });
});
