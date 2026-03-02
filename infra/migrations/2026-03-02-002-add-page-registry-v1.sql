-- Migration: page_registry_v1 table
-- Page Registry v1 — persisted per-page index with type classification,
-- extracted entities, numeric claims, key claims, and provenance.
-- Binding spec: docs/active/deck-fact-registry/DECK_PAGE_FACT_REGISTRY_DISCOVERY_v1.md
--
-- One row = one page × one document × one deal.
-- Primary key is page_id (deterministic: pagev1:{deal_id}:{document_id}:{page_number}).
-- Upsert keyed on page_id: reruns overwrite the same row idempotently.

CREATE TABLE IF NOT EXISTS public.page_registry_v1 (
  -- Deterministic primary key: pagev1:{deal_id}:{document_id}:{page_number}
  page_id                  text        NOT NULL,
  deal_id                  uuid        NOT NULL,
  document_id              uuid        NOT NULL,
  page_number              int         NOT NULL,

  -- Classification
  page_type                text        NOT NULL DEFAULT 'unknown'
                             CONSTRAINT page_registry_v1_page_type_check
                               CHECK (page_type IN (
                                 'ask', 'product', 'market', 'team', 'traction',
                                 'financials', 'competition', 'gtm', 'use_of_funds',
                                 'risks', 'other', 'unknown'
                               )),
  confidence               text        NOT NULL DEFAULT 'low'
                             CONSTRAINT page_registry_v1_confidence_check
                               CHECK (confidence IN ('high', 'medium', 'low')),

  -- Extracted data (JSONB arrays)
  entities                 jsonb       NOT NULL DEFAULT '[]',
  numeric_claims           jsonb       NOT NULL DEFAULT '[]',
  key_claims               jsonb       NOT NULL DEFAULT '[]',

  -- Evidence linkage
  evidence_ids             jsonb       NOT NULL DEFAULT '[]',

  -- Best representative excerpt
  excerpt                  text        NULL,

  -- Timestamps
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT page_registry_v1_pkey PRIMARY KEY (page_id)
);

-- Unique constraint on (deal_id, document_id, page_number) for upsert semantics
ALTER TABLE public.page_registry_v1
  ADD CONSTRAINT IF NOT EXISTS page_registry_v1_deal_doc_page_unique
  UNIQUE (deal_id, document_id, page_number);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS page_registry_v1_deal_idx
  ON public.page_registry_v1 (deal_id);

CREATE INDEX IF NOT EXISTS page_registry_v1_deal_page_type_idx
  ON public.page_registry_v1 (deal_id, page_type);

CREATE INDEX IF NOT EXISTS page_registry_v1_deal_doc_idx
  ON public.page_registry_v1 (deal_id, document_id);

-- GIN indexes for JSONB search (entities, key_claims)
CREATE INDEX IF NOT EXISTS page_registry_v1_entities_gin_idx
  ON public.page_registry_v1 USING GIN (entities);

CREATE INDEX IF NOT EXISTS page_registry_v1_key_claims_gin_idx
  ON public.page_registry_v1 USING GIN (key_claims);
