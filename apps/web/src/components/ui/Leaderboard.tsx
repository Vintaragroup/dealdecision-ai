import { Crown, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface LeaderboardEntry {
  rank: number;
  name: string;
  avatar?: string;
  level: number;
  xp: number;
  change: number; // Change in rank since last period
  isCurrentUser?: boolean;
}

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  darkMode: boolean;
  period?: 'weekly' | 'monthly' | 'all-time';
}

export function Leaderboard({ entries, darkMode, period = 'weekly' }: LeaderboardProps) {
  const getRankColor = (rank: number) => {
    if (rank === 1) return 'from-yellow-400 via-yellow-500 to-orange-500';
    if (rank === 2) return 'from-gray-300 via-gray-400 to-gray-500';
    if (rank === 3) return 'from-orange-400 via-orange-500 to-orange-600';
    return darkMode ? 'from-gray-600 to-gray-700' : 'from-gray-400 to-gray-500';
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) return { emoji: '🥇', label: '1st' };
    if (rank === 2) return { emoji: '🥈', label: '2nd' };
    if (rank === 3) return { emoji: '🥉', label: '3rd' };
    return { emoji: '', label: `${rank}th` };
  };

  const periodLabels = {
    weekly: 'This Week',
    monthly: 'This Month',
    'all-time': 'All Time'
  };

  return (
    <div className={`p-6 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
            <Crown className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
              darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
            }`}>
              Leaderboard
            </h2>
            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {periodLabels[period]}
            </p>
          </div>
        </div>

        {/* Period Selector */}
        <div className={`flex items-center gap-1 p-1 rounded-lg ${
          darkMode ? 'bg-white/5' : 'bg-gray-100'
        }`}>
          <button className={`px-3 py-1 rounded text-xs transition-colors ${
            period === 'weekly'
              ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
              : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
          }`}>
            Week
          </button>
          <button className={`px-3 py-1 rounded text-xs transition-colors ${
            period === 'monthly'
              ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
              : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
          }`}>
            Month
          </button>
          <button className={`px-3 py-1 rounded text-xs transition-colors ${
            period === 'all-time'
              ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
              : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
          }`}>
            All
          </button>
        </div>
      </div>

      {/* Leaderboard Entries */}
      <div className="space-y-2">
        {entries.map((entry) => {
          const badge = getRankBadge(entry.rank);
          const isTopThree = entry.rank <= 3;

          return (
            <div
              key={entry.rank}
              className={`p-4 rounded-lg backdrop-blur-xl border transition-all ${
                entry.isCurrentUser
                  ? 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                  : darkMode ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-4">
                {/* Rank */}
                <div className="w-12 text-center">
                  {isTopThree ? (
                    <div className="flex flex-col items-center">
                      <span className="text-2xl">{badge.emoji}</span>
                      <div className={`text-xs bg-gradient-to-r ${getRankColor(entry.rank)} bg-clip-text text-transparent`}>
                        {badge.label}
                      </div>
                    </div>
                  ) : (
                    <div className={`text-xl ${
                      entry.isCurrentUser
                        ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent'
                        : darkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      {entry.rank}
                    </div>
                  )}
                </div>

                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm border-2 ${
                  entry.isCurrentUser
                    ? 'border-[#6366f1] bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white'
                    : isTopThree
                      ? `border-transparent bg-gradient-to-br ${getRankColor(entry.rank)} text-white`
                      : darkMode ? 'border-white/20 bg-white/10 text-gray-400' : 'border-gray-300 bg-gray-200 text-gray-700'
                }`}>
                  {entry.avatar || entry.name.substring(0, 2).toUpperCase()}
                </div>

                {/* Name & Level */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className={`text-sm ${
                      entry.isCurrentUser
                        ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent'
                        : darkMode ? 'text-white' : 'text-gray-900'
                    }`}>
                      {entry.name}
                      {entry.isCurrentUser && ' (You)'}
                    </h3>
                  </div>
                  <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    Level {entry.level}
                  </p>
                </div>

                {/* XP */}
                <div className="text-right">
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {entry.xp.toLocaleString()} XP
                  </div>
                  
                  {/* Rank Change */}
                  <div className="flex items-center justify-end gap-1 mt-1">
                    {entry.change > 0 ? (
                      <>
                        <TrendingUp className="w-3 h-3 text-green-500" />
                        <span className="text-xs text-green-500">+{entry.change}</span>
                      </>
                    ) : entry.change < 0 ? (
                      <>
                        <TrendingDown className="w-3 h-3 text-red-500" />
                        <span className="text-xs text-red-500">{entry.change}</span>
                      </>
                    ) : (
                      <>
                        <Minus className="w-3 h-3 text-gray-500" />
                        <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>-</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Your Position (if not in top entries) */}
      <div className={`mt-4 pt-4 border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
        <p className={`text-xs text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Showing top {entries.length} users
        </p>
      </div>
    </div>
  );
}
