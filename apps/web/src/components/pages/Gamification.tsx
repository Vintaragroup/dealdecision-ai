import { useState } from 'react';
import { Button } from '../ui/button';
import { AchievementBadge } from '../ui/AchievementBadge';
import { StreakTracker } from '../ui/StreakTracker';
import { ChallengeCard } from '../ui/ChallengeCard';
import { Leaderboard } from '../ui/Leaderboard';
import { SkillTree } from '../ui/SkillTree';
import {
  ArrowLeft,
  Trophy,
  TrendingUp,
  FileText,
  Brain,
  Users,
  Target,
  Zap,
  Award,
  Calendar,
  BarChart3
} from 'lucide-react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface GamificationProps {
  darkMode: boolean;
  onBack?: () => void;
}

export function Gamification({ darkMode, onBack }: GamificationProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'achievements' | 'challenges' | 'leaderboard' | 'skills'>('overview');

  // User Stats
  const userStats = {
    name: 'Sarah Chen',
    level: 12,
    currentXP: 2850,
    maxXP: 5000,
    title: 'Investment Sage',
    rank: 8,
    weeklyXP: 850,
    totalDeals: 47,
    dealsCompleted: 23,
    documentsCreated: 156,
    aiInteractions: 892,
    collaborationScore: 85,
    hoursSaved: 124
  };

  // XP Progress Data
  const xpProgressData = [
    { day: 'Mon', xp: 120 },
    { day: 'Tue', xp: 180 },
    { day: 'Wed', xp: 95 },
    { day: 'Thu', xp: 210 },
    { day: 'Fri', xp: 165 },
    { day: 'Sat', xp: 80 },
    { day: 'Sun', xp: 0 }
  ];

  // Achievements Data
  const achievements = [
    {
      title: 'First Deal',
      description: 'Complete your first deal analysis',
      icon: '🎯',
      tier: 'common' as const,
      unlocked: true
    },
    {
      title: 'Deal Hunter',
      description: 'Analyze 10 different deals',
      icon: '🔍',
      tier: 'rare' as const,
      unlocked: true
    },
    {
      title: 'Investment Pro',
      description: 'Make 25 investment decisions',
      icon: '💼',
      tier: 'epic' as const,
      unlocked: true
    },
    {
      title: 'AI Master',
      description: 'Use AI features 500 times',
      icon: '🤖',
      tier: 'legendary' as const,
      unlocked: true
    },
    {
      title: 'Document Creator',
      description: 'Create 50 documents',
      icon: '📄',
      tier: 'rare' as const,
      unlocked: true
    },
    {
      title: 'Team Player',
      description: 'Collaborate on 20 deals',
      icon: '🤝',
      tier: 'epic' as const,
      unlocked: true
    },
    {
      title: 'Speed Demon',
      description: 'Complete 5 deals in one day',
      icon: '⚡',
      tier: 'epic' as const,
      unlocked: false,
      progress: 3,
      maxProgress: 5
    },
    {
      title: 'Perfect Score',
      description: 'Get a 100/100 DD score',
      icon: '💯',
      tier: 'legendary' as const,
      unlocked: false,
      progress: 1,
      maxProgress: 1
    },
    {
      title: 'Early Bird',
      description: 'Login 7 days in a row',
      icon: '🌅',
      tier: 'rare' as const,
      unlocked: true
    },
    {
      title: 'Night Owl',
      description: 'Work after midnight',
      icon: '🦉',
      tier: 'common' as const,
      unlocked: true
    },
    {
      title: 'Marathon',
      description: 'Use app for 24 hours total',
      icon: '🏃',
      tier: 'epic' as const,
      unlocked: false,
      progress: 18,
      maxProgress: 24
    },
    {
      title: 'Unicorn Hunter',
      description: 'Identify a unicorn startup',
      icon: '🦄',
      tier: 'legendary' as const,
      unlocked: false,
      progress: 0,
      maxProgress: 1
    }
  ];

  // Challenges Data
  const challenges = [
    {
      title: 'Daily Deal Review',
      description: 'Review 3 deals today',
      progress: 2,
      maxProgress: 3,
      reward: { xp: 100, badge: '📊' },
      timeRemaining: '6h 24m',
      difficulty: 'easy' as const
    },
    {
      title: 'Document Sprint',
      description: 'Create 5 documents this week',
      progress: 3,
      maxProgress: 5,
      reward: { xp: 250, badge: '📝 Writer Badge' },
      timeRemaining: '2d 14h',
      difficulty: 'medium' as const
    },
    {
      title: 'AI Collaboration',
      description: 'Use AI Studio 10 times this week',
      progress: 10,
      maxProgress: 10,
      reward: { xp: 500, badge: '🤖 AI Expert' },
      difficulty: 'hard' as const
    },
    {
      title: 'Investment Decision',
      description: 'Complete due diligence on 3 deals',
      progress: 1,
      maxProgress: 3,
      reward: { xp: 300 },
      timeRemaining: '5d 8h',
      difficulty: 'medium' as const
    },
    {
      title: 'Social Butterfly',
      description: 'Share 2 deals with team members',
      progress: 0,
      maxProgress: 2,
      reward: { xp: 150, badge: '🦋' },
      timeRemaining: '3d 12h',
      difficulty: 'easy' as const
    },
    {
      title: 'Comparison Master',
      description: 'Use Deal Comparison 5 times',
      progress: 2,
      maxProgress: 5,
      reward: { xp: 400, badge: '⚖️ Analyst Badge' },
      timeRemaining: '4d 2h',
      difficulty: 'hard' as const
    }
  ];

  // Streaks Data
  const streaks = [
    { type: 'Daily Login', icon: '📅', current: 12, best: 45, target: 30 },
    { type: 'Deal Reviews', icon: '📊', current: 5, best: 14, target: 7 },
    { type: 'AI Usage', icon: '🤖', current: 8, best: 21, target: 14 },
    { type: 'Document Creation', icon: '📝', current: 3, best: 9, target: 7 }
  ];

  // Leaderboard Data
  const leaderboardEntries = [
    { rank: 1, name: 'Michael Chang', level: 18, xp: 8950, change: 0 },
    { rank: 2, name: 'Emma Rodriguez', level: 16, xp: 7420, change: 2 },
    { rank: 3, name: 'James Wilson', level: 15, xp: 6890, change: -1 },
    { rank: 4, name: 'Sophia Lee', level: 14, xp: 5670, change: 1 },
    { rank: 5, name: 'David Kim', level: 14, xp: 5120, change: -2 },
    { rank: 6, name: 'Olivia Taylor', level: 13, xp: 4850, change: 0 },
    { rank: 7, name: 'Ryan Martinez', level: 13, xp: 4320, change: 3 },
    { rank: 8, name: 'Sarah Chen', level: 12, xp: 2850, change: 1, isCurrentUser: true },
    { rank: 9, name: 'Alex Johnson', level: 12, xp: 2640, change: -1 },
    { rank: 10, name: 'Emily Brown', level: 11, xp: 2180, change: 0 }
  ];

  // Skill Trees Data
  const skillPaths = [
    {
      name: 'Market Analysis',
      color: 'from-blue-500 to-blue-700',
      icon: '📈',
      skills: [
        {
          id: 'ma1',
          name: 'Market Sizing',
          description: 'Unlock advanced TAM/SAM/SOM analysis',
          level: 3,
          maxLevel: 3,
          unlocked: true,
          perk: '+10% accuracy on market projections'
        },
        {
          id: 'ma2',
          name: 'Competitive Analysis',
          description: 'Deep dive into competitive landscapes',
          level: 2,
          maxLevel: 3,
          unlocked: true,
          prerequisites: ['Market Sizing'],
          perk: 'Unlock competitor matrix tool'
        },
        {
          id: 'ma3',
          name: 'Trend Forecasting',
          description: 'Predict market trends with AI',
          level: 1,
          maxLevel: 3,
          unlocked: true,
          prerequisites: ['Competitive Analysis']
        },
        {
          id: 'ma4',
          name: 'Market Expert',
          description: 'Master-level market analysis',
          level: 0,
          maxLevel: 1,
          unlocked: false,
          prerequisites: ['Trend Forecasting']
        }
      ]
    },
    {
      name: 'Due Diligence',
      color: 'from-purple-500 to-purple-700',
      icon: '🔍',
      skills: [
        {
          id: 'dd1',
          name: 'Financial Review',
          description: 'Analyze financial statements',
          level: 3,
          maxLevel: 3,
          unlocked: true,
          perk: 'Unlock advanced financial metrics'
        },
        {
          id: 'dd2',
          name: 'Risk Assessment',
          description: 'Identify and evaluate risks',
          level: 2,
          maxLevel: 3,
          unlocked: true,
          prerequisites: ['Financial Review'],
          perk: '+15% risk detection accuracy'
        },
        {
          id: 'dd3',
          name: 'Team Evaluation',
          description: 'Assess founder and team strength',
          level: 1,
          maxLevel: 3,
          unlocked: true,
          prerequisites: ['Risk Assessment']
        },
        {
          id: 'dd4',
          name: 'DD Master',
          description: 'Complete due diligence expert',
          level: 0,
          maxLevel: 1,
          unlocked: false,
          prerequisites: ['Team Evaluation']
        }
      ]
    },
    {
      name: 'AI Mastery',
      color: 'from-green-500 to-green-700',
      icon: '🤖',
      skills: [
        {
          id: 'ai1',
          name: 'Prompt Engineering',
          description: 'Craft better AI prompts',
          level: 3,
          maxLevel: 3,
          unlocked: true,
          perk: 'AI responses 25% faster'
        },
        {
          id: 'ai2',
          name: 'Document Generation',
          description: 'Generate high-quality documents',
          level: 3,
          maxLevel: 3,
          unlocked: true,
          prerequisites: ['Prompt Engineering'],
          perk: 'Unlock premium templates'
        },
        {
          id: 'ai3',
          name: 'AI Collaboration',
          description: 'Work seamlessly with AI',
          level: 2,
          maxLevel: 3,
          unlocked: true,
          prerequisites: ['Document Generation'],
          perk: 'Unlock multi-document analysis'
        },
        {
          id: 'ai4',
          name: 'AI Sage',
          description: 'Master AI integration',
          level: 0,
          maxLevel: 1,
          unlocked: false,
          prerequisites: ['AI Collaboration']
        }
      ]
    }
  ];

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Fixed Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${
        darkMode ? 'bg-[#0f0f0f]/95 border-white/5' : 'bg-white/95 border-gray-200/50'
      }`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {onBack && (
                <button
                  onClick={onBack}
                  className={`p-2 rounded-lg transition-colors ${
                    darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
                  }`}
                >
                  <ArrowLeft className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                </button>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                    <Trophy className="w-4 h-4 text-white" />
                  </div>
                  <h1 className={`text-lg bg-gradient-to-r bg-clip-text text-transparent ${
                    darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                  }`}>
                    Achievements & Progress
                  </h1>
                </div>
                <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Track your journey to becoming an investment expert
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className={`flex items-center gap-1 p-1 rounded-lg ${
              darkMode ? 'bg-white/5' : 'bg-gray-100'
            }`}>
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-2 rounded text-xs transition-colors ${
                  activeTab === 'overview'
                    ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                    : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab('achievements')}
                className={`px-4 py-2 rounded text-xs transition-colors ${
                  activeTab === 'achievements'
                    ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                    : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Achievements
              </button>
              <button
                onClick={() => setActiveTab('challenges')}
                className={`px-4 py-2 rounded text-xs transition-colors ${
                  activeTab === 'challenges'
                    ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                    : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Challenges
              </button>
              <button
                onClick={() => setActiveTab('leaderboard')}
                className={`px-4 py-2 rounded text-xs transition-colors ${
                  activeTab === 'leaderboard'
                    ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                    : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Leaderboard
              </button>
              <button
                onClick={() => setActiveTab('skills')}
                className={`px-4 py-2 rounded text-xs transition-colors ${
                  activeTab === 'skills'
                    ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                    : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Skills
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Hero Profile Card */}
            <div className={`p-8 rounded-lg backdrop-blur-xl border bg-gradient-to-br ${
              darkMode 
                ? 'from-[#6366f1]/10 via-[#8b5cf6]/5 to-transparent border-white/10'
                : 'from-[#6366f1]/5 via-[#8b5cf6]/5 to-transparent border-gray-200'
            } relative overflow-hidden`}>
              {/* Background Glow */}
              <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20 rounded-full blur-3xl"></div>
              
              <div className="relative grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Profile Info */}
                <div className="flex flex-col items-center text-center">
                  <div className="relative mb-4">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center text-3xl text-white border-4 border-white/20 shadow-[0_0_30px_rgba(99,102,241,0.4)]">
                      SC
                    </div>
                    <div className="absolute -bottom-2 -right-2 px-3 py-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full text-white text-xs shadow-lg">
                      Lvl {userStats.level}
                    </div>
                  </div>
                  <h2 className={`text-xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {userStats.name}
                  </h2>
                  <div className="px-3 py-1 bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/20 border border-[#6366f1]/30 rounded-full text-sm text-[#6366f1] mb-4">
                    {userStats.title}
                  </div>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Rank #{userStats.rank} • Top 5%
                  </p>
                </div>

                {/* XP Progress */}
                <div className="flex flex-col justify-center">
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                        Level {userStats.level} Progress
                      </span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>
                        {userStats.currentXP}/{userStats.maxXP} XP
                      </span>
                    </div>
                    <div className={`h-3 rounded-full overflow-hidden ${
                      darkMode ? 'bg-white/10' : 'bg-gray-200'
                    }`}>
                      <div
                        className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] shadow-[0_0_12px_rgba(99,102,241,0.4)] transition-all duration-500"
                        style={{ width: `${(userStats.currentXP / userStats.maxXP) * 100}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Weekly XP Chart */}
                  <div className="mt-4">
                    <p className={`text-xs mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      Weekly XP: +{userStats.weeklyXP} ⚡
                    </p>
                    <ResponsiveContainer width="100%" height={60}>
                      <AreaChart data={xpProgressData}>
                        <defs>
                          <linearGradient id="xpGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area
                          type="monotone"
                          dataKey="xp"
                          stroke="#6366f1"
                          strokeWidth={2}
                          fill="url(#xpGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className={`p-3 rounded-lg backdrop-blur-xl ${
                    darkMode ? 'bg-white/5' : 'bg-white/50'
                  }`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      Deals Analyzed
                    </div>
                    <div className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {userStats.totalDeals}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg backdrop-blur-xl ${
                    darkMode ? 'bg-white/5' : 'bg-white/50'
                  }`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      Documents
                    </div>
                    <div className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {userStats.documentsCreated}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg backdrop-blur-xl ${
                    darkMode ? 'bg-white/5' : 'bg-white/50'
                  }`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      AI Interactions
                    </div>
                    <div className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {userStats.aiInteractions}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg backdrop-blur-xl ${
                    darkMode ? 'bg-white/5' : 'bg-white/50'
                  }`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      Hours Saved
                    </div>
                    <div className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {userStats.hoursSaved}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Streaks & Active Challenges */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <StreakTracker streaks={streaks} darkMode={darkMode} />
              
              <div className={`p-6 rounded-lg backdrop-blur-xl border ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
              }`}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                    <Target className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
                      darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                    }`}>
                      Active Challenges
                    </h2>
                    <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {challenges.filter(c => c.progress < c.maxProgress).length} in progress
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {challenges.slice(0, 3).map((challenge, index) => (
                    <ChallengeCard key={index} challenge={challenge} darkMode={darkMode} />
                  ))}
                </div>

                <Button className="w-full mt-4" variant="outline">
                  View All Challenges
                </Button>
              </div>
            </div>

            {/* Recent Achievements */}
            <div className={`p-6 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                    <Award className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
                      darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                    }`}>
                      Recent Achievements
                    </h2>
                    <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {achievements.filter(a => a.unlocked).length} unlocked
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => setActiveTab('achievements')}>
                  View All
                </Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                {achievements.filter(a => a.unlocked).slice(0, 6).map((achievement, index) => (
                  <AchievementBadge
                    key={index}
                    {...achievement}
                    darkMode={darkMode}
                    size="sm"
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Achievements Tab */}
        {activeTab === 'achievements' && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
              {achievements.map((achievement, index) => (
                <AchievementBadge key={index} {...achievement} darkMode={darkMode} />
              ))}
            </div>
          </div>
        )}

        {/* Challenges Tab */}
        {activeTab === 'challenges' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {challenges.map((challenge, index) => (
              <ChallengeCard key={index} challenge={challenge} darkMode={darkMode} />
            ))}
          </div>
        )}

        {/* Leaderboard Tab */}
        {activeTab === 'leaderboard' && (
          <div className="max-w-3xl mx-auto">
            <Leaderboard entries={leaderboardEntries} darkMode={darkMode} period="weekly" />
          </div>
        )}

        {/* Skills Tab */}
        {activeTab === 'skills' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {skillPaths.map((path, index) => (
              <SkillTree key={index} path={path} darkMode={darkMode} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
