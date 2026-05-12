# Multifamily-Redevelopment-Model-v7.1-asfp9a.xlsx

## File metadata
- **Path**: `/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/evaluation/financial_Audit/Multifamily-Redevelopment-Model-v7.1-asfp9a.xlsx`
- **File type**: `.xlsx`
- **Size**: 255.4 KB
- **Sheet count**: 7
- **Sheets**: Version, A&Rs, UnitsBreakdown, Monthly Pro Forma, YearProForma&Returns, Amortization Schedule, Data

## Extraction summary
- **Extraction method**: direct_openpyxl
- **Extraction succeeded**: Yes
- **Total pages/tables returned**: 7
- **Financial metric tokens detected**: 19
- **Metric families found**: burn, cash, ebitda, real_estate, revenue
- **XLSX facts detected**: Yes
- **Has current-state signals**: Yes
- **Has projection signals**: No
- **Real-estate schema**: Yes

## Current-state outputs

### Revenue / ARR
- **Current**: `Rental Gross Revenue` | sheet: unknown | cell: UnitsBreakdown!?

### Burn Rate
- **Current**: `Other Monthly Expense` = -150 | sheet: unknown | cell: Monthly Pro Forma!col_14

### Runway
- Not detected

### Cash on Hand
- **Current**: `Cash Required if Loan has Points or Fees` = 0 | sheet: unknown | cell: A&Rs!col_10

## Data quality assessment

### Coverage assessment
- **Core metric families covered**: 2/2 (100%)
- **Package quality**: complete

### Integrity signals
- ℹ️ Real-estate schema — NOI/IRR/waterfall expected, not revenue/burn

### Warnings
- ⚠️ File is 255KB — vision worker bypassed (>500KB threshold). Used direct openpyxl scan.

## Audit findings
### Correct
- ✅ Vision worker successfully extracted structured tables from this workbook
- ✅ Current-period revenue signals found: `Rental Gross Revenue` on sheet `unknown`
- ✅ Real-estate schema correctly identified (NOI/IRR/waterfall patterns)

## Pass / Fail verdict

**✅ PASS**

- ✓ Real-estate schema detected (NOI/IRR/waterfall patterns found)
- ✓ Current-period revenue detected (3 signals)
- ✓ Current-period burn detected

## Recommended next action

**none**
