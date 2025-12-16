export type DocumentRecord = {
  document_id: string;
  deal_id: string;
  title: string;
  type: string;
  status: string;
  uploaded_at: string;
  updated_at: string;
};

export type EvidenceDraft = {
  document_id: string;
  source: string;
  kind: string;
  text: string;
  excerpt: string | null;
};

function buildExcerpt(doc: DocumentRecord) {
  const details = [doc.title];
  if (doc.type) details.push(`type: ${doc.type}`);
  details.push(`status: ${doc.status}`);
  return details.join(" • ");
}

export function deriveEvidenceDrafts(
  documents: DocumentRecord[],
  options: { filter?: string; excludeDocumentIds?: Set<string> } = {}
): EvidenceDraft[] {
  const { filter, excludeDocumentIds = new Set<string>() } = options;
  const normalizedFilter = filter?.trim().toLowerCase();

  return documents
    .filter((doc) => !excludeDocumentIds.has(doc.document_id))
    .filter((doc) => {
      if (!normalizedFilter) return true;
      const haystack = `${doc.title} ${doc.type}`.toLowerCase();
      return haystack.includes(normalizedFilter);
    })
    .map((doc) => ({
      document_id: doc.document_id,
      source: "fetch_evidence",
      kind: "document",
      text: `${doc.title} (${doc.type})`,
      excerpt: buildExcerpt(doc),
    }));
}
