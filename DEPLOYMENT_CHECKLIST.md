# LLM Integration Deployment Checklist

## Pre-Deployment (Hours 0-1)

### Code Review & Testing
- [ ] Run all tests: `pnpm test apps/worker/src/lib/llm`
- [ ] Run cache tests: `pnpm test apps/worker/src/lib/cache`
- [ ] Type check passes: `pnpm --filter worker typecheck`
- [ ] Build succeeds: `pnpm --filter worker build`
- [ ] No lint errors: `pnpm lint apps/worker`
- [ ] Review WEEK_1_IMPLEMENTATION_SUMMARY.md
- [ ] Review LLM_INTEGRATION_REFERENCE.md
- [ ] All 12 core files present and not empty
- [ ] All 4 test suites present and comprehensive

### Environment Setup
- [ ] Get OpenAI API key from team
- [ ] Verify key works: `curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models`
- [ ] Add to `.env.local` (do NOT commit): `OPENAI_API_KEY=sk-...`
- [ ] Create `.env.production` with secrets manager reference
- [ ] Verify all required env vars listed in `.env.example`
- [ ] Document any custom routing configuration needed
- [ ] Set up monitoring dashboard access

### Database Preparation
- [ ] Review schema in `apps/worker/src/lib/llm/analytics.ts`
- [ ] Create migration file for `llm_performance_metrics` table
- [ ] Create migration file for `llm_cache_metrics` table
- [ ] Test migrations on staging database
- [ ] Verify table creation succeeds
- [ ] Verify indexes created
- [ ] Verify foreign keys working
- [ ] Backup production database before deploying

### Documentation Review
- [ ] Read WEEK_1_IMPLEMENTATION_SUMMARY.md
- [ ] Read LLM_INTEGRATION_REFERENCE.md
- [ ] Check JSDoc in all files
- [ ] Verify cost projections are understood
- [ ] Document any deviations from plan
- [ ] Create runbook for common scenarios
- [ ] Set up escalation contacts

## Staging Deployment (Hours 1-3)

### Infrastructure
- [ ] Deploy code to staging
- [ ] Deploy database migrations to staging
- [ ] Verify all files deployed correctly
- [ ] Check `apps/worker/src/lib/llm/` files exist
- [ ] Check `apps/worker/src/lib/cache/` files exist
- [ ] Verify no import errors in logs
- [ ] Test health endpoint returns successful response

### Configuration
- [ ] Set OPENAI_API_KEY in staging
- [ ] Set LLM_CACHE_ENABLED=true
- [ ] Set LLM_COMPRESSION_ENABLED=true
- [ ] Set LLM_ANALYTICS_ENABLED=true
- [ ] Verify all defaults in code are sensible
- [ ] Test with feature flag DISABLED (no actual LLM calls)

### Basic Functionality
- [ ] Application starts without errors
- [ ] No TypeScript compilation errors in logs
- [ ] Health check endpoint works
- [ ] Database tables created successfully
- [ ] Can query empty analytics tables
- [ ] Router initializes with available providers
- [ ] Cache system initializes properly

### Manual Testing (Small scale)
- [ ] Initialize LLM: `const llm = initializeLLM()`
- [ ] Test health: `await llm.start()` (should succeed)
- [ ] Test stats: `await llm.getStats()` (should return structure)
- [ ] Enable feature flag for 1 test deal
- [ ] Run analysis on 1 deal
- [ ] Check response quality
- [ ] Verify cost tracking in database
- [ ] Check cache behavior (miss first, hit second)
- [ ] Monitor logs for errors

### Monitoring Setup
- [ ] Set up cost tracking dashboard
- [ ] Set up error alerting (errors > 5 in 1 minute)
- [ ] Set up cost alert ($10/hour threshold)
- [ ] Set up provider health dashboard
- [ ] Set up cache hit rate monitoring
- [ ] Configure PagerDuty/Slack integration
- [ ] Test alert system with dummy alert

### Rollback Preparation
- [ ] Document feature flag name for disabling LLM
- [ ] Create rollback procedure document
- [ ] Test rollback process
- [ ] Identify what to monitor during rollback
- [ ] Create post-rollback checklist

## Production Deployment (Hours 3-6)

### Pre-Production Validation
- [ ] All staging tests passed
- [ ] Staging cost tracking working
- [ ] All alerts tested and working
- [ ] Rollback tested successfully
- [ ] Team trained on new system
- [ ] On-call rotation updated

### Production Deployment
- [ ] Backup production database
- [ ] Deploy database migrations
- [ ] Verify migrations succeeded
- [ ] Deploy application code
- [ ] Verify no application errors
- [ ] Verify all LLM files deployed
- [ ] Set OPENAI_API_KEY in production
- [ ] Verify imports working (no module errors)

### Feature Flag Rollout
- [ ] Start with LLM feature flag DISABLED
- [ ] Monitor for 15 minutes (should see no LLM calls)
- [ ] Enable flag for 1% of traffic / 5 deals
- [ ] Monitor for 1 hour
  - [ ] Check cost per deal (~$0.032)
  - [ ] Check response quality
  - [ ] Check error rate (should be <1%)
  - [ ] Check cache effectiveness
- [ ] Increase to 10% of traffic / 50 deals
- [ ] Monitor for 2 hours
  - [ ] Repeat all checks above
  - [ ] Verify compression working
  - [ ] Verify caching patterns
- [ ] Increase to 50% of traffic
- [ ] Monitor for 4 hours
- [ ] If all green, increase to 100%

### Post-Deployment Monitoring (First 24 hours)
- [ ] Cost tracking per deal accurate
- [ ] Cache hit rates as expected (~5-20%)
- [ ] Error rate acceptable (<1%)
- [ ] Response quality comparable to baseline
- [ ] No OpenAI API errors
- [ ] Provider health checks working
- [ ] Analytics queries working
- [ ] No database constraint violations
- [ ] Compression working (token counts down ~15%)

### Post-Deployment Monitoring (First week)
- [ ] Daily cost report matches projections
- [ ] Weekly cache effectiveness report
- [ ] Provider reliability stable
- [ ] Task-type breakdowns as expected
- [ ] Cycle-specific costs tracked
- [ ] No systematic errors

## Success Criteria

### Day 1 Metrics
- [ ] 0 critical errors in logs
- [ ] Cost per deal: $0.032 ± 20%
- [ ] Cache hit rate: >5%
- [ ] Error rate: <1%
- [ ] Provider health: 100% uptime
- [ ] Response latency: <2 seconds (50th percentile)

### Week 1 Metrics
- [ ] Cost per deal: $0.032 ± 10%
- [ ] Cache hit rate: 10-15%
- [ ] Compression effectiveness: 12-18% token reduction
- [ ] Error rate: <0.5%
- [ ] Provider health: 99%+ uptime
- [ ] Savings validated vs baseline

### Month 1 Goals
- [ ] Process 100+ deals successfully
- [ ] Verify cost trajectory vs projection
- [ ] Identify optimization opportunities
- [ ] Get team comfortable with system
- [ ] Plan Phase 2 self-hosted deployment

## Issue Response Plan

### High Priority (Response: Immediate)
**Symptom**: LLM returning errors on all requests
- [ ] Check OPENAI_API_KEY validity
- [ ] Check API rate limits not exceeded
- [ ] Check network connectivity
- [ ] Check provider health endpoints
- **Action**: Disable feature flag immediately if >50% error rate

**Symptom**: Cost per deal > $0.10
- [ ] Check compression is enabled
- [ ] Check cache is functioning
- [ ] Check routing preferences
- [ ] Check for runaway token generation
- **Action**: Disable feature flag, investigate

### Medium Priority (Response: 1 hour)
**Symptom**: Cache hit rate < 5% expected
- [ ] Verify cache is enabled
- [ ] Check TTL settings
- [ ] Verify content hashing working
- [ ] Check if same analyses being run
- **Action**: Monitor, adjust configuration

**Symptom**: Specific task type failing
- [ ] Check provider supports model
- [ ] Check task-specific config
- [ ] Review error messages
- [ ] Check provider health for that model
- **Action**: Route to fallback provider

### Low Priority (Response: Next business day)
**Symptom**: Analytics queries slow
- [ ] Create database indexes if missing
- [ ] Check table row count
- [ ] Consider archiving old metrics
- **Action**: Optimize queries, add pagination

## Rollback Procedure

If you need to roll back:

1. **Disable LLM Feature Flag** (immediate)
   ```
   Feature flag: LLM_ENABLED = false
   ```

2. **Verify Disable Works** (5 minutes)
   ```
   Check that new deals don't use LLM
   Verify no new LLM calls in last 2 minutes
   ```

3. **Restore Previous Code** (if needed)
   ```
   Git revert to last known good commit
   Redeploy application
   ```

4. **Monitor Metrics** (30 minutes)
   ```
   Confirm error rate returning to baseline
   Confirm cost tracking stopped
   Check response times normal
   ```

5. **Investigate** (ongoing)
   ```
   Review logs for error patterns
   Check OpenAI API status
   Gather team for post-mortem
   ```

6. **Communicate** (immediate)
   ```
   Notify stakeholders of issue
   Update status page
   Document what happened
   ```

## Sign-Off

**Deployment Date**: _______________
**Deployed By**: _______________
**Reviewed By**: _______________
**Approved By**: _______________

**Pre-Deployment Checklist**: ☐ Complete
**Staging Testing**: ☐ Complete & Passed
**Production Deployment**: ☐ Complete
**Rollout Monitoring**: ☐ Ongoing
**24-Hour Validation**: ☐ Passed

**Go/No-Go Decision**: **[ ] GO  [ ] NO-GO**

Notes:
```
_________________________________________________________________

_________________________________________________________________

_________________________________________________________________
```

---

For questions, see LLM_INTEGRATION_REFERENCE.md or WEEK_1_IMPLEMENTATION_SUMMARY.md
