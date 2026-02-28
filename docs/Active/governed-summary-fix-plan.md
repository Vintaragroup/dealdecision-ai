# Fix Plan: Governed Summary — Company Name + Product Narrative

**Status:** PLAN ONLY — no implementation yet  
**Scope:** `governed_summary_v1` and `governed_executive_summary_v1`  
**Target deals:** StackFactor `adb2a1cf`, DealDecision `517be946`, WebMax `23b2fa42`  
**Date:** 2026-03

---

## 1. Root Causes

### Root Cause A — "Startup Corp" placeholder

**Full chain of failures (confirmed by code trace):**

1. `InvestorInsightsJobSchema` (`apps/worker/src/contracts/investor-insights/schemas.ts` line 92) has no `deal_name` field — only `deal_id`, `engine_version`, `force_recompute`, `triggered_by`, `requested_by_user_id`.
2. `generateInvestorInsightsProcessor` (`processor.ts` line 3620) destructures only `deal_id` from the parsed job — **never queries `SELECT name FROM deals WHERE id = $1`**.
3. `buildGovernedSummarySection` signature (`processor.ts` line 2081): `(inputs, previousRecord, engineVersion, governanceVersion)` — **`dealName` parameter absent entirely**.
4. `resolveGovernedSummaryWithCache` call (`processor.ts` line 2113): passes 9 corpus/cache arguments — **`dealName` is silently omitted**.
5. `generateGovernedSummaryV1` user message builder (`governed-summary-v1.ts` ~line 427): `args.dealName ? "Deal: ${args.dealName}\n\n${canonicalCorpus}" : canonicalCorpus` — **the `dealName` guard exists but receives `undefined` every time**.
6. LLM at `temperature: 0` with no identity anchor defaults to "Startup Corp" — a learned placeholder from GPT training distribution.

**Key structural fact:** `deals.name` is the only name field on the deals table (confirmed in `infra/migrations/2025-12-16-000-add-deals-table.sql`). The field exists and always contains the real company name (e.g., "WebMax", "StackFactor", "DealDecision AI"). It is simply never fetched by the processor.

---

### Root Cause B — Overly financial / generic output

**Full chain of failures (confirmed by code trace):**

1. **SYSTEM_PROMPT persona** (`governed-summary-v1.ts` ~line 402):  
   `"You are a financial analyst summarizing a startup investment opportunity for an investor."`  
   This persona framing makes the model lead with financial data and use financial analyst conventions regardless of deal narrative quality.

2. **Total absence of product/narrative corpus.** Complete inventory of `extractPhase2Result` canonical field categories:
   - `raise_terms` (raise_amount, raise_round, raise_instrument, raise_cap, raise_discount, note_interest_rate, note_maturity)
   - `valuation_terms` (valuation_pre, valuation_post, valuation_safe_cap)
   - `market_claims` (tam_value, sam_value, som_value)
   - `traction_signal` (mrr_value, arr_value, revenue_value, growth_rate, customer_count)
   - `use_of_funds` (use_of_funds_buckets)
   - `financial_health` (cash_balance, debt_outstanding, net_cash_burn_monthly, runway_months)
   - `saas_metrics` (churn_pct, retention_pct, cac, ltv)
   - `cap_table` (option_pool_pct, ownership_summary)

   **CONFIRMED: Zero product, problem, solution, differentiation, ICP, or business model fields.**

3. **Insight slots are also financial-only** (confirmed `buildInsightSlotsSection`): raise_terms, market_claims, traction_signal, valuation_terms, use_of_funds — **5 financial/deal-structure slots, zero product slots**.

4. **Corpus ordering is financial-first** (`processor.ts` lines 2116–2128):  
   `canonicalFields → insightSlots → financialStmt → useOfFunds → impliedCapital → financialHealth → financialReconciliation → conflicts`  
   All 7 sections are financial. `gpt-4o-mini` at `max_tokens: 800` weights earlier content more heavily.

5. **`max_tokens: 800`** gives the model severe brevity pressure. Combined with financial-first ordering and a financial analyst persona, the model skips product narrative entirely.

---

## 2. Fix Plan

### Fix A — Pin the company name

**Goal:** Guarantee the deal's real name appears in every generated summary.

#### A1. Fetch `deals.name` in the processor entry point

**File:** `apps/worker/src/jobs/investor-insights/processor.ts`  
**Location:** `generateInvestorInsightsProcessor` parallel data load (~line 3870):

```typescript
// ADD: fetch deal name alongside existing parallel loads
const [coverage, insightSlotInputs, previousFusedFacts, previousGovernedSummary, previousGovernedExecSummary, dealName] = await Promise.all([
  loadCoverageSnapshot(pool, dealId),
  loadInsightSlotInputs(pool, dealId, gateState),
  loadPreviousFusedFacts(pool, dealId),
  loadPreviousGovernedSummary(pool, dealId),
  loadPreviousGovernedExecSummary(pool, dealId),
  loadDealName(pool, dealId),   // ← NEW
]);
```

New helper (add near the other `load*` helpers, ~line 3500):

```typescript
async function loadDealName(pool: Pool, dealId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ name: string }>(
      'SELECT name FROM deals WHERE id = $1 LIMIT 1',
      [dealId]
    );
    return rows[0]?.name ?? null;
  } catch {
    return null;         // fail-open; missing name degrades gracefully
  }
}
```

#### A2. Thread `dealName` through the summary builders

**`buildGovernedSummarySection` signature** (`processor.ts` line 2081):

```typescript
// BEFORE
async function buildGovernedSummarySection(
  inputs: InsightSlotInputs,
  previousRecord: GovernedSummaryRecord | null,
  engineVersion: string,
  governanceVersion: string
)

// AFTER
async function buildGovernedSummarySection(
  inputs: InsightSlotInputs,
  previousRecord: GovernedSummaryRecord | null,
  engineVersion: string,
  governanceVersion: string,
  dealName: string | null,        // ← NEW
)
```

Pass it through to `resolveGovernedSummaryWithCache` (line ~2113):

```typescript
const record = await resolveGovernedSummaryWithCache({
  canonicalFieldsBody,
  insightSlotsBody,
  financialStmtBody,
  useOfFundsBody,
  impliedCapitalBody,
  financialHealthBody,
  financialReconciliationBody,
  conflictsBody,
  dealName,            // ← ADDED
  previousRecord,
  engineVersion,
  governanceVersion,
});
```

Same change applies to `buildGovernedExecutiveSummarySection` (`processor.ts` line 2208) → `resolveGovernedExecSummaryWithCache`.

#### A3. Update call sites

Both call sites that invoke the builders (~line 3884 and ~3891) must pass `dealName`:

```typescript
const governedResult = await buildGovernedSummarySection(
  insightSlotInputs, previousGovernedSummary, engineVersion, VERSION_PINS.governance_version,
  dealName,    // ← ADDED
);
const governedExecResult = await buildGovernedExecutiveSummarySection(
  insightSlotInputs, coverage, gateState, previousGovernedExecSummary, engineVersion, VERSION_PINS.governance_version,
  dealName,    // ← ADDED
);
```

#### A4. Add `validateCompanyName` assertion to governed summary output

**File:** `apps/worker/src/jobs/investor-insights/governed-summary-v1.ts`

After the existing `validateNoNewNumbers` check, add:

```typescript
function validateCompanyName(summary: GovernedSummaryV1, dealName: string | null): boolean {
  if (!dealName) return true;   // nothing to validate when name unknown
  const lower = summary.executive_summary.toLowerCase();
  return lower.includes(dealName.toLowerCase());
}
```

If this returns `false`, set `validation_ok = false` and log `GOVERNED_SUMMARY_COMPANY_NAME_MISSING`. This forces a cache miss and re-generation on the next run.

---

### Fix B — Add product/narrative corpus section

**Goal:** Give the LLM real product description, problem, and differentiation text so it can write a meaningful narrative instead of a financial form letter.

#### B1. Add `buildProductNarrativeBody` extractor

**File:** `apps/worker/src/jobs/investor-insights/processor.ts`  
Add a new function near the other `build*Body` helpers:

```typescript
/**
 * Extract product/narrative text from the first N DPU pages.
 * Pitch decks typically place company description, problem, and solution
 * on slides 1–6. We concatenate the raw text of the first 6 pages that
 * contain at least one of the target keywords, capped at 1000 chars total.
 *
 * This text is passed to the governed summary LLM as [PRODUCT_NARRATIVE]
 * so the model can lead with who/what/why before financial data.
 */
function buildProductNarrativeBody(inputs: InsightSlotInputs): string | null {
  if (inputs.dpuLoadFailed || inputs.dpuPages.length === 0) return null;

  const PRODUCT_KEYWORDS = /\b(?:problem|solution|how it works|differentiat|value proposition|competitive advantage|unique|ICP|customer segment|target market|use case|platform|product|service|technology|software|API|SaaS|marketplace|network|mission)\b/i;

  const candidates = inputs.dpuPages
    .filter(p => PRODUCT_KEYWORDS.test(p.text_raw ?? p.text ?? ""))
    .slice(0, 6);

  if (candidates.length === 0) {
    // fallback: just use the first 3 pages verbatim
    const fallback = inputs.dpuPages.slice(0, 3);
    const text = fallback.map(p => (p.text_raw ?? p.text ?? "").trim()).join("\n---\n").slice(0, 1000);
    return text.length > 50 ? text : null;
  }

  const combined = candidates
    .map(p => (p.text_raw ?? p.text ?? "").trim())
    .join("\n---\n")
    .slice(0, 1000);

  return combined.length > 50 ? combined : null;
}
```

#### B2. Pass `productNarrativeBody` into the summary builders → LLM call

**`buildGovernedSummarySection`** — add one new line after `conflictsBody` is built:

```typescript
const productNarrativeBody = buildProductNarrativeBody(inputs);
```

Pass it to `resolveGovernedSummaryWithCache`:

```typescript
const record = await resolveGovernedSummaryWithCache({
  ...existingArgs,
  dealName,
  productNarrativeBody,   // ← NEW
});
```

**`GovernedSummaryArgs` interface** (`governed-summary-v1.ts`):

```typescript
interface GovernedSummaryArgs {
  // ...existing fields...
  dealName?: string;
  productNarrativeBody?: string;   // ← NEW
}
```

---

### Fix C — Update SYSTEM_PROMPT persona and corpus ordering

**File:** `apps/worker/src/jobs/investor-insights/governed-summary-v1.ts`

#### C1. New SYSTEM_PROMPT

```typescript
// BEFORE
const SYSTEM_PROMPT = `You are a financial analyst summarizing a startup investment opportunity for an investor.`

// AFTER
const SYSTEM_PROMPT = `You are an investment analyst preparing a concise executive summary of a startup investment opportunity for an early-stage investor.

Structure your response as follows:
1. Lead with WHO the company is and WHAT they do (1 sentence, use the exact company name provided).
2. Describe the core problem they solve and WHY their approach is differentiated (1 sentence).
3. Summarize financial position and traction stage (1 sentence).
4. List 2–3 key strengths as bullet points.
5. List 2–3 key risks as bullet points.
6. List 1–2 open diligence questions.

Use ONLY facts present in the corpus below. Do not invent figures, names, or claims. If a fact is unavailable, omit it rather than estimating.`;
```

#### C2. New corpus ordering in `generateGovernedSummaryV1`

```typescript
// BEFORE order: canonicalFields → insightSlots → financialStmt → ... (all financial)

// AFTER order: identity first, narrative second, financial third
const sections: string[] = [];

if (args.dealName) {
  sections.push(`[COMPANY_IDENTITY]\nCompany: ${args.dealName}`);
}
if (args.productNarrativeBody) {
  sections.push(`[PRODUCT_NARRATIVE]\n${args.productNarrativeBody}`);
}
// Market context (from canonical fields: market_claims only)
const marketFields = args.canonicalFieldsBody
  ?.split("\n")
  .filter(l => l.includes("market_claims") || l.includes("traction_signal") || l.includes("customer_count"))
  .join("\n");
if (marketFields) {
  sections.push(`[MARKET_AND_TRACTION]\n${marketFields}`);
}
// Financial data (all remaining canonical fields + structued stmts)
const financialFields = args.canonicalFieldsBody
  ?.split("\n")
  .filter(l => !l.includes("market_claims") && !l.includes("traction_signal"))
  .join("\n");
if (financialFields) {
  sections.push(`[FINANCIAL_SUMMARY]\n${financialFields}`);
}
if (args.insightSlotsBody)         sections.push(`[INSIGHT_SLOTS]\n${args.insightSlotsBody}`);
if (args.financialStmtBody)        sections.push(`[FINANCIAL_STATEMENTS]\n${args.financialStmtBody}`);
if (args.useOfFundsBody)           sections.push(`[USE_OF_FUNDS]\n${args.useOfFundsBody}`);
if (args.impliedCapitalBody)       sections.push(`[IMPLIED_CAPITAL]\n${args.impliedCapitalBody}`);
if (args.financialHealthBody)      sections.push(`[FINANCIAL_HEALTH]\n${args.financialHealthBody}`);
if (args.financialReconciliationBody) sections.push(`[RECONCILIATION]\n${args.financialReconciliationBody}`);
if (args.conflictsBody)            sections.push(`[CONFLICTS]\n${args.conflictsBody}`);

const canonicalCorpus = sections.join("\n\n");
```

---

## 3. Cache Invalidation Strategy

Both `resolveGovernedSummaryWithCache` and `resolveGovernedExecSummaryWithCache` use a SHA-256 fingerprint over the corpus args. Adding `dealName` and `productNarrativeBody` to the fingerprint input **automatically invalidates all existing cached summaries** for every deal. This is the desired behavior — every deal needs re-generation with the new corpus.

**No manual cache purge required.** The fingerprint change is sufficient.

---

## 4. Files to Change

| File | Change | Lines |
|------|--------|-------|
| `apps/worker/src/jobs/investor-insights/processor.ts` | Add `loadDealName(pool, dealId)` helper | ~line 3500 |
| `apps/worker/src/jobs/investor-insights/processor.ts` | Add `loadDealName` to parallel `Promise.all` | ~line 3870 |
| `apps/worker/src/jobs/investor-insights/processor.ts` | Add `dealName` param to `buildGovernedSummarySection` | line 2081 |
| `apps/worker/src/jobs/investor-insights/processor.ts` | Add `dealName` param to `buildGovernedExecutiveSummarySection` | line 2208 |
| `apps/worker/src/jobs/investor-insights/processor.ts` | Add `buildProductNarrativeBody(inputs)` | new function |
| `apps/worker/src/jobs/investor-insights/processor.ts` | Pass `productNarrativeBody` + `dealName` to resolve calls | lines 2113, 2260 |
| `apps/worker/src/jobs/investor-insights/governed-summary-v1.ts` | Add `dealName`, `productNarrativeBody` to `GovernedSummaryArgs` | ~line 355 |
| `apps/worker/src/jobs/investor-insights/governed-summary-v1.ts` | Update `SYSTEM_PROMPT` | ~line 402 |
| `apps/worker/src/jobs/investor-insights/governed-summary-v1.ts` | Reorder corpus into labeled sections | ~line 425 |
| `apps/worker/src/jobs/investor-insights/governed-summary-v1.ts` | Add `validateCompanyName` validator | after `validateNoNewNumbers` |
| `apps/worker/src/jobs/investor-insights/governed-executive-summary-v1.ts` | Mirror all changes from governed-summary-v1 | corresponding lines |

---

## 5. Test Specs

### Unit tests — company name pinning

```
test: buildGovernedSummarySection with dealName="WebMax" 
  → resolveGovernedSummaryWithCache receives dealName="WebMax"
  → LLM user message includes "Deal: WebMax\n\n"

test: buildGovernedSummarySection with dealName=null
  → resolveGovernedSummaryWithCache receives dealName=null
  → LLM user message does NOT crash (null-safe)

test: validateCompanyName("WebMax", summary with "WebMax" in executive_summary)
  → returns true

test: validateCompanyName("StackFactor", summary with "Startup Corp" in executive_summary)
  → returns false → validation_ok = false
```

### Unit tests — product narrative body

```
test: buildProductNarrativeBody with 10 DPU pages, pages 2+4 containing "solution" keyword
  → returns text from pages 2 and 4 concatenated, capped at 1000 chars

test: buildProductNarrativeBody with dpuLoadFailed=true
  → returns null (no crash)

test: buildProductNarrativeBody with pages containing no product keywords
  → returns text from first 3 pages (fallback)
```

### Unit tests — corpus ordering

```
test: generateGovernedSummaryV1 with dealName="DealDecision AI" and productNarrativeBody="AI-powered deal processing"
  → user message starts with "[COMPANY_IDENTITY]\nCompany: DealDecision AI"
  → "[PRODUCT_NARRATIVE]" section appears before "[FINANCIAL_SUMMARY]"
```

### Integration tests — end-to-end summary quality (snapshot tests)

```
test: StackFactor governed_summary_v1 body
  → executive_summary contains "StackFactor"
  → executive_summary does NOT contain "Startup Corp"
  → strengths array has ≥ 1 item grounded in deck signal

test: DealDecision governed_summary_v1 body  
  → executive_summary contains "DealDecision"

test: WebMax governed_summary_v1 body
  → executive_summary contains "WebMax"
```

---

## 6. Implementation Order

1. **[Highest priority]** Fix A1–A3 (fetch + pass `dealName`) — single DB query, low risk, high impact, fixes the most embarrassing regression
2. **[High priority]** Fix A4 (`validateCompanyName`) — adds enforcement so the fix can't silently regress
3. **[Medium priority]** Fix B1–B2 (`buildProductNarrativeBody`) — adds product narrative; note: requires careful testing per deal type to avoid injecting junk (slide footers, table of contents text)
4. **[Medium priority]** Fix C1 (SYSTEM_PROMPT update) — low-risk prompt edit
5. **[Lower priority]** Fix C2 (corpus reordering) — higher risk (fingerprint change regenerates all summaries); do after B is validated

---

## 7. Open Questions Before Implementation

1. **`governed-executive-summary-v1.ts` — does it use the same `GovernedSummaryArgs`?**  
   The exec summary builder mirrors the same pattern as `governed-summary-v1`. Confirm whether it shares the same type or has its own `GovernedExecSummaryArgs` type before threading `dealName`.

2. **Product narrative quality risk.** DPU pages for XLSX-heavy deals (e.g., WebMax) may have very little product text in the first 6 pages. Consider: should `buildProductNarrativeBody` skip `excel_range` pages? Answer: Yes — filter to only `page_type !== "excel_range"` and `page_type !== "excel_sheet"` pages.

3. **`max_tokens: 800` adequacy.** With the new corpus (company identity + product narrative + financial data), the LLM may need up to 1000 tokens to produce a well-structured summary. Recommend bumping to `max_tokens: 1000` alongside the corpus changes.

4. **Cache fingerprint for `productNarrativeBody`.** The body is derived from raw DPU text which changes when documents are re-uploaded. Confirm that `productNarrativeBody` is included in the fingerprint hash (it will be automatically if passed as an arg to `resolveGovernedSummaryWithCache`, but verify).
