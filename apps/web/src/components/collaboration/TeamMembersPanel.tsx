import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Button } from '../ui/button';
import {
  Users,
  UserPlus,
  Mail,
  Shield,
  ShieldCheck,
  Crown,
  MoreVertical,
  X,
  CheckCircle,
  Search,
  Loader2,
  Copy,
  Link as LinkIcon,
  AlertCircle,
} from 'lucide-react';
import {
  apiGetTeamMembers,
  apiCreateTeamInvite,
  apiSetTeamMemberRole,
  apiRemoveTeamMember,
  type TeamMembersResponse,
  type OrgMember,
} from '../../lib/apiClient';

interface TeamMembersPanelProps {
  darkMode: boolean;
  dealId?: string;
  onClose?: () => void;
}

type OrgRole = 'org_owner' | 'org_manager' | 'org_member';

function getRoleConfig(orgRole: string) {
  switch (orgRole) {
    case 'org_owner':
      return { label: 'Owner', icon: Crown, color: '#f59e0b' };
    case 'org_manager':
      return { label: 'Manager', icon: ShieldCheck, color: '#6366f1' };
    default:
      return { label: 'Member', icon: Shield, color: '#6b7280' };
  }
}

/** Simple 2-char initials from a clerk_user_id — shows last 2 hex chars of the id */
function memberInitials(clerkUserId: string): string {
  const suffix = clerkUserId.replace(/^user_/, '');
  return suffix.slice(-2).toUpperCase();
}

export function TeamMembersPanel({ darkMode, onClose }: TeamMembersPanelProps) {
  const { userId: authUserId } = useAuth();

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [teamData, setTeamData] = useState<TeamMembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Action menu state (per member)
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const [roleChangeTarget, setRoleChangeTarget] = useState<string | null>(null);
  const [confirmRemoveTarget, setConfirmRemoveTarget] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const fetchTeam = useCallback(() => {
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

  useEffect(() => {
    return fetchTeam();
  }, [fetchTeam]);

  // Close action menu on outside click
  useEffect(() => {
    if (!openActionMenu) return;
    const handler = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setOpenActionMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openActionMenu]);

  const members = teamData?.members ?? [];
  const currentUserMember = members.find((m) => m.clerk_user_id === authUserId);
  const canManageTeam =
    currentUserMember?.is_admin === true ||
    currentUserMember?.org_role === 'org_owner' ||
    currentUserMember?.org_role === 'org_manager';

  const seatLimit = teamData?.seat_limit ?? null;
  const activeSeats = teamData?.active_seats ?? 0;
  const seatsFull = seatLimit !== null && activeSeats >= seatLimit;

  const filteredMembers = members.filter((m) =>
    m.clerk_user_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  async function handleRoleChange(targetUserId: string, newRole: OrgRole) {
    setActionLoading(true);
    setActionError(null);
    try {
      await apiSetTeamMemberRole(targetUserId, newRole);
      setRoleChangeTarget(null);
      setOpenActionMenu(null);
      fetchTeam();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to change role');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRemove(targetUserId: string) {
    setActionLoading(true);
    setActionError(null);
    try {
      await apiRemoveTeamMember(targetUserId);
      setConfirmRemoveTarget(null);
      setOpenActionMenu(null);
      fetchTeam();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to remove member');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className={`h-full flex flex-col ${darkMode ? 'bg-[#0a0a0b]' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`border-b px-6 py-4 ${darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>Team Members</h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {loading
                ? 'Loading…'
                : teamData?.org_id
                  ? `${members.length} member${members.length !== 1 ? 's' : ''} · ${activeSeats} active${seatLimit !== null ? ` · ${seatLimit} seat${seatLimit !== 1 ? 's' : ''}` : ''}`
                  : 'No organization configured'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManageTeam && (
              <div className="relative group">
                <Button
                  variant="primary"
                  size="sm"
                  darkMode={darkMode}
                  onClick={() => !seatsFull && setShowInviteModal(true)}
                  icon={<UserPlus className="w-4 h-4" />}
                  disabled={seatsFull}
                >
                  Invite Member
                </Button>
                {seatsFull && (
                  <div className={`absolute right-0 top-full mt-1 w-52 text-xs rounded-lg px-3 py-2 shadow-lg z-10 ${darkMode ? 'bg-[#27272a] text-yellow-400' : 'bg-white border border-gray-200 text-yellow-600'}`}>
                    Seat limit reached. Remove a member to invite someone new.
                  </div>
                )}
              </div>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
              >
                <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
          <input
            type="text"
            placeholder="Search members…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full h-9 pl-10 pr-4 rounded-lg border text-sm ${
              darkMode
                ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
            }`}
          />
        </div>
      </div>

      {/* Members List */}
      <div className="flex-1 overflow-y-auto p-6">
        {actionError && (
          <div className={`mb-4 flex items-center gap-2 text-sm px-4 py-3 rounded-lg ${darkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600 border border-red-200'}`}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {actionError}
            <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => setActionError(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

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
            <p className="text-xs opacity-70">Team membership is scoped to an organization. Contact your administrator to set up your org.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMembers.map((member) => {
              const cfg = getRoleConfig(member.org_role);
              const Icon = cfg.icon;
              const isCurrentUser = member.clerk_user_id === authUserId;
              const isOwner = member.org_role === 'org_owner';
              const showMenu = openActionMenu === member.clerk_user_id;
              const showRolePicker = roleChangeTarget === member.clerk_user_id;
              const showConfirmRemove = confirmRemoveTarget === member.clerk_user_id;

              return (
                <div
                  key={member.clerk_user_id}
                  className={`p-4 rounded-xl border transition-colors ${
                    darkMode
                      ? 'bg-[#18181b] border-white/10 hover:border-white/20'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {/* Avatar + Info */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-mono flex-shrink-0"
                        style={{ backgroundColor: cfg.color + '20', color: cfg.color }}
                      >
                        {memberInitials(member.clerk_user_id)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className={`text-sm font-mono truncate ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {member.clerk_user_id}
                          </span>
                          {isCurrentUser && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>you</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                            style={{ backgroundColor: cfg.color + '20', color: cfg.color }}
                          >
                            <Icon className="w-3 h-3" />
                            {cfg.label}
                          </div>
                          {member.seat_consuming && (
                            <span className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>· seat</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action menu button */}
                    {canManageTeam && !isCurrentUser && (
                      <div className="relative flex-shrink-0" ref={showMenu ? actionMenuRef : undefined}>
                        <button
                          onClick={() => {
                            setOpenActionMenu(showMenu ? null : member.clerk_user_id);
                            setRoleChangeTarget(null);
                            setConfirmRemoveTarget(null);
                          }}
                          className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                        >
                          <MoreVertical className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                        </button>

                        {showMenu && !showRolePicker && !showConfirmRemove && (
                          <div className={`absolute right-0 top-full mt-1 w-44 rounded-lg shadow-xl border z-20 overflow-hidden ${
                            darkMode ? 'bg-[#27272a] border-white/10' : 'bg-white border-gray-200'
                          }`}>
                            <button
                              onClick={() => { setRoleChangeTarget(member.clerk_user_id); setOpenActionMenu(null); }}
                              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${darkMode ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'}`}
                            >
                              Change Role
                            </button>
                            {!isOwner && (
                              <button
                                onClick={() => { setConfirmRemoveTarget(member.clerk_user_id); setOpenActionMenu(null); }}
                                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${darkMode ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'}`}
                              >
                                Remove Member
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Inline role change picker */}
                  {showRolePicker && (
                    <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-white/10' : 'border-gray-100'}`}>
                      <p className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Change role to:</p>
                      <div className="flex gap-2 flex-wrap">
                        {(['org_owner', 'org_manager', 'org_member'] as OrgRole[]).map((r) => {
                          const rc = getRoleConfig(r);
                          const RI = rc.icon;
                          const isCurrent = member.org_role === r;
                          return (
                            <button
                              key={r}
                              disabled={isCurrent || actionLoading}
                              onClick={() => handleRoleChange(member.clerk_user_id, r)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                                isCurrent
                                  ? darkMode ? 'bg-white/10 border-white/20 text-gray-300' : 'bg-gray-100 border-gray-200 text-gray-500'
                                  : darkMode ? 'border-white/10 text-gray-300 hover:bg-white/5' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RI className="w-3 h-3" style={{ color: rc.color }} />}
                              {rc.label}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => setRoleChangeTarget(null)}
                          className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${darkMode ? 'border-white/10 text-gray-500 hover:bg-white/5' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Inline remove confirmation */}
                  {showConfirmRemove && (
                    <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-white/10' : 'border-gray-100'}`}>
                      <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Remove this member from the organization?
                      </p>
                      <div className="flex gap-2">
                        <button
                          disabled={actionLoading}
                          onClick={() => handleRemove(member.clerk_user_id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60"
                        >
                          {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          Remove
                        </button>
                        <button
                          onClick={() => setConfirmRemoveTarget(null)}
                          className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${darkMode ? 'border-white/10 text-gray-400 hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredMembers.length === 0 && (
              <div className={`text-center py-12 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No members found</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <InviteMemberModal
          darkMode={darkMode}
          onClose={() => setShowInviteModal(false)}
          onInviteSuccess={() => {
            setShowInviteModal(false);
            fetchTeam();
          }}
        />
      )}
    </div>
  );
}

interface InviteMemberModalProps {
  darkMode: boolean;
  onClose: () => void;
  onInviteSuccess: () => void;
}

function InviteMemberModal({ darkMode, onClose, onInviteSuccess }: InviteMemberModalProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [inviteUrl, setInviteUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setState('loading');
    setErrorMsg('');
    try {
      const result = await apiCreateTeamInvite({ email: email.trim() || undefined });
      setInviteUrl(result.invite_url);
      setState('success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create invite';
      if (msg.includes('SEAT_LIMIT_REACHED')) {
        setErrorMsg('Seat limit reached. Remove a member to free up a seat.');
      } else if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
        setErrorMsg('You need org owner or manager access to create invites.');
      } else {
        setErrorMsg(msg);
      }
      setState('error');
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-lg rounded-2xl shadow-2xl ${darkMode ? 'bg-[#18181b]' : 'bg-white'}`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Invite Team Member</h2>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Generate a secure invite link</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
          >
            <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
          </button>
        </div>

        {/* Content */}
        {state === 'success' ? (
          <div className="p-8">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-7 h-7 text-emerald-500" />
              </div>
              <h3 className={`text-lg mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Invite link created</h3>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Share this link with your team member. It expires in 7 days and can only be used once.
              </p>
            </div>
            <div className={`flex items-center gap-2 rounded-lg border p-3 mb-4 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
              <LinkIcon className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
              <span className={`flex-1 text-sm truncate font-mono ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{inviteUrl}</span>
              <button
                onClick={handleCopyLink}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : darkMode ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={onInviteSuccess}
              className={`w-full py-2 rounded-lg text-sm transition-colors ${darkMode ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-5">
              {state === 'error' && (
                <div className={`flex items-start gap-2 px-4 py-3 rounded-lg text-sm ${darkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {errorMsg}
                </div>
              )}
              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Email Address <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>(optional — pre-fills the invite form)</span>
                </label>
                <div className="relative">
                  <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className={`w-full h-10 pl-10 pr-4 rounded-lg border text-sm ${
                      darkMode
                        ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                        : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                    }`}
                  />
                </div>
              </div>
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                The invitee will join as a <strong>Member</strong>. Managers can update their role after they join.
              </p>
            </div>

            <div className={`px-6 py-4 border-t flex items-center justify-end gap-2 ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
              <Button variant="outline" size="sm" darkMode={darkMode} onClick={onClose} disabled={state === 'loading'}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                darkMode={darkMode}
                onClick={handleCreate}
                disabled={state === 'loading'}
                icon={state === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
              >
                {state === 'loading' ? 'Creating…' : 'Create Invite Link'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

