-- Ensure jobs.payload is always a non-null JSONB object for debuggability.

BEGIN;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS payload JSONB;

ALTER TABLE jobs
  ALTER COLUMN payload SET DEFAULT '{}'::jsonb;

UPDATE jobs
   SET payload = jsonb_strip_nulls(
     jsonb_build_object(
       'job_id', job_id,
       'type', type,
       'deal_id', deal_id,
       'document_id', document_id,
       'parent_job_id', parent_job_id,
       'page_start', page_start,
       'page_end', page_end
     )
   )
 WHERE payload IS NULL;

ALTER TABLE jobs
  ALTER COLUMN payload SET NOT NULL;

COMMIT;
