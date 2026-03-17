/**
 * InsightModules — Full detailed list of analysis module cards.
 * Used in the "detailed" view mode. Supports optional evidence per module.
 */

import type { ModuleId, InsightModuleData, EvidenceItem } from '../../../types/investor-insights';
import { MODULE_ORDER } from '../../../types/investor-insights';
import { InsightModuleCard } from './InsightModuleCard';

interface InsightModulesProps {
  darkMode: boolean;
  modules: Partial<Record<ModuleId, InsightModuleData>>;
  evidenceBase?: Partial<Record<ModuleId, EvidenceItem[]>> | null;
}

export function InsightModules({ darkMode, modules, evidenceBase }: InsightModulesProps) {
  const available = MODULE_ORDER.filter((id) => modules[id] != null);

  if (available.length === 0) {
    return (
      <div
        className={`p-6 rounded-xl border text-center ${
          darkMode
            ? 'bg-white/5 border-white/10 text-gray-500'
            : 'bg-gray-50 border-gray-200 text-gray-400'
        }`}
      >
        No module analysis available yet.
      </div>
    );
  }

  return (
    <>
      {available.map((id) => {
        const mod = modules[id]!;
        const evidence = evidenceBase?.[id] ?? null;
        return (
          <InsightModuleCard
            key={id}
            darkMode={darkMode}
            module={mod}
            variant="expanded"
            evidence={evidence}
          />
        );
      })}
    </>
  );
}
