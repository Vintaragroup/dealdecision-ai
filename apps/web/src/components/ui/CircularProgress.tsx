interface CircularProgressProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  showValue?: boolean;
  darkMode?: boolean;
}

export function CircularProgress({
  value,
  max = 100,
  size = 120,
  strokeWidth = 8,
  label,
  showValue = true,
  darkMode = true
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = (value / max) * 100;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={darkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}
          strokeWidth={strokeWidth}
          fill="none"
        />
        
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#progressGradient)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500 ease-out"
          style={{
            filter: 'drop-shadow(0 0 8px rgba(99, 102, 241, 0.5))'
          }}
        />
      </svg>
      
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {showValue && (
          <div className={`text-2xl bg-gradient-to-br from-white to-white/70 bg-clip-text text-transparent ${
            darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
          }`}>
            {Math.round(percentage)}%
          </div>
        )}
        {label && (
          <div className={`text-xs mt-1 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {label}
          </div>
        )}
      </div>
    </div>
  );
}
