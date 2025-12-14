import { useState } from 'react';
import { Button } from '../ui/Button';
import { TeamMembersPanel } from '../collaboration/TeamMembersPanel';
import {
  Users,
  UserPlus,
  Activity,
  MessageSquare,
  Share2,
  Clock,
  TrendingUp,
  Eye,
  Edit3,
  FileText,
  BarChart3
} from 'lucide-react';

interface TeamProps {
  darkMode: boolean;
}

export function Team({ darkMode }: TeamProps) {
  const [selectedView, setSelectedView] = useState<'members' | 'activity'>('members');

  // Mock activity data
  const recentActivity = [
    {
      id: '1',
      user: 'Michael Rodriguez',
      action: 'commented on',
      target: 'TechVision AI - Due Diligence',
      timestamp: '5 minutes ago',
      type: 'comment',
      icon: MessageSquare
    },
    {
      id: '2',
      user: 'Emily Watson',
      action: 'shared',
      target: 'Q3 Investment Report',
      timestamp: '12 minutes ago',
      type: 'share',
      icon: Share2
    },
    {
      id: '3',
      user: 'Sarah Chen',
      action: 'edited',
      target: 'HealthTech Pro - Financial Analysis',
      timestamp: '1 hour ago',
      type: 'edit',
      icon: Edit3
    },
    {
      id: '4',
      user: 'David Kim',
      action: 'viewed',
      target: 'Deal Comparison Report',
      timestamp: '2 hours ago',
      type: 'view',
      icon: Eye
    },
    {
      id: '5',
      user: 'Michael Rodriguez',
      action: 'created',
      target: 'EduConnect - Initial Assessment',
      timestamp: '3 hours ago',
      type: 'create',
      icon: FileText
    },
    {
      id: '6',
      user: 'Emily Watson',
      action: 'ran analysis on',
      target: 'FinanceFlow Deal',
      timestamp: '4 hours ago',
      type: 'analysis',
      icon: BarChart3
    }
  ];

  // Mock team stats
  const teamStats = [
    {
      label: 'Team Members',
      value: '5',
      change: '+2 this month',
      icon: Users,
      color: '#6366f1'
    },
    {
      label: 'Active Discussions',
      value: '12',
      change: '+4 this week',
      icon: MessageSquare,
      color: '#10b981'
    },
    {
      label: 'Shared Documents',
      value: '34',
      change: '+8 this month',
      icon: Share2,
      color: '#f59e0b'
    },
    {
      label: 'Team Activity',
      value: '156',
      change: 'actions this week',
      icon: Activity,
      color: '#8b5cf6'
    }
  ];

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'comment': return '#3b82f6';
      case 'share': return '#10b981';
      case 'edit': return '#f59e0b';
      case 'view': return '#6b7280';
      case 'create': return '#8b5cf6';
      case 'analysis': return '#6366f1';
      default: return '#6b7280';
    }
  };

  return (
    <div className={`h-full flex ${darkMode ? 'bg-[#0a0a0b]' : 'bg-gray-50'}`}>
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`border-b px-6 py-4 ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Team Collaboration
              </h1>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Manage your team and track collaboration
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              darkMode={darkMode}
              icon={<UserPlus className="w-4 h-4" />}
            >
              Invite Member
            </Button>
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

        {/* Stats Grid */}
        <div className="p-6 border-b ${
          darkMode ? 'border-white/10' : 'border-gray-200'
        }">
          <div className="grid grid-cols-4 gap-4">
            {teamStats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <div
                  key={index}
                  className={`p-4 rounded-xl border ${
                    darkMode
                      ? 'bg-[#18181b] border-white/10'
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: stat.color + '20' }}
                    >
                      <Icon className="w-5 h-5" style={{ color: stat.color }} />
                    </div>
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {stat.value}
                  </div>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {stat.label}
                  </div>
                  <div className="text-xs text-emerald-500">
                    {stat.change}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {selectedView === 'members' ? (
            <TeamMembersPanel darkMode={darkMode} dealId="team" />
          ) : (
            <div className="h-full overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto">
                <div className={`p-4 rounded-xl border mb-6 ${
                  darkMode
                    ? 'bg-[#18181b] border-white/10'
                    : 'bg-white border-gray-200'
                }`}>
                  <div className="flex items-center gap-3">
                    <Activity className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                    <div>
                      <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Recent Team Activity
                      </h3>
                      <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                        Track what your team is working on
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {recentActivity.map(activity => {
                    const Icon = activity.icon;
                    return (
                      <div
                        key={activity.id}
                        className={`p-4 rounded-xl border transition-colors ${
                          darkMode
                            ? 'bg-[#18181b] border-white/10 hover:border-white/20'
                            : 'bg-white border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: getActivityColor(activity.type) + '20' }}
                          >
                            <Icon className="w-5 h-5" style={{ color: getActivityColor(activity.type) }} />
                          </div>

                          <div className="flex-1">
                            <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              <span className={darkMode ? 'text-white' : 'text-gray-900'}>
                                {activity.user}
                              </span>
                              {' '}{activity.action}{' '}
                              <span className={darkMode ? 'text-white' : 'text-gray-900'}>
                                {activity.target}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock className={`w-3 h-3 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`} />
                              <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                {activity.timestamp}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Load More */}
                <div className="mt-6 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    darkMode={darkMode}
                  >
                    Load More Activity
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
