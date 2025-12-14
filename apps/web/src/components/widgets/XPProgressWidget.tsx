import { Zap, TrendingUp } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface XPProgressWidgetProps {
  darkMode: boolean;
  currentLevel: number;
  currentXP: number;
  maxXP: number;
  weeklyXP: number;
  weeklyData: Array<{ day: string; xp: number }>;
}

export function XPProgressWidget({ 
  darkMode, 
  currentLevel, 
  currentXP, 
  maxXP, 
  weeklyXP,
  weeklyData 
}: XPProgressWidgetProps) {
  const percentage = (currentXP / maxXP) * 100;

  return (
    <div className={`p-5 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Level Progress
        </h3>
        <div className="flex items-center gap-1">
          <TrendingUp className="w-3 h-3 text-green-500" />
          <span className="text-xs text-green-500">+{weeklyXP} this week</span>
        </div>
      </div>

      {/* Level Badge & Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center text-white shadow-[0_0_20px_rgba(99,102,241,0.3)]">
              {currentLevel}
            </div>
            <div>
              <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Level {currentLevel}
              </div>
              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {currentXP.toLocaleString()} / {maxXP.toLocaleString()} XP
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {Math.round(percentage)}%
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              to Lvl {currentLevel + 1}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className={`h-3 rounded-full overflow-hidden ${
          darkMode ? 'bg-white/10' : 'bg-gray-200'
        }`}>
          <div
            className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] shadow-[0_0_12px_rgba(99,102,241,0.4)] transition-all duration-500"
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      </div>

      {/* Weekly XP Chart */}
      <div>
        <h4 className={`text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Weekly Activity
        </h4>
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={weeklyData}>
            <defs>
              <linearGradient id="xpGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke={darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} 
            />
            <XAxis 
              dataKey="day" 
              tick={{ fill: darkMode ? '#6b7280' : '#9ca3af', fontSize: 11 }}
              stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            />
            <YAxis 
              tick={{ fill: darkMode ? '#6b7280' : '#9ca3af', fontSize: 11 }}
              stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: darkMode ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)',
                border: darkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
                borderRadius: '8px',
                fontSize: '12px'
              }}
            />
            <Area
              type="monotone"
              dataKey="xp"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#xpGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* XP Sources */}
      <div className={`mt-4 pt-4 border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Deals Completed</span>
            <span className={darkMode ? 'text-white' : 'text-gray-900'}>+320 XP</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Challenges</span>
            <span className={darkMode ? 'text-white' : 'text-gray-900'}>+250 XP</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Streaks</span>
            <span className={darkMode ? 'text-white' : 'text-gray-900'}>+180 XP</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Documents</span>
            <span className={darkMode ? 'text-white' : 'text-gray-900'}>+100 XP</span>
          </div>
        </div>
      </div>
    </div>
  );
}
