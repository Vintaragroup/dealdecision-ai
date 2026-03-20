import { useState } from 'react';
import { TeamMembersPanel } from '../collaboration/TeamMembersPanel';
import {
  Users,
  Activity,
} from 'lucide-react';

interface TeamProps {
  darkMode: boolean;
}

export function Team({ darkMode }: TeamProps) {
  const [selectedView, setSelectedView] = useState<'members' | 'activity'>('members');

  return (
    <div className={`h-full flex ${darkMode ? 'bg-[#0a0a0b]' : 'bg-gray-50'}`}>
      <div className="flex-1 flex flex-col overflow-hidden py-6 px-6">
        {/* Header */}
        <div className={`border-b px-6 py-4 rounded-xl ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="mb-4">
            <h1 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Team Collaboration
            </h1>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Manage your team and track collaboration
            </p>
          </div>

          {/* View Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedView('members')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all ${
                selectedView === 'members'
                  ? darkMode
                    ? 'bg-[#6366f1]/20 border border-[#6366f1] text-[#6366f1]'
                    : 'bg-[#6366f1]/10 border border-[#6366f1] text-[#6366f1]'
                  : darkMode
                    ? 'bg-white/5 border border-white/10 text-gray-400 hover:border-white/20'
                    : 'bg-gray-50 border border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <Users className="w-4 h-4" />
              Team Members
            </button>
            <button
              onClick={() => setSelectedView('activity')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all ${
                selectedView === 'activity'
                  ? darkMode
                    ? 'bg-[#6366f1]/20 border border-[#6366f1] text-[#6366f1]'
                    : 'bg-[#6366f1]/10 border border-[#6366f1] text-[#6366f1]'
                  : darkMode
                    ? 'bg-white/5 border border-white/10 text-gray-400 hover:border-white/20'
                    : 'bg-gray-50 border border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <Activity className="w-4 h-4" />
              Activity Feed
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden mt-6">
          {selectedView === 'members' ? (
            <TeamMembersPanel darkMode={darkMode} dealId="team" />
          ) : (
            <div className={`h-full flex flex-col items-center justify-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              <Activity className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm font-medium mb-1">Activity feed coming soon</p>
              <p className="text-xs opacity-70">Team activity tracking is in development.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
