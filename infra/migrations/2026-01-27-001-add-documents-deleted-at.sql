ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_documents_deal_active
ON public.documents (deal_id)
WHERE deleted_at IS NULL;