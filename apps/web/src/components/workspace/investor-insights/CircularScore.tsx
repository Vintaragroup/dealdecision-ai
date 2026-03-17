/**
 * CircularScore — Displays a score (0–100) as a circular progress arc.
 * Null-safe: renders a placeholder ring when score is null.
 */

interface CircularScoreProps {
  score: number | null;
  size?: number;
  strokeWidth?: number;
  darkMode: boolean;
  /** Optional label rendered below the number. */
  label?: string;
}

export function CircularScore({
  score,
  size = 80,
  strokeWidth = 7,
  darkMode,
  label,
}: CircularScoreProps) {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  const pct = score !== null ? Math.min(100, Math.max(0, score)) : 0;
  const offset = circumference - (pct / 100) * circumference;

  const scoreColor =
    score === null
      ? darkMode
        ? '#4B5563'
        : '#D1D5DB'
      : pct >= 70
      ? '#22c55e'
      : pct >= 45
      ? '#eab308'
      : '#ef4444';

  const trackColor = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Track ring */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={trackColor}
            strokeWidth={strokeWidth}
          />
          {/* Progress arc */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={scoreColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        {/* Score value — absolutely centered over the SVG ring */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-bold leading-none ${
              size >= 80 ? 'text-xl' : 'text-base'
            } ${darkMode ? 'text-white' : 'text-gray-900'}`}
          >
            {score !== null ? pct : '—'}
          </span>
        </div>
      </div>
      {label && (
        <span className={`text-xs text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {label}
        </span>
      )}
    </div>
  );
}
