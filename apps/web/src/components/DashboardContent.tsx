import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Plus, FileText, Sparkles, BarChart3 } from 'lucide-react';
import { QuickStatsBar } from './widgets/QuickStatsBar';
import { ActiveDealsWidget } from './widgets/ActiveDealsWidget';
import { ActivityFeed } from './widgets/ActivityFeed';
import { XPProgressWidget } from './widgets/XPProgressWidget';
import { AIInsightsWidget } from './widgets/AIInsightsWidget';
import { MiniLeaderboardWidget } from './widgets/MiniLeaderboardWidget';
import { RecentAchievementsWidget } from './widgets/RecentAchievementsWidget';
import { RecentDocumentsWidget } from './widgets/RecentDocumentsWidget';
import { UpcomingTasksWidget } from './widgets/UpcomingTasksWidget';
import { PerformanceMetricsWidget } from './widgets/PerformanceMetricsWidget';
import { QuickLinksWidget, QuickLink } from './widgets/QuickLinksWidget';
import type { PageView } from './Sidebar';
import { StreakTracker } from './ui/StreakTracker';
import { ChallengeCard } from './ui/ChallengeCard';
import { useAppSettings } from '../contexts/AppSettingsContext';
import { useUserRole } from '../contexts/UserRoleContext';
import { apiGetDeals } from '../lib/apiClient';

interface DashboardContentProps {
  darkMode: boolean;
  onNavigate?: (page: PageView) => void;
  onDealClick?: (dealId: string) => void;
  onNewDeal?: () => void;
}

export function DashboardContent({ darkMode, onNavigate, onDealClick, onNewDeal }: DashboardContentProps) {
  const { settings } = useAppSettings();
  const { isFounder, isInvestor } = useUserRole();
  const [activeDeals, setActiveDeals] = useState<any[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(true);

  // Fetch deals from API
  useEffect(() => {
    const loadDeals = async () => {
      try {
        const deals = await apiGetDeals();
        // Limit to first 4 deals for dashboard display, transform API data to match UI format
        const displayDeals = (deals || [])
          .slice(0, 4)
          .map((deal: any) => {
            const dealId = deal?.id ?? deal?.deal_id ?? deal?.dealId ?? deal?.dealID;
            const score = Number(deal?.score ?? deal?.overall_score ?? 0) || 0;
            const fundabilityV1 = deal?.fundability_v1 && typeof deal.fundability_v1 === 'object' ? deal.fundability_v1 : null;
            return {
              id: String(dealId ?? ''),
              name: deal?.name || 'Unknown Deal',
              company: (deal?.company ?? deal?.company_name ?? deal?.companyName ?? deal?.name) || 'Unknown Company',
              score,
              status: score >= 75 ? 'go' : score >= 50 ? 'hold' : 'no-go',
              stage: deal?.stage || 'intake',
              lastUpdated: 'Recently',
              trend: 'up' as const,

				// Additive: Analysis Foundation fundability summary (if present).
				fundability_v1: fundabilityV1,
            };
          })
          .filter((d: any) => typeof d.id === 'string' && d.id.length > 0);
        setActiveDeals(displayDeals);
      } catch (error) {
        console.error('Failed to load deals:', error);
        setActiveDeals([]);
      } finally {
        setLoadingDeals(false);
      }
    };

    if (isInvestor) {
      loadDeals();
    } else {
      // For founders, keep the placeholder data for now
      setActiveDeals([
        {
          id: '1',
          name: 'TechCorp Series A',
          company: 'TechCorp Inc.',
          score: 85,
          status: 'go' as const,
          stage: 'Pitch Ready',
          lastUpdated: '1h ago',
          trend: 'up' as const
        },
        {
          id: '2',
          name: 'StartupX Seed Round',
          company: 'StartupX',
          score: 68,
          status: 'hold' as const,
          stage: 'Refining Pitch',
          lastUpdated: '3h ago',
          trend: 'neutral' as const
        }
      ]);
      setLoadingDeals(false);
    }
  }, [isInvestor]);
  
  // Role-specific Quick Stats Data
  const quickStats = isFounder ? [
    { id: 'stat-my-companies', label: 'My Companies', value: 2, icon: 'deals' as const, trend: { value: 1, direction: 'up' as const } },
    { id: 'stat-pitch-materials', label: 'Pitch Materials', value: 8, icon: 'documents' as const },
    ...(settings.gamificationEnabled ? [
      { id: 'stat-level', label: 'Level', value: 12, icon: 'level' as const, highlight: true },
      { id: 'stat-weekly-xp', label: 'Weekly XP', value: '+850', icon: 'xp' as const, trend: { value: 24, direction: 'up' as const } },
      { id: 'stat-streak', label: 'Streak', value: '12d', icon: 'streak' as const, highlight: true },
    ] : []),
    { id: 'stat-fundraising', label: 'Fundraising', value: '$2.5M', icon: 'growth' as const, trend: { value: 15, direction: 'up' as const } }
  ] : [
    { id: 'stat-active-deals', label: 'Active Deals', value: 3, icon: 'deals' as const, trend: { value: 12, direction: 'up' as const } },
    { id: 'stat-documents', label: 'Documents', value: 12, icon: 'documents' as const },
    ...(settings.gamificationEnabled ? [
      { id: 'stat-level', label: 'Level', value: 12, icon: 'level' as const, highlight: true },
      { id: 'stat-weekly-xp', label: 'Weekly XP', value: '+850', icon: 'xp' as const, trend: { value: 24, direction: 'up' as const } },
      { id: 'stat-streak', label: 'Streak', value: '12d', icon: 'streak' as const, highlight: true },
    ] : []),
    { id: 'stat-portfolio', label: 'Portfolio', value: '+24%', icon: 'growth' as const, trend: { value: 24, direction: 'up' as const } }
  ];

  // Role-specific Activity Feed Data
  const activities = isFounder ? [
    {
      id: '1',
      type: 'achievement' as const,
      title: 'Achievement Unlocked!',
      description: 'You earned the "Pitch Master" badge',
      timestamp: '2 hours ago',
      icon: '🎯'
    },
    {
      id: '2',
      type: 'deal' as const,
      title: 'Pitch Deck Updated',
      description: 'TechCorp Series A pitch deck finalized',
      timestamp: '3 hours ago'
    },
    {
      id: '3',
      type: 'document' as const,
      title: 'Document Created',
      description: 'Financial Projections for StartupX',
      timestamp: '5 hours ago'
    },
    {
      id: '4',
      type: 'milestone' as const,
      title: 'Investor Meeting',
      description: 'Scheduled meeting with Sequoia Capital',
      timestamp: '1 day ago'
    },
    {
      id: '5',
      type: 'level' as const,
      title: 'Fundraising Progress',
      description: 'Reached 50% of seed target ($1.25M)',
      timestamp: '2 days ago'
    }
  ] : [
    {
      id: '1',
      type: 'achievement' as const,
      title: 'Achievement Unlocked!',
      description: 'You earned the "AI Master" badge',
      timestamp: '2 hours ago',
      icon: '🤖'
    },
    {
      id: '2',
      type: 'deal' as const,
      title: 'Deal Status Updated',
      description: 'CloudScale SaaS moved to GO status',
      timestamp: '3 hours ago'
    },
    {
      id: '3',
      type: 'document' as const,
      title: 'Document Created',
      description: 'Due Diligence Report for TechVision AI',
      timestamp: '5 hours ago'
    },
    {
      id: '4',
      type: 'rank' as const,
      title: 'Leaderboard Update',
      description: 'You moved up to rank #8 (+1)',
      timestamp: '1 day ago'
    },
    {
      id: '5',
      type: 'level' as const,
      title: 'Level Up!',
      description: 'You reached Level 12',
      timestamp: '2 days ago'
    },
    {
      id: '6',
      type: 'milestone' as const,
      title: 'Milestone Reached',
      description: 'Analyzed 50 deals total',
      timestamp: '3 days ago'
    }
  ];

  // XP Progress Data
  const xpData = {
    currentLevel: 12,
    currentXP: 2850,
    maxXP: 5000,
    weeklyXP: 850,
    weeklyData: [
      { day: 'Mon', xp: 120 },
      { day: 'Tue', xp: 180 },
      { day: 'Wed', xp: 95 },
      { day: 'Thu', xp: 210 },
      { day: 'Fri', xp: 165 },
      { day: 'Sat', xp: 80 },
      { day: 'Sun', xp: 0 }
    ]
  };

  // Role-specific AI Insights Data
  const aiInsights = isFounder ? [
    {
      id: '1',
      type: 'action' as const,
      title: 'Pitch deck needs refinement',
      description: 'StartupX pitch deck is missing key financial projections',
      action: 'Improve Now'
    },
    {
      id: '2',
      type: 'success' as const,
      title: 'TechCorp pitch is ready!',
      description: 'All sections complete and investor-ready',
      action: 'View Pitch'
    },
    {
      id: '3',
      type: 'info' as const,
      title: 'Optimal fundraising timing',
      description: 'Market conditions favorable for Series A in Q2',
      action: 'View Insights'
    },
    {
      id: '4',
      type: 'warning' as const,
      title: 'Investor outreach pending',
      description: '5 investor meetings need follow-up',
      action: 'Send Updates'
    }
  ] : [
    {
      id: '1',
      type: 'action' as const,
      title: '3 deals need your review',
      description: 'TechVision AI, FinTech Wallet, and HealthTech Platform are waiting for feedback',
      action: 'Review Now'
    },
    {
      id: '2',
      type: 'warning' as const,
      title: 'Document update recommended',
      description: 'TechVision AI due diligence is 2 weeks old',
      action: 'Update Document'
    },
    {
      id: '3',
      type: 'info' as const,
      title: 'Market trend detected',
      description: 'AI/ML sector showing 32% growth this quarter',
      action: 'View Analysis'
    },
    {
      id: '4',
      type: 'success' as const,
      title: 'Strong performer identified',
      description: 'CloudScale SaaS exceeds benchmarks in 4/5 categories',
      action: 'View Details'
    }
  ];

  // Leaderboard Data
  const leaderboardEntries = [
    { rank: 1, name: 'Michael Chang', xp: 8950 },
    { rank: 2, name: 'Emma Rodriguez', xp: 7420 },
    { rank: 3, name: 'James Wilson', xp: 6890 },
    { rank: 8, name: 'Sarah Chen', xp: 2850, isCurrentUser: true }
  ];

  // Recent Achievements Data
  const recentAchievements = [
    { id: 'achievement-ai-master', title: 'AI Master', icon: '🤖', tier: 'legendary' as const, unlockedAt: '2h ago' },
    { id: 'achievement-team-player', title: 'Team Player', icon: '🤝', tier: 'epic' as const, unlockedAt: '1d ago' },
    { id: 'achievement-deal-hunter', title: 'Deal Hunter', icon: '🔍', tier: 'rare' as const, unlockedAt: '3d ago' },
    { id: 'achievement-early-bird', title: 'Early Bird', icon: '🌅', tier: 'rare' as const, unlockedAt: '5d ago' }
  ];

  // Streaks Data
  const streaks = [
    { id: 'streak-daily-login', type: 'Daily Login', icon: '📅', current: 12, best: 45, target: 30 },
    { id: 'streak-deal-reviews', type: 'Deal Reviews', icon: '📊', current: 5, best: 14, target: 7 }
  ];

  // Today's Challenges Data
  const todaysChallenges = [
    {
      id: 'challenge-daily-review',
      title: 'Daily Deal Review',
      description: 'Review 3 deals today',
      progress: 2,
      maxProgress: 3,
      reward: { xp: 100, badge: '📊' },
      timeRemaining: '6h 24m',
      difficulty: 'easy' as const
    },
    {
      id: 'challenge-ai-collab',
      title: 'AI Collaboration',
      description: 'Use AI Studio 10 times this week',
      progress: 10,
      maxProgress: 10,
      reward: { xp: 500, badge: '🤖 AI Expert' },
      difficulty: 'hard' as const
    }
  ];

  // Role-specific Recent Documents Data
  const recentDocuments = isFounder ? [
    {
      id: '1',
      title: 'TechCorp Pitch Deck v3',
      type: 'Pitch Deck',
      lastModified: '2h ago',
      status: 'final' as const
    },
    {
      id: '2',
      title: 'Financial Projections Q1-Q4',
      type: 'Financial Model',
      lastModified: '5h ago',
      status: 'in-review' as const
    },
    {
      id: '3',
      title: 'StartupX Executive Summary',
      type: 'Executive Summary',
      lastModified: '1d ago',
      status: 'draft' as const
    }
  ] : [
    {
      id: '1',
      title: 'CloudScale Due Diligence',
      type: 'DD Report',
      lastModified: '2h ago',
      status: 'final' as const
    },
    {
      id: '2',
      title: 'TechVision Investment Memo',
      type: 'Investment Memo',
      lastModified: '5h ago',
      status: 'in-review' as const
    },
    {
      id: '3',
      title: 'FinTech Market Analysis',
      type: 'Market Research',
      lastModified: '1d ago',
      status: 'draft' as const
    }
  ];

  // Role-specific Upcoming Tasks Data
  const upcomingTasks = isFounder ? [
    {
      id: '1',
      title: 'Finalize pitch deck for Sequoia meeting',
      dueDate: 'Today, 4:00 PM',
      priority: 'high' as const,
      category: 'Pitch'
    },
    {
      id: '2',
      title: 'Update financial projections',
      dueDate: 'Tomorrow',
      priority: 'high' as const,
      category: 'Finance'
    },
    {
      id: '3',
      title: 'Send follow-up to Andreessen Horowitz',
      dueDate: 'Dec 12',
      priority: 'medium' as const,
      category: 'Outreach'
    },
    {
      id: '4',
      title: 'Review cap table with legal team',
      dueDate: 'Dec 15',
      priority: 'low' as const,
      category: 'Legal',
      completed: true
    }
  ] : [
    {
      id: '1',
      title: 'Complete CloudScale due diligence',
      dueDate: 'Today, 5:00 PM',
      priority: 'high' as const,
      category: 'DD'
    },
    {
      id: '2',
      title: 'Review TechVision financials',
      dueDate: 'Tomorrow',
      priority: 'high' as const,
      category: 'Analysis'
    },
    {
      id: '3',
      title: 'Partner meeting: Q4 pipeline review',
      dueDate: 'Dec 12',
      priority: 'medium' as const,
      category: 'Meeting'
    },
    {
      id: '4',
      title: 'Update portfolio dashboard',
      dueDate: 'Dec 15',
      priority: 'low' as const,
      category: 'Admin',
      completed: true
    }
  ];

  // Role-specific Performance Metrics Data
  const performanceMetrics = isFounder ? [
    {
      id: 'metric-target-raised',
      label: 'Target Raised',
      value: '$2.5M',
      change: 15,
      trend: 'up' as const,
      icon: 'dollar' as const
    },
    {
      id: 'metric-target-goal',
      label: 'Target Goal',
      value: '$5M',
      icon: 'target' as const
    },
    {
      id: 'metric-investor-meetings',
      label: 'Investor Meetings',
      value: '12',
      change: 20,
      trend: 'up' as const,
      icon: 'users' as const
    },
    {
      id: 'metric-days-active',
      label: 'Days Active',
      value: '45',
      icon: 'calendar' as const
    }
  ] : [
    {
      id: 'metric-portfolio-value',
      label: 'Portfolio Value',
      value: '$24.5M',
      change: 18,
      trend: 'up' as const,
      icon: 'dollar' as const
    },
    {
      id: 'metric-target-irr',
      label: 'Target IRR',
      value: '32%',
      change: 5,
      trend: 'up' as const,
      icon: 'target' as const
    },
    {
      id: 'metric-active-deals',
      label: 'Active Deals',
      value: '8',
      change: 12,
      trend: 'up' as const,
      icon: 'users' as const
    },
    {
      id: 'metric-avg-deal-time',
      label: 'Avg Deal Time',
      value: '28d',
      change: -10,
      trend: 'down' as const,
      icon: 'calendar' as const
    }
  ];

  // Role-specific Quick Links Data
  const quickLinks: QuickLink[] = isFounder ? [
    {
      id: '1',
      title: 'Create Pitch Deck',
      description: 'Build investor-ready presentation',
      icon: 'document' as const,
      action: 'documents'
    },
    {
      id: '2',
      title: 'Investor CRM',
      description: 'Track outreach & meetings',
      icon: 'users' as const,
      action: 'team'
    },
    {
      id: '3',
      title: 'Financial Model',
      description: 'Build projections with AI',
      icon: 'ai' as const,
      action: 'aiStudio'
    },
    {
      id: '4',
      title: 'Fundraising Analytics',
      description: 'Track progress & metrics',
      icon: 'analytics' as const,
      action: 'analytics'
    }
  ] : [
    {
      id: '1',
      title: 'Due Diligence Report',
      description: 'Generate AI-powered DD',
      icon: 'document' as const,
      action: 'documents'
    },
    {
      id: '2',
      title: 'Investment Team',
      description: 'Collaborate with partners',
      icon: 'team' as const,
      action: 'team'
    },
    {
      id: '3',
      title: 'AI Analysis',
      description: 'Deep dive with AI Studio',
      icon: 'ai' as const,
      action: 'aiStudio'
    },
    {
      id: '4',
      title: 'Portfolio Dashboard',
      description: 'View performance metrics',
      icon: 'analytics' as const,
      action: 'analytics'
    }
  ];

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className={`text-xl md:text-2xl mb-1 bg-gradient-to-r bg-clip-text text-transparent ${
            darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
          }`}>
            Welcome back, Sarah! 👋
          </h1>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {isFounder 
              ? "Here's your fundraising progress and pitch status" 
              : "Here's what's happening with your deals today"
            }
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            className="gap-2 text-sm"
            onClick={() => onNavigate?.('documents')}
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">{isFounder ? 'Pitch Materials' : 'Documents'}</span>
          </Button>
          <Button 
            variant="outline"
            className="gap-2 text-sm"
            onClick={() => onNavigate?.('analytics')}
          >
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">Analytics</span>
          </Button>
          <Button 
            className="gap-2 text-sm"
            onClick={onNewDeal}
          >
            <Plus className="w-4 h-4" />
            {isFounder ? 'New Company' : 'New Deal'}
          </Button>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <QuickStatsBar darkMode={darkMode} stats={quickStats} />

      {/* Main Grid - 3 Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* Quick Links */}
          <QuickLinksWidget 
            darkMode={darkMode}
            links={quickLinks}
            onLinkClick={(linkId) => {
              const link = quickLinks.find(l => l.id === linkId);
              if (link) onNavigate?.(link.action as PageView);
            }}
            title="Quick Actions"
          />

          {/* Active Deals */}
          <ActiveDealsWidget 
            darkMode={darkMode} 
            deals={activeDeals.slice(0, 4)} 
            onDealClick={onDealClick}
          />

          {/* Today's Challenges - Only show if gamification enabled */}
          {settings.gamificationEnabled && (
            <div className={`p-5 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Today's Challenges
                </h3>
                <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {todaysChallenges.filter(c => c.progress < c.maxProgress).length} active
                </span>
              </div>
              <div className="space-y-3">
                {todaysChallenges.map((challenge) => (
                  <ChallengeCard key={challenge.id} challenge={challenge} darkMode={darkMode} />
                ))}
              </div>
            </div>
          )}

          {/* Mini Streaks - Only show if gamification enabled */}
          {settings.gamificationEnabled && (
            <div className={`p-5 rounded-lg backdrop-blur-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <h3 className={`text-base mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Active Streaks 🔥
              </h3>
              <div className="space-y-3">
                {streaks.map((streak) => {
                  const percentage = (streak.current / streak.target) * 100;
                  const isOnFire = streak.current >= 7;
                  
                  return (
                    <div key={streak.id}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{streak.icon}</span>
                          <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {streak.type}
                          </span>
                        </div>
                        <div className={`text-lg ${
                          isOnFire 
                            ? 'bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent'
                            : darkMode ? 'text-white' : 'text-gray-900'
                        }`}>
                          {streak.current}d
                        </div>
                      </div>
                      <div className={`h-2 rounded-full overflow-hidden ${
                        darkMode ? 'bg-white/10' : 'bg-gray-200'
                      }`}>
                        <div
                          className={`h-full transition-all duration-500 ${
                            isOnFire
                              ? 'bg-gradient-to-r from-orange-500 to-red-600'
                              : 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                          }`}
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* MIDDLE COLUMN */}
        <div className="space-y-6">
          {/* Activity Feed */}
          <ActivityFeed 
            darkMode={darkMode} 
            activities={settings.gamificationEnabled ? activities : activities.filter(a => 
              a.type !== 'achievement' && a.type !== 'rank' && a.type !== 'level' && a.type !== 'milestone'
            )}
            onActivityClick={(activityId, type) => {
              // Navigate based on activity type
              if (type === 'achievement') onNavigate?.('gamification');
              if (type === 'deal' && activeDeals?.[0]?.id) onDealClick?.(activeDeals[0].id);
              if (type === 'document') onNavigate?.('documents');
              if (type === 'rank' || type === 'level') onNavigate?.('gamification');
            }}
          />

          {/* AI Insights */}
          <AIInsightsWidget 
            darkMode={darkMode} 
            insights={aiInsights}
            onActionClick={(insightId) => {
              // Map insight actions to pages
              const insight = aiInsights.find(i => i.id === insightId);
              if (insight?.id === '1') onNavigate?.('dealsList'); // Review deals
              if (insight?.id === '2') onNavigate?.('documents'); // Update document
              if (insight?.id === '3') onNavigate?.('analytics'); // View analysis
              if (insight?.id === '4' && activeDeals?.[0]?.id) onDealClick?.(activeDeals[0].id);
            }}
          />
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Recent Documents */}
          <RecentDocumentsWidget 
            darkMode={darkMode}
            documents={recentDocuments}
            onDocumentClick={(docId) => onNavigate?.('documents')}
            onViewAll={() => onNavigate?.('documents')}
            title={isFounder ? 'Recent Pitch Materials' : 'Recent Documents'}
          />

          {/* Upcoming Tasks */}
          <UpcomingTasksWidget 
            darkMode={darkMode}
            tasks={upcomingTasks}
            onTaskClick={(taskId) => console.log('Task clicked:', taskId)}
            title="Upcoming Tasks"
          />

          {/* Performance Metrics */}
          <PerformanceMetricsWidget 
            darkMode={darkMode}
            metrics={performanceMetrics}
            title={isFounder ? 'Fundraising Metrics' : 'Portfolio Metrics'}
          />

          {/* XP Progress - Only show if gamification enabled */}
          {settings.gamificationEnabled && (
            <XPProgressWidget darkMode={darkMode} {...xpData} />
          )}

          {/* Mini Leaderboard - Only show if gamification enabled */}
          {settings.gamificationEnabled && (
            <MiniLeaderboardWidget 
              darkMode={darkMode} 
              entries={leaderboardEntries}
              onViewFull={() => onNavigate?.('gamification')}
            />
          )}

          {/* Recent Achievements - Only show if gamification enabled */}
          {settings.gamificationEnabled && (
            <RecentAchievementsWidget 
              darkMode={darkMode} 
              achievements={recentAchievements}
              onViewAll={() => onNavigate?.('gamification')}
            />
          )}
        </div>
      </div>

      {/* Quick Action Bar - Bottom Sticky */}
      {/* Removed - Replaced with global chat assistant */}
    </div>
  );
}