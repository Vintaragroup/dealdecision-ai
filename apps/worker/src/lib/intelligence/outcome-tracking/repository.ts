/**
 * Outcome Tracking — Repository
 *
 * Low-level DB operations for deal_outcomes and deal_outcome_events.
 */

import type { Pool } from "pg";
import type { DealOutcome, DealOutcomeEvent, RecordOutcomeOpts, AddOutcomeEventOpts } from "./types.js";

export async function upsertDealOutcome(
  pool: Pool,
  opts: RecordOutcomeOpts
): Promise<DealOutcome> {
  const { deal_id, org_id, outcome_type, outcome_date = null, investment_amount = null, notes = null } = opts;

  const result = await pool.query<DealOutcome>(
    `INSERT INTO deal_outcomes (deal_id, org_id, outcome_type, outcome_date, investment_amount, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (deal_id) DO UPDATE SET
       outcome_type       = EXCLUDED.outcome_type,
       outcome_date       = EXCLUDED.outcome_date,
       investment_amount  = EXCLUDED.investment_amount,
       notes              = EXCLUDED.notes,
       updated_at         = now()
     RETURNING *`,
    [deal_id, org_id, outcome_type, outcome_date, investment_amount, notes]
  );

  return result.rows[0];
}

export async function insertOutcomeEvent(
  pool: Pool,
  opts: AddOutcomeEventOpts
): Promise<DealOutcomeEvent> {
  const {
    outcome_id,
    deal_id,
    event_type,
    event_date = new Date(),
    notes = null,
    metadata = null,
  } = opts;

  const result = await pool.query<DealOutcomeEvent>(
    `INSERT INTO deal_outcome_events (outcome_id, deal_id, event_type, event_date, notes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [outcome_id, deal_id, event_type, event_date, notes, metadata ? JSON.stringify(metadata) : null]
  );

  return result.rows[0];
}

export async function fetchOutcomeByDealId(
  pool: Pool,
  deal_id: string
): Promise<DealOutcome | null> {
  const result = await pool.query<DealOutcome>(
    `SELECT * FROM deal_outcomes WHERE deal_id = $1 LIMIT 1`,
    [deal_id]
  );
  return result.rows[0] ?? null;
}

export async function fetchOutcomeEventsByOutcomeId(
  pool: Pool,
  outcome_id: string
): Promise<DealOutcomeEvent[]> {
  const result = await pool.query<DealOutcomeEvent>(
    `SELECT * FROM deal_outcome_events WHERE outcome_id = $1 ORDER BY event_date ASC`,
    [outcome_id]
  );
  return result.rows;
}
