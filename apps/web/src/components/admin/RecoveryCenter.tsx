import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiAdminListDeletedDeals,
  apiAdminListDeletedDocuments,
  apiAdminRestoreDeal,
  apiAdminRestoreDocument,
  apiAdminPurgeDeal,
  apiAdminPurgeDocument,
  type AdminRecoveryDealRecord,
  type AdminRecoveryDocumentRecord,
} from '../../lib/apiClient';
import { AlertTriangle, RefreshCw, RotateCcw, Trash2, Search } from 'lucide-react';

type RecoveryCenterProps = {
  adminRole: 'super_admin' | 'admin' | null;
};

function formatTs(value: string | null | undefined): string {
  if (!value) return '—';
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return value;
  return t.toLocaleString();
}

export function RecoveryCenter({ adminRole }: RecoveryCenterProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dealRows, setDealRows] = useState<AdminRecoveryDealRecord[]>([]);
  const [documentRows, setDocumentRows] = useState<AdminRecoveryDocumentRecord[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const canPurge = adminRole === 'super_admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dealsRes, docsRes] = await Promise.all([
        apiAdminListDeletedDeals({ limit: 200, query }),
        apiAdminListDeletedDocuments({ limit: 200, query }),
      ]);
      setDealRows(dealsRes.records);
      setDocumentRows(docsRes.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recovery data');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const softLimitNotice = useMemo(() => {
    return 'Showing up to 200 records per table. Refine search to narrow results.';
  }, []);

  async function handleRestoreDeal(row: AdminRecoveryDealRecord) {
    const reason = window.prompt(`Reason for restoring deal ${row.id}:`, 'Restore from admin recovery center');
    if (!reason || reason.trim().length === 0) return;

    const key = `deal:restore:${row.id}`;
    setBusyKey(key);
    try {
      await apiAdminRestoreDeal(row.id, reason.trim());
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restore deal');
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePurgeDeal(row: AdminRecoveryDealRecord) {
    if (!canPurge) return;
    const reason = window.prompt(`Reason for PURGING deal ${row.id}:`, 'Irreversible cleanup from admin recovery center');
    if (!reason || reason.trim().length === 0) return;

    const expected = `PURGE DEAL ${row.id}`;
    const confirmText = window.prompt(`Type exact confirmation token to purge:\n${expected}`, '');
    if (!confirmText) return;

    const key = `deal:purge:${row.id}`;
    setBusyKey(key);
    try {
      await apiAdminPurgeDeal(row.id, { reason: reason.trim(), confirm_text: confirmText.trim() });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to purge deal');
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRestoreDocument(row: AdminRecoveryDocumentRecord) {
    const reason = window.prompt(`Reason for restoring document ${row.document_id}:`, 'Restore from admin recovery center');
    if (!reason || reason.trim().length === 0) return;

    const key = `document:restore:${row.document_id}`;
    setBusyKey(key);
    try {
      await apiAdminRestoreDocument(row.document_id, reason.trim());
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restore document');
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePurgeDocument(row: AdminRecoveryDocumentRecord) {
    if (!canPurge) return;
    const reason = window.prompt(`Reason for PURGING document ${row.document_id}:`, 'Irreversible cleanup from admin recovery center');
    if (!reason || reason.trim().length === 0) return;

    const expected = `PURGE DOCUMENT ${row.document_id}`;
    const confirmText = window.prompt(`Type exact confirmation token to purge:\n${expected}`, '');
    if (!confirmText) return;

    const key = `document:purge:${row.document_id}`;
    setBusyKey(key);
    try {
      await apiAdminPurgeDocument(row.document_id, { reason: reason.trim(), confirm_text: confirmText.trim() });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to purge document');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[14px] bg-gradient-to-br from-amber-600/10 to-red-700/10 border border-amber-500/25 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5" strokeWidth={1.75} />
          <div>
            <h3 className="text-sm font-semibold text-amber-100">Recovery Center</h3>
            <p className="text-xs text-amber-200/90 mt-1">
              Restore and purge are governance actions. Purge is irreversible and requires super_admin role plus typed confirmation.
            </p>
            {!canPurge && (
              <p className="text-xs text-amber-300 mt-2">
                You are an admin but not super_admin. Purge actions are disabled.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" strokeWidth={1.5} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ID, name, title, owner"
            className="w-full pl-10 pr-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>

        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/70 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-colors"
          title="Refresh recovery data"
        >
          <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="text-xs text-zinc-500">{softLimitNotice}</div>

      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h3 className="text-lg font-semibold text-white">Deleted Deals</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-zinc-800/80 border-b border-zinc-700">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Deal</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Owner</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Deleted</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {!loading && dealRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500 text-sm">No deleted deals found</td>
                </tr>
              )}
              {dealRows.map((row) => {
                const restoreKey = `deal:restore:${row.id}`;
                const purgeKey = `deal:purge:${row.id}`;
                return (
                  <tr key={row.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-sm text-white">{row.name}</div>
                      <div className="text-xs text-zinc-500 font-mono">{row.id}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300">{row.owner ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-zinc-300">{formatTs(row.deleted_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void handleRestoreDeal(row)}
                          disabled={busyKey === restoreKey || busyKey === purgeKey}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-emerald-200 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Restore
                        </button>
                        <button
                          onClick={() => void handlePurgeDeal(row)}
                          disabled={!canPurge || busyKey === restoreKey || busyKey === purgeKey}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-red-200 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50"
                          title={canPurge ? 'Permanently purge deal' : 'Only super_admin can purge'}
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Purge
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h3 className="text-lg font-semibold text-white">Deleted Documents</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-zinc-800/80 border-b border-zinc-700">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Document</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Deal</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Deleted</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {!loading && documentRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500 text-sm">No deleted documents found</td>
                </tr>
              )}
              {documentRows.map((row) => {
                const restoreKey = `document:restore:${row.document_id}`;
                const purgeKey = `document:purge:${row.document_id}`;
                return (
                  <tr key={row.document_id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-sm text-white">{row.title ?? 'Untitled document'}</div>
                      <div className="text-xs text-zinc-500 font-mono">{row.document_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-300">{row.deal_name ?? 'Unknown deal'}</div>
                      <div className="text-xs text-zinc-500 font-mono">{row.deal_id}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300">{formatTs(row.deleted_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void handleRestoreDocument(row)}
                          disabled={busyKey === restoreKey || busyKey === purgeKey}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-emerald-200 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Restore
                        </button>
                        <button
                          onClick={() => void handlePurgeDocument(row)}
                          disabled={!canPurge || busyKey === restoreKey || busyKey === purgeKey}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-red-200 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50"
                          title={canPurge ? 'Permanently purge document' : 'Only super_admin can purge'}
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Purge
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
