import { TrendingUp, Package, DollarSign, Users, PieChart, Briefcase, AlertTriangle, AlertOctagon, HelpCircle } from 'lucide-react';

interface SideNavigationProps {
  activeSection?: string;
  onSectionClick?: (sectionId: string) => void;
  darkMode?: boolean;
}

export function SideNavigation({ activeSection, onSectionClick, darkMode = true }: SideNavigationProps) {
  const sections = [
    { id: 'framing', label: 'Deal Framing', icon: Briefcase },
    { id: 'market', label: 'Market', icon: TrendingUp },
    { id: 'product', label: 'Product', icon: Package },
    { id: 'business-model', label: 'Business Model', icon: DollarSign },
    { id: 'traction', label: 'Traction', icon: PieChart },
    { id: 'financials', label: 'Financials', icon: DollarSign },
    { id: 'team', label: 'Team', icon: Users },
    { id: 'risks', label: 'Risks', icon: AlertTriangle },
    { id: 'red-flags', label: 'Red Flags', icon: AlertOctagon },
    { id: 'open-questions', label: 'Open Questions & Unknowns', icon: HelpCircle },
  ];

  return (
    <div className="sticky top-8 w-56">
      <div className={`rounded-xl border p-3 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
        <div className={`text-[10px] uppercase tracking-wider mb-3 px-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Jump To</div>
        <nav className="space-y-0.5">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => onSectionClick?.(section.id)}
                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-500/20 text-blue-400'
                    : darkMode
                      ? 'text-gray-400 hover:bg-white/10 hover:text-gray-300'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-xs">{section.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}