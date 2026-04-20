/**
 * CrossDealPatternsPanel
 *
 * Internal admin view — aggregates recurring patterns across all deals in the
 * portfolio: top contradictions, missing evidence, low-conviction causes,
 * fragile deals, and conviction band distribution.
 *
 * Internal only. Not exposed to end users.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  FileQuestion,
  TrendingDown,
  ShieldAlert,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  BarChart2,
  Layers,
} from 'lucide-react';
import {
  apiAdminGetCrossDealPatterns,
  type CrossDealPatternsPayload,
  type CrossDealPatternEntry,
  type CrossDealFragileDeal,
} from '../../lib/apiClient';

// ─── Colour helpers ───────────────────────────────────────────────────────────

function severityDot(severity: string | null): string {
  if (!severity) return 'bg-zinc-500';
  const s = severity.toLowerCase();
  if (s === 'critical') return 'bg-red-500';
  if (s === 'high') return 'bg-orange-400';
  if (s === 'medium') return 'bg-yellow-400';
  return 'bg-zinc-400';
}

function severityText(severity: string | null): string {
  if (!severity) return 'text-zinc-400';
  const s = severity.toLowerCase();
  if (s === 'critical') return 'text-red-400';
  if (s === 'high') return 'text-orange-400';
  if (s === 'medium') return 'text-yellow-400';
  return 'text-zinc-400';
}

function bandBadge(band: string): string {
  const b = band.toLowerCase();
  if (b.includes('hard_pass') || b.includes('hard pass')) return 'bg-red-500/20 text-red-300 border-red-500/30';
  if (b.includes('consider_caution') || b.includes('caution')) return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  if (b.includes('strong_consider') || b.includes('strong consider')) return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
  if (b.includes('fund_caution') || b.includes('fund caution')) return 'bg-emerald-600/20 text-emerald-300 border-emerald-600/30';
  if (b.includes('fund_track') || b.includes('fund track')) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
  if (b.includes('fund_confident') || b.includes('fund confident')) return 'bg-green-500/20 text-green-300 border-green-500/30';
  return 'bg-zinc-700/50 text-zinc-300 border-zinc-600/40';
}

function verdictBadge(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v === 'GO') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
  if (v === 'NO_GO') return 'bg-red-500/20 text-red-300 border-red-500/30';
  if (v === 'CONSIDER') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  return 'bg-zinc-700/50 text-zinc-300 border-zinc-600/40';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NarrativeCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">{title}</div>
      <p className="text-sm text-zinc-300 leading-relaxed">{text}</p>
    </div>
  );
}

function PatternRow({ entry, total }: { entry: CrossDealPatternEntry; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const pct = total > 0 ? Math.round((entry.deal_count / total) * 100) : 0;

  return (
    <div className="border-b border-white/[0.05] last:border-b-0">
      <button
        type="button"
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Severity dot */}
        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${severityDot(entry.severity)}`} />

        {/* Label + count bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm text-zinc-200 font-medium leading-tight">{entry.label}</span>
            <span className="text-xs text-zinc-400 flex-shrink-0">{entry.deal_count} deal{entry.deal_count !== 1 ? 's' : ''} · {pct}%</span>
          </div>
          {/* Progress bar */}
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden w-full">
            <div
              className="h-full rounded-full bg-indigo-500/60"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        </div>

        {/* Expand chevron */}
        <span className="flex-shrink-0 mt-1 text-zinc-600">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 ml-5 space-y-2">
          {entry.why_it_matters && (
            <p className="text-xs text-zinc-500 italic">{entry.why_it_matters}</p>
          )}
          {entry.example_deals.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Example deals</div>
              <div className="flex flex-wrap gap-1.5">
                {entry.example_deals.map((d) => (
                  <span
                    key={d.id}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-white/[0.08] bg-white/[0.04] text-zinc-300"
                  >
                    {d.name}
                    {d.score != null && (
                      <span className="text-zinc-500">{Math.round(d.score)}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          {entry.severity && (
            <div className={`text-[10px] font-semibold uppercase tracking-wider ${severityText(entry.severity)}`}>
              {entry.severity} severity
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PatternSection({
  icon: Icon,
  title,
  subtitle,
  entries,
  total,
  emptyMessage,
}: {
  icon: React.FC<{ className?: string }>;
  title: string;
  subtitle: string;
  entries: CrossDealPatternEntry[];
  total: number;
  emptyMessage: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-zinc-900/60 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.07] flex items-start gap-2.5">
        <Icon className="w-4 h-4 text-zinc-400 mt-0.5 flex-shrink-0" />
        <div>
          <div className="text-sm font-semibold text-zinc-200">{title}</div>
          <div className="text-xs text-zinc-500 mt-0.5">{subtitle}</div>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="px-4 py-5 text-sm text-zinc-600 italic">{emptyMessage}</div>
      ) : (
        <div>
          {entries.map((e) => (
            <PatternRow key={e.code} entry={e} total={total} />
          ))}
        </div>
      )}
    </div>
  );
}

function FragileDealRow({ deal }: { deal: CrossDealFragileDeal }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-white/[0.05] last:border-b-0">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-zinc-200 font-medium">{deal.deal_name}</span>
            {deal.conviction_band && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${bandBadge(deal.conviction_band)}`}>
                {deal.conviction_band.replace(/_/g, ' ')}
              </span>
            )}
            {deal.resistance_label && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                deal.resistance_label === 'Very Fragile' || deal.resistance_label === 'Fragile'
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  : 'bg-zinc-700/50 text-zinc-400 border-zinc-600/40'
              }`}>
                {deal.resistance_label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-500">
            {deal.conviction_score != null && <span>Conviction {Math.round(deal.conviction_score)}</span>}
            {deal.confidence != null && <span>Confidence {(deal.confidence * 100).toFixed(0)}%</span>}
            {deal.score != null && <span>Score {Math.round(deal.score)}</span>}
          </div>
        </div>
        <span className="flex-shrink-0 text-zinc-600">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 ml-3 space-y-2">
          {deal.top_reason && (
            <p className="text-xs text-zinc-400 leading-relaxed">
              <span className="text-zinc-600 font-medium">Challenge reason: </span>{deal.top_reason}
            </p>
          )}
          {deal.fragility_signals.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {deal.fragility_signals.map((s, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatBar({ label, count, total, colorClass }: { label: string; count: number; total: number; colorClass: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-300">{label.replace(/_/g, ' ')}</span>
        <span className="text-zinc-500">{count} · {pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function CrossDealPatternsPanel() {
  const [data, setData] = useState<CrossDealPatternsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiAdminGetCrossDealPatterns();
      setData(result);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load patterns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Aggregating cross-deal patterns…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {error}
        <button onClick={() => void load()} className="ml-3 underline text-red-400 hover:text-red-300">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const totalEvaluated = data.deals_with_reports;

  return (
    <div className="space-y-6">
      {/* Header + meta */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Cross-Deal Intelligence Patterns</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Internal view — recurring weaknesses, evidence gaps, and fragility signals across the portfolio.
            Not visible to end users.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/[0.1] text-zinc-400 hover:text-zinc-300 hover:bg-white/[0.05] transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {/* Portfolio stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Deals in portfolio', value: data.total_deals_in_portfolio, sub: null },
          { label: 'With report data', value: data.deals_with_reports, sub: null },
          { label: 'With challenge data', value: data.deals_with_challenge_data, sub: null },
          {
            label: 'Fragile / weak',
            value: data.fragile_deal_count,
            sub: totalEvaluated > 0 ? `${Math.round((data.fragile_deal_count / totalEvaluated) * 100)}% of evaluated` : null,
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-white/[0.07] bg-zinc-900/60 px-4 py-3">
            <div className="text-2xl font-bold text-white">{stat.value}</div>
            <div className="text-xs text-zinc-400 mt-0.5">{stat.label}</div>
            {stat.sub && <div className="text-[10px] text-zinc-600 mt-0.5">{stat.sub}</div>}
          </div>
        ))}
      </div>

      {/* Narrative summary */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mb-2">Portfolio Intelligence Summary</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NarrativeCard title="Portfolio health" text={data.narrative.portfolio_health_summary} />
          <NarrativeCard title="Most common blocker" text={data.narrative.most_common_blocker} />
          <NarrativeCard title="Most common missing evidence" text={data.narrative.most_common_missing} />
          <NarrativeCard title="Most common contradiction" text={data.narrative.most_common_contradiction} />
        </div>
      </div>

      {/* Pattern sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PatternSection
          icon={ShieldAlert}
          title="Top Challenge Factors"
          subtitle="Analytical pressure patterns blocking strong verdicts"
          entries={data.patterns.top_challenge_factors}
          total={totalEvaluated}
          emptyMessage="No challenge factor patterns detected yet."
        />

        <PatternSection
          icon={FileQuestion}
          title="Top Missing Evidence Types"
          subtitle="Evidence gaps that most frequently block high-confidence outcomes"
          entries={data.patterns.top_missing_evidence}
          total={totalEvaluated}
          emptyMessage="No recurring missing evidence patterns detected yet."
        />

        <PatternSection
          icon={AlertTriangle}
          title="Top Contradiction Types"
          subtitle="Where data conflicts most often appear across deals"
          entries={data.patterns.top_contradiction_explanations.length > 0
            ? data.patterns.top_contradiction_explanations
            : data.patterns.top_contradictions}
          total={totalEvaluated}
          emptyMessage="No recurring contradiction patterns detected yet."
        />

        <PatternSection
          icon={TrendingDown}
          title="Top Confidence Asks"
          subtitle="What diligence would most often increase decision confidence"
          entries={data.patterns.top_confidence_asks}
          total={totalEvaluated}
          emptyMessage="No recurring confidence ask patterns detected yet."
        />
      </div>

      {/* Conviction band distribution */}
      {data.conviction_band_distribution.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-zinc-400" />
            <div>
              <div className="text-sm font-semibold text-zinc-200">Conviction Band Distribution</div>
              <div className="text-xs text-zinc-500">Across all evaluated deals</div>
            </div>
          </div>
          <div className="space-y-2.5">
            {data.conviction_band_distribution.map((b) => (
              <StatBar
                key={b.band}
                label={b.band}
                count={b.count}
                total={totalEvaluated}
                colorClass={
                  b.band.includes('fund_confident') ? 'bg-green-500/70' :
                  b.band.includes('fund_track') ? 'bg-emerald-500/60' :
                  b.band.includes('fund_caution') ? 'bg-emerald-600/50' :
                  b.band.includes('strong_consider') ? 'bg-yellow-500/60' :
                  b.band.includes('consider_caution') ? 'bg-amber-500/60' :
                  b.band.includes('hard_pass') ? 'bg-red-500/60' :
                  'bg-zinc-500/50'
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Verdict distribution */}
      {data.verdict_distribution.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-zinc-400" />
            <div>
              <div className="text-sm font-semibold text-zinc-200">Challenge Pass Verdict Distribution</div>
              <div className="text-xs text-zinc-500">Across deals with challenge analysis</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.verdict_distribution.map((v) => (
              <span key={v.verdict} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border font-medium ${verdictBadge(v.verdict)}`}>
                {v.verdict === 'unknown' ? 'Not set' : v.verdict}
                <span className="opacity-60">· {v.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Fragile deals */}
      {data.fragile_deals.length > 0 && (
        <div className="rounded-xl border border-rose-500/20 bg-zinc-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-rose-500/20 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-zinc-200">
                Fragile Deals ({data.fragile_deals.length})
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Deals with low conviction, low confidence, or fragile verdict resistance
              </div>
            </div>
          </div>
          {data.fragile_deals.map((d) => (
            <FragileDealRow key={d.deal_id} deal={d} />
          ))}
        </div>
      )}

      {/* Unknown inputs */}
      {data.patterns.top_unknowns.length > 0 && (
        <PatternSection
          icon={FileQuestion}
          title="Top Unknown / Unverified Inputs"
          subtitle="Inputs that cannot be confirmed, limiting conviction ceiling"
          entries={data.patterns.top_unknowns}
          total={totalEvaluated}
          emptyMessage="No recurring unknown input patterns."
        />
      )}

      <div className="text-[10px] text-zinc-700 text-right">
        Generated {new Date(data.generated_at).toLocaleString()} · internal only
      </div>
    </div>
  );
}
