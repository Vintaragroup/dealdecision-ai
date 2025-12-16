import { test } from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].document_id, "doc-2");
});

test("deriveEvidenceDrafts respects filter term", () => {
  const drafts = deriveEvidenceDrafts(sampleDocs, { filter: "financial" });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].document_id, "doc-2");
});

test("deriveEvidenceDrafts produces structured excerpt", () => {
  const drafts = deriveEvidenceDrafts(sampleDocs);
  const excerpt = drafts[0].excerpt;
  assert.ok(excerpt?.includes("Pitch Deck"));
  assert.ok(excerpt?.includes("status"));
});
