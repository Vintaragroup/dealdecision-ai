import { Crown, TrendingUp } from 'lucide-react';

interface LeaderEntry {
  rank: number;
  name: string;
  xp: number;
  isCurrentUser?: boolean;
}

interface MiniLeaderboardWidgetProps {
  darkMode: boolean;
  entries: LeaderEntry[];
  onViewFull?: () => void;
}

export function MiniLeaderboardWidget({ darkMode, entries, onViewFull }: MiniLeaderboardWidgetProps) {
  const getMedalEmoji = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  };

  return (
    <div className={`p-5 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-yellow-500" />
          <h3 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Leaderboard
          </h3>
        </div>
        <button
          onClick={onViewFull}
          className={`text-xs ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
        >
          View All
        </button>
      </div>

      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.rank}
            className={`p-3 rounded-lg transition-all ${
              entry.isCurrentUser
                ? darkMode
                  ? 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10 border border-[#6366f1]/30'
                  : 'bg-gradient-to-r from-[#6366f1]/5 to-[#8b5cf6]/5 border border-[#6366f1]/30'
                : darkMode
                  ? 'bg-white/5'
                  : 'bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 text-center text-lg ${
                  entry.rank <= 3 ? '' : darkMode ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  {getMedalEmoji(entry.rank) || `#${entry.rank}`}
                </div>
                <div>
                  <div className={`text-sm ${
                    entry.isCurrentUser
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent'
                      : darkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                    {entry.name}
                    {entry.isCurrentUser && ' (You)'}
                  </div>
                  <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {entry.xp.toLocaleString()} XP
                  </div>
                </div>
              </div>
              {entry.isCurrentUser && (
                <TrendingUp className="w-4 h-4 text-green-500" />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
        <p className={`text-xs text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Top performers this week
        </p>
      </div>
    </div>
  );
}
