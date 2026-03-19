import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { apiGetMyAccess } from '../../lib/apiClient';
import { 
  Users, 
  Mail, 
  BarChart3, 
  Search, 
  Filter, 
  Plus, 
  Copy, 
  MoreHorizontal,
  Clock,
  Shield,
  ShieldCheck,
  UserX,
  UserPlus,
  CalendarClock,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { MetricCard } from '../admin/MetricCard';
import { UsersTable } from '../admin/UsersTable';
import { InvitesTable } from '../admin/InvitesTable';
import { InviteCreationPanel } from '../admin/InviteCreationPanel';

type TabType = 'overview' | 'users' | 'invites';
type AdminStatus = 'loading' | 'allowed' | 'denied';

export default function AdminControlPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [adminStatus, setAdminStatus] = useState<AdminStatus>('loading');

  useEffect(() => {
    apiGetMyAccess()
      .then((r) => setAdminStatus(r.is_admin ? 'allowed' : 'denied'))
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
          <h1 className="text-3xl font-semibold text-white mb-2">Admin Control Panel</h1>
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
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && <OverviewSection />}
        {activeTab === 'users' && <UsersSection />}
        {activeTab === 'invites' && <InvitesSection />}
      </div>
    </div>
  );
}

function OverviewSection() {
  const metrics = [
    { label: 'Active Users', value: 247, icon: CheckCircle2, trend: '+12 this week' },
    { label: 'Expired Users', value: 18, icon: XCircle, trend: '3 expiring soon' },
    { label: 'Pending Users', value: 12, icon: AlertCircle, trend: '8 invited today' },
    { label: 'Active Invites', value: 34, icon: Mail, trend: '15 unredeemed' },
  ];

  return (
    <div className="space-y-6">
      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      {/* Recent Activity */}
      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
        <div className="space-y-3">
          {[
            { action: 'User access granted', user: 'sarah.chen@dealco.com', time: '2 minutes ago', type: 'success' },
            { action: 'Admin permissions added', user: 'mike.ross@acmecorp.com', time: '15 minutes ago', type: 'success' },
            { action: 'Invite code redeemed', user: 'alex.kim@startupxyz.com', time: '1 hour ago', type: 'info' },
            { action: 'Access revoked', user: 'john.doe@oldclient.com', time: '2 hours ago', type: 'warning' },
            { action: 'New invite created', user: 'jenny.lee@newclient.com', time: '3 hours ago', type: 'info' },
          ].map((activity, index) => (
            <div key={index} className="flex items-center justify-between py-3 border-b border-zinc-800 last:border-0">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  activity.type === 'success' ? 'bg-emerald-400' :
                  activity.type === 'warning' ? 'bg-amber-400' :
                  'bg-blue-400'
                }`} />
                <div>
                  <p className="text-sm text-white">{activity.action}</p>
                  <p className="text-xs text-zinc-400">{activity.user}</p>
                </div>
              </div>
              <span className="text-xs text-zinc-500">{activity.time}</span>
            </div>
          ))}
        </div>
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
