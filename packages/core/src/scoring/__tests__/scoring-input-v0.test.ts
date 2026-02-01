import { buildDealScoringInputV0FromLineage } from "../scoring-input-v0";

describe("buildDealScoringInputV0FromLineage", () => {
  it("maps visual asset-like nodes into scoring items with locators", () => {
    const res = buildDealScoringInputV0FromLineage({
      deal_id: "d1",
      warnings: ["w"],
      nodes: [
        {
          id: "visual_asset:va1",
          node_id: "visual_asset:va1",
          node_type: "VISUAL_ASSET",
          label: "Page 1",
          data: {
            document_id: "doc1",
            page_index: 0,
            image_uri: "/api/assets/x.png",
            ocr_text_snippet: "hello",
            confidence: 0.7,
            quality_flags: { source: "vision_v1" },
            evidence_snippets: ["snip"],
          },
        },
        {
          id: "document:doc1",
          node_type: "DOCUMENT",
          label: "Deck",
          data: { document_id: "doc1", title: "Deck" },
        },
      ],
    } as any);

    expect(res.deal_id).toBe("d1");
    expect(res.items.length).toBe(2);

    const va = res.items.find((i) => i.id === "visual_asset:va1")!;
    expect(va.kind).toBe("image");
    expect(va.source).toBe("ocr");
    expect(va.document_id).toBe("doc1");
    expect(va.page_index).toBe(0);
    expect(va.text).toBe("hello");
    expect(va.locators[0].document_id).toBe("doc1");
    expect(va.locators[0].image_uri).toBe("/api/assets/x.png");

    const doc = res.items.find((i) => i.id === "document:doc1")!;
    expect(doc.kind).toBe("document");
    expect(doc.title).toBe("Deck");
  });
});
