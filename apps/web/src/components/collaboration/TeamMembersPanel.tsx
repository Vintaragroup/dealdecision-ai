import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import {
  Users,
  UserPlus,
  Mail,
  Shield,
  ShieldCheck,
  Eye,
  Edit3,
  Crown,
  MoreVertical,
  X,
  CheckCircle,
  Search,
  Filter,
  Circle,
  Loader2
} from 'lucide-react';
import { apiGetTeamMembers, type TeamMembersResponse } from '../../lib/apiClient';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  status: 'active' | 'pending' | 'inactive';
  joinedAt: string;
  lastActive: string;
}

interface TeamMembersPanelProps {
  darkMode: boolean;
  dealId?: string;
  onClose?: () => void;
}

export function TeamMembersPanel({ darkMode, onClose }: TeamMembersPanelProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [teamData, setTeamData] = useState<TeamMembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    apiGetTeamMembers()
      .then((data) => { if (!cancelled) { setTeamData(data); setLoading(false); } })
      .catch((e: unknown) => {
        if (!cancelled) {
          setFetchError(e instanceof Error ? e.message : 'Failed to load team');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Map API org members to the display shape the UI expects
  const teamMembers: TeamMember[] = (teamData?.members ?? []).map((m) => ({
    id: m.id,
    name: m.clerk_user_id, // will be enriched with Clerk names in future phase
    email: m.clerk_user_id,
    role: m.org_role === 'org_owner' ? 'owner'
        : m.org_role === 'org_manager' ? 'admin'
        : 'viewer',
    status: m.membership_status === 'active' ? 'active'
          : m.membership_status === 'pending' ? 'pending'
          : 'inactive',
    joinedAt: new Date(m.created_at).toLocaleDateString(),
    lastActive: '—',
  }));

  const getRoleConfig = (role: string) => {
    switch (role) {
      case 'owner':
        return { label: 'Owner', icon: Crown, color: '#f59e0b', description: 'Full access & billing' };
      case 'admin':
        return { label: 'Admin', icon: ShieldCheck, color: '#6366f1', description: 'Manage team & settings' };
      case 'editor':
        return { label: 'Editor', icon: Edit3, color: '#10b981', description: 'Create & edit content' };
      case 'viewer':
        return { label: 'Viewer', icon: Eye, color: '#6b7280', description: 'View only access' };
      default:
        return { label: 'Unknown', icon: Shield, color: '#6b7280', description: 'Unknown role' };
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#10b981';
      case 'pending': return '#f59e0b';
      case 'inactive': return '#6b7280';
      default: return '#6b7280';
    }
  };

  const filteredMembers = teamMembers.filter(member => {
    const matchesSearch = member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         member.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = filterRole === 'all' || member.role === filterRole;
    return matchesSearch && matchesRole;
  });

  return (
    <div className={`h-full flex flex-col ${darkMode ? 'bg-[#0a0a0b]' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`border-b px-6 py-4 ${
        darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Team Members
            </h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {loading ? 'Loading…' : teamData?.org_id
                ? `${teamMembers.length} member${teamMembers.length !== 1 ? 's' : ''} · ${teamData.active_seats} active${teamData.seat_limit !== null ? ` · ${teamData.seat_limit} seats` : ''}`
                : 'No organization configured'
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              darkMode={darkMode}
              onClick={() => setShowInviteModal(true)}
              icon={<UserPlus className="w-4 h-4" />}
            >
              Invite Member
            </Button>
            {onClose && (
              <button
                onClick={onClose}
                className={`p-2 rounded-lg transition-colors ${
                  darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                }`}
              >
                <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
              </button>
            )}
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`} />
            <input
              type="text"
              placeholder="Search members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full h-9 pl-10 pr-4 rounded-lg border text-sm ${
                darkMode
                  ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
              }`}
            />
          </div>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className={`h-9 px-3 rounded-lg border text-sm ${
              darkMode
                ? 'bg-white/5 border-white/10 text-white'
                : 'bg-white border-gray-200 text-gray-900'
            }`}
          >
            <option value="all">All Roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
      </div>

      {/* Members List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className={`flex flex-col items-center justify-center py-16 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <Loader2 className="w-8 h-8 animate-spin mb-3 opacity-50" />
            <p className="text-sm">Loading team members…</p>
          </div>
        ) : fetchError ? (
          <div className={`text-center py-12 ${darkMode ? 'text-red-400' : 'text-red-500'}`}>
            <p className="text-sm">{fetchError}</p>
          </div>
        ) : !teamData?.org_id ? (
          <div className={`text-center py-16 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium mb-1">No organization configured</p>
            <p className="text-xs opacity-70">Team membership is scoped to an organization. Contact your account executive to configure your org.</p>
          </div>
        ) : (
        <>
        <div className="space-y-3">
          {filteredMembers.map(member => {
            const roleConfig = getRoleConfig(member.role);
            const RoleIcon = roleConfig.icon;
            
            return (
              <div
                key={member.id}
                className={`p-4 rounded-xl border transition-colors ${
                  darkMode
                    ? 'bg-[#18181b] border-white/10 hover:border-white/20'
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    {/* Avatar */}
                    <div 
                      className={`w-12 h-12 rounded-full flex items-center justify-center text-lg ${
                        darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
                      }`}
                      style={{ color: roleConfig.color }}
                    >
                      {member.name.split(' ').map(n => n[0]).join('')}
                    </div>

                    {/* Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={darkMode ? 'text-white' : 'text-gray-900'}>
                          {member.name}
                        </h3>
                        <div 
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                          style={{ 
                            backgroundColor: roleConfig.color + '20',
                            color: roleConfig.color
                          }}
                        >
                          <RoleIcon className="w-3 h-3" />
                          {roleConfig.label}
                        </div>
                        <div className="flex items-center gap-1">
                          <Circle 
                            className="w-2 h-2" 
                            fill={getStatusColor(member.status)}
                            stroke="none"
                          />
                          <span 
                            className="text-xs capitalize"
                            style={{ color: getStatusColor(member.status) }}
                          >
                            {member.status}
                          </span>
                        </div>
                      </div>
                      
                      <div className={`text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {member.email}
                      </div>

                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                        Joined {member.joinedAt} • Last active {member.lastActive}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {member.role !== 'owner' && (
                    <button
                      className={`p-2 rounded-lg transition-colors ${
                        darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                      }`}
                    >
                      <MoreVertical className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                    </button>
                  )}
                </div>

                {/* Permissions Preview */}
                {member.status === 'active' && (
                  <div className={`mt-3 pt-3 border-t text-xs ${
                    darkMode ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-500'
                  }`}>
                    {roleConfig.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredMembers.length === 0 && !loading && teamData?.org_id && (
          <div className={`text-center py-12 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No members found</p>
          </div>
        )}
        </>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <InviteMemberModal
          darkMode={darkMode}
          onClose={() => setShowInviteModal(false)}
          onInvite={(_email, _role) => {
            // Real invite flow goes through /invite page + invite codes.
            // This modal is a UI stub — dismiss on submit.
            setShowInviteModal(false);
          }}
        />
      )}
    </div>
  );
}

interface InviteMemberModalProps {
  darkMode: boolean;
  onClose: () => void;
  onInvite: (email: string, role: string) => void;
}

function InviteMemberModal({ darkMode, onClose, onInvite }: InviteMemberModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleInvite = async () => {
    if (!email) return;
    
    setSending(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    onInvite(email, role);
    setSent(true);
    
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  const roleOptions = [
    { value: 'admin', label: 'Admin', icon: ShieldCheck, color: '#6366f1', desc: 'Manage team & settings' },
    { value: 'editor', label: 'Editor', icon: Edit3, color: '#10b981', desc: 'Create & edit content' },
    { value: 'viewer', label: 'Viewer', icon: Eye, color: '#6b7280', desc: 'View only access' }
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-lg rounded-2xl shadow-2xl ${
        darkMode ? 'bg-[#18181b]' : 'bg-white'
      }`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${
          darkMode ? 'border-white/10' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Invite Team Member
              </h2>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Add someone to your workspace
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
            }`}
          >
            <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
          </button>
        </div>

        {/* Content */}
        {sent ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Invitation Sent!
            </h3>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {email} will receive an email invitation
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Email */}
            <div>
              <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Email Address
              </label>
              <div className="relative">
                <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                  darkMode ? 'text-gray-500' : 'text-gray-400'
                }`} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className={`w-full h-10 pl-10 pr-4 rounded-lg border ${
                    darkMode
                      ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                      : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                />
              </div>
            </div>

            {/* Role Selection */}
            <div>
              <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Role & Permissions
              </label>
              <div className="space-y-2">
                {roleOptions.map(option => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setRole(option.value)}
                      className={`w-full p-3 rounded-lg border text-left transition-all ${
                        role === option.value
                          ? darkMode
                            ? 'bg-[#6366f1]/20 border-[#6366f1]'
                            : 'bg-[#6366f1]/10 border-[#6366f1]'
                          : darkMode
                            ? 'bg-white/5 border-white/10 hover:border-white/20'
                            : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-10 h-10 rounded-lg flex items-center justify-center"
                          style={{ 
                            backgroundColor: option.color + '20',
                            color: option.color
                          }}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <div className={`mb-0.5 ${
                            role === option.value 
                              ? 'text-[#6366f1]' 
                              : darkMode ? 'text-white' : 'text-gray-900'
                          }`}>
                            {option.label}
                          </div>
                          <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                            {option.desc}
                          </div>
                        </div>
                        {role === option.value && (
                          <CheckCircle className="w-5 h-5 text-[#6366f1]" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional Message */}
            <div>
              <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Message (Optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a personal message to the invitation..."
                rows={3}
                className={`w-full px-3 py-2 rounded-lg border resize-none text-sm ${
                  darkMode
                    ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        {!sent && (
          <div className={`px-6 py-4 border-t flex items-center justify-end gap-2 ${
            darkMode ? 'border-white/10' : 'border-gray-200'
          }`}>
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              onClick={onClose}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              darkMode={darkMode}
              onClick={handleInvite}
              disabled={!email || sending}
              icon={sending ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Mail className="w-4 h-4" />
              )}
            >
              {sending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
