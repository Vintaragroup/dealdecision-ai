import { MetricsCard } from './MetricsCard';

const metrics = [
  {
    label: 'Active Deals',
    value: 24,
    change: '+12.5%',
    isPositive: true,
    bgColorDark: 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20',
    bgColorLight: 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10',
    borderColorDark: 'border-[#6366f1]/30',
    borderColorLight: 'border-[#6366f1]/30',
    textColorDark: 'text-white',
    textColorLight: 'text-gray-900',
    sparklineData: [18, 20, 19, 22, 21, 23, 24],
    sparklineColor: '#6366f1',
    glowColor: 'shadow-[0_0_40px_rgba(99,102,241,0.15)]'
  },
  {
    label: 'Documents',
    value: 156,
    change: '-2.3%',
    isPositive: false,
    bgColorDark: 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80',
    bgColorLight: 'bg-gradient-to-br from-white/80 to-gray-50/80',
    borderColorDark: 'border-white/5',
    borderColorLight: 'border-gray-200/50',
    textColorDark: 'text-white',
    textColorLight: 'text-gray-900',
    sparklineData: [165, 162, 160, 158, 159, 157, 156],
    sparklineColor: '#ef4444',
    glowColor: 'shadow-[0_0_40px_rgba(0,0,0,0.1)]'
  },
  {
    label: 'AI Score Avg',
    value: 8.4,
    decimals: 1,
    change: '+5.2%',
    isPositive: true,
    bgColorDark: 'bg-gradient-to-br from-emerald-500/20 to-teal-500/20',
    bgColorLight: 'bg-gradient-to-br from-emerald-500/10 to-teal-500/10',
    borderColorDark: 'border-emerald-500/30',
    borderColorLight: 'border-emerald-500/30',
    textColorDark: 'text-white',
    textColorLight: 'text-gray-900',
    sparklineData: [7.8, 7.9, 8.0, 8.1, 8.2, 8.3, 8.4],
    sparklineColor: '#10b981',
    glowColor: 'shadow-[0_0_40px_rgba(16,185,129,0.15)]'
  },
  {
    label: 'Total ROI',
    value: 34.2,
    decimals: 1,
    suffix: '%',
    change: '+8.1%',
    isPositive: true,
    bgColorDark: 'bg-gradient-to-br from-amber-500/20 to-orange-500/20',
    bgColorLight: 'bg-gradient-to-br from-amber-500/10 to-orange-500/10',
    borderColorDark: 'border-amber-500/30',
    borderColorLight: 'border-amber-500/30',
    textColorDark: 'text-white',
    textColorLight: 'text-gray-900',
    sparklineData: [28, 29, 30, 31, 32, 33, 34.2],
    sparklineColor: '#f59e0b',
    glowColor: 'shadow-[0_0_40px_rgba(245,158,11,0.15)]'
  }
];

interface MetricsGridProps {
  darkMode: boolean;
}

export function MetricsGrid({ darkMode }: MetricsGridProps) {
  return (
    <div className="grid grid-cols-4 gap-6">
      {metrics.map((metric, index) => (
        <MetricsCard key={index} metric={metric} darkMode={darkMode} />
      ))}
    </div>
  );
}