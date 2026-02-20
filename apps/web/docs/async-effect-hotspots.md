# Async Effect Hotspots (Fire-and-forget async in effects)

Goal: Identify places where React `useEffect` kicks off async work (network/timers) without a cancellation / stale-guard, leading to:

- `setState` after unmount
- stale writes after key changes (`dealId`, `orgId`)
- request fan-out amplified by auth-token usage

Scope: `apps/web/src`.

## Definitions

- **Unguarded**: no cleanup flag, abort, or `useAsyncStaleGuard` around the async work that later calls `setState`.
- **Partially guarded**: protects unmount only (e.g. `isMountedRef`) but does not guard key changes (e.g. `orgId`, `dealId`).
- **Guarded**: uses a cleanup flag (`cancelled`), `AbortController`, or `useAsyncStaleGuard` to prevent stale/unmounted updates.

## Ranked shortlist (by request fan-out + auth-token amplification)

### 1) DealsList — N+1 request fan-out per mount (**Partially guarded**)

- Where:
  - `fetchDealsAndDocuments()` (fan-out loop): [apps/web/src/components/pages/DealsList.tsx](apps/web/src/components/pages/DealsList.tsx#L117-L184)
  - mount effect that triggers the fetch: [apps/web/src/components/pages/DealsList.tsx](apps/web/src/components/pages/DealsList.tsx#L186-L202)
- Why high impact:
  - Fetches deals, then loops `apiGetDocuments(deal.id)` for every deal (can be dozens+ requests).
  - Calls are authenticated, so fan-out multiplies token/header churn.
- Current guard status:
  - Has `isMountedRef` (prevents post-unmount updates) but does not key-guard org changes.

```tsx
const deals = await apiGetDeals();
// ...
for (const deal of deals) {
  const docsResponse = await apiGetDocuments(deal.id);
  documentCounts[deal.id] = docsResponse.documents?.length || 0;
}
```

Suggested remediation pattern: `useAsyncStaleGuard(orgId)` (or capture an `orgKey` at start) and skip `setState` if stale; optionally parallelize with a cap + abort signals.

### 2) Analytics — sampled fan-out + multi-stage aggregation (**Unguarded**)

- Where:
  - `load()` (docs + extraction reports): [apps/web/src/components/pages/Analytics.tsx](apps/web/src/components/pages/Analytics.tsx#L139-L216)
  - auth/org-driven effect that calls `load()`: [apps/web/src/components/pages/Analytics.tsx](apps/web/src/components/pages/Analytics.tsx#L238-L256)
- Why high impact:
  - Best-effort sampling still fans out: up to 20× `apiGetDocuments` + 10× `apiGetDealExtractionReport` per run.
  - Many sequential `set*` calls happen after awaited stages.

```tsx
const docResults = await Promise.allSettled(sampledDealIds.map((dealId) => apiGetDocuments(dealId)));
// ...
const reportResults = await Promise.allSettled(attentionDealIds.map((dealId) => apiGetDealExtractionReport(dealId)));
```

Suggested remediation pattern: `useAsyncStaleGuard(orgId)` (or cleanup flag) inside `load()` before each state write.

### 3) DealAnalystTab — heavy per-deal multi-request refresh (**Unguarded**)

- Where:
  - `refresh()` (lineage + visual assets + optional deterministic): [apps/web/src/components/deals/tabs/DealAnalystTab.tsx](apps/web/src/components/deals/tabs/DealAnalystTab.tsx#L3314-L3462)
  - effect that calls `refresh()` on `dealId` change: [apps/web/src/components/deals/tabs/DealAnalystTab.tsx](apps/web/src/components/deals/tabs/DealAnalystTab.tsx#L3473-L3476)
- Why high impact:
  - Multiple authenticated calls per deal-switch; responses can be large.
  - Many state writes (lineage, assets, warnings, selection resets).

```tsx
const [lineageRes, assetsRes, understandingRes] = await Promise.allSettled([
  apiGetDealLineage(dealId),
  apiGetDealVisualAssets(dealId),
  understandingPromise,
]);
```

Suggested remediation pattern: `useAsyncStaleGuard(dealId)` inside `refresh()` (or a cleanup flag set by the effect) and return early before applying any state.

### 4) DashboardContent — dashboard-wide fan-out to populate recent docs (**Unguarded**)

- Where:
  - `loadDeals()` (deal list + up to 6× `apiGetDocuments`): [apps/web/src/components/DashboardContent.tsx](apps/web/src/components/DashboardContent.tsx#L73-L163)
  - auth/org-driven effect that calls `loadDeals()`: [apps/web/src/components/DashboardContent.tsx](apps/web/src/components/DashboardContent.tsx#L165-L184)
- Why high impact:
  - `Promise.allSettled` fans out and then updates multiple state atoms.

```tsx
const docResults = await Promise.allSettled(dealIdList.map((dealId) => apiGetDocuments(dealId)));
```

Suggested remediation pattern: `useAsyncStaleGuard(orgId)` (or cleanup flag) checked before the post-await `set*` calls.

### 5) Documents — auth/org deals load + deal selection docs load (**Unguarded**)

- Where:
  - deals list load (`apiGetDeals().then(...setState...)`): [apps/web/src/components/pages/Documents.tsx](apps/web/src/components/pages/Documents.tsx#L49-L71)
  - selected deal docs load (`void refreshDocuments`): [apps/web/src/components/pages/Documents.tsx](apps/web/src/components/pages/Documents.tsx#L89-L98)
  - `refreshDocuments()` body: [apps/web/src/components/pages/Documents.tsx](apps/web/src/components/pages/Documents.tsx#L73-L87)
- Why risky:
  - Late `.then/.finally` or late awaited response can update state after unmount or after deal change.

Suggested remediation pattern: `useAsyncStaleGuard(orgId)` for the deals list effect; `useAsyncStaleGuard(selectedDealId)` (or cleanup flag) for docs refresh.

### 6) DataTab — deal-wide extraction + per-document analysis fetch (**Unguarded**)

- Where:
  - extraction refresh + effect: [apps/web/src/components/workspace/DataTab.tsx](apps/web/src/components/workspace/DataTab.tsx#L43-L66)
  - per-document analysis effect: [apps/web/src/components/workspace/DataTab.tsx](apps/web/src/components/workspace/DataTab.tsx#L68-L94)
- Why risky:
  - Fast deal/document switching can lead to stale writes (report/analysis for the wrong selection).

Suggested remediation pattern: `useAsyncStaleGuard(dealId)` and `useAsyncStaleGuard(`${dealId}:${selectedDocumentId}`)` or cleanup flag.

### 7) DealExtractionReportModal — modal can close mid-request (**Unguarded**)

- Where:
  - refresh + effect: [apps/web/src/components/documents/DealExtractionReportModal.tsx](apps/web/src/components/documents/DealExtractionReportModal.tsx#L56-L82)
- Why risky:
  - Closing the modal while the request is in flight can still call `setState` in `finally`.

Suggested remediation pattern: effect cleanup flag (`cancelled`) checked before state updates, or `useAsyncStaleGuard(dealId)`.

### 8) DocumentsTab — reloadKey churn + unmount risk (**Unguarded**)

- Where:
  - `loadDocuments()` + effect: [apps/web/src/components/documents/DocumentsTab.tsx](apps/web/src/components/documents/DocumentsTab.tsx#L33-L53)

Suggested remediation pattern: cleanup flag / stale guard keyed by `dealId` + `reloadKey`.

### 9) DealComparison — auth/org-driven `void loadDeals()` (**Unguarded**)

- Where:
  - `loadDeals()` sets multiple state atoms: [apps/web/src/components/pages/DealComparison.tsx](apps/web/src/components/pages/DealComparison.tsx#L170-L219)
  - effect that triggers it: [apps/web/src/components/pages/DealComparison.tsx](apps/web/src/components/pages/DealComparison.tsx#L222-L233)

Suggested remediation pattern: `useAsyncStaleGuard(orgId)` in `loadDeals()`.

### 10) DueDiligenceReport — dealId-driven `apiGetDeal` (**Unguarded**)

- Where:
  - effect + inline loader: [apps/web/src/components/pages/DueDiligenceReport.tsx](apps/web/src/components/pages/DueDiligenceReport.tsx#L61-L82)

Suggested remediation pattern: `useAsyncStaleGuard(dealId)` or `AbortController` if the API client supports signals.

### 11) useGovernedLlmOverview — hook-level async refresh races (**Unguarded**)

- Where:
  - `refresh()` + effect: [apps/web/src/hooks/useGovernedLlmOverview.ts](apps/web/src/hooks/useGovernedLlmOverview.ts#L61-L129)
- Why risky:
  - The hook resets state on id change, but an in-flight `refresh()` can still resolve and write state for the previous `id`.

Suggested remediation pattern: `useAsyncStaleGuard(id)` (inside the hook) or an abort/cancel mechanism around `apiGetDealGovernedOverlayPersisted`.

### 12) AnalysisTab — mount-only timeout without cleanup (no network) (**Unguarded**)

- Where:
  - effect + `runAnalysis()` timeout: [apps/web/src/components/workspace/AnalysisTab.tsx](apps/web/src/components/workspace/AnalysisTab.tsx#L75-L90)

Suggested remediation pattern: track timeout handle and clear in cleanup, or `cancelled` flag.

## Guarded examples (good patterns to copy)

- `useAsyncStaleGuard` in DealWorkspace: [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L677)
- Cleanup flag around async fetch in EvidencePanel: [apps/web/src/components/evidence/EvidencePanel.tsx](apps/web/src/components/evidence/EvidencePanel.tsx#L324-L360)
- Cleanup flag in ExtractionReportModal: [apps/web/src/components/documents/ExtractionReportModal.tsx](apps/web/src/components/documents/ExtractionReportModal.tsx#L66-L90)
