// packages/core/src/evidence/evidence-ref.ts

export type EvidenceRef = {
  source_document_id: string;
  page_index: number | null;
  slide_title?: string | null;

  // optional but very useful
  snippet?: string | null;
  evidence_id?: string;
};