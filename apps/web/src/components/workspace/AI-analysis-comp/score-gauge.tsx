interface ScoreGaugeProps {
  score: number;
  size?: number;
}

export function ScoreGauge({ score, size = 200 }: ScoreGaugeProps) {
  const circumference = 2 * Math.PI * 90;
  const progress = (score / 100) * circumference;
  
  // Determine color based on score
  const getColor = () => {
    if (score >= 70) return '#10b981'; // emerald-500
    if (score >= 41) return '#3b82f6'; // blue-500
    return '#ef4444'; // red-500
  };

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Background circle */}
      <svg className="absolute" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={90}
          fill="none"
          stroke="rgba(255, 255, 255, 0.05)"
          strokeWidth="12"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={90}
          fill="none"
          stroke={getColor()}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            transition: 'stroke-dashoffset 1s ease-in-out',
          }}
        />
      </svg>
      {/* Score number */}
      <div className="text-[72px] font-bold text-white leading-none">
        {score}
      </div>
    </div>
  );
}
