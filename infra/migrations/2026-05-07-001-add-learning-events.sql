-- Migration: 2026-05-07-001-add-learning-events
-- LLM Deal Understanding Auditor — Phase 1 instrumentation
--
-- Binding spec: artifacts/llm-deal-understanding-auditor-discovery-and-plan.md
-- Type definition: packages/core/src/models/learning-event-v1.ts
--
-- This table is the persistent store for LearningEventV1 records.
-- Phase 1: table created, no rows emitted yet (emitters are noop stubs).
-- Phase 2+: auditor modules emit events via recordLearningEvent().

CREATE TABLE IF NOT EXISTS public.learning_events (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  deal_id        uuid,
  run_id         text,
  event_type     text        NOT NULL,
  severity       text        NOT NULL DEFAULT 'medium',
  source         text        NOT NULL DEFAULT 'deterministic',
  payload        jsonb       NOT NULL DEFAULT '{}',
  evidence_refs  jsonb       NOT NULL DEFAULT '[]',
  status         text        NOT NULL DEFAULT 'open',
  created_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at    timestamptz,
  resolved_at    timestamptz,
  review_notes   text,

  CONSTRAINT learning_events_pkey
    PRIMARY KEY (id),

  CONSTRAINT learning_events_event_type_check
    CHECK (event_type IN (
      'field_misclassification',
      'wrong_archetype',
      'wrong_policy',
      'financial_semantic_error',
      'contradiction_false_positive',
      'weak_rationale',
      'ui_semantic_confusion',
      'schema_gap',
      'llm_correction_proposed',
      'llm_correction_accepted',
      'llm_correction_rejected'
    )),

  CONSTRAINT learning_events_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  CONSTRAINT learning_events_source_check
    CHECK (source IN (
      'deterministic',
      'llm_auditor',
      'human_review',
      'regression_test',
      'ui_feedback'
    )),

  CONSTRAINT learning_events_status_check
    CHECK (status IN ('open', 'reviewed', 'resolved', 'ignored'))
);

CREATE INDEX IF NOT EXISTS idx_learning_events_deal_id
  ON public.learning_events (deal_id)
  WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learning_events_event_type
  ON public.learning_events (event_type);

CREATE INDEX IF NOT EXISTS idx_learning_events_status
  ON public.learning_events (status);

CREATE INDEX IF NOT EXISTS idx_learning_events_created_at
  ON public.learning_events (created_at DESC);

-- Auto-update updated_at is not applicable here — learning_events are
-- append-only except for status/reviewed_at/resolved_at/review_notes fields.
-- These are patched directly; no trigger is needed.
