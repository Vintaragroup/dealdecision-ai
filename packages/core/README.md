# HRM-DD Data Model Foundation

## Overview

This package contains the complete type system and data model for the **Hierarchical Reasoning Model for Due Diligence (HRM-DD)** analysis engine. It implements the multi-cycle investment analysis framework as specified in the HRM-DD SOP v2.0.

## Package Structure

```
packages/core/
├── src/
│   ├── types/
│   │   ├── hrmdd.ts           # Core HRM-DD types (FactRow, PlannerState, etc.)
│   │   ├── analysis.ts        # Cycle execution and orchestration types
│   │   └── validation.ts      # Validation rules and constants
│   └── index.ts               # Public API exports
```

## Core Concepts

### 1. **FactRow** - Atomic Evidence Unit
The foundational unit of the analysis system. Each fact represents a single verifiable claim.

```typescript
interface FactRow {
  id: string;                          // UUID
  claim: string;                       // Falsifiable statement (≤200 chars)
  source: "deck.pdf" | string;        // Source document
  page: number | string;              // Page reference
  confidence: number;                 // 0.0-1.0 (for calibration)
  created_cycle: number;              // Which cycle identified this fact
}
```

**Rules:**
- Claims must be falsifiable and ≤200 characters
- Source must be: "deck.pdf", URL, or "uncertain"
- Confidence drives calibration scoring
- Immutable once created (track evolution via cycles)

### 2. **PlannerState** - Persistent Analysis Memory
Tracks goals, hypotheses, and constraints across all cycles.

```typescript
interface PlannerState {
  cycle: number;                      // Current cycle
  goals: string[];                    // Investment evaluation objectives
  constraints: string[];              // Analysis rules (e.g., "cite-or-uncertain")
  hypotheses: string[];               // High-level testable assumptions
  subgoals: string[];                 // Derived questions
  focus: string;                      // Current investigation priority
  stop_reason: string | null;         // Analysis termination reason
}
```

**Usage:**
- Persists across all cycles (1→2→3)
- Enables coherent multi-cycle reasoning
- Updated after each cycle completes
- Drives "stop or continue" decisions

### 3. **WorkerDiff** - Incremental Analysis Output
Represents the delta from a single analysis pass (one cycle, one worker).

```typescript
interface WorkerDiff {
  worker_id: string;                  // Analysis worker identifier
  result: string;                     // Text analysis output
  evidence: Evidence[];               // Supporting quotes/citations
  errors: string[];                   // Errors encountered
  new_candidates: string[];           // New hypotheses found
  facts_added: FactRow[];             // Facts extracted
  confidence_updates: Record<...>;    // Fact confidence adjustments
}
```

### 4. **LedgerManifest** - Audit Scoreboard
Comprehensive audit trail of analysis activity and quality.

```typescript
interface LedgerManifest {
  cycles: number;                     // Cycles completed
  depth_delta: number[];              // Depth progression per cycle
  subgoals: number;                   // Subgoals addressed
  constraints: number;                // Constraints checked
  dead_ends: number;                  // Disproven hypotheses
  paraphrase_invariance: number;      // Consistency (0-1)
  calibration: Record<string, number>; // Brier score, etc.
}
```

### 5. **DecisionPack** - Final Deliverable
Complete analysis result with full reasoning audit trail.

```typescript
interface DecisionPack {
  executive_summary: string;          // ≤1 page
  go_no_go: "GO" | "NO-GO" | "CONDITIONAL";
  tranche_plan: TrancheGate[];        // Investment gates
  risk_map: RiskItem[];               // Risks with severity
  what_to_verify: string[];           // Next steps
  calibration_audit: Record<...>;     // Quality metrics
  paraphrase_invariance: number;      // Consistency score
  ledger: LedgerManifest;             // Activity audit log
  fact_table: FactRow[];              // All extracted facts
}
```

## Analysis Cycle Types

### Cycle 1: Broad Scan
- **Focus:** Hypothesis generation + uncertainty mapping
- **Output:** High-level hypotheses, uncertainties, preliminary constraints
- **Success Criteria:** Key questions identified, uncertainty mapped
- **DepthΔ Threshold:** ≥2.0 = continue to Cycle 2

### Cycle 2: Deep Dive
- **Focus:** Uncertainty resolution + hypothesis pressure testing
- **Output:** Evidence assessment, constraint validation
- **Success Criteria:** Binding constraints clear, evidence coverage adequate
- **DepthΔ Threshold:** ≥2.0 = continue to Cycle 3

### Cycle 3: Synthesis
- **Focus:** Final recommendation + gating plan
- **Output:** GO/NO-GO decision, risk map, tranche plan
- **Success Criteria:** Investment decision ready
- **Stop Condition:** Final synthesis complete

## Validation Rules

### Citation Discipline
```typescript
// All claims must be cited or marked "uncertain"
const CITATION_RULES = {
  REQUIRE_CITATION: true,
  ALLOWED_SOURCE_TYPES: ["deck.pdf", "document", "url"],
  QUOTE_MAX_LENGTH: 500,
};
```

### Fact Validation
```typescript
const FACT_VALIDATION = {
  CLAIM_MAX_LENGTH: 200,
  CLAIM_MIN_LENGTH: 10,
  ALLOWED_SOURCES: ["deck.pdf", "uncertain"],
  CONFIDENCE_MIN: 0.0,
  CONFIDENCE_MAX: 1.0,
};
```

### Confidence Thresholds
```typescript
const CONFIDENCE_THRESHOLDS = {
  READY_FOR_DECISION: 0.70,  // Stage progression threshold
  HIGH_CONFIDENCE: 0.80,
  MEDIUM_CONFIDENCE: 0.60,
  LOW_CONFIDENCE: 0.40,
};
```

## Database Schema

HRM-DD analysis data is persisted in dedicated tables:

| Table | Purpose |
|-------|---------|
| `fact_rows` | Atomic evidence units |
| `planner_states` | Per-deal analysis state |
| `analysis_cycles` | Cycle execution records |
| `cycle_outputs` | Structured cycle results |
| `ledger_manifests` | Activity audit logs |
| `decision_packs` | Final analysis deliverables |
| `analysis_metrics` | Quality metrics per deal |
| `citations` | Fact citation references |
| `paraphrase_tests` | Consistency testing results |

**Migration:** `infra/migrations/2025-12-17-001-add-hrmdd-analysis-tables.sql`

## Integration with Existing System

### Deal Flow
```
Deal Created (stage: intake)
    ↓
Documents Uploaded → Evidence Extracted
    ↓
Analysis Triggered (run_analysis job)
    ↓
Cycle 1: Broad Scan → PlannerState + Facts
    ↓
Cycle 2: Deep Dive → More Facts + Constraints (if DepthΔ ≥ 2.0)
    ↓
Cycle 3: Synthesis → DecisionPack (if DepthΔ ≥ 2.0)
    ↓
Deal Auto-Progress (intake → under_review → in_diligence → ready_decision)
```

### API Contracts
New types added to `packages/contracts`:
- `AnalysisRequest` - Request parameters
- `AnalysisProgress` - Real-time progress tracking
- `AnalysisResult` - Final result summary

## Next Phases

### Phase 2: Analysis Engine
- Planner state management service
- Cycle orchestration service
- Ledger tracking service
- Prompt generation service

### Phase 3: LLM Integration
- System prompts for Cycle 1/2/3
- Citation enforcement prompts
- Paraphrase variance testing
- Confidence calibration

## Usage Examples

```typescript
// Create initial planner state
const plannerState: PlannerState = {
  cycle: 1,
  goals: [
    "Validate market & problem",
    "Verify predictive validity",
    "Quantify monetization realism",
    "Team/competition assessment"
  ],
  constraints: ["deck-facts-only", "cite-or-uncertain"],
  hypotheses: [],
  subgoals: [],
  focus: "Initial market validation",
  stop_reason: null,
};

// Track extracted facts
const facts: FactRow[] = [
  {
    id: uuid(),
    claim: "Market TAM exceeds $10B annually",
    source: "deck.pdf",
    page: "3",
    confidence: 0.85,
    created_cycle: 1,
  },
];

// Build decision pack after synthesis
const decision: DecisionPack = {
  executive_summary: "Strong market opportunity with execution risk",
  go_no_go: "CONDITIONAL",
  tranche_plan: [
    { tranche: "T0", condition: "Proof of CAC reduction", trigger: "3-month ops review" }
  ],
  risk_map: [
    { risk: "Market timing", severity: "high", mitigation: "Accelerate GTM", evidence: "..." }
  ],
  what_to_verify: ["Binding customer contracts", "Team references"],
  calibration_audit: { brier: 0.18, citation_compliance: 0.95 },
  paraphrase_invariance: 0.88,
  ledger: manifest,
  fact_table: facts,
};
```

## Constants & Enums

See `packages/core/src/types/validation.ts` for:
- `DEPTH_THRESHOLDS` - Cycle continuation criteria
- `CALIBRATION_RANGES` - Quality score ranges
- `RISK_SEVERITY_SCORES` - Risk weighting
- `DEFAULT_LLM_CONFIGS` - Per-cycle LLM settings
- `StopReason` - Analysis termination reasons
- `AnalysisResultCode` - Job result codes

## Testing

Mock data and test utilities will be added in Phase 2 under `packages/core/src/__tests__/`.

## References

- **HRM-DD SOP:** `/docs/Docs_received_by_Ryan/HRM-DD SOP (DealDecision AI).md`
- **System Architecture:** `/docs/Docs_received_by_Ryan/DealDecision AI - Full System Architecture.md`
- **Database Schema:** `infra/migrations/2025-12-17-001-add-hrmdd-analysis-tables.sql`
