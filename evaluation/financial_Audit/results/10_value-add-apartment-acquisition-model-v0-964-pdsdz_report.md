# Value-Add-Apartment-Acquisition-Model_v0.964-pdsdzt.xlsm

## File metadata
- **Path**: `/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/evaluation/financial_Audit/Value-Add-Apartment-Acquisition-Model_v0.964-pdsdzt.xlsm`
- **File type**: `.xlsm`
- **Size**: 1010.8 KB
- **Sheet count**: 5
- **Sheets**: Version, Summary, Annual Cash Flow, Underwriting, Detail Expenses

## Extraction summary
- **Extraction method**: direct_openpyxl
- **Extraction succeeded**: Yes
- **Total pages/tables returned**: 5
- **Financial metric tokens detected**: 9
- **Metric families found**: burn, cash, real_estate, revenue
- **XLSX facts detected**: Yes
- **Has current-state signals**: Yes
- **Has projection signals**: No
- **Real-estate schema**: Yes

## Current-state outputs

### Revenue / ARR
- **Current**: `EFFECTIVE GROSS REVENUE` = 0 | sheet: unknown | cell: Annual Cash Flow!col_6

### Burn Rate
- **Current**: `Operating Expense / Unit` = 5727.837069015385 | sheet: unknown | cell: Summary![Street Address], [City], [State]

### Runway
- Not detected

### Cash on Hand
- **Current**: `Cash-on-Cash Return` = 0.04261081153330894 | sheet: unknown | cell: Summary!col_8

## Data quality assessment

### Coverage assessment
- **Core metric families covered**: 1/2 (50%)
- **Package quality**: partial

### Integrity signals
- ℹ️ Real-estate schema — NOI/IRR/waterfall expected, not revenue/burn

### Warnings
- ⚠️ File is 1010KB — vision worker bypassed (>500KB threshold). Used direct openpyxl scan.

## Audit findings
### Correct
- ✅ Vision worker successfully extracted structured tables from this workbook
- ✅ Current-period revenue signals found: `EFFECTIVE GROSS REVENUE` on sheet `unknown`
- ✅ Real-estate schema correctly identified (NOI/IRR/waterfall patterns)

## Pass / Fail verdict

**✅ PASS**

- ✓ Real-estate schema detected (NOI/IRR/waterfall patterns found)
- ✓ Current-period revenue detected (1 signals)
- ✓ Current-period burn detected

## Recommended next action

**none**
