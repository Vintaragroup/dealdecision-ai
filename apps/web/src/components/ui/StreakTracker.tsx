import { Flame, Calendar, Target } from 'lucide-react';

interface StreakData {
  type: string;
  icon: string;
  current: number;
  best: number;
  target: number;
}

interface StreakTrackerProps {
  streaks: StreakData[];
  darkMode: boolean;
}

export function StreakTracker({ streaks, darkMode }: StreakTrackerProps) {
  return (
    <div className={`p-6 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
          <Flame className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
            darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
          }`}>
            Streaks
          </h2>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Keep your momentum going!
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {streaks.map((streak, index) => {
          const percentage = (streak.current / streak.target) * 100;
          const isOnFire = streak.current >= 7;
          
          return (
            <div
              key={index}
              className={`p-4 rounded-lg backdrop-blur-xl border ${
                isOnFire
                  ? 'bg-gradient-to-r from-orange-500/10 to-red-600/10 border-orange-500/30'
                  : darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{streak.icon}</span>
                  <div>
                    <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {streak.type}
                    </h3>
                    <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      Best: {streak.best} days
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-2xl ${
                    isOnFire 
                      ? 'bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent'
                      : darkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                    {streak.current}
                  </div>
                  <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    days
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className={`h-2 rounded-full overflow-hidden ${
                darkMode ? 'bg-white/10' : 'bg-gray-200'
              }`}>
                <div
                  className={`h-full transition-all duration-500 ${
                    isOnFire
                      ? 'bg-gradient-to-r from-orange-500 to-red-600 shadow-[0_0_8px_rgba(249,115,22,0.4)]'
                      : 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                  }`}
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                ></div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between mt-2">
                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {streak.target - streak.current > 0 
                    ? `${streak.target - streak.current} days to next milestone`
                    : 'Milestone reached! 🎉'
                  }
                </p>
                {isOnFire && (
                  <div className="flex items-center gap-1">
                    <Flame className="w-3 h-3 text-orange-500 animate-pulse" />
                    <span className="text-xs text-orange-500">On Fire!</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Calendar View */}
      <div className="mt-6">
        <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Last 7 Days
        </h3>
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, i) => {
            const isComplete = i < 5; // Sample: last 5 days complete
            const date = new Date();
            date.setDate(date.getDate() - (6 - i));
            
            return (
              <div key={i} className="text-center">
                <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {date.toLocaleDateString('en-US', { weekday: 'narrow' })}
                </div>
                <div className={`aspect-square rounded-lg flex items-center justify-center text-xs backdrop-blur-xl border transition-all ${
                  isComplete
                    ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] border-[#6366f1]/30 text-white shadow-[0_0_8px_rgba(99,102,241,0.3)]'
                    : darkMode
                      ? 'bg-white/5 border-white/10 text-gray-600'
                      : 'bg-gray-100 border-gray-200 text-gray-400'
                }`}>
                  {isComplete ? '✓' : date.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
