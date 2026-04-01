import { ArrowRight } from 'lucide-react';

interface Improvement {
  action: string;
  points: number;
}

interface ImprovementActionsProps {
  improvements: Improvement[];
}

export function ImprovementActions({ improvements }: ImprovementActionsProps) {
  return (
    <div className="bg-zinc-800/40 rounded-[14px] p-8">
      <h2 className="text-xl font-semibold text-white mb-6">What Would Improve This Score</h2>

      {improvements.length === 0 ? (
        <p className="text-sm text-zinc-500">Run analysis to surface actionable improvements.</p>
      ) : (
        <div className="space-y-3">
          {improvements.map((improvement, index) => (
            <div key={index} className="flex items-center justify-between gap-4 group">
              <div className="flex items-center gap-3 flex-1">
                <ArrowRight className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span className="text-[15px] text-zinc-300">{improvement.action}</span>
              </div>
              <span className="text-sm font-semibold text-blue-400 whitespace-nowrap">
                +{improvement.points} points
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
