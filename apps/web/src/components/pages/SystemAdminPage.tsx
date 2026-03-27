import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { apiGetMyAccess, apiAdminListUsers, apiAdminListInvites } from '../../lib/apiClient';
import { 
  Users, 
  Mail, 
  BarChart3, 
  Search, 
  Filter, 
  Plus, 
  Shield,
  ShieldCheck,
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

type TabType = 'overview' | 'users' | 'invites' | 'orgs' | 'audit' | 'recovery';
type AdminStatus = 'loading' | 'allowed' | 'denied';

export default function AdminControlPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [adminStatus, setAdminStatus] = useState<AdminStatus>('loading');
  const [adminRole, setAdminRole] = useState<'super_admin' | 'admin' | null>(null);

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
            onClick={() => setActiveTab('overview')}
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
            onClick={() => setActiveTab('users')}
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
            onClick={() => setActiveTab('invites')}
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
            onClick={() => setActiveTab('recovery')}
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
            onClick={() => setActiveTab('orgs')}
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
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'audit'
                ? 'bg-zinc-700/50 text-white shadow-lg'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            <ScrollText className="w-4 h-4" strokeWidth={1.5} />
            Audit Logs
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && <OverviewSection />}
        {activeTab === 'users' && <UsersSection />}
        {activeTab === 'invites' && <InvitesSection />}
        {activeTab === 'orgs' && <OrgManagementPanel />}
        {activeTab === 'audit' && <AuditLogsPanel />}
        {activeTab === 'recovery' && <RecoveryCenter adminRole={adminRole} />}
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

  useEffect(() => {
    Promise.all([
      apiAdminListUsers({ limit: 500 }),
      apiAdminListInvites({ limit: 500 }),
    ])
      .then(([usersResp, invitesResp]) => {
        const provisioned = usersResp.records.filter((u) => u.access_status !== 'not_provisioned');
        const active = provisioned.filter((u) => u.access_status === 'active').length;
        const expired = provisioned.filter((u) => u.access_status === 'expired' || u.access_status === 'revoked').length;
        const pending = provisioned.filter((u) => u.access_status === 'pending').length;
        const activeInvites = invitesResp.records.filter((inv) => inv.status === 'active').length;

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
    </div>
  );
}

function UsersSection() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="space-y-6">
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
      <UsersTable searchQuery={searchQuery} />
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
