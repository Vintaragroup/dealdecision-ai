import { CheckCircle2, XCircle } from 'lucide-react';

interface Insight {
  text: string;
  data: string;
}

interface WhyScoreProps {
  strengths: Insight[];
  concerns: Insight[];
}

export function WhyScore({ strengths, concerns }: WhyScoreProps) {
  return (
    <div className="bg-zinc-800/40 rounded-[14px] p-8">
      <h2 className="text-xl font-semibold text-white mb-6">Why This Score</h2>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Strengths */}
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-500 mb-3">Strengths</p>
          {strengths.length === 0 ? (
            <p className="text-sm text-zinc-500">Awaiting structured data to surface strengths.</p>
          ) : (
            strengths.map((strength, index) => (
              <div key={index} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="text-[15px] text-zinc-300 leading-relaxed">
                    {strength.text}
                  </span>
                  {strength.data && (
                    <span className="text-[15px] text-white font-semibold ml-1">
                      ({strength.data})
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Concerns */}
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-red-500 mb-3">Concerns</p>
          {concerns.length === 0 ? (
            <p className="text-sm text-zinc-500">No flagged concerns from scoring systems.</p>
          ) : (
            concerns.map((concern, index) => (
              <div key={index} className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="text-[15px] text-zinc-300 leading-relaxed">
                    {concern.text}
                  </span>
                  {concern.data && (
                    <span className="text-[15px] text-white font-semibold ml-1">
                      ({concern.data})
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
