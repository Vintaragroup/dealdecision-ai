export function getSelectedPolicyIdFromAny(dioLike: any): string | null {
  const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

  // IMPORTANT: ordered lookup to handle nesting drift across persisted DIOs and in-flight DIO-like objects.
  const candidates: unknown[] = [
    // 1) Persisted DIO canonical shape (observed in Postgres): dio_data.dio.deal_classification_v1.selected_policy
    dioLike?.dio?.deal_classification_v1?.selected_policy,

    // 2) In-flight analyzer input / older DIO-like shape
    dioLike?.deal_classification_v1?.selected_policy,

    // 3) Legacy drift
    dioLike?.dio?.dio?.deal_classification_v1?.selected_policy,

    // 4) Phase 1 mirrors
    dioLike?.phase1?.deal_classification_v1?.selected_policy,

    // 5) Nested phase1 mirrors
    dioLike?.dio?.phase1?.deal_classification_v1?.selected_policy,
  ];

  for (const c of candidates) {
    if (isNonEmptyString(c)) return c.trim();
  }

  // Fallback: deep search for deal_classification_v1.selected_policy anywhere in the object.
  // This protects against unexpected nesting drift (e.g., wrappers like { dio: { dio: ... } } or other containers).
  try {
    const seen = new Set<any>();
    const stack: any[] = [dioLike];

    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (seen.has(cur)) continue;
      seen.add(cur);

      const v = (cur as any)?.deal_classification_v1?.selected_policy;
      if (isNonEmptyString(v)) return v.trim();

      // push children
      for (const key of Object.keys(cur)) {
        const child = (cur as any)[key];
        if (child && typeof child === "object") stack.push(child);
      }
    }
  } catch {
    // ignore and fall through
  }

  return null;
}

// Backward-compatible alias (older call sites/tests may still import this).
export function getSelectedPolicyId(dioLike: any): string | null {
  return getSelectedPolicyIdFromAny(dioLike);
}
