import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Download, Maximize2, TrendingUp } from 'lucide-react';
import { useState } from 'react';

const data = [
  { month: 'Jan', current: 12000, previous: 8000 },
  { month: 'Feb', current: 19000, previous: 15000 },
  { month: 'Mar', current: 15000, previous: 12000 },
  { month: 'Apr', current: 25000, previous: 18000 },
  { month: 'May', current: 22000, previous: 20000 },
  { month: 'Jun', current: 30000, previous: 24000 }
];

interface DealflowChartProps {
  darkMode: boolean;
}

export function DealflowChart({ darkMode }: DealflowChartProps) {
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);

  return (
    <div className={`backdrop-blur-xl border rounded-2xl p-6 group relative overflow-hidden ${
      darkMode
        ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5 shadow-[0_0_40px_rgba(0,0,0,0.3)]'
        : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50 shadow-lg'
    }`}>
      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-br opacity-50 ${
        darkMode ? 'from-[#6366f1]/5 via-transparent to-[#8b5cf6]/5' : 'from-[#6366f1]/3 via-transparent to-transparent'
      }`}></div>
      
      {/* Quick Actions - appear on hover */}
      <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2 z-20">
        <button className={`p-2 backdrop-blur-xl border rounded-lg transition-colors ${
          darkMode 
            ? 'bg-white/5 hover:bg-white/10 border-white/10' 
            : 'bg-white/80 hover:bg-gray-100 border-gray-200'
        }`}>
          <Download className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
        </button>
        <button className={`p-2 backdrop-blur-xl border rounded-lg transition-colors ${
          darkMode 
            ? 'bg-white/5 hover:bg-white/10 border-white/10' 
            : 'bg-white/80 hover:bg-gray-100 border-gray-200'
        }`}>
          <Maximize2 className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
        </button>
      </div>

      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-2">
          <h2 className={darkMode ? 'text-white' : 'text-gray-900'}>Deal Flow</h2>
          <div className={`flex items-center gap-1 px-2 py-1 backdrop-blur-xl border rounded-full ${
            darkMode
              ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-emerald-500/30'
              : 'bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border-emerald-500/30'
          }`}>
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span className="text-xs text-emerald-400">+32.1%</span>
          </div>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Current Quarter</span>
            <span className={`bg-gradient-to-r bg-clip-text text-transparent ${
              darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
            }`}>$128,450</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Previous Quarter</span>
            <span className={darkMode ? 'text-white' : 'text-gray-900'}>$97,245</span>
          </div>
        </div>
      </div>
      
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} onMouseMove={(e: any) => e?.activeLabel && setHoveredMonth(e.activeLabel)}>
          <defs>
            <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="gradientLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#2a2a2a' : '#e5e7eb'} />
          <XAxis 
            dataKey="month" 
            stroke={darkMode ? '#666' : '#9ca3af'}
            tick={{ fill: darkMode ? '#666' : '#9ca3af' }}
            axisLine={{ stroke: darkMode ? '#2a2a2a' : '#e5e7eb' }}
          />
          <YAxis 
            stroke={darkMode ? '#666' : '#9ca3af'}
            tick={{ fill: darkMode ? '#666' : '#9ca3af' }}
            axisLine={{ stroke: darkMode ? '#2a2a2a' : '#e5e7eb' }}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: darkMode ? 'rgba(26, 26, 26, 0.9)' : 'rgba(255, 255, 255, 0.95)', 
              border: darkMode ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '12px',
              color: darkMode ? '#fff' : '#000',
              backdropFilter: 'blur(12px)'
            }}
            labelStyle={{ color: darkMode ? '#fff' : '#000' }}
          />
          <Line 
            type="monotone" 
            dataKey="current" 
            stroke="url(#gradientLine)"
            strokeWidth={3}
            dot={{ fill: '#6366f1', r: 4, strokeWidth: 2, stroke: '#fff' }}
            activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff', fill: '#6366f1' }}
            name="Current Quarter"
          />
          <Line 
            type="monotone" 
            dataKey="previous" 
            stroke="#64748b" 
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ fill: '#64748b', r: 4 }}
            name="Previous Quarter"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}