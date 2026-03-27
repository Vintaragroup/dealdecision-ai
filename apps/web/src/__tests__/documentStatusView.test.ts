import { describe, expect, it } from 'vitest';
import { getDocumentStatusView, summarizeDocumentStatuses } from '../lib/documentStatusView';

describe('documentStatusView', () => {
  it.each([
    ['ready_for_analysis', 'Analysis Completed', 'completed', true],
    ['completed', 'Analysis Completed', 'completed', true],
    ['processing', 'In Progress', 'in_progress', false],
    ['pending', 'In Progress', 'in_progress', false],
    ['needs_ocr', 'Needs OCR', 'attention', false],
    ['needs_review', 'Needs Review', 'attention', false],
    ['failed', 'Failed', 'attention', false],
    ['rejected', 'Rejected', 'attention', false],
  ] as const)(
    'maps %s to label=%s bucket=%s completed=%s',
    (status, expectedLabel, expectedBucket, expectedCompleted) => {
      const view = getDocumentStatusView(status);
      expect(view.label).toBe(expectedLabel);
      expect(view.bucket).toBe(expectedBucket);
      expect(view.isAnalysisCompleted).toBe(expectedCompleted);
    }
  );

  it('keeps unknown status human readable and non-success', () => {
    const view = getDocumentStatusView('queued_for_scan');
    expect(view.label).toBe('queued for scan');
    expect(view.bucket).toBe('attention');
    expect(view.isAnalysisCompleted).toBe(false);
  });

  it('summarizes mixed statuses with ready_for_analysis and completed as completed bucket', () => {
    const summary = summarizeDocumentStatuses([
      { status: 'ready_for_analysis' },
      { status: 'completed' },
      { status: 'processing' },
      { status: 'pending' },
      { status: 'needs_ocr' },
      { status: 'failed' },
    ]);

    expect(summary.total).toBe(6);
    expect(summary.completed).toBe(2);
    expect(summary.inProgress).toBe(2);
    expect(summary.attention).toBe(2);
  });
});
