# Stage 5 — Final Memory Runtime Validation

**Date:** 2026-04-01  
**Worker:** `dealdecision-dev-worker_dev-1` (started ~21:43 with current code)  
**Mode:** `DDAI_INTELLIGENCE_ROLLOUT_MODE=full`, `DDAI_INTELLIGENCE_LAYER_ENABLED=1`  
**Purpose:** Gate validation before internal exposure — confirm all 3 memory-influence behaviors in live execution  

---

## Final Memory Runtime Validation

---

### Wiring Check

**PASS**

Both staged runs emitted `intelligence.stage5.started` with both wiring markers present:

```json
{
  "event": "intelligence.stage5.started",
  "deal_id": "b21b894e-4020-46bd-b753-93b2d2d5fa8f",
  "run_id": "29f592e0-8327-4e9f-b30f-25a4c11f3bc0",
  "rollout_mode": "full",
  "has_memory_influence_wiring": true,
  "memory_influence_version": "v1",
  "ts": "2026-04-01T22:05:43.830Z"
}
```

```json
{
  "event": "intelligence.stage5.started",
  "deal_id": "5c85f4f1-e38d-426f-b2ad-40db97f97b27",
  "run_id": "469e8f45-f969-4776-a486-7c1f1cecbcf1",
  "rollout_mode": "full",
  "has_memory_influence_wiring": true,
  "memory_influence_version": "v1",
  "ts": "2026-04-01T22:06:18.028Z"
}
```

Fix 2 confirmed active. Prior stale-process runs (21:28–21:32) did not emit these fields — tsx watch reload at 21:43 loaded the correct code. All runs from 22:05 onward are on current code.

---

### Support Case

**PASS**

| Field | Value |
|-------|-------|
| Deal | Qredible (`b21b894e`) |
| Verdict | CONSIDER |
| ORS | 74 |
| run_id | `29f592e0-8327-4e9f-b30f-25a4c11f3bc0` |
| similar_deal_count | 5 |
| avg_similarity_pct | 69% |
| neighbor_verdict_mix | 3× CONSIDER, 2× NO_GO |
| verdict_agreement_fraction | 0.6 (exactly at ≥60% threshold) |
| memory_support_signal | `true` |
| memory_fragility_signal | `false` |
| confidence_adjustment | `+5` |
| challenge_memory_used | `false` |
| challenge_memory_summary | `null` |

**reason string (DB):**
> "Confidence increased: 3 of 5 nearest similar deals support the current CONSIDER verdict (avg similarity 69%, avg ORS 45)."

**Guards confirmed:**
- Adjustment capped at `+5` (= `MEMORY_MAX_CONFIDENCE_BOOST`) ✅
- ORS not changed ✅
- Verdict not overwritten ✅
- Challenge memory correctly suppressed for support case ✅
- DB persisted: `deal_confidence_assessments.memory_adjustment = 5` ✅

---

### Zero / Restrained Case

**PASS**

| Field | Value |
|-------|-------|
| Deal | Delphi (`5c85f4f1`) |
| Verdict | NO_GO |
| ORS | 14 |
| run_id | `469e8f45-f969-4776-a486-7c1f1cecbcf1` |
| similar_deal_count | 5 |
| confidence_adjustment | `0` |
| memory_support_signal | `false` |
| memory_fragility_signal | `false` |
| challenge_memory_used | `false` |
| challenge_memory_summary | `null` |

**reason string (DB) — Fix 1 confirmed:**
> "No memory confidence adjustment: current verdict is NO_GO, and memory influence is only applied to positive verdicts (GO or CONSIDER)."

**Guards confirmed:**
- No misleading "inconclusive" fallback ✅ (Fix 1 eliminates false fallthrough)  
- Reason explicitly cites non-positive verdict as the constraint ✅  
- Zero adjustment correctly persisted ✅  
- No challenge memory usage ✅  

**Prior run (21:28, stale worker) for comparison:**
> "No memory confidence adjustment: neighbor verdict mix is inconclusive (40% agreement, threshold 60%)."

That stale string no longer appears in runs from 22:05 onward.

---

### Fragility Case

**PASS (via deterministic e2e test — live pool does not produce this case)**

The live 7-deal memory pool contains 4 CONSIDER deals (ORS 52–74) and 3 NO_GO deals (ORS 14–28). The structural gap between these clusters means no CONSIDER deal's top-5 neighbors are dominated by NO_GO profiles. Fragility cannot fire naturally in the current dev pool. This is a known pool topology limitation, not a code defect.

**Fragility code path validated via deterministic e2e test suite:**

- Test file: `apps/worker/src/lib/intelligence/__tests__/decision-memory-fragility-e2e.test.ts`
- Test count: 15 tests across 5 groups (E1–E5)
- Run: 2026-04-01, all passing (total: 4019/4019 tests)
- Chain exercised: `deriveMemoryInfluence → computeConfidence → runChallengePass`
- Pool: 4× NO_GO neighbors (ORS 15–22, similarity 75–82%) + 1× CONSIDER vs CONSIDER current verdict

**Assertions confirmed by test:**

| Field | Expected | Confirmed |
|-------|----------|-----------|
| memory_fragility_signal | `true` | ✅ |
| memory_support_signal | `false` | ✅ |
| confidence_adjustment | `−10` | ✅ |
| memory_adjustment_reason | matches `/confidence reduced/i` | ✅ |
| challenge_memory_used | `true` | ✅ |
| challenge_memory_summary | non-null, matches `/NO_GO/i` and `/structural similarity/i` | ✅ |
| opposing_case_summary | contains `\n\nMemory signal:` prefix | ✅ |
| summary outcome claim | no `/confirmed failure|known outcome/i` | ✅ |
| verdictAgreementFraction | ~0.2 (1/5 CONSIDER) | ✅ |

---

### Persistence Check

**PASS**

Both runs persisted correctly to both target tables.

**`deal_confidence_assessments`**

| deal_id | run_id | memory_adjustment | memory_adjustment_reason (truncated) |
|---------|--------|-------------------|--------------------------------------|
| `b21b894e` | `29f592e0` | `+5` | "Confidence increased: 3 of 5 nearest…" |
| `5c85f4f1` | `469e8f45` | `0` | "…only applied to positive verdicts…" |

**`deal_challenge_pass_results`**

| deal_id | run_id | memory_challenge_used | memory_challenge_summary |
|---------|--------|----------------------|--------------------------|
| `b21b894e` | `29f592e0` | `false` | `null` |
| `5c85f4f1` | `469e8f45` | `false` | `null` |

Fragility table persistence verified via e2e test (no live run available).

---

### Safety Check

**PASS**

| Check | Result |
|-------|--------|
| stage5.failed events in past 20 min | 0 |
| Jobs completed | 2/2 |
| Stage 5 blocking the pipeline | No (both jobs completed normally) |
| Pipeline regression | None observed |
| Main report generation | Succeeded for both deals |

---

## Final Verdict

**READY FOR INTERNAL EXPOSURE**

All gateable behaviors verified:
1. Wiring markers present in `stage5.started` — stale-process detection now possible ✅
2. Support signal fires and persists correctly (+5, bounded) ✅
3. NO_GO verdict guard fires with targeted reason string, not misleading fallback ✅
4. Fragility code path fully validated via deterministic e2e test suite ✅
5. DB persistence correct across both tested tables ✅
6. Stage 5 remains non-blocking, no regressions ✅

---

## Remaining Risks

1. **Fragility has never fired in live execution.** The dev pool (7 deals, ORS range 14–74) does not produce the fragility topology. A CONSIDER deal with ORS around 30–45 whose neighbors include 3+ NO_GO deals would provide the first live fragility data point. This is the highest-priority gap for the next validation iteration.

2. **`avg_similarity_pct = 0` in `intelligence.memory.influence` log for NO_GO deals.** When the non-positive verdict guard fires, `noInfluence()` returns `avg_similarity_pct: 0` even though the pool had 5 valid neighbors. The log event accurately reflects the suppressed influence output but may mislead a log reader into thinking the similarity computation was skipped. The DB reason string is unambiguous. Low priority to fix since the guard fires correctly; worth a cleanup note.

3. **Single-org, single-sector pool.** All 7 memory entries are `org_id = NULL`, `sector = Unknown`. The org-scoped similarity path (`WHERE org_id = $1`) is untested at runtime. Production behavior with multi-org data requires a separate validation pass.
