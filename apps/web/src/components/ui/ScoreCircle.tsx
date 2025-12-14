interface ScoreCircleProps {
  score: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showLabel?: boolean;
  label?: string;
  darkMode: boolean;
}

export function ScoreCircle({ score, size = 'md', showLabel = true, label, darkMode }: ScoreCircleProps) {
  const sizes = {
    sm: { circle: 80, stroke: 8, text: 'text-xl', label: 'text-xs' },
    md: { circle: 120, stroke: 10, text: 'text-3xl', label: 'text-sm' },
    lg: { circle: 160, stroke: 12, text: 'text-5xl', label: 'text-base' },
    xl: { circle: 200, stroke: 14, text: 'text-6xl', label: 'text-lg' }
  };

  const config = sizes[size];
  const radius = (config.circle - config.stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  const getScoreColor = (score: number) => {
    if (score >= 85) return { from: '#10b981', to: '#059669' }; // Green
    if (score >= 70) return { from: '#6366f1', to: '#8b5cf6' }; // Purple
    if (score >= 50) return { from: '#f59e0b', to: '#d97706' }; // Orange
    return { from: '#ef4444', to: '#dc2626' }; // Red
  };

  const colors = getScoreColor(score);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: config.circle, height: config.circle }}>
        {/* Background circle */}
        <svg className="transform -rotate-90" width={config.circle} height={config.circle}>
          <defs>
            <linearGradient id={`gradient-${score}-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors.from} />
              <stop offset="100%" stopColor={colors.to} />
            </linearGradient>
          </defs>
          <circle
            cx={config.circle / 2}
            cy={config.circle / 2}
            r={radius}
            stroke={darkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}
            strokeWidth={config.stroke}
            fill="none"
          />
          {/* Progress circle */}
          <circle
            cx={config.circle / 2}
            cy={config.circle / 2}
            r={radius}
            stroke={`url(#gradient-${score}-${size})`}
            strokeWidth={config.stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
            style={{
              filter: 'drop-shadow(0 0 8px rgba(99, 102, 241, 0.4))'
            }}
          />
        </svg>
        
        {/* Score text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`${config.text} font-bold bg-gradient-to-br from-[${colors.from}] to-[${colors.to}] bg-clip-text text-transparent`}>
            {score}
          </span>
        </div>
      </div>
      
      {showLabel && (
        <div className={`${config.label} text-center ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {label || 'Overall Score'}
        </div>
      )}
    </div>
  );
}
