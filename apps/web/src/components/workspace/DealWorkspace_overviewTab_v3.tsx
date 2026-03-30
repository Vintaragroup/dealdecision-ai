import { MapPin, TrendingUp, DollarSign, Rocket, PlayCircle, CheckCircle2 } from 'lucide-react';

type SignalData = {
  name: string;
  score: number;
  explanation: string;
  confidence: 'Strong Evidence' | 'Partial Evidence' | 'Limited Evidence';
};

type DealOverviewTabProps = {
  darkMode: boolean;

  companyName: string;
  companyDescription: string;
  snapshotFactLabels: {
    raise: string;
    arr: string;
    growth: string;
    customers: string;
    tam: string;
  };
  snapshotFacts: {
    raise: string;
    arr: string;
    growth: string;
    customers: string;
    tam: string;
  };

  signals: SignalData[];

  financials: { label: string; value: string }[];
  traction: { label: string; value: string }[];
  deal: { label: string; value: string }[];
  businessModel: { label: string; value: string }[];

  evidenceLabels: {
    product: string;
    market: string;
    businessModel: string;
    raise: string;
  };

  productSummary: string;
  marketSummary: string;
  businessModelSummary: string;
  raiseTerms: string;

  insightsScore: number;
  insightsConfidence: 'High' | 'Medium' | 'Low';
  onOpenInsights: () => void;
};

const firstValueForLabel = (items: Array<{ label: string; value: string }>, labelMatcher: RegExp): string => {
  const found = items.find((item) => labelMatcher.test(String(item.label ?? '')));
  const value = found?.value?.trim();
  return value && value.length > 0 ? value : '—';
};

const topSignals = (signals: SignalData[]): SignalData[] => {
  if (!Array.isArray(signals) || signals.length === 0) {
    return [
      { name: 'Business Model', score: 0, explanation: 'Signal unavailable', confidence: 'Limited Evidence' },
      { name: 'Key Risk', score: 0, explanation: 'Signal unavailable', confidence: 'Limited Evidence' },
      { name: 'Market Position', score: 0, explanation: 'Signal unavailable', confidence: 'Limited Evidence' },
    ];
  }
  return signals.slice(0, 3);
};

const scoreColorClass = (score: number): string => {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-red-400';
};

const iconForSignal = (name: string) => {
  const normalized = name.toLowerCase();
  if (normalized.includes('business')) return <TrendingUp className="w-4 h-4 text-emerald-400" strokeWidth={1.5} />;
  if (normalized.includes('risk')) return <DollarSign className="w-4 h-4 text-amber-400" strokeWidth={1.5} />;
  return <Rocket className="w-4 h-4 text-blue-400" strokeWidth={1.5} />;
};

export function DealOverviewTab({
  companyName,
  companyDescription,
  snapshotFactLabels,
  snapshotFacts,
  signals,
  traction,
  deal,
  productSummary,
  marketSummary,
  businessModelSummary,
  onOpenInsights,
}: DealOverviewTabProps) {
  const stageValue = firstValueForLabel(deal, /stage|phase|status/i);
  const tractionValue = firstValueForLabel(traction, /customer|client|account/i);
  const signalCards = topSignals(signals);

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="rounded-[18px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-8 border border-zinc-800/50">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-blue-500/20 text-blue-400 rounded-full px-3 py-1 text-xs font-medium">
                  {snapshotFactLabels.tam || 'Market'}
                </span>
                <div className="flex items-center gap-1.5 text-zinc-400 text-sm">
                  <MapPin className="w-4 h-4" strokeWidth={1.5} />
                  <span>{snapshotFacts.customers || 'Unknown location'}</span>
                </div>
              </div>
              <h1 className="text-white text-2xl mb-1">{companyName || 'Company'}</h1>
            </div>
          </div>

          <p className="text-zinc-200 text-lg leading-relaxed">
            {companyDescription || 'No company description available.'}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/70 to-zinc-900/70 border border-zinc-800/50 p-5">
            <div className="text-zinc-400 text-xs mb-2">{snapshotFactLabels.raise}</div>
            <div className="text-white text-xl font-medium">{snapshotFacts.raise || '—'}</div>
            <div className="text-zinc-500 text-xs mt-1">{stageValue}</div>
          </div>

          <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/70 to-zinc-900/70 border border-zinc-800/50 p-5">
            <div className="text-zinc-400 text-xs mb-2">{snapshotFactLabels.arr}</div>
            <div className="text-white text-xl font-medium">{snapshotFacts.arr || '—'}</div>
            <div className="text-zinc-500 text-xs mt-1">{snapshotFacts.growth || '—'}</div>
          </div>

          <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/70 to-zinc-900/70 border border-zinc-800/50 p-5">
            <div className="text-zinc-400 text-xs mb-2">Stage</div>
            <div className="text-white text-xl font-medium">{stageValue}</div>
            <div className="text-zinc-500 text-xs mt-1">{tractionValue}</div>
          </div>

          <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/70 to-zinc-900/70 border border-zinc-800/50 p-5">
            <div className="text-zinc-400 text-xs mb-2">{snapshotFactLabels.tam}</div>
            <div className="text-white text-xl font-medium">{snapshotFacts.tam || '—'}</div>
            <div className="text-zinc-500 text-xs mt-1">{snapshotFactLabels.growth}</div>
          </div>
        </div>

        <div className="rounded-[18px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-8 border border-zinc-800/50">
          <h2 className="text-white text-lg mb-4">Investment Snapshot</h2>
          <p className="text-zinc-200 text-base leading-relaxed">
            <strong className="text-white">{businessModelSummary || 'Business model context unavailable.'}</strong>
            {' '}
            {marketSummary || 'Market summary unavailable.'}
            {' '}
            {productSummary || 'Product summary unavailable.'}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {signalCards.map((signal, index) => (
            <div key={`${signal.name}-${index}`} className="rounded-[14px] bg-gradient-to-br from-zinc-800/70 to-zinc-900/70 border border-zinc-800/50 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {iconForSignal(signal.name)}
                  <span className="text-zinc-300 text-sm font-medium">{signal.name}</span>
                </div>
                <span className={`text-sm font-semibold ${scoreColorClass(signal.score)}`}>{signal.score}</span>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed">
                {signal.explanation || 'No explanation available.'}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-[14px] bg-zinc-900/40 border border-zinc-800/30 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={1.5} />
                <span className="text-zinc-300 text-sm">Analysis complete</span>
              </div>
              <div className="w-px h-4 bg-zinc-700"></div>
              <span className="text-zinc-500 text-xs">{snapshotFacts.growth || 'Updated recently'}</span>
            </div>

            <button
              type="button"
              onClick={onOpenInsights}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-colors"
            >
              <PlayCircle className="w-4 h-4 text-blue-400" strokeWidth={1.5} />
              <span className="text-zinc-300 text-sm">Open Investor Insights</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DealOverviewTab;
