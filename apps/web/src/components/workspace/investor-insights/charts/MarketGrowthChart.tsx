/**
 * MarketGrowthChart — Line chart for market size over time.
 * Pure chart renderer: no card wrapper, no title, no caption.
 * Card/title/caption are owned by the parent panel.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { MarketGrowthData } from '../../../../types/investor-insights';

interface MarketGrowthChartProps {
  darkMode: boolean;
  data: MarketGrowthData;
  height?: number;
}

export function MarketGrowthChart({ darkMode, data, height = 160 }: MarketGrowthChartProps) {
  const textColor = darkMode ? '#9CA3AF' : '#6B7280';
  const gridColor = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data.data_points} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis
          dataKey="year"
          tick={{ fontSize: 11, fill: textColor }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: textColor }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : `$${(v / 1e6).toFixed(0)}M`)}
        />
        <Tooltip
          contentStyle={{
            background: darkMode ? '#1F2937' : '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            color: darkMode ? '#E5E7EB' : '#111827',
          }}
          formatter={(value: number) => [
            value >= 1e9 ? `$${(value / 1e9).toFixed(1)}B` : `$${(value / 1e6).toFixed(0)}M`,
            'Market Size',
          ]}
        />
        <Line
          type="monotone"
          dataKey="market_size"
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ fill: '#6366f1', r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
