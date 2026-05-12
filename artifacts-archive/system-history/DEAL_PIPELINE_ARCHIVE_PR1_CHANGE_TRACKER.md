> STATUS: NEEDS VERIFICATION

# Deal Pipeline Archive PR1 Change Tracker

Date: 2026-03-27
Branch: chore/documents-ui-cleanups
Owner: Copilot implementation pass

## Scope

Implement PR1 archive workflow for Deal Pipeline using `deals.lifecycle_status` as canonical archive state.

Included:
- backend lifecycle filter support on deal list
- backend archive and unarchive routes
- contract exposure for `lifecycle_status`
- frontend archive/unarchive wiring in Deal Pipeline
- frontend lifecycle filter control
- focused API and UI tests

Not included:
- soft-delete conversion for deals
- org-scope SQL policy changes
- backend completeness metric migration
- board/kanban view

## Files Changed

### Contracts
- packages/contracts/src/index.ts
  - Added `Deal.lifecycle_status?: 'draft' | 'active' | 'archived'`

### API
- apps/api/src/routes/deals/_shared.ts
  - Added `DealRow.lifecycle_status`
  - Included `lifecycle_status` in `mapDeal(...)` response mapping

- apps/api/src/routes/deals/deal-core.routes.ts
  - Added `lifecycle` query filter handling on `GET /api/v1/deals`
    - supported values: `active` (default), `archived`, `all`
  - Added `PATCH /api/v1/deals/:deal_id/archive`
  - Added `PATCH /api/v1/deals/:deal_id/unarchive`

### Web
- apps/web/src/lib/apiClient.ts
  - Extended `apiGetDeals(opts?)` with lifecycle query support
  - Added `apiArchiveDeal(dealId)`
  - Added `apiUnarchiveDeal(dealId)`

- apps/web/src/components/pages/DealsList.tsx
  - Added lifecycle filter state and selector (`active`, `archived`, `all`)
  - Added archive/unarchive row action in per-deal Actions menu
  - Added bulk archive/unarchive action for selected deals
  - Updated fetch and refresh paths to respect lifecycle filter
  - Extended search to include owner and stage text in addition to deal name

### Tests
- apps/api/test/deals-archive-lifecycle.test.ts (new)
  - Verifies archive route sets `lifecycle_status='archived'`
  - Verifies unarchive route sets `lifecycle_status='active'`

- apps/web/src/__tests__/DealsList.archiveDeal.test.tsx (new)
  - Verifies selecting Archive calls `apiArchiveDeal(...)`

## API Contract Additions

### List deals
- `GET /api/v1/deals?lifecycle=active|archived|all`
- default: `active`

### Archive mutations
- `PATCH /api/v1/deals/:deal_id/archive`
- `PATCH /api/v1/deals/:deal_id/unarchive`

## Behavior Notes

- Archive is non-destructive: it updates lifecycle state.
- Hard delete remains separate and unchanged (`DELETE ...?purge=true`).
- Pipeline defaults to active deals and can intentionally switch to archived/all.

## Validation Checklist

- [x] API tests pass (archive routes)
- [x] Web tests pass (archive action wiring)
- [x] Existing delete tests still pass
- [ ] Manual sanity check: archive and unarchive from list view
- [ ] Manual sanity check: lifecycle filter reflects expected set

## Follow-Up Work

1. Add archive/unarchive permission policy aligned to org roles.
2. Add Archived badge/chip for clearer state affordance in list/grid rows.
3. Add parity for grid view action menu (archive/delete/edit).
4. Implement soft-delete as default and reserve purge for admin tooling.
5. Move completeness metric ownership to backend contract.
