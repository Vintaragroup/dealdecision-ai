import React, { useCallback, useEffect, useState } from 'react';
import { apiAdminGetSuperAdminOpsFeed, type SuperAdminOpsFeed } from '../../lib/apiClient';
import { RefreshCw } from 'lucide-react';

function formatTs(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
type PresetKey = 'all' | 'access_security' | 'invite_failures' | 'purge_events';

function getAlertSeverity(actionType: string): AlertSeverity {
  if (actionType === 'deal.purge' || actionType === 'document.hard_delete') return 'critical';
  if (
    actionType === 'platform_access.revoke' ||
    actionType === 'platform_access.set_admin_status' ||
    actionType === 'platform_access.set_account_role'
  ) return 'high';
  if (
    actionType === 'organization_membership.revoke' ||
    actionType === 'organization_membership.set_role' ||
    actionType === 'invite.redeem_failed' ||
    actionType === 'invite.expired'
  ) return 'medium';
  return 'low';
}

function getErrorSeverity(message: string): AlertSeverity {
  const m = message.toLowerCase();
  if (/timeout|connection|redis|database|db|auth|forbidden/.test(m)) return 'high';
  if (/validation|missing|invalid|not found/.test(m)) return 'medium';
  return 'low';
}

function severityBadgeClasses(level: AlertSeverity): string {
  if (level === 'critical') return 'bg-red-500/20 text-red-200 border border-red-500/40';
  if (level === 'high') return 'bg-amber-500/20 text-amber-200 border border-amber-500/40';
  if (level === 'medium') return 'bg-yellow-500/20 text-yellow-200 border border-yellow-500/40';
  return 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40';
}

export function SuperAdminOpsPanel() {
  const [hours, setHours] = useState(24);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | AlertSeverity>('all');
  const [preset, setPreset] = useState<PresetKey>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<SuperAdminOpsFeed | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiAdminGetSuperAdminOpsFeed({ hours, limit: 25 });
      setFeed(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load super admin ops feed');
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableActions = Array.from(new Set((feed?.system_alerts ?? []).map((a) => a.action_type))).sort();
  const applyPreset = (nextPreset: PresetKey) => {
    setPreset(nextPreset);
    if (nextPreset === 'all') {
      setActionFilter('all');
      setSeverityFilter('all');
      return;
    }

    if (nextPreset === 'access_security') {
      setSeverityFilter('high');
      setActionFilter('all');
      return;
    }

    if (nextPreset === 'invite_failures') {
      setSeverityFilter('all');
      setActionFilter('invite.redeem_failed');
      return;
    }

    setSeverityFilter('critical');
    setActionFilter('all');
  };

  const filteredAlerts = (feed?.system_alerts ?? []).filter((a) => {
    if (actionFilter !== 'all' && a.action_type !== actionFilter) return false;
    const sev = getAlertSeverity(a.action_type);
    if (severityFilter !== 'all' && sev !== severityFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="rounded-[14px] bg-gradient-to-br from-red-900/20 to-zinc-900/90 border border-red-500/20 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Super Admin Ops</h3>
          <p className="text-xs text-zinc-400 mt-1">Privileged view for system alerts and recent error logs.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white"
          >
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={72}>Last 72h</option>
            <option value={168}>Last 7d</option>
          </select>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white"
          >
            <option value="all">All actions</option>
            {availableActions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as 'all' | AlertSeverity)}
            className="px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white"
          >
            <option value="all">All severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/70 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => applyPreset('all')}
          className={`px-3 py-1.5 rounded-full text-xs border ${preset === 'all' ? 'bg-zinc-700 text-white border-zinc-600' : 'bg-zinc-900/40 text-zinc-300 border-zinc-700 hover:bg-zinc-800'}`}
        >
          All
        </button>
        <button
          onClick={() => applyPreset('access_security')}
          className={`px-3 py-1.5 rounded-full text-xs border ${preset === 'access_security' ? 'bg-amber-500/20 text-amber-200 border-amber-500/40' : 'bg-zinc-900/40 text-zinc-300 border-zinc-700 hover:bg-zinc-800'}`}
        >
          Access/Security
        </button>
        <button
          onClick={() => applyPreset('invite_failures')}
          className={`px-3 py-1.5 rounded-full text-xs border ${preset === 'invite_failures' ? 'bg-yellow-500/20 text-yellow-200 border-yellow-500/40' : 'bg-zinc-900/40 text-zinc-300 border-zinc-700 hover:bg-zinc-800'}`}
        >
          Invite Failures
        </button>
        <button
          onClick={() => applyPreset('purge_events')}
          className={`px-3 py-1.5 rounded-full text-xs border ${preset === 'purge_events' ? 'bg-red-500/20 text-red-200 border-red-500/40' : 'bg-zinc-900/40 text-zinc-300 border-zinc-700 hover:bg-zinc-800'}`}
        >
          Purge Events
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 p-4 border border-zinc-800/80">
          <h4 className="text-sm font-semibold text-zinc-100 mb-3">System Alerts</h4>
          <div className="space-y-2 text-sm">
            {loading && <div className="text-zinc-500">Loading…</div>}
            {!loading && (filteredAlerts.length ?? 0) === 0 && (
              <div className="text-zinc-500">No system alerts for selected window.</div>
            )}
            {filteredAlerts.slice(0, 20).map((a) => (
              <div key={a.id} className="rounded-md border border-zinc-700/80 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-zinc-200 font-mono text-xs">{a.action_type}</div>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${severityBadgeClasses(getAlertSeverity(a.action_type))}`}>
                    {getAlertSeverity(a.action_type)}
                  </span>
                </div>
                <div className="text-zinc-400 text-xs">{a.entity_type}:{a.entity_id}</div>
                <div className="text-zinc-500 text-xs">{formatTs(a.created_at)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 p-4 border border-zinc-800/80">
          <h4 className="text-sm font-semibold text-zinc-100 mb-3">Error Logs (Failed Jobs)</h4>
          <div className="space-y-2 text-sm">
            {loading && <div className="text-zinc-500">Loading…</div>}
            {!loading && (feed?.error_logs?.length ?? 0) === 0 && (
              <div className="text-zinc-500">No failed jobs for selected window.</div>
            )}
            {(feed?.error_logs ?? []).slice(0, 20).map((e) => (
              <div key={e.job_id} className="rounded-md border border-zinc-700/80 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-zinc-200 font-mono text-xs">{e.job_id}</div>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${severityBadgeClasses(getErrorSeverity(e.error ?? e.message ?? ''))}`}>
                    {getErrorSeverity(e.error ?? e.message ?? '')}
                  </span>
                </div>
                <div className="text-zinc-400 text-xs">{e.type ?? 'unknown_type'} · {e.status}</div>
                <div className="text-zinc-400 text-xs">deal: {e.deal_id ?? '—'} · doc: {e.document_id ?? '—'}</div>
                <div className="text-red-300 text-xs">{e.error ?? e.message ?? 'no error message'}</div>
                <div className="text-zinc-500 text-xs">{formatTs(e.updated_at ?? e.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-xs text-zinc-500">
        Source availability: audit_log={String(feed?.availability?.platform_audit_log ?? false)} · jobs={String(feed?.availability?.jobs ?? false)}
      </div>
    </div>
  );
}
