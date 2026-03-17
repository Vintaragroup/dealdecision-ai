/**
 * ScoreCard — A compact score display card with label and confidence bar.
 */

interface ScoreCardProps {
  darkMode: boolean;
  label: string;
  score: number | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  className?: string;
}

const CONFIDENCE_COLORS = {
  high: 'bg-green-500',
  medium: 'bg-yellow-500',
  low: 'bg-red-400',
};

export function ScoreCard({ darkMode, label, score, confidence, className = '' }: ScoreCardProps) {
  const pct = score !== null ? Math.min(100, Math.max(0, score)) : 0;

  const barColor =
    score === null
      ? darkMode ? 'bg-white/10' : 'bg-gray-200'
      : pct >= 70
      ? 'bg-green-500'
      : pct >= 45
      ? 'bg-yellow-500'
      : 'bg-red-400';

  return (
    <div
      className={`p-4 rounded-xl border ${
        darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
      } ${className}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {label}
        </span>
        {confidence && (
          <span
            className={`w-2 h-2 rounded-full ${CONFIDENCE_COLORS[confidence]}`}
            title={`${confidence} confidence`}
          />
        )}
      </div>

      <div className={`text-2xl font-bold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {score !== null ? pct : '—'}
        {score !== null && (
          <span className={`text-sm font-normal ml-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            /100
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className={`h-1.5 rounded-full ${darkMode ? 'bg-white/10' : 'bg-gray-100'}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
