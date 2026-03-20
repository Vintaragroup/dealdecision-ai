import React, { useState, useEffect, useCallback } from 'react';
import { MoreHorizontal, Shield, ShieldOff, CalendarClock, UserX, AlertCircle, Tag, UserPlus } from 'lucide-react';
import { StatusPill } from './StatusPill';
import {
  apiAdminListUsers,
  apiAdminSetAdminStatus,
  apiAdminRevokeAccess,
  apiAdminExtendAccess,
  apiAdminSetAccountRole,
  apiAdminProvisionUser,
  MergedUserRecord,
} from '../../lib/apiClient';

type AccountRole = 'super_admin' | 'admin' | 'account_executive' | 'analyst' | 'client';

const ROLE_LABELS: Record<AccountRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  account_executive: 'Account Exec',
  analyst: 'Analyst',
  client: 'Client',
};

const ROLE_COLORS: Record<AccountRole, string> = {
  super_admin: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  admin: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  account_executive: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  analyst: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  client: 'bg-zinc-600/40 text-zinc-400 border-zinc-600/40',
};

function RoleBadge({ role }: { role: AccountRole | null }) {
  if (!role) return <span className="text-zinc-600 text-sm">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${ROLE_COLORS[role] ?? 'bg-zinc-700 text-zinc-400'}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

interface UsersTableProps {
  searchQuery: string;
  refreshKey?: number;
}

export function UsersTable({ searchQuery, refreshKey }: UsersTableProps) {
  const [users, setUsers] = useState<MergedUserRecord[]>([]);
  const [clerkAvailable, setClerkAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiAdminListUsers({ limit: 200 });
      setUsers(result.records);
      setClerkAvailable(result.clerkAvailable);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load users';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload, refreshKey]);

  const toggleAdmin = async (user: MergedUserRecord) => {
    if (!user.id) { alert('This user has no platform_access record — provision access first.'); return; }
    setBusy(user.clerk_user_id);
    try {
      await apiAdminSetAdminStatus(user.clerk_user_id, !user.is_admin);
      await reload();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to update admin status');
    } finally {
      setBusy(null);
    }
  };

  const revokeUser = async (user: MergedUserRecord) => {
    if (!user.id) { alert('No platform_access record to revoke.'); return; }
    const label = user.email ?? user.clerk_user_id;
    if (!confirm(`Revoke access for ${label}?`)) return;
    setActiveDropdown(null);
    setBusy(user.clerk_user_id);
    try {
      await apiAdminRevokeAccess(user.clerk_user_id);
      await reload();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to revoke access');
    } finally {
      setBusy(null);
    }
  };

  const extendUser = async (user: MergedUserRecord) => {
    if (!user.id) { alert('No platform_access record — provision access first.'); return; }
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
      alert(e instanceof Error ? e.message : 'Failed to extend access');
    } finally {
      setBusy(null);
    }
  };

  const provisionUser = async (user: MergedUserRecord) => {
    if (!window.confirm(`Provision platform access for ${user.email ?? user.clerk_user_id}?\n\nThey will be given 'client' role and active status.`)) return;
    setActiveDropdown(null);
    setBusy(user.clerk_user_id);
    try {
      await apiAdminProvisionUser(user.clerk_user_id, { account_role: 'client' });
      await reload();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to provision user');
    } finally {
      setBusy(null);
    }
  };

  const setRole = async (user: MergedUserRecord) => {
    if (!user.id) { alert('No platform_access record — provision access first.'); return; }
    const roles: AccountRole[] = ['super_admin', 'admin', 'account_executive', 'analyst', 'client'];
    const options = roles.map((r, i) => `${i + 1}. ${ROLE_LABELS[r]}`).join('\n');
    const input = prompt(`Set account role for ${user.email ?? user.clerk_user_id}:\n${options}\n\nEnter a number (1–5):`);
    if (input === null) return;
    const idx = parseInt(input, 10) - 1;
    if (idx < 0 || idx >= roles.length) { alert('Invalid selection'); return; }
    const role = roles[idx];
    setActiveDropdown(null);
    setBusy(user.clerk_user_id);
    try {
      await apiAdminSetAccountRole(user.clerk_user_id, role);
      await reload();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to set role');
    } finally {
      setBusy(null);
    }
  };

  const filteredUsers = users.filter(user => {
    const q = searchQuery.toLowerCase();
    return (
      user.clerk_user_id.toLowerCase().includes(q) ||
      (user.email ?? '').toLowerCase().includes(q) ||
      (user.full_name ?? '').toLowerCase().includes(q) ||
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
    <div className="space-y-3">
      {clerkAvailable === false && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          <span>Clerk identity data unavailable — showing only provisioned users. Set <code className="font-mono text-xs">CLERK_SECRET_KEY</code> in the API environment to enable full user listing.</span>
        </div>
      )}

      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-zinc-800/80 backdrop-blur-sm border-b border-zinc-700">
              <tr>
                <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">User</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Role</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Expiration</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Admin</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Grant Source</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                    No users found
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.clerk_user_id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <div className="text-sm text-white font-medium">
                          {user.full_name ?? (user.email ? null : (
                            <span className="font-mono text-zinc-400">{user.clerk_user_id}</span>
                          ))}
                          {user.full_name && user.email && (
                            <span className="text-zinc-400 font-normal ml-1">·</span>
                          )}
                        </div>
                        {user.email && (
                          <div className="text-sm text-zinc-300">{user.email}</div>
                        )}
                        <div className="text-xs text-zinc-600 font-mono mt-0.5 truncate max-w-[220px]" title={user.clerk_user_id}>
                          {user.clerk_user_id}
                        </div>
                        {user.notes && <div className="text-xs text-zinc-500 mt-0.5">{user.notes}</div>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusPill status={user.access_status} />
                    </td>
                    <td className="px-6 py-4">
                      <RoleBadge role={user.account_role as AccountRole | null} />
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
                      {user.access_status === 'not_provisioned' ? (
                        <span className="text-zinc-600 text-sm">—</span>
                      ) : (
                        <>
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
                        </>
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
                          <div className="absolute right-0 mt-2 w-52 rounded-lg bg-zinc-800 border border-zinc-700 shadow-xl z-10">
                            {user.access_status === 'not_provisioned' ? (
                              <button
                                onClick={() => void provisionUser(user)}
                                disabled={!!busy}
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-emerald-400 hover:bg-zinc-700 transition-colors text-left"
                              >
                                <UserPlus className="w-4 h-4" strokeWidth={1.5} />
                                Provision Access
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => void extendUser(user)}
                                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors text-left"
                                >
                                  <CalendarClock className="w-4 h-4" strokeWidth={1.5} />
                                  Extend Access
                                </button>
                                <button
                                  onClick={() => void setRole(user)}
                                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors text-left"
                                >
                                  <Tag className="w-4 h-4" strokeWidth={1.5} />
                                  Set Role
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
                              </>
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
    </div>
  );
}
