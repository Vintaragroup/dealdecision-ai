import React, { useState, useEffect, useMemo } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { apiGetMyAccess, apiAdminListUsers, apiAdminListInvites, apiAdminGetAuditAlertSummary, type AdminAuditAlertSummary } from '../../lib/apiClient';
import type { MergedUserRecord } from '../../lib/apiClient';
import { 
  Users, 
  Mail, 
  BarChart3, 
  Search, 
  Filter, 
  Plus, 
  Shield,
  ShieldCheck,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertCircle,
  AlertTriangle,
  ScrollText,
  Building2
} from 'lucide-react';
import { MetricCard } from '../admin/MetricCard';
import { UsersTable } from '../admin/UsersTable';
import { InvitesTable } from '../admin/InvitesTable';
import { InviteCreationPanel } from '../admin/InviteCreationPanel';
import { RecoveryCenter } from '../admin/RecoveryCenter';
import { AuditLogsPanel } from '../admin/AuditLogsPanel';
import { OrgManagementPanel } from '../admin/OrgManagementPanel';
import { SuperAdminOpsPanel } from '../admin/SuperAdminOpsPanel';
import { CrossDealPatternsPanel } from '../admin/CrossDealPatternsPanel';
import { AdminUserAnalyticsDetailView } from '../admin/admin-user-analytics';

type TabType = 'overview' | 'users' | 'invites' | 'orgs' | 'audit' | 'recovery' | 'super_admin_ops' | 'intelligence';
type AdminStatus = 'loading' | 'allowed' | 'denied';

const TAB_VALUES: TabType[] = ['overview', 'users', 'invites', 'orgs', 'audit', 'recovery', 'super_admin_ops', 'intelligence'];

function normalizeTab(value: string | null): TabType {
  if (value && (TAB_VALUES as string[]).includes(value)) return value as TabType;
  return 'overview';
}

export default function AdminControlPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>(() => normalizeTab(searchParams.get('tab')));
  const [adminStatus, setAdminStatus] = useState<AdminStatus>('loading');
  const [adminRole, setAdminRole] = useState<'super_admin' | 'admin' | null>(null);

  useEffect(() => {
    const tabFromUrl = normalizeTab(searchParams.get('tab'));
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams, activeTab]);

  const setTabAndQuery = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      if (tab !== 'users') {
        next.delete('analytics_user');
        next.delete('analytics_email');
        next.delete('analytics_name');
        next.delete('analytics_status');
        next.delete('analytics_role');
      }
      return next;
    });
  };

  useEffect(() => {
    apiGetMyAccess()
      .then((r) => {
        setAdminStatus(r.is_admin ? 'allowed' : 'denied');
        if (r.is_admin) {
          setAdminRole(r.account_role === 'super_admin' ? 'super_admin' : 'admin');
        }
      })
      .catch(() => setAdminStatus('denied'));
  }, []);

  if (adminStatus === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400">Verifying access...</div>
      </div>
    );
  }

  if (adminStatus === 'denied') {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-zinc-400 mb-3">
            <span>System</span>
            <span>/</span>
            <span className="text-zinc-300">Admin</span>
          </div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-semibold text-white">Admin Control Panel</h1>
            {adminRole === 'super_admin' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                <ShieldCheck className="w-3 h-3" />
                Super Admin
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-700/60 text-zinc-300 border border-zinc-600/40">
                <Shield className="w-3 h-3" />
                Admin
              </span>
            )}
          </div>
          <p className="text-zinc-400">Manage platform access, invites, and admin permissions</p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-1.5">
          <button
            onClick={() => setTabAndQuery('overview')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'overview'
                ? 'bg-zinc-700/50 text-white shadow-lg'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            <BarChart3 className="w-4 h-4" strokeWidth={1.5} />
            Overview
          </button>
          <button
            onClick={() => setTabAndQuery('users')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'users'
                ? 'bg-zinc-700/50 text-white shadow-lg'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            <Users className="w-4 h-4" strokeWidth={1.5} />
            Users & Access
          </button>
          <button
            onClick={() => setTabAndQuery('invites')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'invites'
                ? 'bg-zinc-700/50 text-white shadow-lg'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            <Mail className="w-4 h-4" strokeWidth={1.5} />
            Invites
          </button>
          <button
            onClick={() => setTabAndQuery('recovery')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'recovery'
                ? 'bg-zinc-700/50 text-white shadow-lg'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            <AlertTriangle className="w-4 h-4" strokeWidth={1.5} />
            Recovery Center
          </button>
          <button
            onClick={() => setTabAndQuery('orgs')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'orgs'
                ? 'bg-zinc-700/50 text-white shadow-lg'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            <Building2 className="w-4 h-4" strokeWidth={1.5} />
            Org Management
          </button>
          <button
            onClick={() => setTabAndQuery('audit')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'audit'
                ? 'bg-zinc-700/50 text-white shadow-lg'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            <ScrollText className="w-4 h-4" strokeWidth={1.5} />
            Audit Logs
          </button>
          {adminRole === 'super_admin' && (
            <button
              onClick={() => setTabAndQuery('super_admin_ops')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'super_admin_ops'
                  ? 'bg-zinc-700/50 text-white shadow-lg'
                  : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30'
              }`}
            >
              <ShieldCheck className="w-4 h-4" strokeWidth={1.5} />
              Super Admin Ops
            </button>
          )}
          <button
            onClick={() => setTabAndQuery('intelligence')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'intelligence'
                ? 'bg-zinc-700/50 text-white shadow-lg'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            <TrendingUp className="w-4 h-4" strokeWidth={1.5} />
            Portfolio Patterns
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && <OverviewSection />}
        {activeTab === 'users' && <UsersSection />}
        {activeTab === 'invites' && <InvitesSection />}
        {activeTab === 'orgs' && <OrgManagementPanel />}
        {activeTab === 'audit' && <AuditLogsPanel />}
        {activeTab === 'recovery' && <RecoveryCenter adminRole={adminRole} />}
        {activeTab === 'super_admin_ops' && adminRole === 'super_admin' && <SuperAdminOpsPanel />}
        {activeTab === 'intelligence' && <CrossDealPatternsPanel />}
      </div>
    </div>
  );
}

function OverviewSection() {
  const [metrics, setMetrics] = useState<{ label: string; value: number; icon: LucideIcon; trend?: string }[]>([
    { label: 'Active Users', value: 0, icon: CheckCircle2 },
    { label: 'Expired / Revoked', value: 0, icon: XCircle },
    { label: 'Pending Users', value: 0, icon: AlertCircle },
    { label: 'Active Invites', value: 0, icon: Mail },
  ]);
  const [loading, setLoading] = useState(true);
  const [alertSummary, setAlertSummary] = useState<AdminAuditAlertSummary | null>(null);

  useEffect(() => {
    Promise.all([
      apiAdminListUsers({ limit: 500 }),
      apiAdminListInvites({ limit: 500 }),
      apiAdminGetAuditAlertSummary({ hours: 24, limit: 5 }),
    ])
      .then(([usersResp, invitesResp, alertResp]) => {
        const provisioned = usersResp.records.filter((u) => u.access_status !== 'not_provisioned');
        const active = provisioned.filter((u) => u.access_status === 'active').length;
        const expired = provisioned.filter((u) => u.access_status === 'expired' || u.access_status === 'revoked').length;
        const pending = provisioned.filter((u) => u.access_status === 'pending').length;
        const activeInvites = invitesResp.records.filter((inv) => inv.status === 'active').length;
        setAlertSummary(alertResp);

        setMetrics([
          { label: 'Active Users', value: active, icon: CheckCircle2 },
          { label: 'Expired / Revoked', value: expired, icon: XCircle },
          { label: 'Pending Users', value: pending, icon: AlertCircle },
          { label: 'Active Invites', value: activeInvites, icon: Mail },
        ]);
      })
      .catch(() => { /* leave zeroed state on error */ })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      {/* Activity placeholder — no live event log yet */}
      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-zinc-500 text-sm">Loading...</div>
        ) : (
          <AuditLogsPanel compact />
        )}
      </div>

      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6">
        <h3 className="text-lg font-semibold text-white mb-3">Governance Alerts (24h)</h3>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl font-semibold text-amber-200">{alertSummary?.total_alerts ?? 0}</span>
          <span className="text-sm text-zinc-400">high-signal governance events</span>
        </div>

        <div className="space-y-2 mb-4">
          {(alertSummary?.by_action ?? []).slice(0, 5).map((entry) => (
            <div key={entry.action_type} className="flex items-center justify-between text-sm">
              <span className="text-zinc-300 font-mono">{entry.action_type}</span>
              <span className="text-zinc-100">{entry.count}</span>
            </div>
          ))}
          {(alertSummary?.by_action ?? []).length === 0 && (
            <div className="text-sm text-zinc-500">No governance alerts in the selected window.</div>
          )}
        </div>

        <div className="border-t border-zinc-800 pt-3">
          <h4 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Recent</h4>
          <div className="space-y-2">
            {(alertSummary?.recent_events ?? []).slice(0, 3).map((event) => (
              <div key={event.id} className="text-xs text-zinc-300">
                <span className="font-mono text-zinc-200">{event.action_type}</span>
                <span className="text-zinc-500"> · {event.entity_type}:{event.entity_id}</span>
              </div>
            ))}
            {(alertSummary?.recent_events ?? []).length === 0 && (
              <div className="text-xs text-zinc-500">No recent governance alert events.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const selectedUser = useMemo<MergedUserRecord | null>(() => {
    const clerkUserId = searchParams.get('analytics_user');
    if (!clerkUserId) return null;

    const accessStatus = searchParams.get('analytics_status');
    const role = searchParams.get('analytics_role');

    return {
      clerk_user_id: clerkUserId,
      email: searchParams.get('analytics_email'),
      full_name: searchParams.get('analytics_name'),
      clerk_created_at: null,
      id: null,
      org_id: null,
      access_status: (accessStatus as MergedUserRecord['access_status']) ?? 'not_provisioned',
      access_expires_at: null,
      is_admin: role === 'super_admin' || role === 'admin',
      account_role: (role as MergedUserRecord['account_role']) ?? null,
      grant_source: null,
      notes: null,
      granted_by_user_id: null,
      created_at: null,
      updated_at: null,
    };
  }, [searchParams]);

  const setSelectedUserInUrl = (user: MergedUserRecord | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'users');

      if (!user) {
        next.delete('analytics_user');
        next.delete('analytics_email');
        next.delete('analytics_name');
        next.delete('analytics_status');
        next.delete('analytics_role');
        return next;
      }

      next.set('analytics_user', user.clerk_user_id);
      if (user.email) next.set('analytics_email', user.email); else next.delete('analytics_email');
      if (user.full_name) next.set('analytics_name', user.full_name); else next.delete('analytics_name');
      if (user.access_status) next.set('analytics_status', user.access_status);
      if (user.account_role) next.set('analytics_role', user.account_role); else next.delete('analytics_role');
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {selectedUser && (
        <AdminUserAnalyticsDetailView
          user={selectedUser}
          onBack={() => setSelectedUserInUrl(null)}
        />
      )}

      {!selectedUser && (
        <>
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex gap-3 flex-1 w-full sm:w-auto">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" strokeWidth={1.5} />
                <input
                  type="text"
                  placeholder="Search by email or user ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                />
              </div>

              {/* Filter */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <Filter className="w-4 h-4" strokeWidth={1.5} />
                Filter
              </button>
            </div>

            {/* Add User Button */}
            <button className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors">
              <Plus className="w-4 h-4" strokeWidth={1.5} />
              Add User
            </button>
          </div>

          {/* Users Table */}
          <UsersTable
            searchQuery={searchQuery}
            onViewAnalytics={(user) => setSelectedUserInUrl(user)}
          />
        </>
      )}
    </div>
  );
}

function InvitesSection() {
  const [inviteRefreshKey, setInviteRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      {/* Invite Creation Panel */}
      <InviteCreationPanel onCreated={() => setInviteRefreshKey((k) => k + 1)} />

      {/* Invites Table */}
      <InvitesTable refreshKey={inviteRefreshKey} />
    </div>
  );
}
