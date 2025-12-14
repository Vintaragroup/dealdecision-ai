import { Trophy, FileText, TrendingUp, Award, Users, Zap, CheckCircle } from 'lucide-react';

interface ActivityItem {
  id: string;
  type: 'achievement' | 'deal' | 'document' | 'rank' | 'level' | 'collaboration' | 'milestone';
  title: string;
  description: string;
  timestamp: string;
  icon?: string;
}

interface ActivityFeedProps {
  darkMode: boolean;
  activities: ActivityItem[];
  onActivityClick?: (activityId: string, type: string) => void;
}

export function ActivityFeed({ darkMode, activities, onActivityClick }: ActivityFeedProps) {
  const getActivityIcon = (type: string, icon?: string) => {
    if (icon) return <span className="text-xl">{icon}</span>;
    
    const iconClass = "w-4 h-4";
    switch (type) {
      case 'achievement':
        return <Trophy className={`${iconClass} text-yellow-500`} />;
      case 'deal':
        return <TrendingUp className={`${iconClass} text-blue-500`} />;
      case 'document':
        return <FileText className={`${iconClass} text-purple-500`} />;
      case 'rank':
        return <Award className={`${iconClass} text-orange-500`} />;
      case 'level':
        return <Zap className={`${iconClass} text-green-500`} />;
      case 'collaboration':
        return <Users className={`${iconClass} text-pink-500`} />;
      case 'milestone':
        return <CheckCircle className={`${iconClass} text-green-500`} />;
      default:
        return <Zap className={`${iconClass} text-gray-500`} />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'achievement':
        return darkMode ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-yellow-50 border-yellow-200';
      case 'deal':
        return darkMode ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-200';
      case 'document':
        return darkMode ? 'bg-purple-500/10 border-purple-500/20' : 'bg-purple-50 border-purple-200';
      case 'rank':
        return darkMode ? 'bg-orange-500/10 border-orange-500/20' : 'bg-orange-50 border-orange-200';
      case 'level':
        return darkMode ? 'bg-green-500/10 border-green-500/20' : 'bg-green-50 border-green-200';
      default:
        return darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className={`p-5 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Recent Activity
        </h3>
        <button className={`text-xs ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}>
          View All
        </button>
      </div>

      <div className="space-y-2">
        {activities.map((activity, index) => (
          <div key={activity.id}>
            <div 
              onClick={() => onActivityClick?.(activity.id, activity.type)}
              className={`p-3 rounded-lg border transition-all cursor-pointer hover:scale-[1.02] ${getActivityColor(activity.type)}`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  darkMode ? 'bg-white/10' : 'bg-white'
                }`}>
                  {getActivityIcon(activity.type, activity.icon)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm mb-0.5 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {activity.title}
                  </p>
                  <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {activity.description}
                  </p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    {activity.timestamp}
                  </p>
                </div>
              </div>
            </div>
            {index < activities.length - 1 && (
              <div className={`w-px h-2 ml-7 ${darkMode ? 'bg-white/5' : 'bg-gray-200'}`}></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}