-- Migration: add verdict column to deal_challenge_pass_results
-- Stores the decision verdict (GO | CONSIDER | NO_GO) at challenge-pass time
-- so the intelligence API can surface it directly without parsing summary text.

ALTER TABLE public.deal_challenge_pass_results
  ADD COLUMN IF NOT EXISTS verdict text;
