import { TrendingUp, TrendingDown } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string | number;
  trend?: {
    value: string;
    direction: 'up' | 'down';
    positive?: boolean;
  };
  subtitle?: string;
}

export function KPICard({ label, value, trend, subtitle }: KPICardProps) {
  const getTrendColor = () => {
    if (!trend) return '';
    if (trend.positive === undefined) {
      return trend.direction === 'up' ? 'text-emerald-400' : 'text-red-400';
    }
    return trend.positive ? 'text-emerald-400' : 'text-red-400';
  };

  return (
    <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-5">
      <div className="text-xs uppercase tracking-wider text-zinc-400 mb-2">
        {label}
      </div>
      <div className="text-2xl text-white mb-1">
        {value}
      </div>
      {trend && (
        <div className={`flex items-center gap-1 text-xs ${getTrendColor()}`}>
          {trend.direction === 'up' ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {trend.value}
        </div>
      )}
      {subtitle && (
        <div className="text-xs text-zinc-500 mt-1">
          {subtitle}
        </div>
      )}
    </div>
  );
}
