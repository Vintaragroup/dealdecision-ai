import { AlertTriangle } from 'lucide-react';

interface DivergenceData {
  exists: boolean;
  system1: {
    name: string;
    posture: string;
    score: number;
  };
  system2: {
    name: string;
    posture: string;
    score: number;
  };
  explanation: string;
}

interface DivergenceWarningProps {
  data: DivergenceData;
}

export function DivergenceWarning({ data }: DivergenceWarningProps) {
  if (!data.exists) return null;

  return (
    <div className="mt-4 bg-amber-500/10 border-2 border-amber-500/30 rounded-[14px] p-6 shadow-[0_0_20px_rgba(245,158,11,0.15)]">
      <div className="flex items-start gap-4">
        <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
        
        <div className="flex-1">
          <h3 className="text-base font-semibold uppercase tracking-wider text-amber-400 mb-3">
            Score Divergence
          </h3>
          
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            <div className="text-sm text-amber-200">
              <span className="font-semibold">{data.system1.name}:</span>{' '}
              {data.system1.posture} ({data.system1.score})
            </div>
            <span className="text-amber-400">vs</span>
            <div className="text-sm text-amber-200">
              <span className="font-semibold">{data.system2.name}:</span>{' '}
              {data.system2.posture} ({data.system2.score})
            </div>
          </div>
          
          <p className="text-sm text-amber-200 leading-relaxed">
            <span className="font-medium">Key Difference:</span> {data.explanation}
          </p>
        </div>
      </div>
    </div>
  );
}
