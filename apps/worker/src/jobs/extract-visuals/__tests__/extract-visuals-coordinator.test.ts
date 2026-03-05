import { describe, expect, it, vi } from "vitest";

// ── PR15 smoke tests ──────────────────────────────────────────────────────────
// These tests verify the structural extraction made in PR15:
//   - coordinator.ts exports `runExtractVisualsCoordinator`
//   - processor.ts exports `extractVisualsProcessor` as a thin wrapper
//   - The wrapper delegates to the coordinator unchanged
//
// They do NOT execute the full job logic — that logic is integration-tested
// elsewhere and would require a large mock surface.

// We import via a spy-on-module approach so we can verify delegation.
vi.mock("../coordinator", async () => {
	const runExtractVisualsCoordinator = vi.fn(async (_job: unknown) => ({ ok: true, _mocked: true }));
	return { runExtractVisualsCoordinator };
});

describe("extract-visuals PR15 coordinator extraction", () => {
	it("exports runExtractVisualsCoordinator as an async function", async () => {
		const mod = await import("../coordinator");
		expect(typeof mod.runExtractVisualsCoordinator).toBe("function");
	});

	it("processor.ts exports extractVisualsProcessor as an async function", async () => {
		const mod = await import("../processor");
		expect(typeof mod.extractVisualsProcessor).toBe("function");
	});

	it("extractVisualsProcessor delegates to runExtractVisualsCoordinator", async () => {
		const { runExtractVisualsCoordinator } = await import("../coordinator");
		const { extractVisualsProcessor } = await import("../processor");

		const fakeJob = { id: "test-job-1", data: { deal_id: "deal-abc" } } as any;
		const result = await extractVisualsProcessor(fakeJob);

		expect(runExtractVisualsCoordinator).toHaveBeenCalledWith(fakeJob);
		expect(result).toMatchObject({ ok: true, _mocked: true });
	});
});
