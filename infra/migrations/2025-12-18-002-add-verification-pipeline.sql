-- Add verification pipeline columns to documents table
BEGIN;

-- Add verification tracking columns
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS verification_result JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ready_for_analysis_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ingestion_summary JSONB DEFAULT NULL;

-- Verification result structure:
-- {
--   "verified_at": ISO timestamp,
--   "overall_score": 0.0-1.0,
--   "quality_checks": {
--     "ocr_confidence": { "avg": float, "min": float, "max": float, "status": "pass|warn|fail" },
--     "text_coherence": { "score": float, "status": "pass|warn|fail" },
--     "data_completeness": { "score": float, "status": "pass|warn|fail", "details": {...} },
--     "extraction_success": boolean
--   },
--   "warnings": [...],
--   "recommendations": [...]
-- }

-- Ingestion summary structure:
-- {
--   "files_uploaded": 1,
--   "total_pages": 15,
--   "documents": [
--     {
--       "title": "...",
--       "type": "pdf|excel|word|powerpoint",
--       "status": "completed|needs_ocr|failed",
--       "pages": 15,
--       "file_size_bytes": 12345,
--       "extraction_quality_score": 0.85,
--       "verification_status": "verified|warnings|failed",
--       "metrics_extracted": 10,
--       "sections_found": 5,
--       "ocr_avg_confidence": 0.92
--     }
--   ],
--   "overall_readiness": "ready|needs_review|failed",
--   "readiness_details": "All documents verified and ready for analysis",
--   "completed_at": ISO timestamp,
--   "next_steps": "Proceed to deal analysis"
-- }

-- Index for verification status checks
CREATE INDEX IF NOT EXISTS idx_documents_verification_status ON documents(verification_status);
CREATE INDEX IF NOT EXISTS idx_documents_ready_for_analysis ON documents(ready_for_analysis_at);

-- Add ingestion report tracking table
CREATE TABLE IF NOT EXISTS ingestion_reports (
  report_id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary JSONB NOT NULL,
  document_ids TEXT[] NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingestion_reports_deal_id ON ingestion_reports(deal_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_reports_created_at ON ingestion_reports(created_at DESC);

COMMIT;

