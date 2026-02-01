import { describe, expect, it } from 'vitest';

import { formatTableTruncationLabel, getTablePreviewModel } from '../components/deals/tabs/DealAnalystTab';

describe('getTablePreviewModel', () => {
  it('returns null for malformed structured_json', () => {
    expect(getTablePreviewModel(null)).toBeNull();
    expect(getTablePreviewModel({})).toBeNull();
    expect(getTablePreviewModel({ table: {} })).toBeNull();
    expect(getTablePreviewModel({ table: { rows: [] } })).toBeNull();
    expect(getTablePreviewModel({ table: { rows: ["not-a-row"] } })).toBeNull();
  });

  it('pads ragged rows and caps rows/cols', () => {
    const structured = {
      table: {
        rows: [
          ['a', 'b', 'c', 'd'],
          ['e'],
          ['f', null, 123],
        ],
        confidence: 0.72,
        method: 'grid_lines_v1',
        notes: 'ok',
      },
    };

    const model = getTablePreviewModel(structured, { maxRows: 2, maxCols: 3 });
    expect(model).not.toBeNull();
    expect(model?.totalRows).toBe(3);
    expect(model?.totalCols).toBe(4);
    expect(model?.shownRows).toBe(2);
    expect(model?.shownCols).toBe(3);
    expect(model?.truncated).toBe(true);

    expect(model?.rows).toEqual([
      ['a', 'b', 'c'],
      ['e', '', ''],
    ]);

    expect(formatTableTruncationLabel(model!)).toBe(
      'Showing first 2 of 3 rows, first 3 of 4 columns'
    );

    expect(model?.method).toBe('grid_lines_v1');
    expect(model?.confidence).toBeCloseTo(0.72);
    expect(model?.notes).toBe('ok');
  });
});
