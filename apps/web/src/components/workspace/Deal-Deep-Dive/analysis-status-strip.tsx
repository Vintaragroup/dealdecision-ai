import { Clock, AlertTriangle, FileCheck, User, AlertOctagon } from 'lucide-react';

interface AnalysisStatusStripProps {
  onCriticalBlockersClick?: () => void;
}

export function AnalysisStatusStrip({ onCriticalBlockersClick }: AnalysisStatusStripProps) {
  const completeCount = 9;
  const totalCount = 9;
  const completionPercentage = Math.round((completeCount / totalCount) * 100);
  const criticalBlockersCount = 7; // 4 critical red flags + 3 critical questions

  return (
    <div className="bg-zinc-800/40 border border-zinc-700/30 rounded-lg px-6 py-3 mb-8">
      <div className="flex flex-wrap items-center justify-between gap-6">
        {/* Progress */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-24 bg-zinc-700 rounded-full h-1.5">
              <div 
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
            <span className="text-xs text-zinc-400">{completionPercentage}% complete</span>
          </div>
        </div>

        {/* Critical Blockers - New */}
        <button
          onClick={onCriticalBlockersClick}
          className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 border border-red-500/40 rounded-md hover:bg-red-500/30 transition-colors"
        >
          <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs text-red-300">🔴 Critical Blockers: {criticalBlockersCount}</span>
        </button>

        {/* Key Counts */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs text-zinc-400">4 red flags</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-zinc-400">6 risks</span>
          </div>
          <div className="flex items-center gap-2">
            <FileCheck className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs text-zinc-400">23 open questions</span>
          </div>
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-6 ml-auto">
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-400">Alex Rivera</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-400">Updated 2h ago</span>
          </div>
        </div>
      </div>
    </div>
  );
}