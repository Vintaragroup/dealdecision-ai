/**
 * ViewModeToggle — Switch between Quick, Detailed, and Executive Brief views.
 */

import type { ViewMode } from '../../../types/investor-insights';

interface ViewModeToggleProps {
  darkMode: boolean;
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'quick', label: 'Quick View' },
  { id: 'detailed', label: 'Detailed' },
  { id: 'executive', label: 'Executive Brief' },
];

export function ViewModeToggle({ darkMode, value, onChange }: ViewModeToggleProps) {
  return (
    <div className="flex justify-end">
      <div
        className={`inline-flex rounded-lg p-1 gap-1 ${
          darkMode ? 'bg-white/5 border border-white/10' : 'bg-gray-100 border border-gray-200'
        }`}
      >
        {MODES.map(({ id, label }) => {
          const active = value === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                active
                  ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-sm'
                  : darkMode
                  ? 'text-gray-400 hover:text-white hover:bg-white/5'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
