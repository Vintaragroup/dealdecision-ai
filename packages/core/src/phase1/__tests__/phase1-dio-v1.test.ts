import { generatePhase1DIOV1 } from "../phase1-dio-v1";

describe("generatePhase1DIOV1 (Phase 1 UI-usability)", () => {
	it("always produces executive_summary_v1 and claims with evidence snippets", () => {
		const out = generatePhase1DIOV1({
			deal: { deal_id: "deal-1", name: "Acme", stage: "intake" },
			inputDocuments: [
				{
					document_id: "doc-1",
					title: "Acme Deck",
					type: "pitch_deck",
					full_text:
						"We are building a SaaS platform for independent retail brands. Target customers: specialty DTC teams. Raising $1.5M seed. Current revenue: $25k MRR with 40 customers.",
				},
			],
		});

		expect(out.executive_summary_v1).toBeTruthy();
		expect(typeof out.executive_summary_v1.title).toBe("string");
		expect(typeof out.executive_summary_v1.one_liner).toBe("string");
		expect(out.executive_summary_v1.one_liner.trim().length).toBeGreaterThan(0);
		expect(out.executive_summary_v1.one_liner).not.toMatch(/No description provided/i);
		expect(Array.isArray(out.executive_summary_v1.unknowns)).toBe(true);

		expect(out.decision_summary_v1).toBeTruthy();
		expect(typeof out.decision_summary_v1.score).toBe("number");
		expect(out.decision_summary_v1.score).toBeGreaterThanOrEqual(0);
		expect(out.decision_summary_v1.score).toBeLessThanOrEqual(100);
		expect(["PASS", "CONSIDER", "GO"]).toContain(out.decision_summary_v1.recommendation);
		expect(Array.isArray(out.decision_summary_v1.reasons)).toBe(true);

		expect(Array.isArray(out.claims)).toBe(true);
		expect(out.claims.length).toBeGreaterThan(0);
		for (const c of out.claims) {
			expect(Array.isArray(c.evidence)).toBe(true);
			expect(c.evidence.length).toBeGreaterThan(0);
			expect(typeof c.evidence[0].snippet).toBe("string");
			expect(c.evidence[0].snippet.trim().length).toBeGreaterThan(0);
		}
	});
});
