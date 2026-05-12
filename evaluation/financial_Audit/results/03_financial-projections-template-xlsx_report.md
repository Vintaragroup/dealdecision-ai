# Financial-Projections-Template.xlsx

## File metadata
- **Path**: `/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/evaluation/financial_Audit/Financial-Projections-Template.xlsx`
- **File type**: `.xlsx`
- **Size**: 208.7 KB
- **Sheet count**: 5
- **Sheets**: Startup Expenses, Income Statement, Balance Sheet, Cash Flow Statement, Payroll Expenses

## Extraction summary
- **Extraction method**: direct_openpyxl
- **Extraction succeeded**: Yes
- **Total pages/tables returned**: 5
- **Financial metric tokens detected**: 24
- **Metric families found**: cash, headcount, revenue
- **XLSX facts detected**: Yes
- **Has current-state signals**: Yes
- **Has projection signals**: No
- **Real-estate schema**: No

## Current-state outputs

### Revenue / ARR
- **Current**: `Revenue` | sheet: unknown | cell: Income Statement!?

### Burn Rate
- Not detected

### Runway
- Not detected

### Cash on Hand
- **Current**: `Cash` = 8060 | sheet: unknown | cell: Balance Sheet!Year 1

## Data quality assessment

### Coverage assessment
- **Core metric families covered**: 2/3 (66%)
- **Package quality**: partial

### Integrity signals
- No contradictions detected at extraction layer

### Warnings
- ⚠️ File is 208KB — vision worker bypassed (>500KB threshold). Used direct openpyxl scan.

## Audit findings
### Correct
- ✅ Vision worker successfully extracted structured tables from this workbook
- ✅ Current-period revenue signals found: `Revenue` on sheet `unknown`

## Pass / Fail verdict

**✅ PASS**

- ✓ Current-period revenue detected (6 signals)

## Recommended next action

**none**
