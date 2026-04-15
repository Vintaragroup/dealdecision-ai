# sf_blog_model.xlsx

## File metadata
- **Path**: `/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/evaluation/financial_Audit/sf_blog_model.xlsx`
- **File type**: `.xlsx`
- **Size**: 253.3 KB
- **Sheet count**: 8
- **Sheets**: Sources & Uses, Assumptions, Financial Statements & Detail, Cashflow, OPEX, Sheet6, Sheet7, Sheet8

## Extraction summary
- **Extraction method**: direct_openpyxl
- **Extraction succeeded**: Yes
- **Total pages/tables returned**: 5
- **Financial metric tokens detected**: 16
- **Metric families found**: burn, cash, ebitda, gross_margin, headcount, real_estate, revenue
- **XLSX facts detected**: Yes
- **Has current-state signals**: Yes
- **Has projection signals**: No
- **Real-estate schema**: Yes

## Current-state outputs

### Revenue / ARR
- **Current**: `Revenue and COS Detail` | sheet: unknown | cell: Financial Statements & Detail!?

### Burn Rate
- **Current**: `Assumptions throughout the model are in blue and are included in the Assumptions and OPEX tabs;` | sheet: unknown | cell: Sources & Uses!?

### Runway
- Not detected

### Cash on Hand
- **Current**: `Debt drawdowns row 248 needs to be manually adjusted to change cash position` | sheet: unknown | cell: Sources & Uses!?

## Data quality assessment

### Coverage assessment
- **Core metric families covered**: 2/2 (100%)
- **Package quality**: complete

### Integrity signals
- ℹ️ Real-estate schema — NOI/IRR/waterfall expected, not revenue/burn

### Warnings
- ⚠️ File is 253KB — vision worker bypassed (>500KB threshold). Used direct openpyxl scan.

## Audit findings
### Correct
- ✅ Vision worker successfully extracted structured tables from this workbook
- ✅ Current-period revenue signals found: `Revenue and COS Detail` on sheet `unknown`
- ✅ Real-estate schema correctly identified (NOI/IRR/waterfall patterns)

## Pass / Fail verdict

**✅ PASS**

- ✓ Real-estate schema detected (NOI/IRR/waterfall patterns found)
- ✓ Current-period revenue detected (3 signals)
- ✓ Current-period burn detected

## Recommended next action

**none**
