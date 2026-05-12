import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface DeepAnalysisSection {
  title: string;
  content: React.ReactNode;
}

interface DeepAnalysisSectionProps {
  sections: DeepAnalysisSection[];
}

export function DeepAnalysisSection({ sections }: DeepAnalysisSectionProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  const toggleSection = (index: number) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSections(newExpanded);
  };

  return (
    <div className="bg-zinc-800/20 rounded-[14px] overflow-hidden">
      {sections.map((section, index) => {
        const isExpanded = expandedSections.has(index);
        
        return (
          <div key={index} className="border-b border-zinc-700/30 last:border-b-0">
            {/* Header */}
            <button
              onClick={() => toggleSection(index)}
              className="w-full flex items-center justify-between px-6 py-4 hover:bg-zinc-800/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-zinc-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                )}
                <span className="text-sm font-medium text-zinc-400">{section.title}</span>
              </div>
            </button>
            
            {/* Content */}
            {isExpanded && (
              <div className="px-6 pb-6 bg-zinc-800/40">
                {section.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
