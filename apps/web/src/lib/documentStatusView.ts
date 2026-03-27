import type { DocumentStatus } from '@dealdecision/contracts';

export type DocumentStatusBucket = 'completed' | 'in_progress' | 'attention';
export type DocumentStatusTone = 'success' | 'warning' | 'danger' | 'neutral';

export type DocumentStatusView = {
  raw: string;
  label: string;
  bucket: DocumentStatusBucket;
  tone: DocumentStatusTone;
  isAnalysisCompleted: boolean;
};

export function getDocumentStatusView(status?: DocumentStatus | string | null): DocumentStatusView {
  const raw = typeof status === 'string' ? status : '';

  if (raw === 'ready_for_analysis' || raw === 'completed') {
    return {
      raw,
      label: 'Analysis Completed',
      bucket: 'completed',
      tone: 'success',
      isAnalysisCompleted: true,
    };
  }

  if (raw === 'pending' || raw === 'processing') {
    return {
      raw,
      label: 'In Progress',
      bucket: 'in_progress',
      tone: 'warning',
      isAnalysisCompleted: false,
    };
  }

  if (raw === 'needs_ocr') {
    return {
      raw,
      label: 'Needs OCR',
      bucket: 'attention',
      tone: 'warning',
      isAnalysisCompleted: false,
    };
  }

  if (raw === 'needs_review') {
    return {
      raw,
      label: 'Needs Review',
      bucket: 'attention',
      tone: 'warning',
      isAnalysisCompleted: false,
    };
  }

  if (raw === 'failed') {
    return {
      raw,
      label: 'Failed',
      bucket: 'attention',
      tone: 'danger',
      isAnalysisCompleted: false,
    };
  }

  if (raw === 'rejected') {
    return {
      raw,
      label: 'Rejected',
      bucket: 'attention',
      tone: 'danger',
      isAnalysisCompleted: false,
    };
  }

  return {
    raw,
    label: raw ? raw.replace(/_/g, ' ') : 'Unknown',
    bucket: 'attention',
    tone: 'neutral',
    isAnalysisCompleted: false,
  };
}

export function summarizeDocumentStatuses(
  documents: ReadonlyArray<{ status?: DocumentStatus | string | null }>
): {
  total: number;
  completed: number;
  inProgress: number;
  attention: number;
} {
  let completed = 0;
  let inProgress = 0;
  let attention = 0;

  for (const document of documents) {
    const view = getDocumentStatusView(document.status);
    if (view.bucket === 'completed') {
      completed += 1;
      continue;
    }
    if (view.bucket === 'in_progress') {
      inProgress += 1;
      continue;
    }
    attention += 1;
  }

  return {
    total: documents.length,
    completed,
    inProgress,
    attention,
  };
}
