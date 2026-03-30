import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState, ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  id?: string;
  defaultOpen?: boolean;
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
  evidenceCoverage
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section id={id} className="mb-6 scroll-mt-8">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-zinc-800/60 hover:bg-zinc-800/80 rounded-t-[14px] px-6 py-4 flex items-center justify-between transition-colors"
      >
        <div className="flex items-center gap-4">
          <h2 className="text-lg text-white">{title}</h2>
          {evidenceCoverage && (
            <div className="text-xs text-zinc-400">
              Evidence Coverage: 
              <span className="text-emerald-400 ml-1.5">{evidenceCoverage.strong}% Strong</span>
              <span className="text-zinc-500 mx-1">/</span>
              <span className="text-amber-400">{evidenceCoverage.moderate}% Moderate</span>
              <span className="text-zinc-500 mx-1">/</span>
              <span className="text-red-400">{evidenceCoverage.weak}% Weak</span>
            </div>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-zinc-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-zinc-400" />
        )}
      </button>
      {isOpen && (
        <div className="bg-zinc-800/30 rounded-b-[14px] p-6">
          {children}
        </div>
      )}
    </section>
  );
}