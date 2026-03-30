import { TrendingUp, Package, DollarSign, Users, PieChart, Briefcase, AlertTriangle, AlertOctagon, HelpCircle } from 'lucide-react';

interface SideNavigationProps {
  activeSection?: string;
  onSectionClick?: (sectionId: string) => void;
}

export function SideNavigation({ activeSection, onSectionClick }: SideNavigationProps) {
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
      <div className="bg-zinc-800/40 border border-zinc-700/30 rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-3 px-2">Jump To</div>
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
                    : 'text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-300'
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