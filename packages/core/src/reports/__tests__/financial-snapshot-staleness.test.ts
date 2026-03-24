import { detectFinancialSnapshotStaleness } from '../financial-snapshot-staleness';

// ─── detectFinancialSnapshotStaleness ────────────────────────────────────────

describe('detectFinancialSnapshotStaleness', () => {
  const reportTs = new Date('2026-02-24T23:54:53.720Z');

  test('stale=true when max fact created_at is strictly newer than report', () => {
    const maxFactCreatedAt = new Date('2026-03-12T17:24:41.806Z'); // ~16 days newer
    const result = detectFinancialSnapshotStaleness({ maxFactCreatedAt, reportCreatedAt: reportTs });
    expect(result.stale).toBe(true);
    expect(result.max_fact_ts).toBe(maxFactCreatedAt.toISOString());
    expect(result.report_ts).toBe(reportTs.toISOString());
  });

  test('stale=false when max fact created_at is older than report', () => {
    const maxFactCreatedAt = new Date('2026-02-20T00:00:00.000Z'); // older
    const result = detectFinancialSnapshotStaleness({ maxFactCreatedAt, reportCreatedAt: reportTs });
    expect(result.stale).toBe(false);
  });

  test('stale=false when max fact created_at equals report created_at exactly', () => {
    const result = detectFinancialSnapshotStaleness({
      maxFactCreatedAt: reportTs,
      reportCreatedAt: reportTs,
    });
    expect(result.stale).toBe(false);
  });

  test('stale=false when no facts exist (null maxFactCreatedAt)', () => {
    const result = detectFinancialSnapshotStaleness({ maxFactCreatedAt: null, reportCreatedAt: reportTs });
    expect(result.stale).toBe(false);
    expect(result.max_fact_ts).toBeNull();
    expect(result.report_ts).toBe(reportTs.toISOString());
  });

  test('preserves ISO timestamp strings in output', () => {
    const maxFactCreatedAt = new Date('2026-03-13T16:32:18.670Z');
    const result = detectFinancialSnapshotStaleness({ maxFactCreatedAt, reportCreatedAt: reportTs });
    expect(result.max_fact_ts).toBe('2026-03-13T16:32:18.670Z');
    expect(result.report_ts).toBe('2026-02-24T23:54:53.720Z');
  });

  test('stale=true by 1ms — boundary condition', () => {
    const reportTs2 = new Date('2026-02-24T23:54:53.000Z');
    const maxFactCreatedAt = new Date('2026-02-24T23:54:53.001Z'); // 1ms newer
    const result = detectFinancialSnapshotStaleness({ maxFactCreatedAt, reportCreatedAt: reportTs2 });
    expect(result.stale).toBe(true);
  });
});
