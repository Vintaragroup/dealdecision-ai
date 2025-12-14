import { User } from 'lucide-react';

interface UserProfileProps {
  name?: string;
  avatar?: string;
  level: number;
  currentXP: number;
  maxXP: number;
  darkMode?: boolean;
}

export function UserProfile({ 
  name = 'User',
  avatar,
  level,
  currentXP,
  maxXP,
  darkMode = true 
}: UserProfileProps) {
  const xpPercentage = (currentXP / maxXP) * 100;
  
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
      darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/50'
    }`}>
      {/* Avatar */}
      <div className="relative">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${
          avatar 
            ? '' 
            : 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]'
        }`}>
          {avatar ? (
            <img src={avatar} alt={name} className="w-full h-full object-cover" />
          ) : (
            <User className="w-4 h-4 text-white" />
          )}
        </div>
        
        {/* Level badge */}
        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-full flex items-center justify-center text-[10px] text-white border-2 border-[#0f0f0f] shadow-[0_0_8px_rgba(99,102,241,0.6)]">
          {level}
        </div>
      </div>
      
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm truncate ${
          darkMode ? 'text-white' : 'text-gray-900'
        }`}>
          {name}
        </div>
        
        {/* XP Progress bar */}
        <div className="flex items-center gap-2 mt-0.5">
          <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${
            darkMode ? 'bg-white/10' : 'bg-gray-200'
          }`}>
            <div 
              className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all duration-500 shadow-[0_0_6px_rgba(99,102,241,0.5)]"
              style={{ width: `${xpPercentage}%` }}
            />
          </div>
          <span className={`text-[10px] ${
            darkMode ? 'text-gray-500' : 'text-gray-600'
          }`}>
            {currentXP}/{maxXP}
          </span>
        </div>
      </div>
    </div>
  );
}
