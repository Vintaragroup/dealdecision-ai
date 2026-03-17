/**
 * QuickInsightCards — Grid of compact module cards for the quick view mode.
 */

import type { ModuleId, InsightModuleData } from '../../../types/investor-insights';
import { MODULE_ORDER } from '../../../types/investor-insights';
import { InsightModuleCard } from './InsightModuleCard';

interface QuickInsightCardsProps {
  darkMode: boolean;
  modules: Partial<Record<ModuleId, InsightModuleData>>;
}

export function QuickInsightCards({ darkMode, modules }: QuickInsightCardsProps) {
  const available = MODULE_ORDER.filter((id) => modules[id] != null);

  if (available.length === 0) {
    return (
      <div
        className={`p-6 rounded-xl border text-center ${
          darkMode ? 'bg-white/5 border-white/10 text-gray-500' : 'bg-gray-50 border-gray-200 text-gray-400'
        }`}
      >
        No module analysis available yet.
      </div>
    );
  }

  return (
    <div>
      <h3 className={`text-base font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        Module Scores
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {available.map((id) => {
          const mod = modules[id]!;
          return (
            <InsightModuleCard
              key={id}
              darkMode={darkMode}
              module={mod}
              variant="compact"
            />
          );
        })}
      </div>
    </div>
  );
}
