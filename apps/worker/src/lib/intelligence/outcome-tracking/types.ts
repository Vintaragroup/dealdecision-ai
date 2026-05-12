/**
 * Outcome Tracking — Types
 */

export type OutcomeType =
  | "invested"
  | "passed"
  | "declined_at_screening"
  | "declined_at_diligence"
  | "follow_on"
  | "deal_died"
  | "pending";

export interface DealOutcome {
  id: string;
  deal_id: string;
  org_id: string;
  outcome_type: OutcomeType;
  outcome_date: Date | null;
  investment_amount?: number | null;
  notes?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DealOutcomeEvent {
  id: string;
  outcome_id: string;
  deal_id: string;
  event_type: string;
  event_date: Date;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: Date;
}

export interface RecordOutcomeOpts {
  deal_id: string;
  org_id: string;
  outcome_type: OutcomeType;
  outcome_date?: Date | null;
  investment_amount?: number | null;
  notes?: string | null;
}

export interface AddOutcomeEventOpts {
  outcome_id: string;
  deal_id: string;
  event_type: string;
  event_date?: Date;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}
