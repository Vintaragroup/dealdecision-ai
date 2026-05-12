# Tech-Startup-Financial-statement-template.xlsx

## File metadata
- **Path**: `/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/evaluation/financial_Audit/Tech-Startup-Financial-statement-template.xlsx`
- **File type**: `.xlsx`
- **Size**: 100.8 KB
- **Sheet count**: 8
- **Sheets**: Summary, Financial Summary, Assumptions, Income Statement, Balance Sheet, Financials - 3 yr projection, Revenue, Headcount

## Extraction summary
- **Extraction method**: direct_openpyxl
- **Extraction succeeded**: Yes
- **Total pages/tables returned**: 8
- **Financial metric tokens detected**: 35
- **Metric families found**: burn, cash, ebitda, gross_margin, headcount, revenue
- **XLSX facts detected**: Yes
- **Has current-state signals**: Yes
- **Has projection signals**: No
- **Real-estate schema**: No

## Current-state outputs

### Revenue / ARR
- **Current**: `Please explain and justify any assumptions you made that drive revenue growth and expenses here:` | sheet: unknown | cell: Summary!?

### Burn Rate
- **Current**: `Change in Cash (Burn)` = -23316.8375 | sheet: unknown | cell: Financial Summary!Q1 2021 Actual

### Runway
- Not detected

### Cash on Hand
- **Current**: `Beginning Cash Balance` = 200000.0 | sheet: unknown | cell: Summary!col_2

## Data quality assessment

### Coverage assessment
- **Core metric families covered**: 3/3 (100%)
- **Package quality**: complete

### Integrity signals
- No contradictions detected at extraction layer

### Warnings
- ⚠️ File is 100KB — vision worker bypassed (>500KB threshold). Used direct openpyxl scan.

## Audit findings
### Correct
- ✅ Vision worker successfully extracted structured tables from this workbook
- ✅ Current-period revenue signals found: `Please explain and justify any assumptions you made that drive revenue growth and expenses here:` on sheet `unknown`

## Pass / Fail verdict

**✅ PASS**

- ✓ Current-period revenue detected (21 signals)
- ✓ Current-period burn detected

## Recommended next action

**none**
