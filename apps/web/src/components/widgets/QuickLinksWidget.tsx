import { 
  FileText, 
  Users, 
  Sparkles, 
  BarChart3, 
  Target, 
  Calendar,
  Briefcase,
  TrendingUp,
  ArrowRight
} from 'lucide-react';
import type { PageView } from '../Sidebar';

export interface QuickLink {
  id: string;
  title: string;
  description: string;
  icon: 'document' | 'team' | 'users' | 'ai' | 'analytics' | 'target' | 'calendar' | 'briefcase' | 'trending';
  action: PageView;
}

interface QuickLinksWidgetProps {
  darkMode: boolean;
  links: QuickLink[];
  onLinkClick?: (linkId: string) => void;
  title?: string;
}

export function QuickLinksWidget({ 
  darkMode, 
  links,
  onLinkClick,
  title = 'Quick Actions'
}: QuickLinksWidgetProps) {
  const getIcon = (iconType: string) => {
    const iconClass = `w-4 h-4`;
    switch (iconType) {
      case 'document':
        return <FileText className={iconClass} />;
      case 'team':
        return <Users className={iconClass} />;
      case 'users':
        return <Users className={iconClass} />;
      case 'ai':
        return <Sparkles className={iconClass} />;
      case 'analytics':
        return <BarChart3 className={iconClass} />;
      case 'target':
        return <Target className={iconClass} />;
      case 'calendar':
        return <Calendar className={iconClass} />;
      case 'briefcase':
        return <Briefcase className={iconClass} />;
      case 'trending':
        return <TrendingUp className={iconClass} />;
      default:
        return <FileText className={iconClass} />;
    }
  };

  return (
    <div className={`p-5 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <h3 className={`text-base mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {title}
      </h3>

      <div className="space-y-2">
        {links.map((link) => (
          <button
            key={link.id}
            onClick={() => onLinkClick?.(link.id)}
            className={`w-full p-3 rounded-lg border transition-all group ${
              darkMode 
                ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20' 
                : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white`}>
                {getIcon(link.icon)}
              </div>
              
              <div className="flex-1 text-left">
                <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {link.title}
                </h4>
                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {link.description}
                </p>
              </div>
              
              <ArrowRight className={`w-4 h-4 transition-transform group-hover:translate-x-1 ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
