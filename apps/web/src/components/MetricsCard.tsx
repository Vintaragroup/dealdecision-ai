import { TrendingUp, TrendingDown } from 'lucide-react';
import { AnimatedCounter } from './AnimatedCounter';
import { SparklineChart } from './SparklineChart';

interface MetricsCardProps {
  metric: {
    label: string;
    value: number;
    decimals?: number;
    suffix?: string;
    change: string;
    isPositive: boolean;
    sparklineData: number[];
    sparklineColor: string;
    bgColorDark: string;
    bgColorLight: string;
    borderColorDark: string;
    borderColorLight: string;
    textColorDark: string;
    textColorLight: string;
    glowColor: string;
  };
  darkMode: boolean;
}

export function MetricsCard({ metric, darkMode }: MetricsCardProps) {
  return (
    <div
      className={`backdrop-blur-xl rounded-2xl p-6 group hover:scale-105 transition-all duration-200 cursor-pointer relative overflow-hidden border ${
        darkMode 
          ? `${metric.bgColorDark} ${metric.borderColorDark}` 
          : `${metric.bgColorLight} ${metric.borderColorLight}`
      } ${metric.glowColor}`}
    >
      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${
        darkMode ? 'from-white/5' : 'from-white/30'
      } to-transparent`}></div>
      
      <div className="space-y-3 relative z-10">
        <div className="flex items-center justify-between">
          <div className={`text-sm opacity-70 ${
            darkMode ? metric.textColorDark : metric.textColorLight
          }`}>
            {metric.label}
          </div>
          <SparklineChart 
            data={metric.sparklineData} 
            color={metric.sparklineColor}
            positive={metric.isPositive}
          />
        </div>
        <div className="flex items-end justify-between">
          <div className={`text-3xl bg-gradient-to-br bg-clip-text text-transparent ${
            darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
          }`}>
            <AnimatedCounter 
              end={metric.value} 
              decimals={metric.decimals || 0}
              suffix={metric.suffix || ''}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className={`text-sm ${metric.isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
              {metric.change}
            </span>
            {metric.isPositive ? (
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-600" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
