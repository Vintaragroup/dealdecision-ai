import { Award } from 'lucide-react';

interface Achievement {
  id: string;
  title: string;
  icon: string;
  tier: 'common' | 'rare' | 'epic' | 'legendary';
  unlockedAt: string;
}

interface RecentAchievementsWidgetProps {
  darkMode: boolean;
  achievements: Achievement[];
  onViewAll?: () => void;
}

export function RecentAchievementsWidget({ darkMode, achievements, onViewAll }: RecentAchievementsWidgetProps) {
  const tierConfig = {
    common: 'from-gray-400 to-gray-600',
    rare: 'from-blue-400 to-blue-600',
    epic: 'from-purple-400 to-purple-600',
    legendary: 'from-yellow-400 via-orange-500 to-red-600'
  };

  return (
    <div className={`p-5 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-yellow-500" />
          <h3 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Achievements
          </h3>
        </div>
        <button
          onClick={onViewAll}
          className={`text-xs ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
        >
          View All
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {achievements.map((achievement) => (
          <div
            key={achievement.id}
            className={`p-3 rounded-lg backdrop-blur-xl border transition-all hover:scale-105 cursor-pointer ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div className="flex flex-col items-center text-center">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-2 bg-gradient-to-br ${
                tierConfig[achievement.tier]
              } shadow-[0_0_15px_rgba(99,102,241,0.3)]`}>
                <span className="text-2xl">{achievement.icon}</span>
              </div>
              <h4 className={`text-xs mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {achievement.title}
              </h4>
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {achievement.unlockedAt}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between text-xs">
          <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>
            Next: Speed Demon
          </span>
          <span className={darkMode ? 'text-white' : 'text-gray-900'}>
            60% complete
          </span>
        </div>
        <div className={`h-1.5 rounded-full overflow-hidden mt-2 ${
          darkMode ? 'bg-white/10' : 'bg-gray-200'
        }`}>
          <div
            className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all duration-500"
            style={{ width: '60%' }}
          ></div>
        </div>
      </div>
    </div>
  );
}
