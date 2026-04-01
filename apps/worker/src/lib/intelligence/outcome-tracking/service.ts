/**
 * Outcome Tracking — Service
 *
 * Public API for recording deal outcomes and outcome events.
 */

import type { Pool } from "pg";
import type { DealOutcome, DealOutcomeEvent, RecordOutcomeOpts, AddOutcomeEventOpts } from "./types.js";
import {
  upsertDealOutcome,
  insertOutcomeEvent,
  fetchOutcomeByDealId,
  fetchOutcomeEventsByOutcomeId,
} from "./repository.js";

export async function recordOutcome(
  pool: Pool,
  opts: RecordOutcomeOpts
): Promise<DealOutcome> {
  return upsertDealOutcome(pool, opts);
}

export async function addOutcomeEvent(
  pool: Pool,
  opts: AddOutcomeEventOpts
): Promise<DealOutcomeEvent> {
  return insertOutcomeEvent(pool, opts);
}

export async function getOutcome(
  pool: Pool,
  deal_id: string
): Promise<DealOutcome | null> {
  return fetchOutcomeByDealId(pool, deal_id);
}

export async function getOutcomeEvents(
  pool: Pool,
  outcome_id: string
): Promise<DealOutcomeEvent[]> {
  return fetchOutcomeEventsByOutcomeId(pool, outcome_id);
}
