import { PieChart, Pie, Cell, ResponsiveContainer, Legend } from 'recharts';
import { Download, Maximize2 } from 'lucide-react';
import { Button } from './ui/button';

const data = [
  { name: 'Excellent', value: 38.6, color: '#6366f1' },
  { name: 'Good', value: 28.4, color: '#8b5cf6' },
  { name: 'Average', value: 18.2, color: '#a78bfa' },
  { name: 'Needs Work', value: 14.8, color: '#c4b5fd' }
];

interface ScoreChartProps {
  darkMode: boolean;
}

export function ScoreChart({ darkMode }: ScoreChartProps) {
  return (
    <div className={`backdrop-blur-xl border rounded-2xl p-6 group relative overflow-hidden ${
      darkMode
        ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5 shadow-[0_0_40px_rgba(0,0,0,0.3)]'
        : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50 shadow-lg'
    }`}>
      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-br opacity-50 ${
        darkMode ? 'from-[#8b5cf6]/5 via-transparent to-[#6366f1]/5' : 'from-[#6366f1]/3 via-transparent to-transparent'
      }`}></div>
      
      {/* Quick Actions */}
      <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2 z-20">
        <Button variant="ghost" size="icon" aria-label="Download" className="dd-btn-icon">
          <Download className="w-4 h-4 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Expand" className="dd-btn-icon">
          <Maximize2 className="w-4 h-4 text-muted-foreground" />
        </Button>
      </div>

      <div className="mb-6 relative z-10">
        <h2 className={darkMode ? 'text-white' : 'text-gray-900'}>AI Score Distribution</h2>
      </div>
      
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
            <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
            <linearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#c4b5fd" />
            </linearGradient>
            <linearGradient id="grad4" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#c4b5fd" />
              <stop offset="100%" stopColor="#ddd6fe" />
            </linearGradient>
          </defs>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
          >
            <Cell fill="url(#grad1)" />
            <Cell fill="url(#grad2)" />
            <Cell fill="url(#grad3)" />
            <Cell fill="url(#grad4)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <div className="mt-4 space-y-2 relative z-10">
        {data.map((item, index) => (
          <div key={index} className={`flex items-center justify-between text-sm px-2 py-1.5 rounded-lg transition-colors ${
            darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/50'
          }`}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br" style={{ 
                backgroundImage: `linear-gradient(135deg, ${item.color}, ${item.color}dd)` 
              }}></div>
              <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>{item.name}</span>
            </div>
            <span className={`bg-gradient-to-r bg-clip-text text-transparent ${
              darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
            }`}>{item.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}