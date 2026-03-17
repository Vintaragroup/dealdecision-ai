/**
 * RiskRadarChart — Radar chart displaying risk scores across categories.
 * Pure chart renderer: no card wrapper, no title, no badge.
 * Card/title/risk-level badge are owned by the parent panel.
 */

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { RiskAssessmentData } from '../../../../types/investor-insights';

interface RiskRadarChartProps {
  darkMode: boolean;
  data: RiskAssessmentData;
  height?: number;
}

const RISK_LEVEL_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#ef4444',
};

export function RiskRadarChart({ darkMode, data, height = 160 }: RiskRadarChartProps) {
  const fillColor = data.overall_risk_level
    ? RISK_LEVEL_COLORS[data.overall_risk_level]
    : '#6366f1';

  const tickColor = darkMode ? '#9CA3AF' : '#6B7280';
  const gridColor = darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data.categories} margin={{ top: 0, right: 16, bottom: 0, left: 16 }}>
        <PolarGrid stroke={gridColor} />
        <PolarAngleAxis
          dataKey="category"
          tick={{ fontSize: 10, fill: tickColor }}
        />
        <Tooltip
          contentStyle={{
            background: darkMode ? '#1F2937' : '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            color: darkMode ? '#E5E7EB' : '#111827',
          }}
          formatter={(value: number) => [`${value}/100`, 'Risk Score']}
        />
        <Radar
          name="Risk"
          dataKey="risk_score"
          stroke={fillColor}
          fill={fillColor}
          fillOpacity={0.25}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
