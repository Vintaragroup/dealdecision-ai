import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { type MergedUserRecord, apiAdminGetUserAnalytics, type AdminUserAnalyticsResponse } from '../../lib/apiClient';

type RangeValue = 7 | 30 | 90 | 'all';

interface AdminUserAnalyticsDetailViewProps {
  user: MergedUserRecord;
  onBack?: () => void;
}

function KPICard({ label, value, subtitle }: { label: string; value: string | number; subtitle?: string }) {
  return (
    <div className="rounded-[12px] bg-zinc-900/70 border border-zinc-800 p-4">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
      <div className="text-xl text-zinc-100">{value}</div>
      {subtitle ? <div className="text-xs text-zinc-500 mt-1">{subtitle}</div> : null}
    </div>
  );
}

function StatusBadge({ label, variant = 'neutral' }: { label: string; variant?: 'success' | 'warning' | 'info' | 'neutral' | 'premium' }) {
  const variants: Record<string, string> = {
    success: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    warning: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    info: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    neutral: 'bg-zinc-700/50 text-zinc-300 border-zinc-600/40',
    premium: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${variants[variant]}`}>{label}</span>;
}

function formatRole(role: MergedUserRecord['account_role'] | string | null): string {
  if (!role) return 'No Role';
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRelativeDate(value: string | null): string {
  if (!value) return 'No activity observed';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaMs = Date.now() - date.getTime();
  const deltaHours = Math.floor(deltaMs / (1000 * 60 * 60));
  if (deltaHours < 1) return 'Within the last hour';
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 30) return `${deltaDays}d ago`;
  return date.toLocaleDateString();
}

export function AdminUserAnalyticsDetailView({ user, onBack }: AdminUserAnalyticsDetailViewProps) {
  const [range, setRange] = useState<RangeValue>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminUserAnalyticsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiAdminGetUserAnalytics(user.clerk_user_id, { days: range })
      .then((resp) => {
        if (cancelled) return;
        setData(resp);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Failed to load analytics';
        setError(msg);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user.clerk_user_id, range]);

  const avgDocsPerDeal = useMemo(() => {
    if (!data || data.kpis.total_deals === 0) return 0;
    return data.kpis.total_documents / data.kpis.total_deals;
  }, [data]);

  return (
    <div className="space-y-6 rounded-[14px] bg-gradient-to-br from-zinc-900/95 to-zinc-950/95 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6 border border-zinc-800/60">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            {onBack && (
              <button
                onClick={onBack}
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-800/70 hover:bg-zinc-700/70 px-3 py-1.5 text-xs text-zinc-300 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to users
              </button>
            )}
            <h2 className="text-xl text-white">User Analytics Overview</h2>
          </div>
          <p className="text-sm text-zinc-400">{user.email ?? user.clerk_user_id}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <StatusBadge
              label={user.access_status.replace('_', ' ')}
              variant={user.access_status === 'active' ? 'success' : user.access_status === 'pending' ? 'warning' : 'neutral'}
            />
            <StatusBadge label={formatRole(user.account_role)} variant={user.is_admin ? 'info' : 'neutral'} />
            {user.is_admin && <StatusBadge label="Admin" variant="premium" />}
          </div>
        </div>

        <div className="flex items-center gap-2 bg-zinc-800/80 rounded-lg p-1 self-start">
          {[7, 30, 90, 'all'].map((v) => (
            <button
              key={String(v)}
              onClick={() => setRange(v as RangeValue)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                range === v
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {v === 'all' ? 'All Time' : `${v}d`}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-400">
          Loading user analytics...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KPICard label="Total Deals" value={data.kpis.total_deals} />
            <KPICard label="Active Deals" value={data.kpis.active_deals} />
            <KPICard label="Archived Deals" value={data.kpis.archived_deals} />
            <KPICard label="Documents" value={data.kpis.total_documents} subtitle={`${avgDocsPerDeal.toFixed(1)} docs/deal`} />
            <KPICard label="Jobs" value={data.kpis.total_jobs} subtitle={`${data.kpis.failed_jobs} failed`} />
            <KPICard label="AI Analyses" value={data.kpis.ai_analyses_total} subtitle={`${data.kpis.ai_llm_called_total} with live LLM`} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 rounded-[12px] bg-zinc-900/70 border border-zinc-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm uppercase tracking-wider text-zinc-400">Deal Activity</h3>
                <span className="text-xs text-zinc-500">Top 20 by recency</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left py-2 text-xs text-zinc-500 uppercase">Deal</th>
                      <th className="text-left py-2 text-xs text-zinc-500 uppercase">Stage</th>
                      <th className="text-left py-2 text-xs text-zinc-500 uppercase">Docs</th>
                      <th className="text-left py-2 text-xs text-zinc-500 uppercase">Jobs</th>
                      <th className="text-left py-2 text-xs text-zinc-500 uppercase">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deals.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-sm text-zinc-500 text-center">
                          No user-attributed deal activity in this window.
                        </td>
                      </tr>
                    )}
                    {data.deals.map((deal) => (
                      <tr key={deal.deal_id} className="border-b border-zinc-900/80">
                        <td className="py-3 text-sm text-zinc-200">{deal.name}</td>
                        <td className="py-3 text-sm text-zinc-400">{deal.stage ?? 'Unknown'}</td>
                        <td className="py-3 text-sm text-zinc-300">{deal.document_count}</td>
                        <td className="py-3 text-sm text-zinc-300">{deal.total_jobs} ({deal.failed_jobs} failed)</td>
                        <td className="py-3 text-sm text-zinc-500">{formatRelativeDate(deal.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-[12px] bg-zinc-900/70 border border-zinc-800 p-5">
              <h3 className="text-sm uppercase tracking-wider text-zinc-400 mb-3">Confidence & Gaps</h3>
              <div className="space-y-2 mb-4">
                {Object.entries(data.data_quality.attributed_sources).map(([key, available]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">{key.replace(/_/g, ' ')}</span>
                    <span className={available ? 'text-emerald-400' : 'text-zinc-500'}>
                      {available ? 'available' : 'unavailable'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                {Object.entries(data.data_quality.unsupported_metrics).map(([key, item]) => (
                  <div key={key} className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                    <div className="flex items-center gap-2 text-amber-300 text-xs mb-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {key.replace(/_/g, ' ')}
                    </div>
                    <p className="text-xs text-zinc-300">{item.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[12px] bg-zinc-900/70 border border-zinc-800 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm uppercase tracking-wider text-zinc-400">Recent Activity</h3>
              <span className="text-xs text-zinc-500">Last observed: {formatRelativeDate(data.kpis.last_activity_at)}</span>
            </div>
            <div className="space-y-2">
              {data.activity.length === 0 && (
                <div className="text-sm text-zinc-500 py-2">No activity events in this window.</div>
              )}
              {data.activity.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2">
                  <div>
                    <div className="text-sm text-zinc-200">{item.label}</div>
                    <div className="text-xs text-zinc-500">{item.detail}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xs ${item.severity === 'warning' ? 'text-amber-300' : 'text-zinc-400'}`}>{item.kind}</div>
                    <div className="text-xs text-zinc-500">{formatRelativeDate(item.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default AdminUserAnalyticsDetailView;
