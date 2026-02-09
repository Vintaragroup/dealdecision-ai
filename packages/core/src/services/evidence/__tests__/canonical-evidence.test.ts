import {
	computeEvidenceId,
	computePacketId,
	selectEvidenceForPacket,
	type EvidenceItem,
} from "../canonical-evidence";

describe("canonical evidence hashing", () => {
	it("computeEvidenceId is stable for same inputs", () => {
		const a = computeEvidenceId({
			deal_id: "11111111-1111-1111-1111-111111111111",
			source_type: "document",
			source_path: "document:doc1:chunk:0",
			content_text: "Revenue grew\n\n  10%",
			tags: ["document", "text"],
		});
		const b = computeEvidenceId({
			deal_id: "11111111-1111-1111-1111-111111111111",
			source_type: "document",
			source_path: "document:doc1:chunk:0",
			content_text: "Revenue grew\r\n\r\n10%",
			tags: ["text", "document"],
		});
		expect(a).toEqual(b);
	});

	it("packet_id changes when selected ids change", () => {
		const base = {
			deal_id: "11111111-1111-1111-1111-111111111111",
			purpose: "test",
			config: { minConfidence: 0.5, maxItems: 2, preferTags: [], maxOmissions: 10 },
		};
		const p1 = computePacketId({ ...base, selected_ids: ["ev_a", "ev_b"] });
		const p2 = computePacketId({ ...base, selected_ids: ["ev_a", "ev_c"] });
		expect(p1).not.toEqual(p2);
	});
});

describe("canonical evidence selection", () => {
	it("selection is deterministic and stable ordered", () => {
		const items: EvidenceItem[] = [
			{
				evidence_id: "ev_1",
				deal_id: "11111111-1111-1111-1111-111111111111",
				source_type: "document",
				source_path: "doc:a",
				tags: ["financial"],
				confidence: 0.8,
				extracted_at: "2026-01-01T00:00:00.000Z",
				content_text: "A",
				meta: {},
			},
			{
				evidence_id: "ev_2",
				deal_id: "11111111-1111-1111-1111-111111111111",
				source_type: "document",
				source_path: "doc:b",
				tags: ["team"],
				confidence: 0.9,
				extracted_at: "2026-01-02T00:00:00.000Z",
				content_text: "B",
				meta: {},
			},
			{
				evidence_id: "ev_3",
				deal_id: "11111111-1111-1111-1111-111111111111",
				source_type: "document",
				source_path: "doc:c",
				tags: ["other"],
				confidence: 0.4,
				extracted_at: "2026-01-03T00:00:00.000Z",
				content_text: "C",
				meta: {},
			},
		];

		const cfg = { minConfidence: 0.5, maxItems: 2, preferTags: ["financial"], maxOmissions: 10 };
		const r1 = selectEvidenceForPacket(items, cfg);
		const r2 = selectEvidenceForPacket(items, cfg);
		expect(r1.selected.map((x) => x.evidence_id)).toEqual(r2.selected.map((x) => x.evidence_id));
		expect(r1.selected.map((x) => x.evidence_id)).toEqual(["ev_1", "ev_2"]);
		// Ineligible item should appear as omission
		expect(r1.omitted.some((o) => o.evidence_id === "ev_3" && o.reason === "below_min_confidence")).toBe(true);
	});
});
