import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiAdminListAuditLogs, type PlatformAuditLogRecord } from '../../lib/apiClient';
import { RefreshCw, Search, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 25;

function formatTs(value: string): string {
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return value;
  return t.toLocaleString();
}

type AuditLogsPanelProps = {
  compact?: boolean;
};

export function AuditLogsPanel({ compact = false }: AuditLogsPanelProps) {
  const [records, setRecords] = useState<PlatformAuditLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actorUserId, setActorUserId] = useState('');
  const [actionType, setActionType] = useState('');
  const [entityType, setEntityType] = useState('');

  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiAdminListAuditLogs({
        limit: compact ? 10 : PAGE_SIZE,
        offset: compact ? 0 : offset,
        actor_user_id: actorUserId.trim() || undefined,
        action_type: actionType.trim() || undefined,
        entity_type: entityType.trim() || undefined,
      });
      setRecords(resp.records);
      setTotal(resp.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [compact, offset, actorUserId, actionType, entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = useMemo(() => (compact ? 'Recent Activity' : 'Audit Logs'), [compact]);

  return (
    <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/70 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
          Refresh
        </button>
      </div>

      {!compact && (
        <div className="p-4 border-b border-zinc-800 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" strokeWidth={1.5} />
            <input
              value={actorUserId}
              onChange={(e) => {
                setOffset(0);
                setActorUserId(e.target.value);
              }}
              placeholder="Filter actor user ID"
              className="w-full pl-10 pr-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
          <input
            value={actionType}
            onChange={(e) => {
              setOffset(0);
              setActionType(e.target.value);
            }}
            placeholder="Filter action type"
            className="w-full px-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          <input
            value={entityType}
            onChange={(e) => {
              setOffset(0);
              setEntityType(e.target.value);
            }}
            placeholder="Filter entity type"
            className="w-full px-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>
      )}

      {error && <div className="px-4 py-3 text-sm text-red-300 bg-red-500/10 border-b border-red-500/20">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-zinc-800/80 border-b border-zinc-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Time</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Actor</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Action</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Entity</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500 text-sm">
                  No audit records found
                </td>
              </tr>
            )}
            {records.map((row) => (
              <tr key={row.id} className="hover:bg-zinc-800/30 transition-colors align-top">
                <td className="px-4 py-3 text-xs text-zinc-300 whitespace-nowrap">{formatTs(row.created_at)}</td>
                <td className="px-4 py-3 text-xs text-zinc-300 font-mono">{row.actor_user_id}</td>
                <td className="px-4 py-3 text-xs text-zinc-100">{row.action_type}</td>
                <td className="px-4 py-3 text-xs text-zinc-300">
                  <div>{row.entity_type}</div>
                  <div className="font-mono text-zinc-500">{row.entity_id}</div>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-300">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!compact && (
        <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
          <span>
            Showing {records.length === 0 ? 0 : offset + 1}-{Math.min(offset + records.length, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={!canPrev}
              onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.5} />
              Prev
            </button>
            <button
              disabled={!canNext}
              onClick={() => setOffset((v) => v + PAGE_SIZE)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
