# Automatic Deal Stage Progression

## Overview

The system automatically progresses deals through stages based on objective metrics. Users can still manually override stages at any time.

## Progression Rules

### Idea → Progress
**Triggers when:**
- Deal has 3+ documents uploaded, OR
- Deal score reaches 40+

**Use case:** Early concept gets real documentation or initial scoring analysis.

### Progress → Ready (Investor Ready)
**Triggers when:**
- Score >= 70, AND
- 5+ documents uploaded, AND
- Deal has been analyzed (DIO analysis complete)

**Use case:** Deal has substantial documentation, good metrics, and AI analysis.

### Ready → Pitched
**Triggers when:**
- Score >= 85, AND
- 8+ documents uploaded, AND
- 3+ evidence items collected

**Use case:** Deal is well-documented, high-scoring, and has strong evidence trail.

## How It Works

### Automatic Checks
Stage progression is automatically evaluated in three scenarios:

1. **Document Upload**
   - When a document is uploaded to a deal, the system checks if it now meets progression criteria
   - Response includes `stage_progression` field indicating if deal advanced
   - Example: Uploading the 3rd document to an "idea" stage deal triggers → "progress"

2. **Deal Analysis**
   - When analysis completes, the system evaluates if the deal now qualifies for next stage
   - Worker processes this after AI analysis finishes

3. **Manual Check**
   - Call `POST /api/v1/deals/{dealId}/auto-progress` to manually trigger evaluation
   - Always safe - only progresses if conditions are met

### API Responses

#### Document Upload Response
```json
{
  "document": { /* document object */ },
  "job_status": "queued",
  "job_id": "...",
  "stage_progression": {
    "progressed": true,
    "newStage": "progress"
  }
}
```

#### Auto-Progress Endpoint
```json
{
  "progressed": true,
  "newStage": "ready",
  "message": "Deal automatically progressed from progress to ready"
}
```

## Manual Override

Users can always manually change a deal's stage via the UI or API:
- `PUT /api/v1/deals/{dealId}` with `{ "stage": "desired_stage" }`
- Manual stage changes take precedence over automatic progression
- No restrictions on forward/backward movement

## Reversing Stages

If metrics drop (e.g., documents deleted, score decreases), deals do NOT automatically regress. Users must manually move them backward if needed.

## Extensibility

Rules are defined in `apps/api/src/services/stageProgression.ts`:

```typescript
const progressionRules: StageProgressionRule[] = [
  {
    fromStage: "idea",
    toStage: "progress",
    conditions: (m) => m.documentCount >= 3 || m.score >= 40,
    description: "Has 3+ documents or score >= 40"
  },
  // ... more rules
];
```

To add new rules:
1. Add new rule object to `progressionRules` array
2. Define `fromStage`, `toStage`, `conditions` function, and `description`
3. Restart the API service

## Metrics Used in Conditions

Available metrics when evaluating progression:
- `score` - Deal's current score (0-100)
- `documentCount` - Number of documents uploaded
- `daysInCurrentStage` - How long deal has been in current stage
- `hasAnalysis` - Whether DIO analysis version exists
- `hasEvidenceCount` - Number of evidence items linked to deal

## Business Logic Summary

| Stage | Duration | Key Triggers | Next Stage |
|-------|----------|--------------|-----------|
| Idea | Early concept | 3 docs OR score 40+ | Progress |
| Progress | Development | Score 70+ AND 5+ docs AND analyzed | Ready |
| Ready | Investor ready | Score 85+ AND 8+ docs AND 3+ evidence | Pitched |
| Pitched | Deal closed | N/A | Complete |

