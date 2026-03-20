import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { useClerk, useOrganization, useUser } from '@clerk/clerk-react';
import { 
  User,
  Mail,
  Building,
  MapPin,
  Phone,
  Calendar,
  Award,
  Target,
  Bell,
  Palette,
  Moon,
  Sun,
  CreditCard,
  LogOut,
  Camera,
  Save
} from 'lucide-react';
import { apiGetProfileStats } from '../../lib/apiClient';

interface ProfileProps {
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
}

export function Profile({ darkMode, setDarkMode }: ProfileProps) {
  const { isLoaded: userLoaded, isSignedIn, user } = useUser();
  const { isLoaded: orgLoaded, organization, membership } = useOrganization();
  const clerk = useClerk();

  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'notifications' | 'billing'>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<{ dealCount: number; documentCount: number } | null>(null);

  const fullName = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Account';
  const primaryEmail =
    user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || '';
  const avatarUrl = user?.imageUrl || '';
  const memberSince = (() => {
    const raw = (user as any)?.createdAt;
    const date = raw instanceof Date ? raw : typeof raw === 'number' ? new Date(raw) : null;
    if (!date) return null;
    try {
      return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
    } catch {
      return null;
    }
  })();

  const orgName = orgLoaded ? organization?.name || null : null;
  const orgRole = orgLoaded ? (membership as any)?.role || null : null;

  // Load real stats from API
  useEffect(() => {
    let cancelled = false;
    apiGetProfileStats()
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(() => { /* silently degrade — stats stay null */ });
    return () => { cancelled = true; };
  }, []);

  if (!userLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
        <div className="text-sm text-white/70">Loading profile…</div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
        <div className="text-sm text-white/70">You are signed out.</div>
      </div>
    );
  }

  // Notification settings — initialized from Clerk unsafeMetadata, persisted on toggle.
  const meta = (user?.unsafeMetadata ?? {}) as Record<string, unknown>;
  const getMetaBool = (key: string, def: boolean) =>
    typeof meta[key] === 'boolean' ? (meta[key] as boolean) : def;

  const [notifications, setNotifications] = useState({
    emailDeals:     getMetaBool('notif_emailDeals', true),
    emailActivity:  getMetaBool('notif_emailActivity', true),
    emailDigest:    getMetaBool('notif_emailDigest', false),
    pushDeals:      getMetaBool('notif_pushDeals', true),
    pushComments:   getMetaBool('notif_pushComments', true),
    pushMentions:   getMetaBool('notif_pushMentions', true),
  });

  // Profile extras — initialized from Clerk unsafeMetadata.
  const [profileExtras, setProfileExtras] = useState({
    title:    typeof meta.title    === 'string' ? meta.title    : '',
    company:  typeof meta.company  === 'string' ? meta.company  : '',
    location: typeof meta.location === 'string' ? meta.location : '',
    phone:    typeof meta.phone    === 'string' ? meta.phone    : '',
    bio:      typeof meta.bio      === 'string' ? meta.bio      : '',
    linkedIn: typeof meta.linkedIn === 'string' ? meta.linkedIn : '',
    twitter:  typeof meta.twitter  === 'string' ? meta.twitter  : '',
  });

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await user.update({
        unsafeMetadata: {
          ...user.unsafeMetadata,
          ...profileExtras,
        },
      });
    } catch (err) {
      setSaveError('Save failed — please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleNotif = async (key: keyof typeof notifications, value: boolean) => {
    setNotifications((prev) => ({ ...prev, [key]: value }));
    try {
      await user.update({
        unsafeMetadata: {
          ...user.unsafeMetadata,
          [`notif_${key}`]: value,
        },
      });
    } catch {
      // Revert optimistic update on failure
      setNotifications((prev) => ({ ...prev, [key]: !value }));
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      await user.setProfileImage({ file });
    } finally {
      setAvatarUploading(false);
      // Reset so re-selecting the same file triggers onChange again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const statCards = [
    {
      label: 'Total Deals',
      value: stats ? String(stats.dealCount) : '—',
      icon: <Target className="w-5 h-5" />,
      color: 'text-blue-400',
    },
    {
      label: 'Documents Uploaded',
      value: stats ? String(stats.documentCount) : '—',
      icon: <Award className="w-5 h-5" />,
      color: 'text-purple-400',
    },
  ];

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6">
        {/* Header with Stats */}
        <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <div className="flex items-start gap-6 mb-6">
            {/* Avatar */}
            <div className="relative">
              <div className="w-24 h-24 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-2xl flex items-center justify-center text-4xl shadow-lg overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={fullName} className="w-full h-full object-cover" />
                ) : (
                  <span aria-hidden>👤</span>
                )}
              </div>
              {/* Hidden file input for avatar upload */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className={`absolute -bottom-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center shadow-lg bg-[#6366f1] hover:bg-[#5558e3] text-white transition-colors disabled:opacity-50`}
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>

            {/* Info */}
            <div className="flex-1">
              <h1 className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {fullName}
              </h1>
              {(orgName || orgRole) && (
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {orgName ? `Org: ${orgName}` : 'Org'}
                  {orgRole ? ` · Role: ${String(orgRole)}` : ''}
                </p>
              )}
              <div className={`flex items-center gap-4 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {primaryEmail}
                </span>
                {memberSince && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Member since {memberSince}
                  </span>
                )}
              </div>
            </div>

            <Button
              variant="secondary"
              darkMode={darkMode}
              icon={<LogOut className="w-4 h-4" />}
              onClick={() => {
                void clerk.signOut({ redirectUrl: '/' });
              }}
            >
              Sign Out
            </Button>
          </div>

          {/* Stats Grid — 2 real cards */}
          <div className="grid grid-cols-2 gap-4">
            {statCards.map((stat, i) => (
              <div
                key={i}
                className={`p-4 rounded-xl border ${
                  darkMode
                    ? 'bg-white/5 border-white/10'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className={`${stat.color} mb-2`}>
                  {stat.icon}
                </div>
                <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {stat.value}
                </div>
                <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className={`backdrop-blur-xl border rounded-2xl overflow-hidden ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          {/* Tab Headers */}
          <div className={`flex border-b ${darkMode ? 'border-white/5' : 'border-gray-200'}`}>
            {[
              { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
              { id: 'preferences', label: 'Preferences', icon: <Palette className="w-4 h-4" /> },
              { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
              { id: 'billing', label: 'Billing', icon: <CreditCard className="w-4 h-4" /> }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 text-sm transition-colors ${
                  activeTab === tab.id
                    ? darkMode
                      ? 'text-white border-b-2 border-[#6366f1]'
                      : 'text-gray-900 border-b-2 border-[#6366f1]'
                    : darkMode
                      ? 'text-gray-500 hover:text-gray-300'
                      : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {/* Profile Tab */}
            {activeTab === 'profile' && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Full Name
                    </label>
                    <Input darkMode={darkMode} value={fullName} disabled />
                    <div className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Managed by Clerk
                    </div>
                  </div>
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Email
                    </label>
                    <Input darkMode={darkMode} type="email" value={primaryEmail} disabled />
                    <div className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Managed by Clerk
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Title
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileExtras.title}
                      onChange={(e) => setProfileExtras({ ...profileExtras, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Company
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileExtras.company}
                      onChange={(e) => setProfileExtras({ ...profileExtras, company: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Location
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileExtras.location}
                      onChange={(e) => setProfileExtras({ ...profileExtras, location: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Phone
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileExtras.phone}
                      onChange={(e) => setProfileExtras({ ...profileExtras, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Bio
                  </label>
                  <Textarea
                    darkMode={darkMode}
                    value={profileExtras.bio}
                    onChange={(e) => setProfileExtras({ ...profileExtras, bio: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      LinkedIn
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileExtras.linkedIn}
                      onChange={(e) => setProfileExtras({ ...profileExtras, linkedIn: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Twitter / X
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileExtras.twitter}
                      onChange={(e) => setProfileExtras({ ...profileExtras, twitter: e.target.value })}
                    />
                  </div>
                </div>

                {saveError && (
                  <div className="text-sm text-red-400">{saveError}</div>
                )}

                <div className="flex justify-end pt-4">
                  <Button
                    variant="primary"
                    darkMode={darkMode}
                    onClick={handleSave}
                    loading={isSaving}
                    icon={<Save className="w-4 h-4" />}
                  >
                    {isSaving ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            )}

            {/* Preferences Tab — dark mode toggle only; language/tz removed until wired */}
            {activeTab === 'preferences' && (
              <div className="space-y-6">
                <div>
                  <h3 className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Appearance
                  </h3>
                  <div className={`p-4 rounded-xl border ${
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                        <div>
                          <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {darkMode ? 'Dark Mode' : 'Light Mode'}
                          </div>
                          <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                            Toggle between light and dark themes
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setDarkMode(!darkMode)}
                        className={`relative w-14 h-7 rounded-full transition-colors ${
                          darkMode ? 'bg-[#6366f1]' : 'bg-gray-300'
                        }`}
                      >
                        <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                          darkMode ? 'translate-x-8' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Notifications Tab — persisted via Clerk unsafeMetadata */}
            {activeTab === 'notifications' && (
              <div className="space-y-6">
                <div>
                  <h3 className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Email Notifications
                  </h3>
                  <div className="space-y-3">
                    {([
                      { key: 'emailDeals',    label: 'New deals created',   description: 'Get notified when team members create new deals' },
                      { key: 'emailActivity', label: 'Activity updates',    description: "Updates on deals you're following" },
                      { key: 'emailDigest',   label: 'Daily digest',        description: 'Summary of activity sent every morning' },
                    ] as const).map((item) => (
                      <div key={item.key} className={`p-4 rounded-xl border ${
                        darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {item.label}
                            </div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              {item.description}
                            </div>
                          </div>
                          <button
                            onClick={() => toggleNotif(item.key, !notifications[item.key])}
                            className={`relative w-14 h-7 rounded-full transition-colors ${
                              notifications[item.key] ? 'bg-[#6366f1]' : 'bg-gray-300'
                            }`}
                          >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                              notifications[item.key] ? 'translate-x-8' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Push Notifications
                  </h3>
                  <div className="space-y-3">
                    {([
                      { key: 'pushDeals',    label: 'Deal updates', description: 'Real-time notifications for deal changes' },
                      { key: 'pushComments', label: 'Comments',     description: 'When someone comments on your deals' },
                      { key: 'pushMentions', label: 'Mentions',     description: 'When someone @mentions you' },
                    ] as const).map((item) => (
                      <div key={item.key} className={`p-4 rounded-xl border ${
                        darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {item.label}
                            </div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              {item.description}
                            </div>
                          </div>
                          <button
                            onClick={() => toggleNotif(item.key, !notifications[item.key])}
                            className={`relative w-14 h-7 rounded-full transition-colors ${
                              notifications[item.key] ? 'bg-[#6366f1]' : 'bg-gray-300'
                            }`}
                          >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                              notifications[item.key] ? 'translate-x-8' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Billing Tab — honest placeholder until Stripe is integrated */}
            {activeTab === 'billing' && (
              <div className="py-12 text-center">
                <CreditCard className={`w-8 h-8 mx-auto mb-3 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                <p className={`text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Billing is managed externally.
                </p>
                <a
                  href="mailto:support@dealdecisionai.com"
                  className="text-[#6366f1] text-sm hover:underline"
                >
                  Contact support for billing questions
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
