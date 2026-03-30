import { AlertOctagon, Link2 } from 'lucide-react';

interface RedFlagCardProps {
  title: string;
  description: string;
  impact: 'medium' | 'high' | 'critical';
  source: string;
  isContradiction?: boolean;
}

export function RedFlagCard({ title, description, impact, source, isContradiction = false }: RedFlagCardProps) {
  const impactConfig = {
    medium: {
      borderClass: 'border-red-500/40',
      bgClass: 'bg-red-500/5',
      textClass: 'text-red-400',
      badgeClass: 'bg-red-500/20 text-red-300',
      ringClass: '',
      borderWidth: 'border',
    },
    high: {
      borderClass: 'border-red-500/60',
      bgClass: 'bg-red-500/10',
      textClass: 'text-red-400',
      badgeClass: 'bg-red-500/30 text-red-200',
      ringClass: '',
      borderWidth: 'border-2',
    },
    critical: {
      borderClass: 'border-red-500/80',
      bgClass: 'bg-red-500/15',
      textClass: 'text-red-300',
      badgeClass: 'bg-red-500/40 text-red-100',
      ringClass: 'ring-2 ring-red-500/40 shadow-[0_0_20px_rgba(239,68,68,0.2)]',
      borderWidth: 'border-[3px]',
    },
  };

  const config = impactConfig[impact];

  return (
    <div className={`rounded-lg ${config.borderWidth} ${config.borderClass} ${config.bgClass} ${config.ringClass} p-5`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3 flex-1">
          <AlertOctagon className={`w-5 h-5 ${config.textClass} mt-0.5 flex-shrink-0`} />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h4 className={`text-[15px] font-medium ${config.textClass}`}>{title}</h4>
              {isContradiction && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/20 border border-purple-500/40 rounded-md text-[10px] uppercase tracking-wider text-purple-300 font-semibold">
                  <Link2 className="w-3 h-3" />
                  Contradiction Detected
                </div>
              )}
            </div>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-md text-[10px] uppercase tracking-wider font-semibold ${config.badgeClass} whitespace-nowrap`}>
          {impact}
        </span>
      </div>
      
      <p className="text-sm text-zinc-300 leading-relaxed mb-3 ml-8">{description}</p>
      
      <div className="ml-8">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 font-semibold">Source</div>
        <div className="text-xs text-zinc-400">{source}</div>
      </div>
    </div>
  );
}