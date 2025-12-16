import { Bell, Activity, Users, DollarSign, TrendingUp, Sparkles, FileText, Trophy, MessageSquare, Target, CheckCheck, X, Eye, ChevronRight } from 'lucide-react';
import type { NotificationPreferences } from './pages/Settings';
import { useAppSettings } from '../contexts/AppSettingsContext';

interface Notification {
  id: string;
  type: 'roi' | 'deal' | 'ai' | 'team' | 'achievement' | 'document';
  icon: any;
  iconColor: string;
  title: string;
  description?: string;
  time: string;
  unread: boolean;
  actionLabel?: string;
}

interface RightSidebarProps {
  isOpen: boolean;
  darkMode: boolean;
  notificationPreferences: NotificationPreferences;
  onMarkAsRead?: (id: string) => void;
  onMarkAllAsRead?: () => void;
  onClearNotification?: (id: string) => void;
}

export function RightSidebar({ 
  isOpen, 
  darkMode, 
  notificationPreferences,
  onMarkAsRead,
  onMarkAllAsRead,
  onClearNotification 
}: RightSidebarProps) {
  const { settings } = useAppSettings();
  
  // All possible notifications
  const allNotifications: Notification[] = [
    // ROI & Savings
    {
      id: '1',
      type: 'roi',
      icon: DollarSign,
      iconColor: 'from-emerald-500 to-emerald-600',
      title: 'Milestone Reached!',
      description: 'You just crossed $100K in total savings',
      time: 'Just now',
      unread: true,
      actionLabel: 'View ROI'
    },
    {
      id: '2',
      type: 'roi',
      icon: TrendingUp,
      iconColor: 'from-emerald-500 to-emerald-600',
      title: 'Weekly ROI Summary',
      description: 'This week you saved $12K and 48 hours',
      time: '5 minutes ago',
      unread: true,
      actionLabel: 'See Details'
    },
    // Deal Updates
    {
      id: '3',
      type: 'deal',
      icon: Target,
      iconColor: 'from-[#6366f1] to-[#8b5cf6]',
      title: 'Deal Score Improved',
      description: 'TechVision AI jumped from 82 to 89',
      time: '12 minutes ago',
      unread: false,
      actionLabel: 'View Deal'
    },
    {
      id: '4',
      type: 'deal',
      icon: FileText,
      iconColor: 'from-[#6366f1] to-[#8b5cf6]',
      title: 'Deal Status Changed',
      description: 'CloudScale moved to "Under Review"',
      time: 'Today, 11:59 AM',
      unread: false
    },
    // AI Analysis
    {
      id: '5',
      type: 'ai',
      icon: Sparkles,
      iconColor: 'from-purple-500 to-purple-600',
      title: 'AI Analysis Complete',
      description: 'Due diligence report is ready',
      time: '2 hours ago',
      unread: false,
      actionLabel: 'View Report'
    },
    {
      id: '6',
      type: 'ai',
      icon: Sparkles,
      iconColor: 'from-purple-500 to-purple-600',
      title: 'Document Generated',
      description: 'Executive summary ready for review',
      time: 'Today, 9:30 AM',
      unread: false
    },
    // Team & Collaboration
    {
      id: '7',
      type: 'team',
      icon: MessageSquare,
      iconColor: 'from-cyan-500 to-cyan-600',
      title: 'Sarah Chen mentioned you',
      description: 'In TechVision AI deal comments',
      time: 'Today, 8:15 AM',
      unread: false,
      actionLabel: 'Reply'
    },
    {
      id: '8',
      type: 'team',
      icon: Users,
      iconColor: 'from-cyan-500 to-cyan-600',
      title: 'New team member joined',
      description: 'Michael Torres joined your workspace',
      time: 'Yesterday, 4:22 PM',
      unread: false
    },
    // Achievements
    {
      id: '9',
      type: 'achievement',
      icon: Trophy,
      iconColor: 'from-amber-500 to-amber-600',
      title: 'Achievement Unlocked!',
      description: '"Efficiency Master" - 400+ hours saved',
      time: 'Yesterday, 2:10 PM',
      unread: false,
      actionLabel: 'View Badge'
    },
    // Documents
    {
      id: '10',
      type: 'document',
      icon: FileText,
      iconColor: 'from-rose-500 to-rose-600',
      title: 'Document Review Request',
      description: 'Pitch deck needs your approval',
      time: '2 days ago',
      unread: false,
      actionLabel: 'Review'
    }
  ];

  // Filter notifications based on preferences AND gamification setting
  const filteredNotifications = allNotifications.filter(notif => {
    // If gamification is disabled, hide achievement notifications
    if (!settings.gamificationEnabled && notif.type === 'achievement') {
      return false;
    }
    
    switch (notif.type) {
      case 'roi':
        return notificationPreferences.roiSavings.enabled;
      case 'deal':
        return notificationPreferences.dealUpdates.enabled;
      case 'ai':
        return notificationPreferences.aiAnalysis.enabled;
      case 'team':
        return notificationPreferences.teamCollaboration.enabled;
      case 'achievement':
        return notificationPreferences.achievements.enabled;
      case 'document':
        return notificationPreferences.documents.enabled;
      default:
        return true;
    }
  });

  // Group notifications by time
  const today: Notification[] = [];
  const yesterday: Notification[] = [];
  const thisWeek: Notification[] = [];

  filteredNotifications.forEach(notif => {
    if (notif.time.includes('now') || notif.time.includes('minute') || notif.time.includes('hour') || notif.time.includes('Today')) {
      today.push(notif);
    } else if (notif.time.includes('Yesterday')) {
      yesterday.push(notif);
    } else {
      thisWeek.push(notif);
    }
  });

  const unreadCount = filteredNotifications.filter(n => n.unread).length;

  const allActivities = [
    {
      icon: Target,
      title: 'Updated pitch deck score',
      deal: 'TechVision AI',
      time: 'Just now',
      color: 'from-emerald-500 to-emerald-600',
      isGamification: false
    },
    {
      icon: FileText,
      title: 'Generated DD report',
      deal: 'CloudScale',
      time: '58 seconds ago',
      color: 'from-[#6366f1] to-[#8b5cf6]',
      isGamification: false
    },
    {
      icon: Sparkles,
      title: 'AI analysis completed',
      deal: 'DataFlow Pro',
      time: '12 minutes ago',
      color: 'from-purple-500 to-purple-600',
      isGamification: false
    },
    {
      icon: Trophy,
      title: 'Milestone reached',
      deal: 'FinTech Innovations',
      time: 'Today, 11:59 AM',
      color: 'from-amber-500 to-amber-600',
      isGamification: true
    }
  ];

  // Filter activities based on gamification setting
  const activities = settings.gamificationEnabled 
    ? allActivities 
    : allActivities.filter(a => !a.isGamification);

  const contacts = [
    { name: 'Sarah Chen', role: 'Lead Investor', online: true, color: 'from-[#6366f1] to-[#8b5cf6]' },
    { name: 'Michael Torres', role: 'Co-Founder', online: true, color: 'from-rose-500 to-rose-600' },
    { name: 'Emma Wilson', role: 'Analyst', online: false, color: 'from-amber-500 to-amber-600' },
    { name: 'James Rodriguez', role: 'Advisor', online: true, color: 'from-emerald-500 to-emerald-600' },
    { name: 'Lisa Anderson', role: 'Partner', online: false, color: 'from-purple-500 to-purple-600' },
    { name: 'David Park', role: 'Investor', online: false, color: 'from-cyan-500 to-cyan-600' }
  ];

  const NotificationItem = ({ notification }: { notification: Notification }) => {
    const Icon = notification.icon;
    
    return (
      <div className={`group relative flex items-start gap-3 backdrop-blur-xl rounded-lg p-3 -mx-2 cursor-pointer transition-all border ${
        darkMode
          ? 'hover:bg-white/5 border-transparent hover:border-white/10'
          : 'hover:bg-gray-100/50 border-transparent hover:border-gray-200/50'
      }`}>
        {/* Unread indicator */}
        {notification.unread && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-12 bg-gradient-to-b from-[#6366f1] to-[#8b5cf6] rounded-r shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
        )}
        
        {/* Icon */}
        <div className={`w-9 h-9 bg-gradient-to-br ${notification.iconColor} rounded-lg flex items-center justify-center text-white shrink-0 shadow-lg`}>
          <Icon className="w-4 h-4" />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className={`text-sm truncate ${
              notification.unread 
                ? darkMode ? 'text-white' : 'text-gray-900' 
                : darkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {notification.title}
            </p>
            
            {/* Quick actions on hover */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {notification.unread && onMarkAsRead && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkAsRead(notification.id);
                  }}
                  className={`p-1 rounded hover:bg-white/10 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                  title="Mark as read"
                >
                  <CheckCheck className="w-3 h-3" />
                </button>
              )}
              {onClearNotification && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearNotification(notification.id);
                  }}
                  className={`p-1 rounded hover:bg-white/10 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                  title="Clear"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          
          {notification.description && (
            <p className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              {notification.description}
            </p>
          )}
          
          <div className="flex items-center justify-between">
            <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
              {notification.time}
            </p>
            {notification.actionLabel && (
              <button className={`text-xs px-2 py-0.5 rounded transition-colors ${
                darkMode
                  ? 'text-[#6366f1] hover:bg-[#6366f1]/10'
                  : 'text-[#6366f1] hover:bg-[#6366f1]/10'
              }`}>
                {notification.actionLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside className={`absolute top-[56px] right-0 bottom-0 w-full sm:w-[340px] backdrop-blur-xl border-l overflow-y-auto transition-transform duration-300 z-40 ${
      isOpen ? 'translate-x-0' : 'translate-x-full'
    } ${
      darkMode 
        ? 'bg-[#0f0f0f]/98 border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.5)]'
        : 'bg-white/98 border-gray-200/50 shadow-2xl'
    }`}>
      <div className="p-6 space-y-6">
        {/* Notifications Header */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className={darkMode ? 'text-white' : 'text-gray-900'}>Notifications</h3>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white rounded-full text-xs shadow-[0_0_12px_rgba(99,102,241,0.5)]">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && onMarkAllAsRead && (
                <button
                  onClick={onMarkAllAsRead}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    darkMode
                      ? 'text-gray-400 hover:text-white hover:bg-white/5'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                  title="Mark all as read"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
              )}
              <Bell className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            </div>
          </div>

          {/* Empty state */}
          {filteredNotifications.length === 0 && (
            <div className={`text-center py-8 backdrop-blur-xl border rounded-lg ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200/50'
            }`}>
              <Bell className={`w-8 h-8 mx-auto mb-2 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
              <p className={`text-sm mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                No notifications
              </p>
              <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-500'}`}>
                You're all caught up!
              </p>
            </div>
          )}

          {/* Today */}
          {today.length > 0 && (
            <div className="mb-4">
              <h4 className={`text-xs uppercase tracking-wider mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Today
              </h4>
              <div className="space-y-2">
                {today.map((notification) => (
                  <NotificationItem key={notification.id} notification={notification} />
                ))}
              </div>
            </div>
          )}

          {/* Yesterday */}
          {yesterday.length > 0 && (
            <div className="mb-4">
              <h4 className={`text-xs uppercase tracking-wider mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Yesterday
              </h4>
              <div className="space-y-2">
                {yesterday.map((notification) => (
                  <NotificationItem key={notification.id} notification={notification} />
                ))}
              </div>
            </div>
          )}

          {/* This Week */}
          {thisWeek.length > 0 && (
            <div className="mb-4">
              <h4 className={`text-xs uppercase tracking-wider mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Earlier
              </h4>
              <div className="space-y-2">
                {thisWeek.map((notification) => (
                  <NotificationItem key={notification.id} notification={notification} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Activities */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className={darkMode ? 'text-white' : 'text-gray-900'}>Recent Activity</h3>
            <Activity className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
          </div>
          <div className="space-y-3">
            {activities.map((activity, index) => {
              const Icon = activity.icon;
              return (
                <div key={index} className={`flex items-start gap-3 p-2 -mx-2 rounded-lg cursor-pointer transition-colors ${
                  darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/50'
                }`}>
                  <div className={`w-8 h-8 bg-gradient-to-br ${activity.color} rounded-lg flex items-center justify-center text-white shrink-0 shadow-lg`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {activity.title}
                    </p>
                    <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-500'}`}>
                      {activity.deal}
                    </p>
                    <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                      {activity.time}
                    </p>
                  </div>
                  <ChevronRight className={`w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Contacts */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className={darkMode ? 'text-white' : 'text-gray-900'}>Team</h3>
            <Users className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
          </div>
          <div className="space-y-3">
            {contacts.map((contact, index) => (
              <div key={index} className={`flex items-center gap-3 rounded-lg p-2 -mx-2 cursor-pointer transition-colors ${
                darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/50'
              }`}>
                <div className="relative">
                  <div className={`w-8 h-8 bg-gradient-to-br ${contact.color} rounded-full flex items-center justify-center text-white text-xs shrink-0 shadow-lg`}>
                    {contact.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  {contact.online && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-[#0f0f0f] rounded-full"></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {contact.name}
                  </p>
                  <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {contact.role}
                  </p>
                </div>
                <MessageSquare className={`w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

export type { NotificationPreferences };