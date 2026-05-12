# Six6 Remediation Package — Implementation Record

**Timestamp**: 2026-04-12T15:37:16Z  
**RCs addressed**: RC-S6-001, RC-S6-002, RC-S6-003, RC-S6-004, RC-S6-013  
**Test suite**: Core 1571 ✅ | Worker 4494 ✅  
**REPORT_COMPILER_VERSION**: 36  

---

## RC-S6-003 — PAI Business Model: "Robot-as-a-Service (RaaS)"

**File**: `apps/api/src/lib/promoted-facts-from-dpu.ts`  
**Root cause**: PAI slides produce `PROMOTE_SLIDE_FACTS_ZERO_FACTS` → DPU fallback path → `inferBusinessModelLabel()` matched `licensingRe` ("licens*") in PAI slide text before checking RaaS patterns.  
**Fix**: Added `raasRe` regex:

```typescript
const raasRe = /\b(robot\s+as\s+a\s+service|raas\b|hardware\s+as\s+a\s+service|haas\b|customers?\s+lease\s+(?:robots?|hardware)|per-?robot\s+fee|equipment\s+leasing)\b/i;
```

Updated label ternary: `hasRaas && !hasB2B2C` → "Robot-as-a-Service (RaaS)" fires before licensing.  
Added `dtcAllowedForFund` guard: suppresses DTC when SPV/fund signals dominate without explicit DTC keyword.  
Updated early-exit: includes `!hasRaas` condition.

---

## RC-S6-002 — Weavstra / Climatic SPV Bleed in Investment Analysis Overview

**File**: `packages/core/src/reports/investment-analysis-overview-v2.ts`  
**Root cause**: `\bspv\b` regex didn't match "SPVs" (plural).  
**Fix**: Changed to `\bspvs?\b|\bspecial\s+purpose\s+vehicles?\b/i`.

---

## RC-S6-001 — Weavstra Business Model: "DTC Ecommerce" (Stale Promoted Fact)

**Two-part fix**:

### Part 1: Worker policy guard (suppresses stale DTC at analysis time)
**File**: `apps/worker/src/jobs/analyze-deal/processor.ts` → `resolvePromotedBusinessModelForPolicy()`

Added Case 2 guard: when `rawText` is empty and `currentDisplay` doesn't contain DTC/ecommerce signals, suppress the stored DTC label as stale:

```typescript
if (!rawText) {
  const currentHasDtc = /\b(dtc\b|d2c\b|direct[\s-]to[\s-]consumer|ecommerce)\b/i.test(currentDisplay);
  if (!currentHasDtc) {
    return { action: "suppress", display: null, reason: "stale_dtc_label_conflicts_with_current_non_dtc_signals" };
  }
}
```

### Part 2: Stale evidence_items deletion on suppress (prevents report compiler from reading stale value)

When `policyResolution.action === "suppress"`, worker now deletes the `evidence_items` record:

```typescript
} else if (policyResolution.action === "suppress") {
  await pool.query(
    `DELETE FROM evidence_items WHERE evidence_id = $1 AND deal_id = $2::uuid`,
    [suppressedEvidenceId, dealId]
  );
}
```

### Part 3: Manual cleanup (immediate fix for current state)

Deleted stale record directly:
```sql
DELETE FROM evidence_items 
WHERE evidence_id = 'deal:fba0138d-2a24-4b99-b50c-ee45dc73caa0:fact:business_model_v1'
  AND deal_id = 'fba0138d-2a24-4b99-b50c-ee45dc73caa0';
```

**Why the stale record matters**: The report compiler's `loadPromotedFactsForDeal()` reads from `evidence_items`. When `business_model_v1` fact exists, `hasModel = true` → DPU fallback is skipped → stale "DTC Ecommerce" persists in report. Deleting the stale record forces the DPU fallback path in the report compiler, which uses `inferBusinessModelLabel()` with correct guards.

---

## RC-S6-013 — Stage Confidence: IDEA → 0.35

**File**: `packages/core/src/models/funding-stage-model.ts`  
**Root cause**: IDEA label was using full 0.6 weight, masking uncertainty.  
**Fix**: IDEA-derived labels get `weight = 0.35` instead of 0.6:

```typescript
const isIdeaDerived = /^idea(?:tion|[-_ ]stage)?$/i.test(rawStr);
const weight = isIdeaDerived ? 0.35 : 0.6;
```

---

## RC-S6-004 — Stage Label: "unknown" for Large-Raise IDEA Deals

**File**: `packages/core/src/reports/compiler-simple.ts`  
**Root cause**: `inferFundingStageModelV1` was called with `structured_summary.raise.value` which was `null` for deals where DIO `deal_overview_v2.sources` lacked page citations (required by `hasPrimaryCitation`). With no raise band signal, IDEA (0.35) was the only signal → `pre_seed` with no conflict.

**Fix**: Added DIO overview/exec raise fallback:

```typescript
const _ssRaiseAmount = parseMoneyLike(structuredSummary?.raise?.value ?? null).amount ?? null;
const _dioOverviewRaise = asNonEmptyString(dio?.dio?.phase1?.deal_overview_v2?.raise) ?? null;
const _dioExecRaise = asNonEmptyString(dio?.dio?.phase1?.executive_summary_v1?.raise) ?? null;
const _dioRaiseStr = _dioOverviewRaise ?? _dioExecRaise;
const _dioRaiseAmount = _dioRaiseStr ? parseMoneyLike(_dioRaiseStr).amount ?? null : null;
const _fundingStageRaiseAmount = _ssRaiseAmount ?? _dioRaiseAmount;

inferFundingStageModelV1({ raise_amount: _fundingStageRaiseAmount, ... })
```

Applied to both `compileDIOToReport` and `compileDIOToReportWithPromotedFacts`.

**Expected conflict resolution** (via softmax01 + 0.15 threshold):
- IDEA (0.35) + $90M raise (growth band 0.4) → softmax delta ≈ 0.015 < 0.15 → `unknown`
- IDEA (0.35) + $25M raise (growth band 0.4) → `unknown`
- IDEA (0.35) alone (no raise) → `pre_seed` conf=0.35 (no conflict)

---

## Cleanup

- Removed `DEBUG_PHASE1_OVERVIEW_V2: "1"` from `docker-compose.dev.yml` (was set for investigation)
- Debug log in `processor.ts` is guarded by `DDAI_DEBUG_POLICY_GUARD === "1"` env var (safe to leave)

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/lib/promoted-facts-from-dpu.ts` | RaaS + fund/SPV guard + dtcKeyword (RC-S6-003, RC-S6-001) |
| `apps/worker/src/jobs/analyze-deal/processor.ts` | Stale DTC guard + DB delete on suppress (RC-S6-001) |
| `packages/core/src/reports/investment-analysis-overview-v2.ts` | SPV plural regex (RC-S6-002) |
| `packages/core/src/models/funding-stage-model.ts` | IDEA weight 0.35 (RC-S6-013, RC-S6-004) |
| `packages/core/src/reports/compiler-simple.ts` | DIO raise fallback for stage inference (RC-S6-004) |
| `apps/api/src/routes/reports.ts` | REPORT_COMPILER_VERSION = 36 |
| `docker-compose.dev.yml` | Removed temporary debug env var |

---

## Test Coverage Added

- `investment-analysis-overview-v2.summary.test.ts`: 4 SPV regression tests
- `promote-slide-facts.test.ts`: 4 RC-S6-003/001 tests
- `funding-stage-model.test.ts`: 6 RC-S6-004/013 tests (20 total)
