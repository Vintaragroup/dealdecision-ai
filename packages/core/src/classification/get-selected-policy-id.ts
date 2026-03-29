export type SelectedPolicyResolutionSource =
  | "selectedPolicyId"
  | "selected_policy"
  | "policy_id"
  | "deal_classification_v1.selected_policy"
  | "dio.deal_classification_v1.selected_policy"
  | "dio.dio.deal_classification_v1.selected_policy"
  | "phase1.deal_classification_v1.selected_policy"
  | "dio.phase1.deal_classification_v1.selected_policy"
  | "deep_search.deal_classification_v1.selected_policy"
  | "not_found";

export type SelectedPolicyResolution = {
  policyId: string | null;
  source: SelectedPolicyResolutionSource;
  usedFallback: boolean;
};

function asNonEmptyPolicy(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

export function resolveSelectedPolicyIdFromAny(dioLike: any): SelectedPolicyResolution {
  // Deterministic priority order for API/web integration payloads.
  const orderedCandidates: Array<{ source: SelectedPolicyResolutionSource; value: unknown }> = [
    // 1) Explicitly passed selectedPolicyId (often passed by web call sites)
    { source: "selectedPolicyId", value: dioLike?.selectedPolicyId },

    // 2) Top-level aliases from mapped API payloads
    { source: "selected_policy", value: dioLike?.selected_policy },
    { source: "policy_id", value: dioLike?.policy_id },

    // 3) Classification object on the current node
    { source: "deal_classification_v1.selected_policy", value: dioLike?.deal_classification_v1?.selected_policy },

    // 4+) Existing nested payload paths observed across DIO/report/envelope shapes
    { source: "dio.deal_classification_v1.selected_policy", value: dioLike?.dio?.deal_classification_v1?.selected_policy },
    { source: "dio.dio.deal_classification_v1.selected_policy", value: dioLike?.dio?.dio?.deal_classification_v1?.selected_policy },
    { source: "phase1.deal_classification_v1.selected_policy", value: dioLike?.phase1?.deal_classification_v1?.selected_policy },
    { source: "dio.phase1.deal_classification_v1.selected_policy", value: dioLike?.dio?.phase1?.deal_classification_v1?.selected_policy },
  ];

  for (const candidate of orderedCandidates) {
    const policyId = asNonEmptyPolicy(candidate.value);
    if (policyId) {
      return {
        policyId,
        source: candidate.source,
        usedFallback: false,
      };
    }
  }

  // Final fallback: deep-search only structured classification path.
  // We intentionally avoid any inference from labels/text/LLM output.
  try {
    const seen = new Set<any>();
    const stack: any[] = [dioLike];

    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (seen.has(cur)) continue;
      seen.add(cur);

      const policyId = asNonEmptyPolicy((cur as any)?.deal_classification_v1?.selected_policy);
      if (policyId) {
        return {
          policyId,
          source: "deep_search.deal_classification_v1.selected_policy",
          usedFallback: true,
        };
      }

      for (const key of Object.keys(cur)) {
        const child = (cur as any)[key];
        if (child && typeof child === "object") stack.push(child);
      }
    }
  } catch {
    // ignore and return not_found
  }

  return {
    policyId: null,
    source: "not_found",
    usedFallback: true,
  };
}

export function getSelectedPolicyIdFromAny(dioLike: any): string | null {
  return resolveSelectedPolicyIdFromAny(dioLike).policyId;
}

// Backward-compatible alias (older call sites/tests may still import this).
export function getSelectedPolicyId(dioLike: any): string | null {
  return getSelectedPolicyIdFromAny(dioLike);
}
