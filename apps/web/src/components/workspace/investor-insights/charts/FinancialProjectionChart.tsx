/**
 * FinancialProjectionChart — Dual-line chart for revenue and gross margin projections.
 * Pure chart renderer: no card wrapper, no title, no caption.
 * Card/title/caption are owned by the parent panel.
 *
 * Context-specific props:
 *   VisualIntelligencePanel: height=160 showMargin=true  fontSize=11 dotRadius=3
 *   ExecutiveBrief:          height=150 showMargin=false fontSize=10 dotRadius=2
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { FinancialProjectionData } from '../../../../types/investor-insights';

interface FinancialProjectionChartProps {
  darkMode: boolean;
  data: FinancialProjectionData;
  /** Chart height in px. Default 160. */
  height?: number;
  /** Show gross margin line. Default true. */
  showMargin?: boolean;
  /** Axis/legend font size. Default 11. */
  fontSize?: number;
  /** Line dot radius. Default 3. */
  dotRadius?: number;
}

export function FinancialProjectionChart({
  darkMode,
  data,
  height = 160,
  showMargin = true,
  fontSize = 11,
  dotRadius = 3,
}: FinancialProjectionChartProps) {
  const textColor = darkMode ? '#9CA3AF' : '#6B7280';
  const gridColor = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={data.data_points}
        margin={{ top: 4, right: 4, bottom: 0, left: -24 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis
          dataKey="period"
          tick={{ fontSize, fill: textColor }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize, fill: textColor }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) =>
            v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${(v / 1e3).toFixed(0)}K`
          }
        />
        <Tooltip
          contentStyle={{
            background: darkMode ? '#1F2937' : '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            color: darkMode ? '#E5E7EB' : '#111827',
          }}
        />
        {showMargin && (
          <Legend
            wrapperStyle={{ fontSize, color: textColor }}
            iconSize={8}
          />
        )}
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ fill: '#6366f1', r: dotRadius }}
          name="Revenue"
        />
        {showMargin && (
          <Line
            type="monotone"
            dataKey="gross_margin"
            stroke="#8b5cf6"
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={{ fill: '#8b5cf6', r: dotRadius }}
            name="Gross Margin"
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
