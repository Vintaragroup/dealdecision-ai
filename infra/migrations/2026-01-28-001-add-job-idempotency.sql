-- Postgres-backed idempotency for job-enqueue operations (additive to Redis/BullMQ dedupe)

CREATE TABLE IF NOT EXISTS job_idempotency (
  id BIGSERIAL PRIMARY KEY,
  deal_id UUID NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  job_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_idempotency_unique_scope
  ON job_idempotency (deal_id, operation, idempotency_key);

CREATE INDEX IF NOT EXISTS job_idempotency_job_id_idx
  ON job_idempotency (job_id);

-- Ensure updated_at stays current when job_id is set.
-- (Routes update updated_at explicitly; this is a safety net.)
CREATE OR REPLACE FUNCTION job_idempotency_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_idempotency_touch ON job_idempotency;
CREATE TRIGGER trg_job_idempotency_touch
BEFORE UPDATE ON job_idempotency
FOR EACH ROW EXECUTE FUNCTION job_idempotency_touch_updated_at();
