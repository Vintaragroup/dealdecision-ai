# financial-model-template-cmu-compton-10-12-23-1.xlsx

## File metadata
- **Path**: `/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/evaluation/financial_Audit/financial-model-template-cmu-compton-10-12-23-1.xlsx`
- **File type**: `.xlsx`
- **Size**: 1062.3 KB
- **Sheet count**: 23
- **Sheets**: Notes, Stmts Summ, Stmts Monthly, Revenues, Deal Profiles, Emp Input, Op Exp Summ, Eng Summ, Operations, Dev … (+13 more)

## Extraction summary
- **Extraction method**: direct_openpyxl
- **Extraction succeeded**: Yes
- **Total pages/tables returned**: 23
- **Financial metric tokens detected**: 180
- **Metric families found**: cash, gross_margin, headcount, revenue
- **XLSX facts detected**: Yes
- **Has current-state signals**: Yes
- **Has projection signals**: Yes
- **Real-estate schema**: No

## Current-state outputs

### Revenue / ARR
- **Current**: `Use "Toggle Cell" in Revenues tab to run "What If" bookings attainment scenarios - What happens to results & cash if we hit revenues of 90%, 75%, etc.` | sheet: unknown | cell: Notes!?
- **Projected**: `Revenues & Deal Profiles tabs contain a pretty straightforward revenue model - a "named" forecast by customer & product and in terms of ; many situations are more complex and will require more build up calculations` | sheet: unknown | cell: Notes!? | ⚠ projected

### Burn Rate
- Not detected

### Runway
- Not detected

### Cash on Hand
- **Current**: `Stmts Summ & Stmts Monthly tabs contain detailed & summary monthly & quarterly Income Statements, Balance Sheets and Cash Flows for 2 years; future years more summarized & uses general % change cells` | sheet: unknown | cell: Notes!?

## Data quality assessment

### Coverage assessment
- **Core metric families covered**: 2/3 (66%)
- **Package quality**: partial

### Integrity signals
- No contradictions detected at extraction layer

### Warnings
- ⚠️ File is 1062KB — vision worker bypassed (>500KB threshold). Used direct openpyxl scan.

## Audit findings
### Correct
- ✅ Vision worker successfully extracted structured tables from this workbook
- ✅ Current-period revenue signals found: `Use "Toggle Cell" in Revenues tab to run "What If" bookings attainment scenarios - What happens to results & cash if we hit revenues of 90%, 75%, etc.` on sheet `unknown`
- ✅ Large workbook (23 sheets) — multi-tab financial model

## Pass / Fail verdict

**✅ PASS**

- ✓ Current-period revenue detected (10 signals)

## Recommended next action

**none**
