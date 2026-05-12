# workspace/legacy — PRODUCTION LIVE

> **Do NOT delete or refactor this directory without a dedicated migration task.**

## Status

**Production-live.** `WorkspaceRedesignedShell.tsx` exports a type that is actively imported by `IntelligenceTab.tsx`.

## Imported files

| File | Imported by |
|------|-------------|
| `WorkspaceRedesignedShell.tsx` | `IntelligenceTab.tsx` (type import: `FinancialTile`) |

## Why "legacy"?

`WorkspaceRedesignedShell` was built as a Phase B workspace layout redesign. It is named `legacy` because it predates the current workspace shell structure, but continues to export types consumed by the live `IntelligenceTab`.

`DealWorkspace_overviewTab_v3.tsx` appears unused in production imports at this time (referenced only in comments), but lives alongside the live file.

## Safe to touch?

- Reading / understanding: yes
- Deleting `WorkspaceRedesignedShell.tsx`: **NO** — `IntelligenceTab.tsx` imports `FinancialTile` from it
- Deleting `DealWorkspace_overviewTab_v3.tsx`: verify zero imports before removing
