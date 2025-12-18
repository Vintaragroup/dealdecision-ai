-- Add full content storage columns to documents table
-- full_content: Complete extracted data (PDFContent, ExcelContent, etc)
-- full_text: Complete concatenated text from all pages (for full-text search)
-- page_count: Total number of pages/sheets processed
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS full_content JSONB,
  ADD COLUMN IF NOT EXISTS full_text TEXT,
  ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT 0;

-- Create GIN index on full_content for better query performance
CREATE INDEX IF NOT EXISTS idx_documents_full_content_gin ON documents USING gin (full_content);

-- Create GIN index on full_text for full-text search
CREATE INDEX IF NOT EXISTS idx_documents_full_text_gin ON documents USING gin (to_tsvector('english', full_text));
