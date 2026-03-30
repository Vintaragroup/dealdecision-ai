import { Building2 } from 'lucide-react';

export function DealFraming() {
  return (
    <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-8 mb-6">
      <div className="flex items-start gap-4">
        <div className="bg-blue-500/10 rounded-lg p-3 flex-shrink-0">
          <Building2 className="w-6 h-6 text-blue-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl text-white mb-3">Acme Corp</h2>
          <p className="text-[15px] leading-relaxed text-zinc-300 mb-4">
            Acme Corp is an AI-powered customer service platform that enables mid-market B2B SaaS companies 
            to automate support operations while maintaining human oversight. The company provides 24/7 AI 
            agents that integrate with existing support stacks, learn from interactions, and seamlessly 
            hand off to human agents when needed.
          </p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <span className="text-zinc-500">Stage:</span>
              <span className="text-zinc-300 ml-2">Series B</span>
            </div>
            <div>
              <span className="text-zinc-500">Sector:</span>
              <span className="text-zinc-300 ml-2">AI/SaaS</span>
            </div>
            <div>
              <span className="text-zinc-500">Deal Type:</span>
              <span className="text-zinc-300 ml-2">Growth Investment</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-zinc-700/50">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Investment Thesis</div>
            <p className="text-sm text-blue-400 italic">
              Strong product with proven PMF faces go-to-market scaling challenges that require capital and leadership depth
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
