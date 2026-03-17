/**
 * VisualIntelligencePanel — Chart panel displayed in quick and detailed views.
 *
 * Owns the card/title/chart/caption structure for each chart.
 * Charts are pure chart renderers; captions live here per the architecture corrections.
 *
 * Shows up to 3 charts (market growth, financial projections, risk radar).
 * Null-safe: hides individual charts when data is unavailable.
 * Hides the entire panel when no charts have data.
 */

import { Activity } from 'lucide-react';
import type { VisualIntelligenceData } from '../../../types/investor-insights';
import { MarketGrowthChart } from './charts/MarketGrowthChart';
import { FinancialProjectionChart } from './charts/FinancialProjectionChart';
import { RiskRadarChart } from './charts/RiskRadarChart';

interface VisualIntelligencePanelProps {
  darkMode: boolean;
  data: VisualIntelligenceData;
}

const RISK_LEVEL_LABELS: Record<string, string> = {
  low: 'Low Risk',
  medium: 'Moderate Risk',
  high: 'Elevated Risk',
};

const RISK_LEVEL_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#ef4444',
};

export function VisualIntelligencePanel({ darkMode, data }: VisualIntelligencePanelProps) {
  const hasAny =
    data.market_growth !== null ||
    data.financial_projections !== null ||
    data.risk_assessment !== null;

  if (!hasAny) return null;

  return (
    <div className={`p-6 rounded-xl border backdrop-blur-xl ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center gap-2 mb-6">
        <Activity className="w-5 h-5 text-[#6366f1]" />
        <h3 className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Visual Intelligence
        </h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Market Growth Chart */}
        {data.market_growth && (
          <div className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
            <h4 className={`text-sm font-medium mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Market Growth Projection
            </h4>
            <MarketGrowthChart darkMode={darkMode} data={data.market_growth} height={200} />
            <p className={`text-xs mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {data.market_growth.cagr != null
                ? `${data.market_growth.cagr.toFixed(1)}% CAGR`
                : data.market_growth.summary}
            </p>
          </div>
        )}

        {/* Financial Projections Chart */}
        {data.financial_projections && (
          <div className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
            <h4 className={`text-sm font-medium mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Revenue &amp; Margin Forecast
            </h4>
            <FinancialProjectionChart
              darkMode={darkMode}
              data={data.financial_projections}
              height={200}
              showMargin={true}
              fontSize={11}
              dotRadius={3}
            />
            <p className={`text-xs mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {data.financial_projections.summary}
            </p>
          </div>
        )}

        {/* Risk Assessment Radar */}
        {data.risk_assessment && data.risk_assessment.categories.length > 0 && (
          <div className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="flex items-center justify-between mb-4">
              <h4 className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Risk Assessment Radar
              </h4>
              {data.risk_assessment.overall_risk_level && (
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: `${RISK_LEVEL_COLORS[data.risk_assessment.overall_risk_level]}20`,
                    color: RISK_LEVEL_COLORS[data.risk_assessment.overall_risk_level],
                  }}
                >
                  {RISK_LEVEL_LABELS[data.risk_assessment.overall_risk_level]}
                </span>
              )}
            </div>
            <RiskRadarChart darkMode={darkMode} data={data.risk_assessment} height={200} />
            <p className={`text-xs mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Lower scores indicate lower risk
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
