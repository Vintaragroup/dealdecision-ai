# AI-analysis-legacy — UNUSED (safe-to-remove candidate)

## Status

**Unused in production.** No production source files import from this directory. It is referenced only in test files.

## Contents

| File | Status |
|------|--------|
| `AnalysisTab.tsx` | Unused in production — imported only in `AnalysisTab.financialSnapshotStale.test.tsx` |

## History

This `AnalysisTab` component was an earlier iteration of the analysis/intelligence tab. The active implementation lives in `apps/web/src/components/workspace/IntelligenceTab.tsx` (or similar).

## Safe to remove?

- The test file `AnalysisTab.financialSnapshotStale.test.tsx` imports from this directory — that test would need to be updated or deleted alongside this component
- Verify no new imports have been added: `grep -r "AI-analysis-legacy\|AnalysisTab" apps/web/src --include="*.tsx" --include="*.ts" | grep -v __tests__`
- Track removal in a dedicated cleanup task, not casually
