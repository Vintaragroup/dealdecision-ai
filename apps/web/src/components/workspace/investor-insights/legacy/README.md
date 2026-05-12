# investor-insights/legacy — PRODUCTION LIVE

> **Do NOT delete or refactor this directory without a dedicated migration task.**

## Status

**Production-live.** Every component in this directory is actively imported by `InvestorInsightsTab.tsx`.

## Imported files

| File | Imported by |
|------|-------------|
| `ExecutivePulse.tsx` | `InvestorInsightsTab.tsx` |
| `IntelligenceGrid.tsx` | `InvestorInsightsTab.tsx` |
| `SwotPanel.tsx` | `InvestorInsightsTab.tsx` |
| `SynthesizedNarrative.tsx` | `InvestorInsightsTab.tsx` |
| `SentimentFilterToggle.tsx` | `InvestorInsightsTab.tsx` |
| `ExternalDiligenceSkeleton.tsx` | `InvestorInsightsTab.tsx` |

## Why "legacy"?

These components were built during an earlier UX iteration and are named `legacy` because they are candidates for replacement by a future investor-insights redesign. They are **not deprecated yet** — they render the current production investor insights panel.

## Safe to touch?

- Reading / understanding: yes
- Renaming / deleting: **NO** — requires updating `InvestorInsightsTab.tsx` and all related tests first
- Modifying component internals: only if explicitly scoped in a feature task
