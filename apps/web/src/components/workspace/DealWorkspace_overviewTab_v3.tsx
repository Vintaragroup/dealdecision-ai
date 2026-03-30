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
  darkMode,
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
  const surfaceClass = darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200';
  const cardClass = darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200';
  const titleClass = darkMode ? 'text-white' : 'text-gray-900';
  const bodyClass = darkMode ? 'text-gray-300' : 'text-gray-700';
  const mutedClass = darkMode ? 'text-gray-400' : 'text-gray-600';
  const subtleClass = darkMode ? 'text-gray-500' : 'text-gray-500';

  return (
    <div className="w-full max-w-none">
      <div className="w-full max-w-none space-y-6">
        <div className={`rounded-xl border p-8 ${surfaceClass}`}>
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-blue-500/20 text-blue-400 rounded-full px-3 py-1 text-xs font-medium">
                  {snapshotFactLabels.tam || 'Market'}
                </span>
                <div className={`flex items-center gap-1.5 text-sm ${mutedClass}`}>
                  <MapPin className="w-4 h-4" strokeWidth={1.5} />
                  <span>{snapshotFacts.customers || 'Unknown location'}</span>
                </div>
              </div>
              <h1 className={`text-2xl mb-1 ${titleClass}`}>{companyName || 'Company'}</h1>
            </div>
          </div>

          <p className={`text-lg leading-relaxed ${bodyClass}`}>
            {companyDescription || 'No company description available.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className={`rounded-xl border p-5 ${cardClass}`}>
            <div className={`text-xs mb-2 ${mutedClass}`}>{snapshotFactLabels.raise}</div>
            <div className={`text-xl font-medium ${titleClass}`}>{snapshotFacts.raise || '—'}</div>
            <div className={`text-xs mt-1 ${subtleClass}`}>{stageValue}</div>
          </div>

          <div className={`rounded-xl border p-5 ${cardClass}`}>
            <div className={`text-xs mb-2 ${mutedClass}`}>{snapshotFactLabels.arr}</div>
            <div className={`text-xl font-medium ${titleClass}`}>{snapshotFacts.arr || '—'}</div>
            <div className={`text-xs mt-1 ${subtleClass}`}>{snapshotFacts.growth || '—'}</div>
          </div>

          <div className={`rounded-xl border p-5 ${cardClass}`}>
            <div className={`text-xs mb-2 ${mutedClass}`}>Stage</div>
            <div className={`text-xl font-medium ${titleClass}`}>{stageValue}</div>
            <div className={`text-xs mt-1 ${subtleClass}`}>{tractionValue}</div>
          </div>

          <div className={`rounded-xl border p-5 ${cardClass}`}>
            <div className={`text-xs mb-2 ${mutedClass}`}>{snapshotFactLabels.tam}</div>
            <div className={`text-xl font-medium ${titleClass}`}>{snapshotFacts.tam || '—'}</div>
            <div className={`text-xs mt-1 ${subtleClass}`}>{snapshotFactLabels.growth}</div>
          </div>
        </div>

        <div className={`rounded-xl border p-8 ${surfaceClass}`}>
          <h2 className={`text-sm uppercase tracking-wide mb-4 ${mutedClass}`}>Investment Snapshot</h2>
          <p className={`text-base leading-relaxed ${bodyClass}`}>
            <strong className={titleClass}>{businessModelSummary || 'Business model context unavailable.'}</strong>
            {' '}
            {marketSummary || 'Market summary unavailable.'}
            {' '}
            {productSummary || 'Product summary unavailable.'}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {signalCards.map((signal, index) => (
            <div key={`${signal.name}-${index}`} className={`rounded-xl border p-5 ${cardClass}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {iconForSignal(signal.name)}
                  <span className={`text-sm font-medium ${bodyClass}`}>{signal.name}</span>
                </div>
                <span className={`text-sm font-semibold ${scoreColorClass(signal.score)}`}>{signal.score}</span>
              </div>
              <p className={`text-sm leading-relaxed ${mutedClass}`}>
                {signal.explanation || 'No explanation available.'}
              </p>
            </div>
          ))}
        </div>

        <div className={`rounded-xl border p-4 ${surfaceClass}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={1.5} />
                <span className={`text-sm ${bodyClass}`}>Analysis complete</span>
              </div>
              <div className={`w-px h-4 ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}></div>
              <span className={`text-xs ${subtleClass}`}>{snapshotFacts.growth || 'Updated recently'}</span>
            </div>

            <button
              type="button"
              onClick={onOpenInsights}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                darkMode
                  ? 'bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20'
                  : 'bg-white hover:bg-gray-50 border-gray-200 hover:border-gray-300'
              }`}
            >
              <PlayCircle className="w-4 h-4 text-blue-400" strokeWidth={1.5} />
              <span className={`text-sm ${bodyClass}`}>Open Investor Insights</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DealOverviewTab;
