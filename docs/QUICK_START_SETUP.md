# Quick Start Setup Guide - Week 1 LLM Integration

**Status**: Code complete, ready for environment configuration and testing

## 📋 Prerequisites Checklist

Before proceeding, ensure you have:

- [ ] OpenAI API Key (sign up at https://platform.openai.com/api-keys)
- [ ] PostgreSQL database running (should already be set up)
- [ ] Redis server running (should already be set up)
- [ ] Node.js & pnpm installed

## 🚀 Setup Steps (5 minutes)

### Step 1: Configure OpenAI API Key

Copy `.env.example` to `.env` and add your API key:

```bash
# Create .env file (if it doesn't exist)
cp .env.example .env

# Edit .env and replace with your actual API key
# OPENAI_API_KEY=sk-your-actual-key-here
```

Or set it directly in your terminal:

```bash
export OPENAI_API_KEY="sk-your-actual-key-here"
```

### Step 2: Validate Configuration

Run the validation script to ensure everything is configured correctly:

```bash
pnpm validate:llm
```

**Expected Output:**
```
✓ LLM Enabled
✓ API Key Configured
✓ Cache Enabled
✓ Compression Enabled
✓ Analytics Enabled

✅ Validation PASSED - Configuration is ready
```

If you see errors, check:
1. `.env` file exists in root directory
2. `OPENAI_API_KEY` is set and starts with `sk-`
3. No quotes around the key value in `.env`

### Step 3: Run Unit Tests

Verify all components are working:

```bash
cd apps/worker
pnpm test
```

**Expected**: All 85+ tests should pass with no failures

### Step 4: Apply Database Migrations

Create the necessary tables for LLM analytics:

```bash
pnpm db:migrate
```

This creates:
- `llm_performance_metrics` - Tracks all API calls and costs
- `llm_cache_metrics` - Tracks cache effectiveness

### Step 5: Start Development Environment

In separate terminals, start:

**Terminal 1: API Server**
```bash
pnpm dev
```

**Terminal 2: Worker Processes** (if not started by pnpm dev)
```bash
cd apps/worker && pnpm dev
```

### Step 6: Verify System is Running

Check the health endpoints:

```bash
# LLM health check
curl http://localhost:9000/api/v1/analytics/llm/health

# Expected response:
# {
#   "enabled": true,
#   "apiKeyConfigured": true,
#   "recentErrors": 0,
#   "recentCalls": 0
# }
```

## 📊 Testing the Integration

Once the system is running, follow the `LLM_TESTING_GUIDE.md` for comprehensive testing:

```bash
# Basic health check
curl http://localhost:9000/api/v1/admin/health

# Check feature flags
curl http://localhost:9000/api/v1/admin/feature-flags

# View analytics summary
curl http://localhost:9000/api/v1/analytics/llm/summary
```

## 🔑 Key Environment Variables Explained

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENAI_API_KEY` | ✅ Yes | - | OpenAI API authentication key |
| `LLM_ENABLED` | No | `true` | Master enable/disable flag |
| `LLM_CACHE_ENABLED` | No | `true` | Enable content-hash caching |
| `LLM_CACHE_TTL_DAYS` | No | `7` | Cache validity period (1-30 days) |
| `LLM_COMPRESSION_ENABLED` | No | `true` | Enable context compression |
| `LLM_PERCENTAGE` | No | `100` | Gradual rollout percentage (0-100) |
| `ADMIN_TOKEN` | No | (none) | Bearer token for admin API |

## 📈 Expected Performance Metrics

After first analysis run, you should see:

- **Cost per deal**: $0.028-0.040 (depends on document size)
- **Context compression**: 15% token reduction
- **Cache effectiveness**: 20% API reduction on repeated analyses
- **Latency**: 2-5 seconds per analysis (with network)

## 🐛 Troubleshooting

### "API Key validation failed"
```bash
# Check key is valid and starts with 'sk-'
echo $OPENAI_API_KEY

# Key should look like: sk-proj-abc123xyz...
```

### "Cannot connect to database"
```bash
# Start PostgreSQL
docker compose -f infra/docker-compose.yml up postgres

# Apply migrations
pnpm db:migrate
```

### "Redis connection error"
```bash
# Start Redis
docker compose -f infra/docker-compose.yml up redis
```

### Tests failing with TypeScript errors
```bash
# Ensure correct version of dependencies
pnpm install

# Rebuild TypeScript
pnpm typecheck
```

## 📚 Next After Setup

1. **Quick Testing** (30 minutes)
   - Follow steps in `LLM_TESTING_GUIDE.md`
   - Test basic health endpoints
   - Upload a sample document for analysis

2. **Feature Flag Testing** (30 minutes)
   - Enable/disable LLM analysis
   - Test percentage-based rollout (1%, 10%, 100%)
   - Verify correct users are included

3. **Analytics Verification** (30 minutes)
   - Check cost tracking accuracy
   - Validate cache hit rates
   - Review performance metrics

4. **Staging Deployment** (see `DEPLOYMENT_CHECKLIST.md`)
   - Deploy to staging environment
   - Run full integration tests
   - Monitor for 24 hours

5. **Production Rollout** (see `DEPLOYMENT_CHECKLIST.md`)
   - Start at 1% traffic
   - Gradually increase to 100%
   - Monitor metrics continuously

## ✅ Setup Checklist

- [ ] OpenAI API key obtained
- [ ] `.env` file configured with API key
- [ ] `pnpm validate:llm` passes all checks
- [ ] All unit tests pass (`pnpm test` in apps/worker)
- [ ] Database migrations applied (`pnpm db:migrate`)
- [ ] Development environment running (`pnpm dev`)
- [ ] Health endpoint responds (`curl http://localhost:9000/api/v1/analytics/llm/health`)
- [ ] Ready to begin integration testing

## 🎯 Estimated Timeline

- Setup: 5-10 minutes
- Validation: 2-3 minutes  
- Testing: 1-2 hours
- Total time to verified deployment: 2-3 hours

---

**Questions?** See:
- Architecture: `LLM_INTEGRATION_REFERENCE.md`
- Testing procedures: `LLM_TESTING_GUIDE.md`
- Deployment: `DEPLOYMENT_CHECKLIST.md`
- Full summary: `INTEGRATION_COMPLETE.md`
