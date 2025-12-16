import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { 
  User,
  Mail,
  Building,
  MapPin,
  Phone,
  Calendar,
  Award,
  TrendingUp,
  Target,
  Sparkles,
  Bell,
  Shield,
  Palette,
  Moon,
  Sun,
  Globe,
  CreditCard,
  LogOut,
  Camera,
  CheckCircle,
  Save
} from 'lucide-react';

interface ProfileProps {
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
}

export function Profile({ darkMode, setDarkMode }: ProfileProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'notifications' | 'billing'>('profile');
  const [isSaving, setIsSaving] = useState(false);

  // Profile data
  const [profileData, setProfileData] = useState({
    name: 'Sarah Chen',
    email: 'sarah.chen@company.com',
    title: 'Founder & CEO',
    company: 'TechVision AI',
    location: 'San Francisco, CA',
    phone: '+1 (555) 123-4567',
    bio: 'Serial entrepreneur with 2 successful exits. Building the future of AI infrastructure.',
    linkedIn: 'linkedin.com/in/sarahchen',
    twitter: '@sarahchen'
  });

  // Notification settings
  const [notifications, setNotifications] = useState({
    emailDeals: true,
    emailActivity: true,
    emailDigest: false,
    pushDeals: true,
    pushComments: true,
    pushMentions: true,
    weeklyReport: true,
    monthlyReport: false
  });

  const stats = [
    { label: 'Total Deals', value: '12', icon: <Target className="w-5 h-5" />, color: 'text-blue-400' },
    { label: 'Documents Created', value: '47', icon: <Award className="w-5 h-5" />, color: 'text-purple-400' },
    { label: 'Total XP Earned', value: '8,450', icon: <Sparkles className="w-5 h-5" />, color: 'text-yellow-400' },
    { label: 'Current Level', value: '12', icon: <TrendingUp className="w-5 h-5" />, color: 'text-emerald-400' }
  ];

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
    }, 1500);
  };

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
              <div className="w-24 h-24 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-2xl flex items-center justify-center text-4xl shadow-lg">
                👩‍💼
              </div>
              <button className={`absolute -bottom-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${
                darkMode ? 'bg-[#6366f1] hover:bg-[#5558e3]' : 'bg-[#6366f1] hover:bg-[#5558e3]'
              } text-white transition-colors`}>
                <Camera className="w-4 h-4" />
              </button>
            </div>

            {/* Info */}
            <div className="flex-1">
              <h1 className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {profileData.name}
              </h1>
              <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {profileData.title} at {profileData.company}
              </p>
              <div className={`flex items-center gap-4 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {profileData.email}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {profileData.location}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Member since Jan 2024
                </span>
              </div>
            </div>

            <Button
              variant="secondary"
              darkMode={darkMode}
              icon={<LogOut className="w-4 h-4" />}
            >
              Sign Out
            </Button>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4">
            {stats.map((stat, i) => (
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
                    <Input
                      darkMode={darkMode}
                      value={profileData.name}
                      onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Email
                    </label>
                    <Input
                      darkMode={darkMode}
                      type="email"
                      value={profileData.email}
                      onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Title
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileData.title}
                      onChange={(e) => setProfileData({ ...profileData, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Company
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileData.company}
                      onChange={(e) => setProfileData({ ...profileData, company: e.target.value })}
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
                      value={profileData.location}
                      onChange={(e) => setProfileData({ ...profileData, location: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Phone
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileData.phone}
                      onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Bio
                  </label>
                  <Textarea
                    darkMode={darkMode}
                    value={profileData.bio}
                    onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })}
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
                      value={profileData.linkedIn}
                      onChange={(e) => setProfileData({ ...profileData, linkedIn: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Twitter
                    </label>
                    <Input
                      darkMode={darkMode}
                      value={profileData.twitter}
                      onChange={(e) => setProfileData({ ...profileData, twitter: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <Button
                    variant="primary"
                    darkMode={darkMode}
                    onClick={handleSave}
                    loading={isSaving}
                    icon={<Save className="w-4 h-4" />}
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            )}

            {/* Preferences Tab */}
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

                <div>
                  <h3 className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Language & Region
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Language
                      </label>
                      <select className={`w-full px-4 py-2 rounded-lg border ${
                        darkMode
                          ? 'bg-white/5 border-white/10 text-white'
                          : 'bg-white border-gray-200 text-gray-900'
                      }`}>
                        <option>English (US)</option>
                        <option>English (UK)</option>
                        <option>Spanish</option>
                        <option>French</option>
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Timezone
                      </label>
                      <select className={`w-full px-4 py-2 rounded-lg border ${
                        darkMode
                          ? 'bg-white/5 border-white/10 text-white'
                          : 'bg-white border-gray-200 text-gray-900'
                      }`}>
                        <option>Pacific Time (PT)</option>
                        <option>Eastern Time (ET)</option>
                        <option>Central European Time (CET)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Notifications Tab */}
            {activeTab === 'notifications' && (
              <div className="space-y-6">
                <div>
                  <h3 className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Email Notifications
                  </h3>
                  <div className="space-y-3">
                    {[
                      { key: 'emailDeals', label: 'New deals created', description: 'Get notified when team members create new deals' },
                      { key: 'emailActivity', label: 'Activity updates', description: 'Updates on deals you\'re following' },
                      { key: 'emailDigest', label: 'Daily digest', description: 'Summary of activity sent every morning' }
                    ].map((item) => (
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
                            onClick={() => setNotifications({ ...notifications, [item.key]: !notifications[item.key as keyof typeof notifications] })}
                            className={`relative w-14 h-7 rounded-full transition-colors ${
                              notifications[item.key as keyof typeof notifications] ? 'bg-[#6366f1]' : 'bg-gray-300'
                            }`}
                          >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                              notifications[item.key as keyof typeof notifications] ? 'translate-x-8' : 'translate-x-1'
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
                    {[
                      { key: 'pushDeals', label: 'Deal updates', description: 'Real-time notifications for deal changes' },
                      { key: 'pushComments', label: 'Comments', description: 'When someone comments on your deals' },
                      { key: 'pushMentions', label: 'Mentions', description: 'When someone @mentions you' }
                    ].map((item) => (
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
                            onClick={() => setNotifications({ ...notifications, [item.key]: !notifications[item.key as keyof typeof notifications] })}
                            className={`relative w-14 h-7 rounded-full transition-colors ${
                              notifications[item.key as keyof typeof notifications] ? 'bg-[#6366f1]' : 'bg-gray-300'
                            }`}
                          >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                              notifications[item.key as keyof typeof notifications] ? 'translate-x-8' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Billing Tab */}
            {activeTab === 'billing' && (
              <div className="space-y-6">
                <div className={`p-6 rounded-xl border ${
                  darkMode
                    ? 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/10 border-[#6366f1]/30'
                    : 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/5 border-[#6366f1]/20'
                }`}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className={`text-lg mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Pro Plan
                      </h3>
                      <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Unlimited deals, AI analysis, and team collaboration
                      </p>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        $49
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        per month
                      </div>
                    </div>
                  </div>
                  <Button variant="secondary" darkMode={darkMode}>
                    Manage Subscription
                  </Button>
                </div>

                <div>
                  <h3 className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Payment Method
                  </h3>
                  <div className={`p-4 rounded-xl border ${
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CreditCard className="w-5 h-5" />
                        <div>
                          <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            •••• •••• •••• 4242
                          </div>
                          <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                            Expires 12/25
                          </div>
                        </div>
                      </div>
                      <Button variant="secondary" darkMode={darkMode} size="sm">
                        Update
                      </Button>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Billing History
                  </h3>
                  <div className="space-y-2">
                    {[
                      { date: 'Dec 1, 2024', amount: '$49.00', status: 'Paid' },
                      { date: 'Nov 1, 2024', amount: '$49.00', status: 'Paid' },
                      { date: 'Oct 1, 2024', amount: '$49.00', status: 'Paid' }
                    ].map((invoice, i) => (
                      <div key={i} className={`p-4 rounded-xl border ${
                        darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {invoice.date}
                            </div>
                            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                              {invoice.amount}
                            </div>
                            <div className="flex items-center gap-1 text-emerald-400 text-xs">
                              <CheckCircle className="w-3 h-3" />
                              {invoice.status}
                            </div>
                          </div>
                          <Button variant="secondary" darkMode={darkMode} size="sm">
                            Download
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
