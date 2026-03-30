import { CheckCircle, AlertCircle, FileText, HelpCircle } from 'lucide-react';

interface SubSectionProps {
  title: string;
  summary: string;
  evidenceStrength?: 'strong' | 'moderate' | 'weak' | 'missing';
  strengths?: string[];
  weaknesses?: string[];
  evidence?: string[];
  openQuestions?: string[];
}

export function SubSection({
  title,
  summary,
  evidenceStrength = 'moderate',
  strengths = [],
  weaknesses = [],
  evidence = [],
  openQuestions = [],
}: SubSectionProps) {
  const evidenceConfig = {
    strong: { color: 'emerald', label: 'Strong Evidence', bgClass: 'bg-emerald-500/15', textClass: 'text-emerald-400', borderClass: 'border-emerald-500/40' },
    moderate: { color: 'amber', label: 'Moderate Evidence', bgClass: 'bg-amber-500/15', textClass: 'text-amber-400', borderClass: 'border-amber-500/40' },
    weak: { color: 'red', label: 'Weak Evidence', bgClass: 'bg-red-500/15', textClass: 'text-red-400', borderClass: 'border-red-500/40' },
    missing: { color: 'zinc', label: 'Evidence Missing', bgClass: 'bg-zinc-700/50', textClass: 'text-zinc-400', borderClass: 'border-zinc-600/40' },
  };

  const config = evidenceConfig[evidenceStrength];

  return (
    <div className="bg-zinc-800/50 rounded-lg p-6 mb-4 last:mb-0">
      <div className="flex items-start justify-between mb-4">
        <h4 className="text-[15px] text-white font-medium">{title}</h4>
        <div className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-semibold border ${config.bgClass} ${config.textClass} ${config.borderClass} whitespace-nowrap`}>
          {config.label}
        </div>
      </div>
      
      <p className="text-[15px] text-zinc-300 leading-relaxed mb-5">{summary}</p>

      {/* Strengths */}
      {strengths.length > 0 && (
        <div className="mb-4">
          <div className="flex flex-wrap gap-2.5">
            {strengths.map((strength, index) => (
              <div
                key={index}
                className="flex items-start gap-2 bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/30"
              >
                <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <span className="text-xs text-emerald-300 leading-relaxed">{strength}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weaknesses */}
      {weaknesses.length > 0 && (
        <div className="mb-4">
          <div className="flex flex-wrap gap-2.5">
            {weaknesses.map((weakness, index) => (
              <div
                key={index}
                className="flex items-start gap-2 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/30"
              >
                <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="text-xs text-amber-300 leading-relaxed">{weakness}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence */}
      {evidence.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2.5">
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Evidence</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {evidence.map((item, index) => (
              <button
                key={index}
                className="px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 rounded-md text-xs text-blue-400 border border-blue-500/30 transition-colors cursor-pointer"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Open Questions */}
      {openQuestions.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2.5">
            <HelpCircle className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Open Questions</span>
          </div>
          <ul className="space-y-2 ml-1">
            {openQuestions.map((question, index) => (
              <li key={index} className="text-xs text-zinc-400 ml-4 list-disc leading-relaxed">
                {question}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}