-- Migration: Update deal stage values to analysis-driven workflow
-- intake: Deal created + documents uploaded (pre-analysis)
-- under_review: First analysis complete, AI identified gaps/opportunities
-- in_diligence: Investor actively addressing identified gaps
-- ready_decision: DD complete, confidence >= 70%, investment-ready
-- pitched: Deal presented or investment decision made

BEGIN;

-- Map old stages to new stages
UPDATE deals
SET stage = CASE
  WHEN stage = 'idea' THEN 'intake'
  WHEN stage = 'progress' THEN 'under_review'
  WHEN stage = 'ready' THEN 'in_diligence'
  WHEN stage = 'pitched' THEN 'pitched'
  ELSE 'intake'
END;

COMMIT;

