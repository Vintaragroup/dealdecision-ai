# Priority Classification System

## Overview

Priority classification automatically determines a deal's investment priority based on 4 key factors:
1. **Deal Score** (confidence metrics) - 0-40 points
2. **Document Completeness** - 0-25 points
3. **Stage Position** (workflow progress) - 0-20 points
4. **Evidence Quality** (verified findings) - 0-15 points

Total score determines priority level:
- **High**: 70+ points
- **Medium**: 40-69 points
- **Low**: 0-39 points

## Scoring Breakdown

### Factor 1: Deal Score (0-40 points)
Represents the AI-calculated confidence in the deal's investment viability.

| Score Range | Points |
|-------------|--------|
| ≥ 80% | 40 |
| ≥ 70% | 30 |
| ≥ 60% | 20 |
| ≥ 50% | 10 |
| < 50% | 0 |

**Rationale**: Higher confidence scores indicate more thorough analysis and stronger investment case.

### Factor 2: Document Completeness (0-25 points)
Measures the depth of due diligence documentation provided.

| Documents | Points |
|-----------|--------|
| 4+ | 25 |
| 3 | 18 |
| 2 | 12 |
| 1 | 6 |
| 0 | 0 |

**Rationale**: More documents = more comprehensive information for decision-making. Weighted curve encourages getting to 4+ docs.

### Factor 3: Stage Position (0-20 points)
Reflects how far the deal has progressed through the workflow.

| Stage | Points | Meaning |
|-------|--------|---------|
| pitched | 20 | Investment decision made |
| ready_decision | 18 | DD complete, high confidence |
| in_diligence | 10 | Actively addressing gaps |
| under_review | 5 | Initial analysis complete |
| intake | 0 | Just starting, docs uploaded |

**Rationale**: Later stages indicate more mature deals with more investor commitment.

### Factor 4: Evidence Quality (0-15 points)
Counts verified findings and support for investment thesis.

| Evidence Count | Points |
|---|---|
| ≥ 5 | 15 |
| ≥ 3 | 10 |
| ≥ 1 | 5 |
| 0 | 0 |

**Rationale**: More evidence = stronger, more defensible investment decision.

## Automatic Updates

Priority is automatically recalculated when:
1. **Deal stage progresses** - new stage position changes weighting
2. **Documents are uploaded** - document count increases
3. **Analysis completes** - score is calculated and evidence is extracted
4. **Manual recalculation** - triggered via API endpoints

## API Endpoints

### Recalculate All Deal Priorities
```bash
POST /api/v1/deals/batch/recalculate-priorities
Content-Type: application/json

{}
```

**Response**:
```json
{
  "message": "All deal priorities recalculated",
  "stats": {
    "updated": 27,
    "high": 5,
    "medium": 12,
    "low": 10
  },
  "timestamp": "2025-12-17T03:42:19.455Z"
}
```

### Recalculate Single Deal Priority
```bash
POST /api/v1/deals/:dealId/recalculate-priority
Content-Type: application/json

{}
```

**Response**:
```json
{
  "dealId": "10efd7bf-e4be-4bc3-9e24-1e66158e5dc1",
  "name": "Cino",
  "oldPriority": "low",
  "newPriority": "low",
  "message": "Priority recalculated for deal Cino"
}
```

## Priority Distribution Example

Starting state (all deals in intake stage):
```
Priority Distribution:
  High:   0 deals
  Medium: 0 deals
  Low:   27 deals
```

As analysis progresses, deals move through stages and their priorities update:
```
Priority Distribution (after active DD):
  High:   5 deals (scored 80+%, in ready_decision/pitched)
  Medium: 12 deals (scored 60-79%, in in_diligence)
  Low:   10 deals (scored <60% or in early stages)
```

## Future Enhancements

Priority classification can be further refined with:
1. **Investor Profile Matching** - weight by investor's industry/stage preferences
2. **Opportunity Size** - incorporate TAM and market growth potential
3. **Risk Profile** - adjust based on portfolio risk tolerance
4. **Team Experience** - weight founder track record and team quality
5. **Custom Weighting** - allow investors to define their own priority weights

These additions will enable personalized deal rankings based on individual firm investment criteria.

## Implementation Details

**File**: `apps/api/src/services/priorityClassification.ts`

Key functions:
- `classifyPriority(factors)` - Calculates priority score from metrics
- `updateDealPriority(dealId)` - Updates single deal priority
- `updateAllDealPriorities()` - Batch update all deals

Integration points:
- Automatically called when stage progresses
- Triggered after document upload
- Triggered after analysis completion
