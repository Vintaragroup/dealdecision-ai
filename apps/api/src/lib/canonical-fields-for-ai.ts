/**
 * canonical-fields-for-ai.ts
 *
 * Server-side raise_amount resolution applied before canonical_fields are
 * injected into LLM prompts by the AI Analysis endpoints in deals.ts.
 *
 * Mirrors the 3 rules in
 *   apps/worker/src/jobs/investor-insights/resolve-raise-amount.ts
 * but operates on already-resolved string values rather than raw candidates
 * with source text, so only Rules 1 and 3 can be applied (Rule 2 requires
 * surrounding context that is unavailable at the API layer).
 *
 *  Rule 1 – raise_terms OVERRIDE
 *    If raise_terms_raw is provided and stage is early-stage (IDEA / pre-seed /
 *    seed / unknown), extract the money token and use it as raise_amount.
 *
 *  Rule 2 – market-context taint (NOT re-applicable at API layer)
 *    Applied upstream in the worker during deck extraction. The API has no
 *    access to the surrounding deck text, so this check cannot be repeated here.
 *
 *  Rule 3 – magnitude sanity
 *    For early-stage deals, if canonical_fields.raise_amount is >= $100M and no
 *    raise_terms override was applied, null the value out.  The original context
 *    text is unavailable here so the strong-verb exemption cannot be evaluated;
 *    conservative rejection is preferred.
 *
 * Usage (deal-terms endpoint):
 *
 *   const { canonical_fields } = getCanonicalFieldsForAI({
 *     canonical_fields: rawFields,
 *     raise_terms_raw,   // from insight_slots section (raise_terms value)
 *     stage,             // from canonical_fields section (stage field)
 *   });
 *   // use resolved canonical_fields for fieldLines → LLM prompt
 */

// ─── Stage constants (mirrors EARLY_STAGE_SET in resolve-raise-amount.ts) ────

const EARLY_STAGE_SET = new Set([
  "IDEA", "idea",
  "pre-seed", "Pre-Seed", "PRE_SEED",
  "seed", "Seed", "SEED",
  "Unknown", "unknown", "UNKNOWN",
]);

/** >= this threshold (millions) triggers magnitude rejection for early-stage. */
const MAGNITUDE_THRESHOLD_M = 100;

// ─── Regexes ──────────────────────────────────────────────────────────────────

/**
 * Matches the leading money token in a raise_terms string
 * (e.g. "$25K" from "$25K Pre-Seed").
 * Matches: currency symbol, number, optional multiplier suffix.
 * Does NOT match bare numbers without a currency symbol.
 */
const MONEY_TOKEN_RE =
  /[€£$]\s*\d[\d,.]*(?:\.\d+)?\s*(?:MM|BB|[TMBKtmbk]|trillion|billion|million|thousand)?(?!\d)/i;

/**
 * Parses a money string to extract the numeric component and multiplier suffix,
 * for arithmetic comparison against MAGNITUDE_THRESHOLD_M.
 */
const MONEY_PARSE_RE =
  /(?:[€£$]|USD|EUR|GBP)?\s*(\d[\d,]*(?:\.\d+)?)\s*(MM|BB|trillion|billion|million|thousand|T|B|M|K|t|b|m|k)?\b/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEarlyStage(stage: string | null | undefined): boolean {
  if (stage == null) return true; // null / undefined → treated as early-stage
  return EARLY_STAGE_SET.has(stage);
}

function parseMoneyToMillions(text: string): number | null {
  if (!text || typeof text !== "string") return null;
  const m = MONEY_PARSE_RE.exec(text);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const suffix = (m[2] ?? "").toLowerCase();
  const multiplier: Record<string, number> = {
    t: 1_000_000, trillion: 1_000_000,
    b: 1_000,     bb: 1_000,     billion:  1_000,
    m: 1,         mm: 1,         million:  1,
    k: 0.001,                    thousand: 0.001,
  };
  return num * (multiplier[suffix] ?? 1);
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type CanonicalFieldsResolutionSource =
  | "raise_terms_override"
  | "canonical"
  | "magnitude_rejected"
  | "none";

export type CanonicalFieldsForAIDiagnostics = {
  raise_amount_resolution: {
    source: CanonicalFieldsResolutionSource;
    original_value: string | null;
    resolved_value: string | null;
    reason: string | null;
  };
};

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Apply raise_amount resolution rules before building an LLM prompt.
 *
 * @param canonical_fields  The flat field dict from the client (may still have
 *                          a market-tainted raise_amount value such as "$11B").
 * @param raise_terms_raw   Optional string from the insight_slots `raise_terms`
 *                          slot (e.g. "$25K Pre-Seed"). Provided by the client
 *                          from the render_package insight_slots section.
 * @param stage             Optional stage label from canonical_fields.stage.
 *                          When null / undefined is treated as early-stage.
 */
export function getCanonicalFieldsForAI({
  canonical_fields,
  raise_terms_raw,
  stage,
}: {
  canonical_fields: Record<string, string | null>;
  raise_terms_raw?: string | null;
  stage?: string | null;
}): {
  canonical_fields: Record<string, string | null>;
  diagnostics: CanonicalFieldsForAIDiagnostics;
} {
  const original = canonical_fields.raise_amount ?? null;
  const earlyStage = isEarlyStage(stage);

  // ── Rule 1: raise_terms override for early-stage deals ───────────────────
  if (raise_terms_raw && typeof raise_terms_raw === "string" && earlyStage) {
    const tokenMatch = MONEY_TOKEN_RE.exec(raise_terms_raw);
    // Normalise: strip internal whitespace, uppercase the suffix (e.g. "$25k" → "$25K")
    const moneyToken = tokenMatch
      ? tokenMatch[0].replace(/\s+/g, "").replace(/[kmbt]$/i, (s) => s.toUpperCase())
      : null;

    if (moneyToken) {
      return {
        canonical_fields: { ...canonical_fields, raise_amount: moneyToken },
        diagnostics: {
          raise_amount_resolution: {
            source: "raise_terms_override",
            original_value: original,
            resolved_value: moneyToken,
            reason: `raise_terms_raw "${raise_terms_raw}" supplied for early-stage deal`,
          },
        },
      };
    }
  }

  // ── Rule 3: magnitude sanity for early-stage deals ───────────────────────
  // (Rule 2 is inapplicable — surrounding deck text is unavailable at API layer)
  if (earlyStage && original) {
    const amountM = parseMoneyToMillions(original);
    if (amountM !== null && amountM >= MAGNITUDE_THRESHOLD_M) {
      return {
        canonical_fields: { ...canonical_fields, raise_amount: null },
        diagnostics: {
          raise_amount_resolution: {
            source: "magnitude_rejected",
            original_value: original,
            resolved_value: null,
            reason:
              `raise_amount "${original}" (${amountM}M) >= ${MAGNITUDE_THRESHOLD_M}M ` +
              `for early-stage deal with no raise_terms override; conservative rejection applied`,
          },
        },
      };
    }
  }

  // ── Pass-through: no override required ───────────────────────────────────
  return {
    canonical_fields,
    diagnostics: {
      raise_amount_resolution: {
        source: original ? "canonical" : "none",
        original_value: original,
        resolved_value: original,
        reason: null,
      },
    },
  };
}
