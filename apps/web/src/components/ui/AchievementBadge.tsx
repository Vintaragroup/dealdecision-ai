import { Lock } from 'lucide-react';

type BadgeTier = 'common' | 'rare' | 'epic' | 'legendary';

interface AchievementBadgeProps {
  title: string;
  description: string;
  icon: string;
  tier: BadgeTier;
  unlocked: boolean;
  progress?: number;
  maxProgress?: number;
  darkMode: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function AchievementBadge({
  title,
  description,
  icon,
  tier,
  unlocked,
  progress,
  maxProgress,
  darkMode,
  size = 'md'
}: AchievementBadgeProps) {
  const tierConfig = {
    common: {
      gradient: 'from-gray-400 to-gray-600',
      shadow: 'shadow-[0_0_20px_rgba(156,163,175,0.3)]',
      glow: 'bg-gray-500/20',
      border: 'border-gray-500/30'
    },
    rare: {
      gradient: 'from-blue-400 to-blue-600',
      shadow: 'shadow-[0_0_20px_rgba(59,130,246,0.4)]',
      glow: 'bg-blue-500/20',
      border: 'border-blue-500/30'
    },
    epic: {
      gradient: 'from-purple-400 to-purple-600',
      shadow: 'shadow-[0_0_20px_rgba(168,85,247,0.4)]',
      glow: 'bg-purple-500/20',
      border: 'border-purple-500/30'
    },
    legendary: {
      gradient: 'from-yellow-400 via-orange-500 to-red-600',
      shadow: 'shadow-[0_0_30px_rgba(251,191,36,0.5)]',
      glow: 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20',
      border: 'border-yellow-500/30'
    }
  };

  const sizeConfig = {
    sm: {
      container: 'w-28 h-28',
      icon: 'text-3xl',
      badge: 'w-20 h-20',
      title: 'text-xs',
      desc: 'text-xs'
    },
    md: {
      container: 'w-36 h-36',
      icon: 'text-4xl',
      badge: 'w-24 h-24',
      title: 'text-sm',
      desc: 'text-xs'
    },
    lg: {
      container: 'w-48 h-48',
      icon: 'text-5xl',
      badge: 'w-32 h-32',
      title: 'text-base',
      desc: 'text-sm'
    }
  };

  const config = tierConfig[tier];
  const sizing = sizeConfig[size];

  return (
    <div className={`${sizing.container} flex flex-col items-center gap-3`}>
      {/* Badge */}
      <div className="relative">
        <div className={`${sizing.badge} rounded-full flex items-center justify-center backdrop-blur-xl border transition-all ${
          unlocked 
            ? `bg-gradient-to-br ${config.gradient} ${config.shadow} ${config.border}`
            : darkMode 
              ? 'bg-white/5 border-white/10' 
              : 'bg-gray-200 border-gray-300'
        } ${unlocked ? 'hover:scale-110' : ''}`}>
          {unlocked ? (
            <span className={`${sizing.icon} animate-pulse-subtle`}>{icon}</span>
          ) : (
            <Lock className={`w-8 h-8 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
          )}
        </div>

        {/* Glow Effect */}
        {unlocked && (
          <div className={`absolute inset-0 rounded-full blur-xl ${config.glow} animate-pulse-slow`}></div>
        )}

        {/* Tier Badge */}
        {unlocked && (
          <div className={`absolute -top-1 -right-1 px-2 py-0.5 rounded-full text-xs uppercase tracking-wide bg-gradient-to-r ${config.gradient} text-white shadow-lg`}>
            {tier}
          </div>
        )}
      </div>

      {/* Title */}
      <div className="text-center">
        <h4 className={`${sizing.title} mb-1 ${
          unlocked 
            ? darkMode ? 'text-white' : 'text-gray-900'
            : darkMode ? 'text-gray-600' : 'text-gray-400'
        }`}>
          {title}
        </h4>
        <p className={`${sizing.desc} ${
          unlocked
            ? darkMode ? 'text-gray-400' : 'text-gray-600'
            : darkMode ? 'text-gray-700' : 'text-gray-500'
        }`}>
          {description}
        </p>

        {/* Progress (for locked badges) */}
        {!unlocked && progress !== undefined && maxProgress !== undefined && (
          <div className="mt-2">
            <div className={`h-1 rounded-full overflow-hidden ${
              darkMode ? 'bg-white/10' : 'bg-gray-300'
            }`}>
              <div
                className={`h-full bg-gradient-to-r ${config.gradient} transition-all duration-500`}
                style={{ width: `${(progress / maxProgress) * 100}%` }}
              ></div>
            </div>
            <p className={`text-xs mt-1 ${darkMode ? 'text-gray-600' : 'text-gray-500'}`}>
              {progress}/{maxProgress}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
