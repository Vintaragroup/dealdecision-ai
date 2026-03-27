import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiAdminGetOrg,
  apiAdminListOrgMembers,
  apiAdminListOrgs,
  apiAdminRevokeOrgMembership,
  apiAdminSetOrgMemberRole,
  apiAdminUpsertOrg,
  type OrgMember,
  type OrgSettings,
} from '../../lib/apiClient';
import { Building2, RefreshCw, Users, UserX } from 'lucide-react';

export function OrgManagementPanel() {
  const [orgs, setOrgs] = useState<OrgSettings[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [selectedOrg, setSelectedOrg] = useState<OrgSettings | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (orgId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const orgRes = await apiAdminListOrgs();
      setOrgs(orgRes.orgs);
      const resolvedOrgId = orgId ?? selectedOrgId ?? orgRes.orgs[0]?.id ?? '';
      if (!resolvedOrgId) {
        setSelectedOrgId('');
        setSelectedOrg(null);
        setMembers([]);
        return;
      }

      setSelectedOrgId(resolvedOrgId);
      const [orgDetail, memberRes] = await Promise.all([
        apiAdminGetOrg(resolvedOrgId),
        apiAdminListOrgMembers(resolvedOrgId),
      ]);
      setSelectedOrg(orgDetail.org);
      setMembers(memberRes.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load org management data');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeMembers = useMemo(() => members.filter((m) => m.membership_status === 'active').length, [members]);

  async function saveOrgSettings() {
    if (!selectedOrg) return;
    const reason = window.prompt('Reason for updating organization settings:', 'Organization settings updated from admin UI');
    if (!reason || reason.trim().length === 0) return;

    setBusyKey('org:save');
    try {
      await apiAdminUpsertOrg(selectedOrg.id, {
        organization_name: selectedOrg.organization_name,
        included_seats: selectedOrg.included_seats,
        seat_limit: selectedOrg.seat_limit,
        billing_status: selectedOrg.billing_status,
        notes: selectedOrg.notes,
        reason: reason.trim(),
      });
      await load(selectedOrg.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update organization settings');
    } finally {
      setBusyKey(null);
    }
  }

  async function setMemberRole(member: OrgMember, role: OrgMember['org_role']) {
    const reason = window.prompt(
      `Reason for changing role of ${member.clerk_user_id} to ${role}:`,
      `Organization member role set to ${role} from admin UI`
    );
    if (!reason || reason.trim().length === 0) return;

    const key = `member:role:${member.id}`;
    setBusyKey(key);
    try {
      await apiAdminSetOrgMemberRole(member.clerk_org_id, member.clerk_user_id, role, reason.trim());
      await load(member.clerk_org_id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update member role');
    } finally {
      setBusyKey(null);
    }
  }

  async function revokeMembership(member: OrgMember) {
    const reason = window.prompt(
      `Reason for revoking membership of ${member.clerk_user_id}:`,
      'Organization membership revoked from admin UI'
    );
    if (!reason || reason.trim().length === 0) return;

    const key = `member:revoke:${member.id}`;
    setBusyKey(key);
    try {
      await apiAdminRevokeOrgMembership(member.clerk_org_id, member.clerk_user_id, reason.trim());
      await load(member.clerk_org_id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke membership');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Organization Management</h3>
          <p className="text-xs text-zinc-400 mt-1">Update seat policy and manage organization member roles.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedOrgId}
            onChange={(e) => {
              const nextId = e.target.value;
              setSelectedOrgId(nextId);
              void load(nextId);
            }}
            className="px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white"
          >
            {orgs.length === 0 && <option value="">No organizations</option>}
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.organization_name ?? org.clerk_org_id}
              </option>
            ))}
          </select>
          <button
            onClick={() => void load(selectedOrgId)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/70 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      {selectedOrg && (
        <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
            <h4 className="text-base font-semibold text-white">Organization Settings</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm text-zinc-300">
              Name
              <input
                value={selectedOrg.organization_name ?? ''}
                onChange={(e) => setSelectedOrg((prev) => (prev ? { ...prev, organization_name: e.target.value } : prev))}
                className="mt-1 w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white"
              />
            </label>
            <label className="text-sm text-zinc-300">
              Billing Status
              <select
                value={selectedOrg.billing_status}
                onChange={(e) => setSelectedOrg((prev) => (prev ? { ...prev, billing_status: e.target.value as OrgSettings['billing_status'] } : prev))}
                className="mt-1 w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white"
              >
                <option value="trial">trial</option>
                <option value="active">active</option>
                <option value="past_due">past_due</option>
                <option value="cancelled">cancelled</option>
              </select>
            </label>
            <label className="text-sm text-zinc-300">
              Included Seats
              <input
                type="number"
                min={0}
                value={selectedOrg.included_seats}
                onChange={(e) => setSelectedOrg((prev) => (prev ? { ...prev, included_seats: Number(e.target.value) } : prev))}
                className="mt-1 w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white"
              />
            </label>
            <label className="text-sm text-zinc-300">
              Seat Limit
              <input
                type="number"
                min={0}
                value={selectedOrg.seat_limit}
                onChange={(e) => setSelectedOrg((prev) => (prev ? { ...prev, seat_limit: Number(e.target.value) } : prev))}
                className="mt-1 w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white"
              />
            </label>
          </div>
          <label className="block text-sm text-zinc-300 mt-4">
            Notes
            <textarea
              value={selectedOrg.notes ?? ''}
              onChange={(e) => setSelectedOrg((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
              rows={3}
              className="mt-1 w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white"
            />
          </label>
          <div className="mt-4 flex items-center justify-between text-xs text-zinc-400">
            <span>{activeMembers} active members</span>
            <button
              onClick={() => void saveOrgSettings()}
              disabled={busyKey === 'org:save' || loading}
              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm disabled:opacity-50"
            >
              Save Settings
            </button>
          </div>
        </div>
      )}

      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center gap-2">
          <Users className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
          <h4 className="text-base font-semibold text-white">Organization Members</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-zinc-800/80 border-b border-zinc-700">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {!loading && members.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500 text-sm">No organization members found</td>
                </tr>
              )}
              {members.map((member) => {
                const roleKey = `member:role:${member.id}`;
                const revokeKey = `member:revoke:${member.id}`;
                return (
                  <tr key={member.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-sm text-white font-mono">{member.clerk_user_id}</div>
                      <div className="text-xs text-zinc-500">{member.access_status ?? 'unknown access status'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={member.org_role}
                        onChange={(e) => void setMemberRole(member, e.target.value as OrgMember['org_role'])}
                        disabled={busyKey === roleKey || busyKey === revokeKey}
                        className="px-2.5 py-1.5 bg-zinc-800/50 border border-zinc-700 rounded-md text-xs text-white"
                      >
                        <option value="org_owner">org_owner</option>
                        <option value="org_manager">org_manager</option>
                        <option value="org_member">org_member</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-300">{member.membership_status}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void revokeMembership(member)}
                        disabled={busyKey === roleKey || busyKey === revokeKey || member.membership_status === 'revoked'}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-red-200 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50"
                      >
                        <UserX className="w-3.5 h-3.5" strokeWidth={1.5} />
                        Revoke
                      </button>
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
