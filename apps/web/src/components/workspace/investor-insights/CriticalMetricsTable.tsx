import type { CriticalMetrics } from '../../../types/investor-insights';

interface CriticalMetricsTableProps {
  darkMode: boolean;
  metrics: CriticalMetrics | null;
}

interface MetricDef {
  label: string;
  value: string | undefined;
  colorClass?: string;
}

export function CriticalMetricsTable({ darkMode, metrics }: CriticalMetricsTableProps) {
  const metricDefs: MetricDef[] = [
    { label: 'Current ARR',   value: metrics?.financial.current_arr },
    { label: 'YoY Growth',    value: metrics?.financial.yoy_growth,    colorClass: 'text-green-500' },
    { label: 'Gross Margin',  value: metrics?.financial.gross_margin },
    { label: 'Retention Rate',value: metrics?.product.retention_rate,  colorClass: 'text-green-500' },
    { label: 'LTV/CAC',       value: metrics?.financial.ltv_cac_ratio },
    { label: 'Runway',        value: metrics?.financial.runway_months,  colorClass: 'text-amber-500' },
    { label: 'TAM',           value: metrics?.market.tam },
    { label: 'Market CAGR',   value: metrics?.market.market_cagr,      colorClass: 'text-green-500' },
  ];

  return (
    <div
      className={`p-4 rounded-lg border ${
        darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
      }`}
    >
      <p
        className={`text-sm font-medium uppercase tracking-wider mb-4 ${
          darkMode ? 'text-[#a5b4fc]' : 'text-[#6366f1]'
        }`}
      >
        Critical Metrics
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metricDefs.map(({ label, value, colorClass }) => (
          <div key={label}>
            <p className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {label}
            </p>
            <p
              className={`text-lg font-bold ${
                colorClass
                  ? colorClass
                  : darkMode
                  ? 'text-white'
                  : 'text-gray-900'
              }`}
            >
              {value ?? '–'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
