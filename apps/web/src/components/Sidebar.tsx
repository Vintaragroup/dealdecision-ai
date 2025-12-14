import { 
  LayoutDashboard, 
  FileText, 
  Target, 
  TrendingUp, 
  Users, 
  BookOpen,
  User,
  Briefcase,
  Award,
  Trophy,
  MessageSquare,
  Settings,
  BarChart3,
  Folder,
  Sparkles,
  HelpCircle,
  Plus,
  GitCompare,
  FileCode
} from 'lucide-react';
import { Logo } from './Logo';
import { useAppSettings } from '../contexts/AppSettingsContext';
import { useUserRole } from '../contexts/UserRoleContext';

type LogoVariant = 'orbiting' | 'pulse' | 'network' | 'hexagon' | 'morph';
type PageView = 'dashboard' | 'dealsList' | 'dealWorkspace' | 'analytics' | 'documents' | 'aiStudio' | 'gamification' | 'templates' | 'team' | 'profile' | 'roiCalculator' | 'settings' | 'logoShowcase' | 'componentShowcase' | 'dealComparison' | 'reportsGenerated';

interface SidebarProps {
  darkMode: boolean;
  logoVariant?: LogoVariant;
  currentPage: PageView;
  onNavigate: (page: PageView) => void;
  onRestartOnboarding?: () => void;
  onNewDeal?: () => void;
  mobileMenuOpen?: boolean;
  setMobileMenuOpen?: (open: boolean) => void;
}

export function Sidebar({ darkMode, logoVariant = 'network', currentPage, onNavigate, onRestartOnboarding, onNewDeal, mobileMenuOpen = false, setMobileMenuOpen }: SidebarProps) {
  const { settings } = useAppSettings();
  const { isInvestor, isFounder } = useUserRole();
  
  const getNavItemClass = (page: PageView) => {
    const isActive = currentPage === page;
    
    if (isActive) {
      return `flex items-center gap-3 px-3 py-2 rounded-lg shadow-[0_0_20px_rgba(99,102,241,0.15)] cursor-pointer ${
        darkMode
          ? 'text-white bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/20 backdrop-blur-xl border border-[#6366f1]/30'
          : 'text-gray-900 bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10 backdrop-blur-xl border border-[#6366f1]/30'
      }`;
    }
    
    return `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer ${
      darkMode 
        ? 'text-gray-300 hover:bg-white/5' 
        : 'text-gray-600 hover:bg-gray-100/80'
    }`;
  };

  return (
    <>
      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileMenuOpen?.(false)}
        />
      )}
      
      {/* Sidebar */}
      <aside className={`w-[240px] fixed lg:static inset-y-0 left-0 z-50 backdrop-blur-xl border-r flex flex-col transition-transform duration-300 ${
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      } ${
        darkMode 
          ? 'bg-[#0f0f0f]/95 border-white/5' 
          : 'bg-white/95 border-gray-200/50'
      }`}>
        {/* Logo */}
        <div className={`h-[56px] flex items-center px-6 md:px-4 border-b ${
          darkMode ? 'border-white/5' : 'border-gray-200/50'
        }`}>
          <div className="flex items-center gap-2">
            <Logo variant={logoVariant} size={24} />
            <span className={`bg-gradient-to-r bg-clip-text text-transparent text-sm lg:text-base ${
              darkMode ? 'from-white to-white/80' : 'from-gray-900 to-gray-700'
            }`}>DealDecision AI</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 overflow-y-auto">
          <div className="space-y-6">
            {/* New Deal Button */}
            {onNewDeal && (
              <button
                onClick={onNewDeal}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] transition-all`}
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm">{isFounder ? 'New Company' : 'New Deal'}</span>
              </button>
            )}

            {/* Main */}
            <div>
              <h3 className={`px-3 mb-2 text-xs uppercase tracking-wider ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}>Main</h3>
              <div className="space-y-1">
                <button 
                  onClick={() => onNavigate('dashboard')}
                  className={getNavItemClass('dashboard')}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span className="text-sm">Dashboard</span>
                </button>
                <button 
                  onClick={() => onNavigate('dealsList')}
                  className={getNavItemClass('dealsList')}
                >
                  <Folder className="w-4 h-4" />
                  <span className="text-sm">{isFounder ? 'My Companies' : 'Deal Pipeline'}</span>
                </button>
                <button 
                  onClick={() => onNavigate('documents')}
                  className={getNavItemClass('documents')}
                >
                  <FileText className="w-4 h-4" />
                  <span className="text-sm">{isFounder ? 'Pitch Materials' : 'Documents'}</span>
                </button>
                <button 
                  onClick={() => onNavigate('analytics')}
                  className={getNavItemClass('analytics')}
                >
                  <BarChart3 className="w-4 h-4" />
                  <span className="text-sm">{isFounder ? 'Fundraising Analytics' : 'Portfolio Analytics'}</span>
                </button>
                {/* Deal Comparison - Investor Only */}
                {isInvestor && (
                  <button 
                    onClick={() => onNavigate('dealComparison')}
                    className={getNavItemClass('dealComparison')}
                  >
                    <GitCompare className="w-4 h-4" />
                    <span className="text-sm">Compare Deals</span>
                  </button>
                )}
              </div>
            </div>

            {/* Tools */}
            <div>
              <h3 className={`px-3 mb-2 text-xs uppercase tracking-wider ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}>Tools</h3>
              <div className="space-y-1">
                {/* Document Studio - Founders Only */}
                {isFounder && (
                  <button 
                    onClick={() => onNavigate('aiStudio')}
                    className={getNavItemClass('aiStudio')}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span className="text-sm">Document Studio</span>
                  </button>
                )}
                <button 
                  onClick={() => onNavigate('reportsGenerated')}
                  className={getNavItemClass('reportsGenerated')}
                >
                  <FileCode className="w-4 h-4" />
                  <span className="text-sm">Reports Generated</span>
                </button>
                <button 
                  onClick={() => onNavigate('roiCalculator')}
                  className={getNavItemClass('roiCalculator')}
                >
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm">ROI Calculator</span>
                </button>
                <button 
                  onClick={() => onNavigate('templates')}
                  className={getNavItemClass('templates')}
                >
                  <FileText className="w-4 h-4" />
                  <span className="text-sm">Templates</span>
                </button>
              </div>
            </div>

            {/* Workspace */}
            <div>
              <h3 className={`px-3 mb-2 text-xs uppercase tracking-wider ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}>Workspace</h3>
              <div className="space-y-1">
                {settings.gamificationEnabled && (
                  <button 
                    onClick={() => onNavigate('gamification')}
                    className={getNavItemClass('gamification')}
                  >
                    <Trophy className="w-4 h-4" />
                    <span className="text-sm">Achievements</span>
                  </button>
                )}
                <button 
                  onClick={() => onNavigate('team')}
                  className={getNavItemClass('team')}
                >
                  <Users className="w-4 h-4" />
                  <span className="text-sm">{isFounder ? 'Founding Team' : 'Investment Team'}</span>
                </button>
                <button 
                  onClick={() => onNavigate('profile')}
                  className={getNavItemClass('profile')}
                >
                  <User className="w-4 h-4" />
                  <span className="text-sm">Profile</span>
                </button>
              </div>
            </div>

            {/* System */}
            <div>
              <h3 className={`px-3 mb-2 text-xs uppercase tracking-wider ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}>System</h3>
              <div className="space-y-1">
                <button 
                  onClick={() => onNavigate('settings')}
                  className={getNavItemClass('settings')}
                >
                  <Settings className="w-4 h-4" />
                  <span className="text-sm">Settings</span>
                </button>
                {onRestartOnboarding && (
                  <button 
                    onClick={onRestartOnboarding}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      darkMode 
                        ? 'text-gray-300 hover:bg-white/5' 
                        : 'text-gray-600 hover:bg-gray-100/80'
                    }`}
                  >
                    <HelpCircle className="w-4 h-4" />
                    <span className="text-sm">Restart Tour</span>
                  </button>
                )}
                <button className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  darkMode 
                    ? 'text-gray-300 hover:bg-white/5' 
                    : 'text-gray-600 hover:bg-gray-100/80'
                }`}>
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-sm">Support</span>
                </button>
              </div>
            </div>

            {/* Dev Tools */}
            <div>
              <h3 className={`px-3 mb-2 text-xs uppercase tracking-wider ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}>Dev</h3>
              <div className="space-y-1">
                <button 
                  onClick={() => onNavigate('componentShowcase')}
                  className={getNavItemClass('componentShowcase')}
                >
                  <BookOpen className="w-4 h-4" />
                  <span className="text-sm">Components</span>
                </button>
                <button 
                  onClick={() => onNavigate('logoShowcase')}
                  className={getNavItemClass('logoShowcase')}
                >
                  <Target className="w-4 h-4" />
                  <span className="text-sm">Logo Variants</span>
                </button>
              </div>
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className={`p-4 border-t ${
          darkMode ? 'border-white/5' : 'border-gray-200/50'
        }`}>
          <div className={`flex items-center gap-2 text-xs px-3 py-2 backdrop-blur-xl border rounded-lg ${
            darkMode
              ? 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/20'
              : 'bg-gradient-to-r from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
          }`}>
            <div className="w-6 h-6 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded shadow-[0_0_12px_rgba(99,102,241,0.4)]"></div>
            <span className={`bg-gradient-to-r bg-clip-text text-transparent ${
              darkMode ? 'from-gray-400 to-gray-500' : 'from-gray-600 to-gray-500'
            }`}>Powered by AI</span>
          </div>
        </div>
      </aside>
    </>
  );
}