import { Bell, DollarSign, FileText, Sparkles, Users, Trophy, MessageSquare, Mail, Smartphone, Volume2, Moon, Palette, Shield, Globe, Save, RotateCcw, Check } from 'lucide-react';
import { useState } from 'react';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useUserRole } from '../../contexts/UserRoleContext';

export interface NotificationPreferences {
  roiSavings: {
    enabled: boolean;
    savingsMilestones: boolean;
    weeklyRoiSummaries: boolean;
    achievementUnlocks: boolean;
  };
  dealUpdates: {
    enabled: boolean;
    statusChanges: boolean;
    scoreImprovements: boolean;
    milestonesReached: boolean;
  };
  aiAnalysis: {
    enabled: boolean;
    analysisComplete: boolean;
    documentGeneration: boolean;
    reportReady: boolean;
  };
  teamCollaboration: {
    enabled: boolean;
    mentions: boolean;
    comments: boolean;
    teamActivity: boolean;
  };
  achievements: {
    enabled: boolean;
    newBadges: boolean;
    levelUps: boolean;
    challengeCompletions: boolean;
  };
  documents: {
    enabled: boolean;
    uploaded: boolean;
    versionUpdates: boolean;
    reviewRequests: boolean;
  };
}

interface SettingsProps {
  darkMode: boolean;
  notificationPreferences: NotificationPreferences;
  onSavePreferences: (prefs: NotificationPreferences) => void;
}

export function Settings({ darkMode, notificationPreferences, onSavePreferences }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<'notifications' | 'appearance' | 'account' | 'privacy' | 'admin'>('notifications');
  const [prefs, setPrefs] = useState<NotificationPreferences>(notificationPreferences);
  const [hasChanges, setHasChanges] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const { settings, toggleGamification } = useAppSettings();
  const { settings: userRoleSettings, setRole, isInvestor, isFounder } = useUserRole();

  const updateCategory = (category: keyof NotificationPreferences, field: string, value: boolean) => {
    setPrefs(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [field]: value
      }
    }));
    setHasChanges(true);
  };

  const toggleCategory = (category: keyof NotificationPreferences) => {
    const currentEnabled = prefs[category].enabled;
    setPrefs(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        enabled: !currentEnabled
      }
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    onSavePreferences(prefs);
    setHasChanges(false);
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 3000);
  };

  const handleReset = () => {
    setPrefs(notificationPreferences);
    setHasChanges(false);
  };

  const tabs = [
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'appearance' as const, label: 'Appearance', icon: Palette },
    { id: 'account' as const, label: 'Account', icon: Shield },
    { id: 'privacy' as const, label: 'Privacy', icon: Globe },
    { id: 'admin' as const, label: 'Admin', icon: Sparkles },
  ];

  const cardClass = `backdrop-blur-xl border rounded-xl p-6 ${
    darkMode 
      ? 'bg-white/5 border-white/10' 
      : 'bg-white/80 border-gray-200/50 shadow-lg'
  }`;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className={`text-3xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Settings
          </h1>
          <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
            Manage your account settings and preferences
          </p>
        </div>

        {/* Tabs */}
        <div className={`flex gap-2 mb-6 p-1 backdrop-blur-xl border rounded-xl ${
          darkMode 
            ? 'bg-white/5 border-white/10' 
            : 'bg-white/80 border-gray-200/50'
        }`}>
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-lg'
                    : darkMode
                    ? 'text-gray-400 hover:text-white hover:bg-white/5'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Save Bar */}
        {hasChanges && (
          <div className={`mb-6 p-4 backdrop-blur-xl border rounded-xl flex items-center justify-between ${
            darkMode
              ? 'bg-amber-500/10 border-amber-500/20'
              : 'bg-amber-50 border-amber-200'
          }`}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
              <span className={darkMode ? 'text-amber-200' : 'text-amber-900'}>
                You have unsaved changes
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  darkMode
                    ? 'text-gray-400 hover:text-white hover:bg-white/5'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </div>
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-lg hover:shadow-xl transition-shadow"
              >
                <div className="flex items-center gap-2">
                  <Save className="w-4 h-4" />
                  Save Changes
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        {activeTab === 'notifications' && (
          <div className="space-y-6">
            {/* ROI & Savings */}
            <div className={cardClass}>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-lg">
                    <DollarSign className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      ROI & Savings
                    </h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Get notified about your savings milestones and achievements
                    </p>
                    <span className={`inline-block mt-2 px-2 py-0.5 text-xs rounded-full ${
                      darkMode 
                        ? 'bg-emerald-500/20 text-emerald-300' 
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      Recommended
                    </span>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={prefs.roiSavings.enabled}
                    onChange={() => toggleCategory('roiSavings')}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 rounded-full peer transition-colors ${
                    prefs.roiSavings.enabled
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                      : darkMode ? 'bg-gray-700' : 'bg-gray-300'
                  }`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      prefs.roiSavings.enabled ? 'translate-x-5' : ''
                    }`}></div>
                  </div>
                </label>
              </div>
              
              {prefs.roiSavings.enabled && (
                <div className="space-y-3 pl-13">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Savings milestones reached
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.roiSavings.savingsMilestones}
                      onChange={(e) => updateCategory('roiSavings', 'savingsMilestones', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Weekly ROI summaries
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.roiSavings.weeklyRoiSummaries}
                      onChange={(e) => updateCategory('roiSavings', 'weeklyRoiSummaries', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Achievement unlocks
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.roiSavings.achievementUnlocks}
                      onChange={(e) => updateCategory('roiSavings', 'achievementUnlocks', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Deal Updates */}
            <div className={cardClass}>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-lg flex items-center justify-center shadow-lg">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Deal Updates
                    </h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Stay informed about changes to your deals
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={prefs.dealUpdates.enabled}
                    onChange={() => toggleCategory('dealUpdates')}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 rounded-full peer transition-colors ${
                    prefs.dealUpdates.enabled
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                      : darkMode ? 'bg-gray-700' : 'bg-gray-300'
                  }`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      prefs.dealUpdates.enabled ? 'translate-x-5' : ''
                    }`}></div>
                  </div>
                </label>
              </div>
              
              {prefs.dealUpdates.enabled && (
                <div className="space-y-3 pl-13">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Deal status changes
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.dealUpdates.statusChanges}
                      onChange={(e) => updateCategory('dealUpdates', 'statusChanges', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Score improvements
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.dealUpdates.scoreImprovements}
                      onChange={(e) => updateCategory('dealUpdates', 'scoreImprovements', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Milestones reached
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.dealUpdates.milestonesReached}
                      onChange={(e) => updateCategory('dealUpdates', 'milestonesReached', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* AI & Analysis */}
            <div className={cardClass}>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      AI & Analysis
                    </h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Get notified when AI completes analysis or generates documents
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={prefs.aiAnalysis.enabled}
                    onChange={() => toggleCategory('aiAnalysis')}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 rounded-full peer transition-colors ${
                    prefs.aiAnalysis.enabled
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                      : darkMode ? 'bg-gray-700' : 'bg-gray-300'
                  }`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      prefs.aiAnalysis.enabled ? 'translate-x-5' : ''
                    }`}></div>
                  </div>
                </label>
              </div>
              
              {prefs.aiAnalysis.enabled && (
                <div className="space-y-3 pl-13">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Analysis complete
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.aiAnalysis.analysisComplete}
                      onChange={(e) => updateCategory('aiAnalysis', 'analysisComplete', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Document generation complete
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.aiAnalysis.documentGeneration}
                      onChange={(e) => updateCategory('aiAnalysis', 'documentGeneration', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Report ready
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.aiAnalysis.reportReady}
                      onChange={(e) => updateCategory('aiAnalysis', 'reportReady', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Team & Collaboration */}
            <div className={cardClass}>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg flex items-center justify-center shadow-lg">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Team & Collaboration
                    </h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Stay connected with your team's activity
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={prefs.teamCollaboration.enabled}
                    onChange={() => toggleCategory('teamCollaboration')}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 rounded-full peer transition-colors ${
                    prefs.teamCollaboration.enabled
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                      : darkMode ? 'bg-gray-700' : 'bg-gray-300'
                  }`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      prefs.teamCollaboration.enabled ? 'translate-x-5' : ''
                    }`}></div>
                  </div>
                </label>
              </div>
              
              {prefs.teamCollaboration.enabled && (
                <div className="space-y-3 pl-13">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      @Mentions
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.teamCollaboration.mentions}
                      onChange={(e) => updateCategory('teamCollaboration', 'mentions', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Comments on your deals
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.teamCollaboration.comments}
                      onChange={(e) => updateCategory('teamCollaboration', 'comments', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Team member activity
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.teamCollaboration.teamActivity}
                      onChange={(e) => updateCategory('teamCollaboration', 'teamActivity', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Achievements & Gamification */}
            <div className={cardClass}>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg flex items-center justify-center shadow-lg">
                    <Trophy className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Achievements & Gamification
                    </h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Celebrate your wins and progress
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={prefs.achievements.enabled}
                    onChange={() => toggleCategory('achievements')}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 rounded-full peer transition-colors ${
                    prefs.achievements.enabled
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                      : darkMode ? 'bg-gray-700' : 'bg-gray-300'
                  }`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      prefs.achievements.enabled ? 'translate-x-5' : ''
                    }`}></div>
                  </div>
                </label>
              </div>
              
              {prefs.achievements.enabled && (
                <div className="space-y-3 pl-13">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      New badges earned
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.achievements.newBadges}
                      onChange={(e) => updateCategory('achievements', 'newBadges', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Level ups
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.achievements.levelUps}
                      onChange={(e) => updateCategory('achievements', 'levelUps', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Challenge completions
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.achievements.challengeCompletions}
                      onChange={(e) => updateCategory('achievements', 'challengeCompletions', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Documents */}
            <div className={cardClass}>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-rose-600 rounded-lg flex items-center justify-center shadow-lg">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Documents
                    </h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Track document changes and updates
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={prefs.documents.enabled}
                    onChange={() => toggleCategory('documents')}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 rounded-full peer transition-colors ${
                    prefs.documents.enabled
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                      : darkMode ? 'bg-gray-700' : 'bg-gray-300'
                  }`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      prefs.documents.enabled ? 'translate-x-5' : ''
                    }`}></div>
                  </div>
                </label>
              </div>
              
              {prefs.documents.enabled && (
                <div className="space-y-3 pl-13">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Document uploaded
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.documents.uploaded}
                      onChange={(e) => updateCategory('documents', 'uploaded', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Version updates
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.documents.versionUpdates}
                      onChange={(e) => updateCategory('documents', 'versionUpdates', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Review requests
                    </span>
                    <input 
                      type="checkbox" 
                      checked={prefs.documents.reviewRequests}
                      onChange={(e) => updateCategory('documents', 'reviewRequests', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Palette className={`w-5 h-5 ${darkMode ? 'text-white' : 'text-gray-900'}`} />
              <h3 className={darkMode ? 'text-white' : 'text-gray-900'}>
                Appearance Settings
              </h3>
            </div>
            <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
              Appearance settings coming soon...
            </p>
          </div>
        )}

        {activeTab === 'account' && (
          <div className="space-y-6">
            {/* User Role */}
            <div className={cardClass}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-lg flex items-center justify-center shadow-lg">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    User Role
                  </h3>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Choose your role to customize your experience
                  </p>
                </div>
              </div>

              {/* Role Selector */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Investor Role */}
                <button
                  onClick={() => setRole('investor')}
                  className={`p-5 rounded-xl border-2 transition-all text-left ${
                    isInvestor
                      ? 'border-[#6366f1] bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10'
                      : darkMode
                      ? 'border-white/10 hover:border-white/20 bg-white/5'
                      : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                      isInvestor
                        ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]'
                        : darkMode ? 'bg-white/10' : 'bg-gray-200'
                    }`}>
                      <span className={`text-2xl ${isInvestor ? '' : 'grayscale opacity-50'}`}>💼</span>
                    </div>
                    {isInvestor && (
                      <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                  <h4 className={`mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Investor
                  </h4>
                  <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Evaluate opportunities, perform due diligence, and deploy capital
                  </p>
                  <div className={`text-xs space-y-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    <p>• Deal pipeline & scoring</p>
                    <p>• Due diligence reports</p>
                    <p>• Portfolio analytics</p>
                    <p>• Deal comparison tools</p>
                  </div>
                  {isInvestor && (
                    <div className={`mt-3 px-2 py-1 rounded text-xs inline-block ${
                      darkMode ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      Default
                    </div>
                  )}
                </button>

                {/* Founder Role */}
                <button
                  onClick={() => setRole('founder')}
                  className={`p-5 rounded-xl border-2 transition-all text-left ${
                    isFounder
                      ? 'border-[#6366f1] bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10'
                      : darkMode
                      ? 'border-white/10 hover:border-white/20 bg-white/5'
                      : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                  }`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                      isFounder
                        ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]'
                        : darkMode ? 'bg-white/10' : 'bg-gray-200'
                    }`}>
                      <span className={`text-2xl ${isFounder ? '' : 'grayscale opacity-50'}`}>🚀</span>
                    </div>
                    {isFounder && (
                      <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                  <h4 className={`mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Founder
                  </h4>
                  <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Build pitch materials, track fundraising, and attract investors
                  </p>
                  <div className={`text-xs space-y-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    <p>• Pitch deck builder</p>
                    <p>• Fundraising tracker</p>
                    <p>• Investor CRM</p>
                    <p>• Financial projections</p>
                  </div>
                </button>
              </div>

              {/* Current Role Info */}
              <div className={`mt-6 p-4 rounded-lg border ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
              }`}>
                <p className={`text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Current Role: <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {isInvestor ? 'Investor' : 'Founder'}
                  </span>
                </p>
                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {isInvestor 
                    ? 'Your dashboard shows deal pipeline, due diligence tools, and portfolio analytics.'
                    : 'Your dashboard shows fundraising progress, pitch builder, and investor outreach tools.'
                  }
                </p>
              </div>
            </div>

            {/* Account Info Placeholder */}
            <div className={cardClass}>
              <div className="flex items-center gap-3 mb-4">
                <Shield className={`w-5 h-5 ${darkMode ? 'text-white' : 'text-gray-900'}`} />
                <h3 className={darkMode ? 'text-white' : 'text-gray-900'}>
                  Account Information
                </h3>
              </div>
              <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                Profile and account management coming soon...
              </p>
            </div>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Globe className={`w-5 h-5 ${darkMode ? 'text-white' : 'text-gray-900'}`} />
              <h3 className={darkMode ? 'text-white' : 'text-gray-900'}>
                Privacy Settings
              </h3>
            </div>
            <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
              Privacy settings coming soon...
            </p>
          </div>
        )}

        {activeTab === 'admin' && (
          <div className="space-y-6">
            {/* Platform Features */}
            <div className={cardClass}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
                  <Trophy className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Platform Features
                  </h3>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Control which features are available to users
                  </p>
                </div>
              </div>

              {/* Gamification Toggle */}
              <div className={`p-4 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg flex items-center justify-center shadow">
                      <Trophy className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h4 className={`mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Gamification System
                      </h4>
                      <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Enable or disable achievements, XP, leaderboards, and challenges across the platform
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={settings.gamificationEnabled}
                      onChange={toggleGamification}
                      className="sr-only peer"
                    />
                    <div className={`w-11 h-6 rounded-full peer transition-colors ${settings.gamificationEnabled ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]' : darkMode ? 'bg-gray-700' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.gamificationEnabled ? 'translate-x-5' : ''}`}></div>
                    </div>
                  </label>
                </div>

                {/* Info about what gets disabled */}
                <div className={`mt-4 p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white'}`}>
                  <p className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    When disabled, the following features will be hidden:
                  </p>
                  <ul className={`text-xs space-y-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    <li>• Gamification page in sidebar</li>
                    <li>• XP progress widgets and counters</li>
                    <li>• Achievement badges and notifications</li>
                    <li>• Leaderboards and rankings</li>
                    <li>• Challenge cards and skill trees</li>
                    <li>• Streak trackers</li>
                  </ul>
                </div>

                {/* Status indicator */}
                <div className={`mt-4 flex items-center gap-2 px-3 py-2 rounded-lg ${settings.gamificationEnabled ? darkMode ? 'bg-emerald-500/10' : 'bg-emerald-50' : darkMode ? 'bg-gray-500/10' : 'bg-gray-100'}`}>
                  <div className={`w-2 h-2 rounded-full ${settings.gamificationEnabled ? 'bg-emerald-500' : 'bg-gray-500'}`}></div>
                  <span className={`text-xs ${settings.gamificationEnabled ? darkMode ? 'text-emerald-300' : 'text-emerald-700' : darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Gamification is currently {settings.gamificationEnabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
              </div>
            </div>

            {/* Future admin features placeholder */}
            <div className={cardClass}>
              <div className="flex items-center gap-3 mb-4">
                <Sparkles className={`w-5 h-5 ${darkMode ? 'text-white' : 'text-gray-900'}`} />
                <div>
                  <h3 className={darkMode ? 'text-white' : 'text-gray-900'}>
                    Additional Admin Features
                  </h3>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    More admin controls coming soon...
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Success Toast */}
      {showSavedToast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4">
          <div className={`flex items-center gap-3 px-4 py-3 backdrop-blur-xl border rounded-lg shadow-2xl ${
            darkMode
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : 'bg-emerald-50 border-emerald-200'
          }`}>
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-lg">
              <Check className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className={`text-sm ${darkMode ? 'text-emerald-200' : 'text-emerald-900'}`}>
                Preferences saved successfully!
              </p>
              <p className={`text-xs ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                Your notification settings have been updated
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}