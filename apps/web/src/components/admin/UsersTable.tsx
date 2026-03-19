import React, { useState, useEffect, useCallback } from 'react';
import { MoreHorizontal, Shield, ShieldOff, CalendarClock, UserX } from 'lucide-react';
import { StatusPill } from './StatusPill';
import {
  apiAdminListPlatformAccess,
  apiAdminSetAdminStatus,
  apiAdminRevokeAccess,
  apiAdminExtendAccess,
  PlatformAccessRecord,
} from '../../lib/apiClient';

interface UsersTableProps {
  searchQuery: string;
  refreshKey?: number;
}

export function UsersTable({ searchQuery, refreshKey }: UsersTableProps) {
  const [users, setUsers] = useState<PlatformAccessRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiAdminListPlatformAccess({ limit: 200 });
      setUsers(result.records);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load users';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload, refreshKey]);

  const toggleAdmin = async (user: PlatformAccessRecord) => {
    setBusy(user.clerk_user_id);
    try {
      await apiAdminSetAdminStatus(user.clerk_user_id, !user.is_admin);
      await reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update admin status';
      alert(msg);
    } finally {
      setBusy(null);
    }
  };

  const revokeUser = async (user: PlatformAccessRecord) => {
    if (!confirm(`Revoke access for ${user.clerk_user_id}?`)) return;
    setActiveDropdown(null);
    setBusy(user.clerk_user_id);
    try {
      await apiAdminRevokeAccess(user.clerk_user_id);
      await reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to revoke access';
      alert(msg);
    } finally {
      setBusy(null);
    }
  };

  const extendUser = async (user: PlatformAccessRecord) => {
    const input = prompt('Extend access by how many days? (1–365)', '90');
    if (input === null) return;
    const days = parseInt(input, 10);
    if (!days || days < 1 || days > 365) { alert('Enter a number between 1 and 365'); return; }
    setActiveDropdown(null);
    setBusy(user.clerk_user_id);
    try {
      await apiAdminExtendAccess(user.clerk_user_id, days);
      await reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to extend access';
      alert(msg);
    } finally {
      setBusy(null);
    }
  };

  const filteredUsers = users.filter(user => {
    const q = searchQuery.toLowerCase();
    return (
      user.clerk_user_id.toLowerCase().includes(q) ||
      (user.notes ?? '').toLowerCase().includes(q) ||
      (user.grant_source ?? '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-8 text-center text-zinc-400">
        Loading users...
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
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-zinc-800/80 backdrop-blur-sm border-b border-zinc-700">
            <tr>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">User ID</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Expiration</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Admin</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Grant Source</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                  No users found
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <div className="text-sm text-white font-mono truncate max-w-[200px]" title={user.clerk_user_id}>
                        {user.clerk_user_id}
                      </div>
                      {user.notes && <div className="text-xs text-zinc-500 mt-0.5">{user.notes}</div>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusPill status={user.access_status} />
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">
                      {user.access_expires_at
                        ? new Date(user.access_expires_at).toLocaleDateString()
                        : <span className="text-zinc-500">—</span>
                      }
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => void toggleAdmin(user)}
                      disabled={!!busy}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                        user.is_admin ? 'bg-blue-600' : 'bg-zinc-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          user.is_admin ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    {user.is_admin && (
                      <span className="ml-2 text-xs text-blue-400">Admin</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-400">{user.grant_source ?? '—'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="relative">
                      <button
                        onClick={() => setActiveDropdown(activeDropdown === user.clerk_user_id ? null : user.clerk_user_id)}
                        disabled={!!busy}
                        className="p-1.5 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <MoreHorizontal className="w-5 h-5 text-zinc-400" strokeWidth={1.5} />
                      </button>

                      {activeDropdown === user.clerk_user_id && (
                        <div className="absolute right-0 mt-2 w-48 rounded-lg bg-zinc-800 border border-zinc-700 shadow-xl z-10">
                          <button
                            onClick={() => void extendUser(user)}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors text-left"
                          >
                            <CalendarClock className="w-4 h-4" strokeWidth={1.5} />
                            Extend Access
                          </button>
                          <button
                            onClick={() => void toggleAdmin(user)}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors text-left"
                          >
                            {user.is_admin ? (
                              <>
                                <ShieldOff className="w-4 h-4" strokeWidth={1.5} />
                                Remove Admin
                              </>
                            ) : (
                              <>
                                <Shield className="w-4 h-4" strokeWidth={1.5} />
                                Make Admin
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => void revokeUser(user)}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-zinc-700 transition-colors text-left"
                          >
                            <UserX className="w-4 h-4" strokeWidth={1.5} />
                            Revoke Access
                          </button>
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
