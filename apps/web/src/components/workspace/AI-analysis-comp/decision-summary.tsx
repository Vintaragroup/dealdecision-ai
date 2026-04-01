import { ScoreGauge } from './score-gauge';
import { MiniGauge } from './mini-gauge';

interface DecisionSummaryProps {
  score: number;
  posture: 'FUND' | 'INVESTIGATE' | 'MONITOR' | 'PASS';
  explanation: string;
  opportunity?: number | null;
  confidence?: number | null;
  risk?: number | null;
}

export function DecisionSummary({
  score,
  posture,
  explanation,
  opportunity,
  confidence,
  risk,
}: DecisionSummaryProps) {
  const getPostureStyles = () => {
    switch (posture) {
      case 'FUND':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
      case 'INVESTIGATE':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
      case 'MONITOR':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      case 'PASS':
        return 'bg-red-500/20 text-red-400 border-red-500/40';
    }
  };

  return (
    <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-12">
      <div className="flex flex-col items-center gap-8">
        {/* Primary Score */}
        <div className="flex flex-col items-center gap-4">
          <ScoreGauge score={score} />
          <div
            className={`px-6 py-2 rounded-full border text-base font-semibold uppercase tracking-wider ${getPostureStyles()}`}
          >
            {posture}
          </div>
        </div>

        {/* Supporting Scores */}
        {(opportunity != null && confidence != null && risk != null) && (
        <div className="flex items-center justify-center gap-12 w-full max-w-[600px]">
          <MiniGauge label="Opportunity" score={opportunity} />
          <MiniGauge label="Confidence" score={confidence} />
          <MiniGauge label="Risk" score={risk} />
        </div>
        )}

        {/* Explanation */}
        <p className="text-lg italic text-zinc-300 text-center max-w-[700px]">
          "{explanation}"
        </p>
      </div>
    </div>
  );
}
