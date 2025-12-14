import { Trophy, Clock, Gift } from 'lucide-react';

interface Challenge {
  title: string;
  description: string;
  progress: number;
  maxProgress: number;
  reward: {
    xp: number;
    badge?: string;
  };
  timeRemaining?: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'epic';
}

interface ChallengeCardProps {
  challenge: Challenge;
  darkMode: boolean;
}

export function ChallengeCard({ challenge, darkMode }: ChallengeCardProps) {
  const percentage = (challenge.progress / challenge.maxProgress) * 100;
  const isComplete = challenge.progress >= challenge.maxProgress;

  const difficultyConfig = {
    easy: {
      color: 'text-green-500',
      bg: darkMode ? 'bg-green-500/10' : 'bg-green-50',
      border: 'border-green-500/30',
      label: 'EASY'
    },
    medium: {
      color: 'text-yellow-500',
      bg: darkMode ? 'bg-yellow-500/10' : 'bg-yellow-50',
      border: 'border-yellow-500/30',
      label: 'MEDIUM'
    },
    hard: {
      color: 'text-orange-500',
      bg: darkMode ? 'bg-orange-500/10' : 'bg-orange-50',
      border: 'border-orange-500/30',
      label: 'HARD'
    },
    epic: {
      color: 'text-purple-500',
      bg: darkMode ? 'bg-purple-500/10' : 'bg-purple-50',
      border: 'border-purple-500/30',
      label: 'EPIC'
    }
  };

  const config = difficultyConfig[challenge.difficulty];

  return (
    <div className={`p-4 rounded-lg backdrop-blur-xl border transition-all ${
      isComplete
        ? 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30 shadow-[0_0_20px_rgba(99,102,241,0.2)]'
        : darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {challenge.title}
            </h3>
            {isComplete && (
              <span className="px-2 py-0.5 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white text-xs rounded-full">
                Complete!
              </span>
            )}
          </div>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {challenge.description}
          </p>
        </div>
        <div className={`px-2 py-1 rounded text-xs ${config.bg} ${config.border} ${config.color} border`}>
          {config.label}
        </div>
      </div>

      {/* Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>
            Progress
          </span>
          <span className={darkMode ? 'text-white' : 'text-gray-900'}>
            {challenge.progress}/{challenge.maxProgress}
          </span>
        </div>
        <div className={`h-2 rounded-full overflow-hidden ${
          darkMode ? 'bg-white/10' : 'bg-gray-200'
        }`}>
          <div
            className={`h-full transition-all duration-500 ${
              isComplete
                ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] shadow-[0_0_8px_rgba(99,102,241,0.4)]'
                : 'bg-gradient-to-r from-gray-400 to-gray-500'
            }`}
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* XP Reward */}
          <div className="flex items-center gap-1">
            <Trophy className={`w-3 h-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              +{challenge.reward.xp} XP
            </span>
          </div>

          {/* Badge Reward */}
          {challenge.reward.badge && (
            <div className="flex items-center gap-1">
              <Gift className={`w-3 h-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
              <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {challenge.reward.badge}
              </span>
            </div>
          )}
        </div>

        {/* Time Remaining */}
        {challenge.timeRemaining && !isComplete && (
          <div className="flex items-center gap-1">
            <Clock className={`w-3 h-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {challenge.timeRemaining}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
