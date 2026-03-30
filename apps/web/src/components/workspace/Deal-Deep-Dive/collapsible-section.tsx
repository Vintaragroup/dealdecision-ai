import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState, ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  id?: string;
  defaultOpen?: boolean;
  darkMode?: boolean;
  evidenceCoverage?: {
    strong: number;
    moderate: number;
    weak: number;
  };
}

export function CollapsibleSection({ 
  title, 
  children, 
  id, 
  defaultOpen = false,
  darkMode = true,
  evidenceCoverage
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section id={id} className={`mb-6 scroll-mt-8 rounded-xl border overflow-hidden ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-6 py-4 flex items-center justify-between transition-colors border-b ${
          darkMode
            ? 'bg-white/5 hover:bg-white/10 border-white/10'
            : 'bg-gray-50 hover:bg-gray-100 border-gray-200'
        }`}
      >
        <div className="flex items-center gap-4">
          <h2 className={`text-sm uppercase tracking-wide ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{title}</h2>
          {evidenceCoverage && (
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Evidence Coverage: 
              <span className="text-emerald-400 ml-1.5">{evidenceCoverage.strong}% Strong</span>
              <span className={`${darkMode ? 'text-gray-500' : 'text-gray-500'} mx-1`}>/</span>
              <span className="text-amber-400">{evidenceCoverage.moderate}% Moderate</span>
              <span className={`${darkMode ? 'text-gray-500' : 'text-gray-500'} mx-1`}>/</span>
              <span className="text-red-400">{evidenceCoverage.weak}% Weak</span>
            </div>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
        ) : (
          <ChevronDown className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
        )}
      </button>
      {isOpen && (
        <div className={`p-6 ${darkMode ? 'bg-white/[0.02]' : 'bg-white'}`}>
          {children}
        </div>
      )}
    </section>
  );
}