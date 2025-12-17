-- Migration: HRM-DD Analysis Tables
-- Comprehensive schema for multi-cycle hierarchical reasoning analysis
-- Date: 2025-12-17

BEGIN;

-- fact_rows: Atomic evidence units
CREATE TABLE IF NOT EXISTS fact_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    claim TEXT NOT NULL,
    source TEXT NOT NULL, -- "deck.pdf", URL, or "uncertain"
    page VARCHAR(50),
    confidence DECIMAL(3,2) NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    created_cycle INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    CONSTRAINT fact_rows_deal_created_idx UNIQUE (deal_id, claim, created_cycle)
);

CREATE INDEX idx_fact_rows_deal_id ON fact_rows(deal_id);
CREATE INDEX idx_fact_rows_created_cycle ON fact_rows(created_cycle);
CREATE INDEX idx_fact_rows_confidence ON fact_rows(confidence);

-- planner_states: H-module persistent state per deal
CREATE TABLE IF NOT EXISTS planner_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
    cycle INTEGER NOT NULL,
    goals TEXT[] NOT NULL,
    constraints TEXT[] NOT NULL,
    hypotheses TEXT[] NOT NULL,
    subgoals TEXT[] NOT NULL,
    focus TEXT,
    stop_reason TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_planner_states_deal_id ON planner_states(deal_id);

-- analysis_cycles: Individual cycle execution records
CREATE TABLE IF NOT EXISTS analysis_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    cycle_number INTEGER NOT NULL,
    focus VARCHAR(50) NOT NULL, -- "broad_scan", "deep_dive", "synthesis"
    status VARCHAR(50) NOT NULL, -- "running", "completed", "failed", "timeout"
    duration_ms INTEGER,
    findings_count INTEGER DEFAULT 0,
    facts_extracted INTEGER DEFAULT 0,
    depth_delta DECIMAL(5,2),
    should_continue BOOLEAN DEFAULT false,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT now(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    CONSTRAINT unique_deal_cycle UNIQUE (deal_id, cycle_number)
);

CREATE INDEX idx_analysis_cycles_deal_id ON analysis_cycles(deal_id);
CREATE INDEX idx_analysis_cycles_status ON analysis_cycles(status);

-- cycle_outputs: Structured output from each cycle
CREATE TABLE IF NOT EXISTS cycle_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL UNIQUE REFERENCES analysis_cycles(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    cycle_number INTEGER NOT NULL,
    hypotheses JSONB, -- Array of hypotheses
    uncertainties JSONB, -- Array of uncertainties
    constraints JSONB, -- Array of binding constraints
    findings JSONB, -- Array of findings
    depth_assessment JSONB, -- Depth assessment metrics
    created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_cycle_outputs_deal_id ON cycle_outputs(deal_id);
CREATE INDEX idx_cycle_outputs_cycle_number ON cycle_outputs(cycle_number);

-- ledger_manifests: Audit scoreboard for analysis
CREATE TABLE IF NOT EXISTS ledger_manifests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
    cycles_completed INTEGER DEFAULT 0,
    depth_delta JSONB, -- Array of depth metrics per cycle
    subgoals_addressed INTEGER DEFAULT 0,
    constraints_checked INTEGER DEFAULT 0,
    dead_ends INTEGER DEFAULT 0,
    paraphrase_invariance DECIMAL(3,2),
    calibration_brier DECIMAL(3,2),
    total_facts INTEGER DEFAULT 0,
    total_findings INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_ledger_manifests_deal_id ON ledger_manifests(deal_id);

-- decision_packs: Final analysis deliverable
CREATE TABLE IF NOT EXISTS decision_packs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
    analysis_id VARCHAR(100),
    executive_summary TEXT NOT NULL,
    go_no_go VARCHAR(20) NOT NULL, -- "GO", "NO-GO", "CONDITIONAL"
    tranche_plan JSONB, -- Gates and conditions
    risk_map JSONB, -- Array of risks with severity
    what_to_verify TEXT[],
    calibration_audit JSONB, -- Quality metrics
    paraphrase_invariance DECIMAL(3,2),
    fact_table_snapshot JSONB, -- Snapshot of facts at synthesis
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_decision_packs_deal_id ON decision_packs(deal_id);
CREATE INDEX idx_decision_packs_go_no_go ON decision_packs(go_no_go);

-- analysis_metrics: Per-deal analysis quality metrics
CREATE TABLE IF NOT EXISTS analysis_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
    citation_compliance DECIMAL(3,2),
    paraphrase_invariance DECIMAL(3,2),
    overall_depth DECIMAL(5,2),
    confidence_average DECIMAL(3,2),
    processing_time_seconds INTEGER,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_analysis_metrics_deal_id ON analysis_metrics(deal_id);

-- citations: Structured fact citations
CREATE TABLE IF NOT EXISTS citations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id UUID NOT NULL REFERENCES fact_rows(id) ON DELETE CASCADE,
    claim TEXT NOT NULL,
    source TEXT NOT NULL,
    page VARCHAR(50),
    confidence DECIMAL(3,2),
    created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_citations_fact_id ON citations(fact_id);

-- paraphrase_tests: Paraphrase variance testing results
CREATE TABLE IF NOT EXISTS paraphrase_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    cycle_number INTEGER,
    original_prompt TEXT,
    paraphrases TEXT[],
    responses TEXT[],
    variance_score DECIMAL(3,2),
    inconsistencies TEXT[],
    overall_confidence DECIMAL(3,2),
    created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_paraphrase_tests_deal_id ON paraphrase_tests(deal_id);

COMMIT;
