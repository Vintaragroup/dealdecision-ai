import { Briefcase, FileText, Trophy, Zap, Flame, TrendingUp } from 'lucide-react';

interface Stat {
  id?: string;
  label: string;
  value: string | number;
  icon: 'deals' | 'documents' | 'level' | 'xp' | 'streak' | 'growth';
  trend?: {
    value: number;
    direction: 'up' | 'down';
  };
  highlight?: boolean;
}

interface QuickStatsBarProps {
  darkMode: boolean;
  stats: Stat[];
}

export function QuickStatsBar({ darkMode, stats }: QuickStatsBarProps) {
  const getIcon = (icon: string) => {
    const iconClass = "w-4 h-4";
    switch (icon) {
      case 'deals':
        return <Briefcase className={iconClass} />;
      case 'documents':
        return <FileText className={iconClass} />;
      case 'level':
        return <Trophy className={iconClass} />;
      case 'xp':
        return <Zap className={iconClass} />;
      case 'streak':
        return <Flame className={iconClass} />;
      case 'growth':
        return <TrendingUp className={iconClass} />;
      default:
        return <Briefcase className={iconClass} />;
    }
  };

  return (
    <div className={`p-4 rounded-lg backdrop-blur-xl border ${
      darkMode 
        ? 'bg-gradient-to-r from-[#6366f1]/10 via-[#8b5cf6]/5 to-transparent border-white/10'
        : 'bg-gradient-to-r from-[#6366f1]/5 via-[#8b5cf6]/5 to-transparent border-gray-200'
    }`}>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.id || stat.label}
            className={`flex items-center gap-3 ${
              stat.highlight 
                ? `p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white/50'}` 
                : ''
            }`}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              stat.highlight
                ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]'
                : darkMode ? 'bg-white/10' : 'bg-gray-100'
            }`}>
              <div className={stat.highlight ? 'text-white' : darkMode ? 'text-gray-400' : 'text-gray-600'}>
                {getIcon(stat.icon)}
              </div>
            </div>
            <div>
              <div className={`text-xs mb-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {stat.label}
              </div>
              <div className="flex items-center gap-2">
                <div className={`text-lg ${
                  stat.highlight
                    ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent'
                    : darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  {stat.value}
                </div>
                {stat.trend && (
                  <span className={`text-xs ${
                    stat.trend.direction === 'up' ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {stat.trend.direction === 'up' ? '+' : '-'}{Math.abs(stat.trend.value)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
