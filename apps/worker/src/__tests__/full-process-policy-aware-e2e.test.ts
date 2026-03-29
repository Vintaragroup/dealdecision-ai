import { describe, expect, it, vi } from "vitest";

import { maybeEnqueueAnalyzeDealGuarantee } from "../lib/analyze-deal-guarantee";
import {
  composePolicyAwareSystemPrompt,
  validatePolicyAwareOutputTemplateV2,
} from "../lib/policy-aware-prompt-runtime";

/**
 * Lightweight end-to-end guard across the full-process handoff boundary:
 * extract finalize prerequisites -> analyze enqueue -> policy-aware output contract check.
 */
describe("full-process policy-aware e2e", () => {
  it("reaches analyze enqueue and emits template-compliant policy-aware output", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            active_analyze_status: null,
            total_docs: 2,
            unfinalized_visual_docs: 0,
          },
        ],
      })),
    } as any;

    const logs: string[] = [];
    const logger = {
      log: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
    } as any;

    const enqueueCallback = vi.fn(async () => ({ enqueued: true, jobId: "job-analyze-1" }));

    const handoff = await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "deal-e2e-001",
      trigger: "extract_visuals_finalize",
      pool,
      logger,
      enqueueCallback,
    });

    expect(handoff.action).toBe("enqueued");
    expect(enqueueCallback).toHaveBeenCalledTimes(1);

    const composed = composePolicyAwareSystemPrompt({
      kind: "governed_ui_copy_v1",
      selectedPolicyId: "operating_startup_revenue_v1",
    });

    const outputValidation = validatePolicyAwareOutputTemplateV2({
      kind: "governed_ui_copy_v1",
      selectedPolicyId: composed.runtimeMetadata.selected_policy_id,
      output: {
        hero_summary: "The company sells workflow software to SMB finance teams and monetizes through recurring subscriptions.",
        product_solution: "It automates receivables reconciliation and cash forecasting for small finance teams.",
        market_icp: "The ICP is US-based SMBs with lean accounting teams and high invoicing volume.",
        business_model: "Revenue is generated via monthly SaaS subscriptions with tiered seat pricing.",
        raise_terms: "Raising capital to accelerate GTM and product expansion.",
      },
    });

    expect(outputValidation.ok).toBe(true);
    expect(outputValidation.degraded).toBe(false);
  });
});
