import { CheckCircle, Lock, Circle } from 'lucide-react';

interface SkillNode {
  id: string;
  name: string;
  description: string;
  level: number;
  maxLevel: number;
  unlocked: boolean;
  prerequisites?: string[];
  perk?: string;
}

interface SkillPath {
  name: string;
  color: string;
  icon: string;
  skills: SkillNode[];
}

interface SkillTreeProps {
  path: SkillPath;
  darkMode: boolean;
}

export function SkillTree({ path, darkMode }: SkillTreeProps) {
  return (
    <div className={`p-6 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${path.color} flex items-center justify-center`}>
          <span className="text-xl">{path.icon}</span>
        </div>
        <div>
          <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {path.name}
          </h3>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {path.skills.filter(s => s.unlocked).length}/{path.skills.length} skills unlocked
          </p>
        </div>
      </div>

      {/* Skill Nodes */}
      <div className="relative space-y-4">
        {path.skills.map((skill, index) => {
          const isMaxLevel = skill.level === skill.maxLevel;
          const hasNextSkill = index < path.skills.length - 1;
          
          return (
            <div key={skill.id} className="relative">
              {/* Connection Line */}
              {hasNextSkill && (
                <div className={`absolute left-5 top-12 w-0.5 h-8 ${
                  skill.unlocked 
                    ? `bg-gradient-to-b ${path.color}`
                    : darkMode ? 'bg-white/10' : 'bg-gray-300'
                }`}></div>
              )}

              {/* Skill Card */}
              <div className={`relative p-4 rounded-lg backdrop-blur-xl border transition-all ${
                skill.unlocked
                  ? `bg-gradient-to-r ${path.color.replace('from-', 'from-').replace('to-', 'to-')}/10 ${
                      darkMode ? 'border-white/20' : 'border-gray-300'
                    }`
                  : darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200'
              }`}>
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                    skill.unlocked
                      ? isMaxLevel
                        ? `bg-gradient-to-br ${path.color} border-transparent`
                        : `bg-gradient-to-br ${path.color.replace('from-', 'from-').replace('to-', 'to-')}/20 border-current`
                      : darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-200 border-gray-300'
                  }`}>
                    {isMaxLevel ? (
                      <CheckCircle className="w-5 h-5 text-white" />
                    ) : skill.unlocked ? (
                      <Circle className={`w-5 h-5 ${darkMode ? 'text-white' : 'text-gray-900'}`} />
                    ) : (
                      <Lock className={`w-5 h-5 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-1">
                      <h4 className={`text-sm ${
                        skill.unlocked 
                          ? darkMode ? 'text-white' : 'text-gray-900'
                          : darkMode ? 'text-gray-600' : 'text-gray-400'
                      }`}>
                        {skill.name}
                      </h4>
                      {skill.unlocked && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          isMaxLevel
                            ? `bg-gradient-to-r ${path.color} text-white border-transparent`
                            : darkMode ? 'bg-white/10 border-white/20 text-gray-400' : 'bg-gray-200 border-gray-300 text-gray-700'
                        }`}>
                          Level {skill.level}/{skill.maxLevel}
                        </span>
                      )}
                    </div>

                    <p className={`text-xs mb-2 ${
                      skill.unlocked
                        ? darkMode ? 'text-gray-400' : 'text-gray-600'
                        : darkMode ? 'text-gray-700' : 'text-gray-500'
                    }`}>
                      {skill.description}
                    </p>

                    {/* Perk */}
                    {skill.unlocked && skill.perk && (
                      <div className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
                        darkMode ? 'bg-white/10 text-gray-300' : 'bg-gray-200 text-gray-700'
                      }`}>
                        <span className="text-yellow-500">⚡</span>
                        {skill.perk}
                      </div>
                    )}

                    {/* Progress Bar (for unlocked skills not at max level) */}
                    {skill.unlocked && !isMaxLevel && (
                      <div className={`mt-2 h-1.5 rounded-full overflow-hidden ${
                        darkMode ? 'bg-white/10' : 'bg-gray-200'
                      }`}>
                        <div
                          className={`h-full bg-gradient-to-r ${path.color} transition-all duration-500`}
                          style={{ width: `${(skill.level / skill.maxLevel) * 100}%` }}
                        ></div>
                      </div>
                    )}

                    {/* Prerequisites (for locked skills) */}
                    {!skill.unlocked && skill.prerequisites && skill.prerequisites.length > 0 && (
                      <div className={`mt-2 text-xs ${darkMode ? 'text-gray-600' : 'text-gray-500'}`}>
                        🔒 Requires: {skill.prerequisites.join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
