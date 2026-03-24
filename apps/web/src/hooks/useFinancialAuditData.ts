import { useMemo } from 'react';
import { ProcessedAuditData, FinancialAuditTabProps } from '../types/financialAudit';

/**
 * Hook to process and transform Financial Audit data
 * Maps raw API data to component-ready format
 */
export function useFinancialAuditData(props: FinancialAuditTabProps): ProcessedAuditData {
  const {
    financialBreakdownV1,
    underwritingReadinessV1,
    financialIntegrityV1,
    financialSnapshotStale = false
  } = props;

  return useMemo(() => {
    // This is where you would map real API data
    // For now, returning mock data structure
    
    const processedData: ProcessedAuditData = {
      status: 'WARNING',
      isStale: financialSnapshotStale,
      lastUpdated: '2 hours ago',
      
      actionPanel: {
        status: 'WARNING',
        criticalActions: [
          { text: 'Cash balance conflict ($400K discrepancy)', severity: 'critical' },
          { text: 'Missing CAC / LTV / Churn metrics', severity: 'critical' }
        ],
        validationActions: [
          { text: 'Customer count (deck only)', severity: 'warning' },
          { text: 'Runway assumptions need validation', severity: 'warning' }
        ],
        strengths: [
          { text: 'Revenue supported (XLSX + Deck)', severity: 'success' },
          { text: 'Gross margin validated across sources', severity: 'success' }
        ]
      },
      
      summaryMetrics: {
        completeness: 67,
        criticalMetrics: '5 / 7 present',
        conflicts: 3,
        factsAnalyzed: 127
      },
      
      sourceOfTruth: {
        rows: [
          { 
            metric: 'ARR', 
            value: '$5.2M', 
            source: 'XLSX', 
            sources: 2, 
            confidence: 'High', 
            confidenceExplanation: 'XLSX + Deck aligned', 
            status: 'Supported', 
            sourceWeight: 5 
          },
          { 
            metric: 'Revenue (2024)', 
            value: '$4.8M', 
            source: 'Deck', 
            sources: 3, 
            confidence: 'High', 
            confidenceExplanation: 'XLSX + Deck + PDF aligned', 
            status: 'Supported', 
            sourceWeight: 5 
          },
          { 
            metric: 'Burn Rate', 
            value: '$180K/mo', 
            source: 'XLSX', 
            sources: 1, 
            confidence: 'Medium', 
            confidenceExplanation: 'Single source', 
            status: 'Single Source', 
            sourceWeight: 5 
          },
          { 
            metric: 'Cash Balance', 
            value: '$2.1M', 
            source: 'PDF', 
            sources: 2, 
            confidence: 'Medium', 
            confidenceExplanation: 'Sources conflict', 
            status: 'Conflicting', 
            sourceWeight: 2 
          },
          { 
            metric: 'Gross Margin', 
            value: '68%', 
            source: 'XLSX', 
            sources: 2, 
            confidence: 'High', 
            confidenceExplanation: 'XLSX + Deck aligned', 
            status: 'Supported', 
            sourceWeight: 5 
          },
          { 
            metric: 'Customer Count', 
            value: '250', 
            source: 'Deck', 
            sources: 1, 
            confidence: 'Low', 
            confidenceExplanation: 'Deck only', 
            status: 'Single Source', 
            sourceWeight: 3 
          },
          { 
            metric: 'MRR Growth', 
            value: '+12% MoM', 
            source: 'XLSX', 
            sources: 2, 
            confidence: 'High', 
            confidenceExplanation: 'XLSX + Deck aligned', 
            status: 'Supported', 
            sourceWeight: 5 
          }
        ]
      },
      
      conflicts: {
        conflicts: [
          { 
            metric: 'Cash Balance', 
            sourceA: { name: 'XLSX Model', value: '$2.1M' }, 
            sourceB: { name: 'Pitch Deck', value: '$2.5M' }, 
            difference: '+$400K (19%)',
            impact: 'Affects runway by ~2 months',
            impactSeverity: 'high'
          },
          { 
            metric: 'Team Size', 
            sourceA: { name: 'Deck', value: '15 people' }, 
            sourceB: { name: 'PDF Doc', value: '12 people' }, 
            difference: '+3 (25%)',
            impact: 'Low impact — rounding or timing difference',
            impactSeverity: 'low'
          },
          { 
            metric: 'Runway', 
            sourceA: { name: 'XLSX', value: '11.7 months' }, 
            sourceB: { name: 'Deck', value: '12 months' }, 
            difference: '+0.3 months',
            impact: 'Low impact — rounding difference',
            impactSeverity: 'low'
          }
        ]
      },
      
      timeAudit: {
        items: [
          { metric: 'Revenue', period: 'TTM (Actual)', clarity: 'Clear', type: 'historical' },
          { metric: 'ARR', period: 'Current', clarity: 'Clear', type: 'historical' },
          { 
            metric: 'Revenue (2025)', 
            period: 'FY Projection', 
            clarity: 'Warning', 
            type: 'projected', 
            warning: 'Mixed temporal data: Projected revenue compared to historical burn rate' 
          },
          { 
            metric: 'Customer Count', 
            period: 'Quarterly', 
            clarity: 'Ambiguous', 
            type: 'historical', 
            warning: 'Period not clearly specified' 
          }
        ]
      },
      
      snapshot: {
        metrics: [
          { 
            label: 'Revenue', 
            value: '$4.8M', 
            change: '+120%', 
            confidence: 'High', 
            confidenceReason: 'XLSX + Deck aligned'
          },
          { 
            label: 'Burn Rate', 
            value: '$180K/mo', 
            change: '+15%', 
            confidence: 'Medium', 
            confidenceReason: 'Single source'
          },
          { 
            label: 'Cash', 
            value: '$2.1M', 
            change: '-$540K', 
            confidence: 'Medium', 
            confidenceReason: 'Sources conflict — needs resolution'
          },
          { 
            label: 'Runway', 
            value: '11.7 months', 
            change: '-2.3 months', 
            confidence: 'High', 
            confidenceReason: 'XLSX calculation validated'
          },
          { 
            label: 'Gross Margin', 
            value: '68%', 
            change: '+3%', 
            confidence: 'High', 
            confidenceReason: 'XLSX + Deck aligned'
          }
        ]
      },
      
      riskFlags: {
        critical: [
          { message: 'Cash balance shows $400K discrepancy between sources' }
        ],
        validation: [
          { message: '3 metrics rely on single source with no cross-validation' },
          { message: 'Customer count confidence is low (deck only)' }
        ],
        dataQuality: [
          { message: '2 time periods are ambiguous or not clearly labeled' }
        ]
      },
      
      readiness: {
        score: 72,
        status: 'PARTIAL',
        missingMetrics: ['Customer CAC', 'LTV', 'Churn Rate'],
        weakAreas: ['Cash balance conflicts', 'Ambiguous time periods'],
        summary: 'Core financials present and mostly supported. Critical gaps in unit economics. Resolve cash balance conflict and obtain missing CAC/LTV metrics before proceeding to investment decision.'
      },
      
      formulas: {
        traces: [
          { metric: 'ARR', formula: '=MRR*12', depth: 1, sheets: ['Financials'], circular: false, confidence: 'High' },
          { metric: 'Runway', formula: '=Cash/BurnRate', depth: 2, sheets: ['Financials', 'Assumptions'], circular: false, confidence: 'High' },
          { metric: 'Gross Margin', formula: '=(Revenue-COGS)/Revenue', depth: 2, sheets: ['P&L'], circular: false, confidence: 'Medium' },
          { metric: 'Growth Rate', formula: '=(Current-Prior)/Prior', depth: 3, sheets: ['Financials', 'Historical', 'Metrics'], circular: false, confidence: 'Low' }
        ]
      },
      
      rawFacts: {
        facts: [
          { metric: 'ARR', period: 'Current', value: '$5.2M', source: 'XLSX', sheet: 'Financials', cell: 'B12', confidence: 'High', formula: '=MRR*12' },
          { metric: 'MRR', period: 'Current', value: '$433K', source: 'XLSX', sheet: 'Financials', cell: 'B11', confidence: 'High', formula: '=SUM(CustomerRevenue)' },
          { metric: 'Revenue', period: '2024', value: '$4.8M', source: 'Deck', sheet: null, cell: 'Slide 8', confidence: 'High', formula: null },
          { metric: 'Cash', period: 'Current', value: '$2.1M', source: 'XLSX', sheet: 'Balance Sheet', cell: 'D5', confidence: 'Medium', formula: null }
        ]
      }
    };

    return processedData;
  }, [financialBreakdownV1, underwritingReadinessV1, financialIntegrityV1, financialSnapshotStale]);
}
