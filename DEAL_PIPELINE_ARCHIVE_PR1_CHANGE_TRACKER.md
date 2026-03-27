# Deal Pipeline Archive PR1 Change Tracker

Date: 2026-03-27
Branch: chore/documents-ui-cleanups
Owner: Copilot implementation pass

## Scope

Implement PR1 archive workflow for Deal Pipeline using `deals.lifecycle_status` as canonical archive state.

Included:
- backend lifecycle filter support on deal list
- backend archive and unarchive routes
- backend soft-delete default for deals
- backend admin restore endpoint for soft-deleted deals
- backend admin hard purge path retained for irreversible deletion
- backend persisted views exposure and increment endpoint
- contract exposure for `lifecycle_status`
- contract exposure for `views`
- frontend archive/unarchive wiring in Deal Pipeline
- frontend delete flow switched to soft-delete semantics
- frontend lifecycle filter control
- frontend deal-open view tracking call
- focused API and UI tests

Not included:
- org-scope SQL policy changes
- backend completeness metric migration
- board/kanban view

## Files Changed

### Contracts
- packages/contracts/src/index.ts
  - Added `Deal.lifecycle_status?: 'draft' | 'active' | 'archived'`
  - Added `Deal.views?: number`

### API
- apps/api/src/routes/deals/_shared.ts
  - Added `DealRow.lifecycle_status`
  - Added `DealRow.views`
  - Included `lifecycle_status` in `mapDeal(...)` response mapping
  - Included `views` in `mapDeal(...)` response mapping when available

- apps/api/src/routes/deals/deal-core.routes.ts
  - Added `lifecycle` query filter handling on `GET /api/v1/deals`
    - supported values: `active` (default), `archived`, `all`
  - Added `PATCH /api/v1/deals/:deal_id/archive`
  - Added `PATCH /api/v1/deals/:deal_id/unarchive`
  - Added `PATCH /api/v1/deals/:deal_id/restore` (admin restore)
  - Added `POST /api/v1/deals/:deal_id/view` (atomic views increment)
  - Changed `DELETE /api/v1/deals/:deal_id` to soft-delete by default
  - Kept `DELETE /api/v1/deals/:deal_id?purge=true` as admin-only hard purge

### Web
- apps/web/src/lib/apiClient.ts
  - Extended `apiGetDeals(opts?)` with lifecycle query support
  - Added `apiArchiveDeal(dealId)`
  - Added `apiUnarchiveDeal(dealId)`
  - Added `apiRestoreDeal(dealId)`
  - Added `apiPurgeDeal(dealId)`
  - Added `apiTrackDealView(dealId)`
  - Changed `apiDeleteDeal` default from hard purge to soft-delete

- apps/web/src/AppShell.tsx
  - Added non-blocking `apiTrackDealView` call in `handleDealClick`

- apps/web/src/components/pages/DealsList.tsx
  - Added lifecycle filter state and selector (`active`, `archived`, `all`)
  - Added archive/unarchive row action in per-deal Actions menu
  - Added bulk archive/unarchive action for selected deals
  - Updated delete confirmation copy to reflect soft-delete semantics
  - Updated fetch and refresh paths to respect lifecycle filter
  - Extended search to include owner and stage text in addition to deal name

### Tests
- apps/api/test/deals-archive-lifecycle.test.ts (new)
  - Verifies archive route sets `lifecycle_status='archived'`
  - Verifies unarchive route sets `lifecycle_status='active'`

- apps/web/src/__tests__/DealsList.archiveDeal.test.tsx (new)
  - Verifies selecting Archive calls `apiArchiveDeal(...)`

- apps/api/test/deals-view-tracking.test.ts (new)
  - Verifies view endpoint increments `views` and returns updated count
  - Verifies route returns 501 when `deals.views` column is unavailable

- apps/api/test/deals-delete-purge.test.ts
  - Verifies soft-delete by default (`DELETE /api/v1/deals/:deal_id`)
  - Verifies admin restore (`PATCH /api/v1/deals/:deal_id/restore`)
  - Verifies hard purge remains available with `purge=true`

- apps/web/src/__tests__/DealsList.deleteDeal.test.tsx
  - Updated to assert soft-delete API call (`purge: false`)

## API Contract Additions

### List deals
- `GET /api/v1/deals?lifecycle=active|archived|all`
- default: `active`

### Archive mutations
- `PATCH /api/v1/deals/:deal_id/archive`
- `PATCH /api/v1/deals/:deal_id/unarchive`

### Views tracking
- `POST /api/v1/deals/:deal_id/view`

### Delete and restore mutations
- `DELETE /api/v1/deals/:deal_id` (soft-delete default)
- `PATCH /api/v1/deals/:deal_id/restore` (admin restore)
- `DELETE /api/v1/deals/:deal_id?purge=true` (admin hard purge)

## Behavior Notes

- Archive is non-destructive: it updates lifecycle state.
- Delete is now safer by default: soft-delete first.
- Admin can restore soft-deleted deals.
- Admin can still complete irreversible hard purge with `purge=true`.
- Pipeline defaults to active deals and can intentionally switch to archived/all.
- Views are now persisted in `deals.views`, emitted in deal payloads, and incremented when a deal is opened.

## Validation Checklist

- [x] API tests pass (archive routes)
- [x] API tests pass (soft-delete, restore, hard purge)
- [x] Web tests pass (archive action wiring)
- [x] Existing delete tests still pass
- [ ] Manual sanity check: archive and unarchive from list view
- [ ] Manual sanity check: lifecycle filter reflects expected set

## Follow-Up Work

1. Add archive/unarchive permission policy aligned to org roles.
2. Add Archived badge/chip for clearer state affordance in list/grid rows.
3. Add parity for grid view action menu (archive/delete/edit).
4. Add UI affordance for admin restore/purge actions.
5. Move completeness metric ownership to backend contract.
