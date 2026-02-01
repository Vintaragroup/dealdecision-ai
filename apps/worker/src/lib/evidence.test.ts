import { expect, test } from "vitest";
import { deriveEvidenceDrafts, type DocumentRecord } from "./evidence";

const sampleDocs: DocumentRecord[] = [
  {
    document_id: "doc-1",
    deal_id: "deal-1",
    title: "Pitch Deck",
    type: "pitch_deck",
    status: "completed",
    uploaded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    document_id: "doc-2",
    deal_id: "deal-1",
    title: "Financials 2024",
    type: "financials",
    status: "processing",
    uploaded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

test("deriveEvidenceDrafts filters excluded document_ids", () => {
  const drafts = deriveEvidenceDrafts(sampleDocs, { excludeDocumentIds: new Set(["doc-1"]) });
  expect(drafts).toHaveLength(1);
  expect(drafts[0].document_id).toBe("doc-2");
});

test("deriveEvidenceDrafts respects filter term", () => {
  const drafts = deriveEvidenceDrafts(sampleDocs, { filter: "financial" });
  expect(drafts).toHaveLength(1);
  expect(drafts[0].document_id).toBe("doc-2");
});

test("deriveEvidenceDrafts produces structured excerpt", () => {
  const drafts = deriveEvidenceDrafts(sampleDocs);
  const excerpt = drafts[0].excerpt;
  expect(excerpt ?? "").toContain("Pitch Deck");
  expect(excerpt ?? "").toContain("status");
});
