import { Award, ChevronRight } from 'lucide-react';

const items = [
  { name: 'Market Analysis', progress: 92 },
  { name: 'Financial Review', progress: 78 },
  { name: 'Team Assessment', progress: 65 },
  { name: 'Legal Compliance', progress: 88 },
  { name: 'Tech Stack Audit', progress: 54 },
  { name: 'Competitive Landscape', progress: 71 }
];

interface DueDiligenceProgressProps {
  darkMode: boolean;
}

export function DueDiligenceProgress({ darkMode }: DueDiligenceProgressProps) {
  return (
    <div className={`backdrop-blur-xl border rounded-2xl p-6 relative overflow-hidden ${
      darkMode
        ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5 shadow-[0_0_40px_rgba(0,0,0,0.3)]'
        : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50 shadow-lg'
    }`}>
      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-br opacity-50 ${
        darkMode ? 'from-[#8b5cf6]/5 to-transparent' : 'from-[#6366f1]/3 to-transparent'
      }`}></div>
      
      <div className="mb-6 relative z-10">
        <h2 className={darkMode ? 'text-white' : 'text-gray-900'}>Due Diligence Progress</h2>
      </div>
      
      <div className="space-y-4 relative z-10">
        {items.map((item, index) => (
          <div key={index} className="space-y-2 group cursor-pointer">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className={`transition-colors ${
                  darkMode ? 'text-gray-300 group-hover:text-white' : 'text-gray-700 group-hover:text-gray-900'
                }`}>{item.name}</span>
                {item.progress === 100 && (
                  <Award className="w-3 h-3 text-[#6366f1] drop-shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className={`bg-gradient-to-r bg-clip-text text-transparent ${
                  darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                }`}>{item.progress}%</span>
                <ChevronRight className={`w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ${
                  darkMode ? 'text-gray-600' : 'text-gray-400'
                }`} />
              </div>
            </div>
            <div className={`h-2 backdrop-blur-xl border rounded-full overflow-hidden ${
              darkMode 
                ? 'bg-white/5 border-white/10' 
                : 'bg-gray-200/50 border-gray-300/30'
            }`}>
              <div 
                className="h-full bg-gradient-to-r from-[#6366f1] via-[#8b5cf6] to-[#a78bfa] rounded-full transition-all duration-500 shadow-[0_0_12px_rgba(99,102,241,0.4)]"
                style={{ width: `${item.progress}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>

      <div className={`mt-6 pt-6 border-t relative z-10 ${
        darkMode ? 'border-white/10' : 'border-gray-200/50'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Overall Completion</span>
          <span className="text-xl bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent">74%</span>
        </div>
        <div className={`flex items-center gap-2 text-xs px-3 py-2 backdrop-blur-xl border rounded-lg ${
          darkMode
            ? 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/20'
            : 'bg-gradient-to-r from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
        }`}>
          <Award className="w-3 h-3 text-[#6366f1]" />
          <span className={`bg-gradient-to-r bg-clip-text text-transparent ${
            darkMode ? 'from-gray-400 to-gray-500' : 'from-gray-600 to-gray-500'
          }`}>Complete all tasks to unlock achievement</span>
        </div>
      </div>
    </div>
  );
}
