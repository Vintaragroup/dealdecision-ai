# Modal_Legacy — PRODUCTION LIVE (type exports only)

> **Do NOT delete or refactor this directory without a dedicated migration task.**

## Status

**Production-live.** `NewDealModal.tsx` exports the `DealFormData` type that is actively imported by multiple production files.

## Imported files

| File | Imported by |
|------|-------------|
| `NewDealModal.tsx` (`DealFormData` type) | `AppShell.tsx`, `newDeal_Modal.tsx`, `TemplateEditor.tsx`, `AnalysisTab_v1.tsx`, `AIDealAssistant.tsx` |

## Why "legacy"?

The `NewDealModal` component was superseded by `newDeal_Modal.tsx` at the project root, but the `DealFormData` type it defines is still the canonical shared type for the new-deal form contract. The directory is named `Modal_Legacy` to signal that the *component* is deprecated, but the type export is still live.

## Safe to touch?

- Reading / understanding: yes
- Deleting the component render code: allowed if `newDeal_Modal.tsx` takes over the component role
- Removing `DealFormData` type or the file: **NO** — requires updating all 5 import sites first
- Renaming: only with a coordinated rename across all import sites
