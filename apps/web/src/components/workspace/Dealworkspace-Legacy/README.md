# Dealworkspace-Legacy — UNUSED (safe-to-remove candidate)

## Status

**Unused in production.** No production source files import from this directory. It is referenced only in comments/documentation strings elsewhere in the codebase.

## Contents

| File | Status |
|------|--------|
| `DealOverviewTab.tsx` | Unused — no production imports found |
| `dealworkspace_overview_comp.tsx` | Unused — no production imports found |
| `DealWorkspaceTopSection.tsx` | Unused — no production imports found |

## History

These components are from an earlier `DealWorkspace` overview tab implementation. The active replacement lives in `apps/web/src/components/workspace/`.

## Safe to remove?

- Verify with `grep -r "Dealworkspace-Legacy\|DealOverviewTab\|DealWorkspaceTopSection\|dealworkspace_overview_comp" apps/web/src --include="*.tsx" --include="*.ts"` before deleting
- If zero live imports confirmed, this directory is a **safe deletion candidate**
- Track removal in a dedicated cleanup task, not casually
