import React, { useState, useEffect, useCallback } from 'react';
import { Copy, MoreHorizontal, XCircle, Check, RefreshCw } from 'lucide-react';
import { StatusPill } from './StatusPill';
import {
  apiAdminListInvites,
  apiAdminRevokeInvite,
  AdminInviteRecord,
} from '../../lib/apiClient';

interface InvitesTableProps {
  refreshKey?: number;
}

export function InvitesTable({ refreshKey }: InvitesTableProps) {
  const [invites, setInvites] = useState<AdminInviteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiAdminListInvites({ limit: 200 });
      setInvites(result.records);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load invites';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload, refreshKey]);

  const copyInviteLink = (code: string) => {
    const link = `${window.location.origin}/invite/${code}`;
    navigator.clipboard.writeText(link).catch(() => {});
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const revokeInvite = async (code: string) => {
    if (!confirm(`Revoke invite code ${code}?`)) return;
    setActiveDropdown(null);
    setRevoking(code);
    try {
      await apiAdminRevokeInvite(code);
      await reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to revoke invite';
      alert(msg);
    } finally {
      setRevoking(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-8 text-center text-zinc-400">
        Loading invites...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-8 text-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Invite Codes</h3>
        <button
          onClick={() => void reload()}
          className="p-1.5 hover:bg-zinc-700 rounded-lg transition-colors text-zinc-400 hover:text-zinc-300"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-zinc-800/80 backdrop-blur-sm border-b border-zinc-700">
            <tr>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Code</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Email</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Duration</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Redeemed By</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Created</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {invites.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                  No invites created yet
                </td>
              </tr>
            ) : (
              invites.map((invite) => (
                <tr key={invite.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-6 py-4">
                    <span className="text-sm text-white font-mono">{invite.code}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">
                      {invite.email || <span className="text-zinc-500 italic">Unbound</span>}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-400">{invite.access_duration_days} days</span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusPill status={invite.status} />
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">
                      {invite.redeemed_email || invite.redeemed_by_clerk_user_id || <span className="text-zinc-500">—</span>}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-400">
                      {new Date(invite.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyInviteLink(invite.code)}
                        disabled={invite.status !== 'active'}
                        className="p-1.5 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-40"
                        title="Copy invite link"
                      >
                        {copied === invite.code ? (
                          <Check className="w-4 h-4 text-emerald-400" strokeWidth={1.5} />
                        ) : (
                          <Copy className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
                        )}
                      </button>

                      {invite.status === 'active' && (
                        <div className="relative">
                          <button
                            onClick={() => setActiveDropdown(activeDropdown === invite.id ? null : invite.id)}
                            disabled={revoking === invite.code}
                            className="p-1.5 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-40"
                          >
                            <MoreHorizontal className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
                          </button>

                          {activeDropdown === invite.id && (
                            <div className="absolute right-0 mt-2 w-40 rounded-lg bg-zinc-800 border border-zinc-700 shadow-xl z-10">
                              <button
                                onClick={() => void revokeInvite(invite.code)}
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-zinc-700 transition-colors text-left"
                              >
                                <XCircle className="w-4 h-4" strokeWidth={1.5} />
                                Revoke Invite
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
