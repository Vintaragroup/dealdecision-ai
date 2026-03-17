# Overview Signal & Snapshot Fact Semantics

_Architecture reference for Deal Workspace Overview signals and KPI snapshot facts._

---

## 1. Signal Cards: Title vs. Description

### Problem (resolved)

`buildSignalCards` previously set `description = title` — the same string appeared in both
fields. The UI renders the title as the signal heading and the description (mapped to
`explanation`) as the supporting paragraph beneath the progress bar. Duplicate text gives the
investor no additional context.

### Fixed semantics

| Signal field | Content | Source |
|---|---|---|
| `title` | The natural-language observation (e.g. "Strong product-market fit") | `scoreExplanationV1.primary_strengths` / `primary_constraints` |
| `description` | Evidence-context framing based on **type × band** | `_DESCRIPTION_CONTEXT` in `buildSignalCards.ts` |

### Description copy by band × type

| Band | Strength | Concern |
|---|---|---|
| `high` | "Supporting evidence found across submitted materials." | "Flagged during diligence review." |
| `med` | "Partially supported by available evidence." | "Area of potential concern — evidence is partial." |
| `low` | "Identified strength — evidence is limited." | "Risk area — limited evidence to fully assess." |
| `unknown` | "Identified strength — evidence not yet assessed." | "Risk area — evidence not yet assessed." |

`description` propagates to `WorkspaceOverviewSignal.explanation` via `toOverviewSignalData`.

---

## 2. Signal Data Flow

```
scoreExplanationV1
  .primary_strengths[]    ─┐
  .primary_constraints[]  ─┤─→ filterMismatchedScoreItems
                            │
                            ▼
                     filteredStrengths / filteredWeaknesses
                            │
                            ▼
                     buildSignalCards(strengths, weaknesses, band)
                            │   → WorkspaceSignalCard[]
                            │       .title   = natural-language string
                            │       .description = evidence-context copy
                            │
                            ▼
                     toOverviewSignalData(cards, band)
                            │   → WorkspaceOverviewSignal[]
                            │       .name        = card.title
                            │       .explanation = card.description  ← DISTINCT
                            │       .score       = placement score
                            │       .confidence  = evidence label
                            ▼
                     vm.overview.signalData  →  DealOverviewTab
```

---

## 3. Snapshot Fact Precedence

KPI tiles in the Overview are governed by a multi-source fallback chain. Each field is
resolved in priority order; the first truthy, displayable value wins.

### ARR (revenue)

```
selectedHeader.revenue.value
  ← phase1:  overviewV2?.revenue   (AI-extracted)
  ← report:  reportFromApi header  (structured KPI)
  gated by:  revenueAllowed (permission flag)
```

### Growth

```
reportStructuredGrowthValue  (reportStructuredKpis?.growth — highest priority)
  └─ prefers .percent field, falls back to .raw
growthValue  (selectedHeader.growth.value)
  ← phase1:  overviewV2?.growth
  ← report:  reportFromApi header
```

### Customers

```
selectedHeader.customers.value
  ← phase1:  overviewV2?.customers
  ← report:  reportFromApi header
```

### Raise

```
selectedHeader.raise.value
  ← reportFromApi header
  governed by: chooseGovernedKeyFact (overlay can override)
```

### TAM (market size)

```
overviewV2?.market_size ?? overviewV2?.tam ?? null
→ displays "—" when absent
```

### Business Model

```
selectedHeader.business_model.value
  || authoritativeBusinessModel.value
  || workspaceOverviewModel.keyFacts.business_model.value
```

---

## 4. Core Deal Facts (governedKeyFacts)

The four narrative fact cards (Product, Market, Business Model, Raise) are resolved via
`chooseGovernedKeyFact()` with a deterministic/overlay priority:

| Fact | Deterministic source | Overlay source | Prefers deterministic when |
|---|---|---|---|
| Product | `overviewProductCanonical` | `ovFacts.product_solution` | `authoritativeProductTextV1` is set |
| Market | `overviewMarketIcpCanonical` | `ovFacts.market_icp` | `authoritativeMarketTextV1` is set |
| Business Model | `overviewBusinessModelCanonical` | `ovFacts.business_model` | `selectedHeader.ready` |
| Raise | `overviewRaiseTermsCanonical` | `ovFacts.raise` | `selectedHeader.ready` |

`needsReview` badges on overlay facts are suppressed when the report evidence gate blocked
LLM stages (`shouldSuppressNeedsReview`).

---

## 5. Confidence Band → Evidence Labels

The overall `confidenceBand` (`high | med | low | unknown`) is derived from
`scoreExplanationV1.confidence_band` and controls:

- **Signal confidence label** (`WorkspaceOverviewSignal.confidence`):
  - Strength cards: `high→Strong Evidence`, `med→Partial Evidence`, `low/unknown→Limited Evidence`
  - Concern cards: `high/med→Partial Evidence`, `low/unknown→Limited Evidence`
- **Signal description copy** (see §1 table above)
- **Signal placement scores**:
  - Strengths cluster `85 → 60` (decrement 5 per card)
  - Concerns cluster `50 → 20` (decrement 5 per card)

---

## 6. Key Files

| File | Role |
|---|---|
| `apps/web/src/components/workspace/builders/buildSignalCards.ts` | Builds signal cards + maps to overview signal data |
| `apps/web/src/components/workspace/builders/buildWorkspaceViewModel.ts` | Orchestrates all KPI tiles, snapshot facts, signals |
| `apps/web/src/components/workspace/contracts/workspaceViewModel.ts` | Type contracts for `WorkspaceSignalCard`, `WorkspaceOverviewSignal` |
| `apps/web/src/components/workspace/DealOverviewTab.tsx` | Renders signals and fact cards |
| `apps/web/src/lib/__tests__/buildWorkspaceViewModel.test.ts` | 58 tests covering KPI chain, signal semantics, confidence labels |
