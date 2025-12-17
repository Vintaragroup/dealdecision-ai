# LLM Integration - End-to-End Testing Guide

## Quick Start Testing

### Prerequisites
- OpenAI API key (sk-...)
- Database migrations applied
- Node.js environment running

### Step 1: Validate Configuration
```bash
pnpm validate:llm
```

This checks:
- ✅ OPENAI_API_KEY is set and valid
- ✅ All environment variables configured
- ✅ API connectivity to OpenAI
- ✅ Cache and compression settings

### Step 2: Test API Endpoints

#### Start the API server
```bash
cd apps/api
pnpm dev
```

The API will be running on http://localhost:9000

#### Check LLM Health
```bash
curl http://localhost:9000/api/v1/analytics/llm/health
```

Expected response:
```json
{
  "enabled": true,
  "apiKeyConfigured": true,
  "recentErrors": 0,
  "recentCalls": 0
}
```

#### Get Analytics Summary
```bash
curl http://localhost:9000/api/v1/analytics/llm/summary
```

This shows:
- Total API calls
- Total cost
- Average cost per call
- Cache effectiveness
- Error counts

### Step 3: Manual Feature Flag Testing

#### Check current feature flags
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:9000/api/v1/admin/feature-flags
```

#### Set LLM to 10% rollout (gradual)
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"percentage": 10}' \
  http://localhost:9000/api/v1/admin/feature-flags/llm-analysis/percentage
```

#### Disable LLM completely
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:9000/api/v1/admin/feature-flags/llm-analysis/disable
```

#### Re-enable LLM
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:9000/api/v1/admin/feature-flags/llm-analysis/enable
```

### Step 4: Test with Real Deal

#### 1. Create a test deal
```bash
curl -X POST http://localhost:9000/api/v1/deals \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "Test Company",
    "stage": "Series A",
    "target_raise": 1000000
  }'
```

Note the `deal_id` from the response.

#### 2. Upload test documents
```bash
curl -X POST http://localhost:9000/api/v1/documents/upload \
  -H "Content-Type: multipart/form-data" \
  -F "deal_id=<deal_id>" \
  -F "file=@path/to/test.pdf"
```

#### 3. Start analysis
```bash
curl -X POST http://localhost:9000/api/v1/analysis/start \
  -H "Content-Type: application/json" \
  -d '{
    "deal_id": "<deal_id>",
    "max_cycles": 1,
    "analysis_mode": "full"
  }'
```

#### 4. Check analysis progress
```bash
curl http://localhost:9000/api/v1/analysis/status/<deal_id>
```

#### 5. View LLM costs for this deal
```bash
curl http://localhost:9000/api/v1/analytics/llm/deals/<deal_id>
```

Expected response:
```json
{
  "totalCost": 0.032,
  "apiCalls": 1,
  "cacheHits": 0,
  "tokensSaved": 0,
  "costSaved": 0,
  "averageLatencyMs": 1200,
  "errorCount": 0
}
```

### Step 5: Test Different Task Types

The system should route different tasks to different models:

- **fact-extraction** → Qwen 14B (cheap)
- **synthesis** → GPT-4o (best quality)
- **validation** → GPT-4o (strong reasoning)
- **hypothesis-generation** → Qwen 14B (balanced)
- **classification** → Qwen quantized (fastest)
- **chat-response** → GPT-4o (user-facing)
- **query-generation** → Qwen 14B (effective)

Check that costs align with expected model usage.

### Step 6: Test Cache Effectiveness

#### Run same analysis twice
```bash
# First run - should miss cache
curl -X POST http://localhost:9000/api/v1/analysis/start ...

# Check cache metrics
curl http://localhost:9000/api/v1/analytics/llm/cache-effectiveness
```

Expected output shows increased cache hits on second run.

### Step 7: Test Error Handling

#### Disable OpenAI API key
```bash
# Set to invalid key
export OPENAI_API_KEY=sk-invalid
```

#### Try analysis
```bash
curl -X POST http://localhost:9000/api/v1/analysis/start ...
```

Should fail gracefully with informative error message.

#### Re-enable and verify recovery
```bash
export OPENAI_API_KEY=sk-valid...
curl -X POST http://localhost:9000/api/v1/analysis/start ...
```

Should work normally again.

## Automated Testing

### Run Unit Tests
```bash
# Worker LLM tests
cd apps/worker
pnpm test

# Run with coverage
pnpm test -- --coverage
```

### Expected Test Results
- ✅ model-provider: 22/22 passing
- ✅ model-router: 16/16 passing
- ✅ context-compressor: 22/22 passing
- ✅ analysis-cache: 25/25 passing

Total: **85+ tests passing**

## Performance Baseline Testing

### 1. Measure cost per deal
Run 10 analyses and check average cost:
```bash
curl http://localhost:9000/api/v1/analytics/llm/cost-per-deal?limit=10
```

Expected: $0.03-0.04 per deal

### 2. Measure cache effectiveness
```bash
curl http://localhost:9000/api/v1/analytics/llm/cache-effectiveness
```

Expected: 10-20% hit rate after 5+ analyses

### 3. Measure compression effectiveness
Check via analytics endpoint:
```bash
curl http://localhost:9000/api/v1/analytics/llm/summary
```

Look for token savings in metrics.

### 4. Measure latency
```bash
curl http://localhost:9000/api/v1/analytics/llm/cost-trend
```

Check `avgLatencyMs` - should be 800-2000ms for GPT-4o

## Debugging Tips

### Enable detailed logging
```bash
# Set in .env
LOG_LEVEL=debug
LLM_DEBUG=true
```

### Check worker logs
```bash
cd apps/worker
pnpm dev
```

Watch for LLM completion job processing.

### Monitor database
```sql
-- Check recent LLM metrics
SELECT * FROM llm_performance_metrics 
ORDER BY created_at DESC LIMIT 10;

-- Check cache effectiveness
SELECT * FROM llm_cache_metrics 
WHERE created_at > now() - interval '1 hour'
ORDER BY created_at DESC;
```

### Test analytics queries directly
```sql
-- Cost per deal
SELECT deal_id, COUNT(*) as calls, SUM(cost_usd) as cost
FROM llm_performance_metrics
GROUP BY deal_id
ORDER BY cost DESC;

-- Cache hit rate
SELECT 
  SUM(CASE WHEN event_type = 'hit' THEN 1 ELSE 0 END) as hits,
  SUM(CASE WHEN event_type = 'miss' THEN 1 ELSE 0 END) as misses,
  ROUND(100.0 * SUM(CASE WHEN event_type = 'hit' THEN 1 ELSE 0 END) / 
    NULLIF(SUM(CASE WHEN event_type IN ('hit', 'miss') THEN 1 ELSE 0 END), 0), 2) as hit_rate
FROM llm_cache_metrics;
```

## Success Criteria

### ✅ Baseline Metrics
- [ ] Cost per deal: $0.025-0.040
- [ ] Cache hit rate: >5%
- [ ] Error rate: <1%
- [ ] Avg latency: <2000ms

### ✅ Feature Flags
- [ ] Can enable/disable LLM without restart
- [ ] Percentage rollout works (1%, 10%, 50%, 100%)
- [ ] User-based consistency (same user always in/out)

### ✅ Analytics
- [ ] All 8 endpoints responding with valid data
- [ ] Cost calculations accurate
- [ ] Token counts matching API responses
- [ ] Cache metrics being recorded

### ✅ Error Handling
- [ ] Invalid API key caught and logged
- [ ] Rate limits handled gracefully
- [ ] Network errors trigger retries
- [ ] Fallback to non-LLM analysis works

## Next Steps

Once testing is complete:
1. Review DEPLOYMENT_CHECKLIST.md
2. Plan staging deployment
3. Schedule production rollout phases (1% → 10% → 50% → 100%)

---

**Questions?** Check `LLM_INTEGRATION_REFERENCE.md` for detailed architecture info.
