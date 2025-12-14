import { Search, Bell, Grid3x3, Sun, Moon, RotateCcw, Home, ChevronRight, Menu, X } from 'lucide-react';
import { UserProfile } from './ui/UserProfile';
import { useState } from 'react';
import { useUserRole } from '../contexts/UserRoleContext';

interface HeaderProps {
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: (value: boolean) => void;
  currentPage?: string;
  mobileMenuOpen?: boolean;
  setMobileMenuOpen?: (value: boolean) => void;
}

export function Header({ darkMode, setDarkMode, rightSidebarOpen, setRightSidebarOpen, currentPage = 'Dashboard', mobileMenuOpen, setMobileMenuOpen }: HeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const { isFounder } = useUserRole();

  const getPageTitle = (page: string) => {
    const pageTitles: Record<string, string> = {
      dashboard: 'Dashboard',
      dealsList: isFounder ? 'My Companies' : 'Deal Pipeline',
      analytics: isFounder ? 'Fundraising Analytics' : 'Portfolio Analytics',
      documents: isFounder ? 'Pitch Materials' : 'Documents',
      aiStudio: 'Document Studio',
      dueDiligence: 'Due Diligence Report',
      dealComparison: 'Deal Comparison',
      gamification: 'Achievements & Progress',
      componentShowcase: 'Component Library',
      team: isFounder ? 'Founding Team' : 'Investment Team',
      templates: 'Templates',
      profile: 'Profile',
      roiCalculator: 'ROI Calculator',
      settings: 'Settings',
      dealWorkspace: isFounder ? 'Pitch Builder' : 'Deal Workspace'
    };
    return pageTitles[page] || 'Dashboard';
  };

  return (
    <header className={`h-[56px] backdrop-blur-xl border-b flex items-center justify-between px-4 md:px-6 ${
      darkMode 
        ? 'bg-[#0f0f0f]/80 border-white/5' 
        : 'bg-white/80 border-gray-200/50'
    }`}>
      <div className="flex items-center gap-2 md:gap-4">
        {/* Mobile Menu Button */}
        <button 
          onClick={() => setMobileMenuOpen?.(!mobileMenuOpen)}
          className={`lg:hidden p-2 rounded-lg transition-colors ${
            darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/80'
          }`}
        >
          {mobileMenuOpen ? (
            <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
          ) : (
            <Menu className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
          )}
        </button>

        {/* Desktop Breadcrumb */}
        <div className="hidden md:flex items-center gap-4">
          <button className={`p-2 rounded-lg transition-colors ${
            darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/80'
          }`}>
            <Grid3x3 className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
          </button>
          <button className={`p-2 rounded-lg transition-colors ${
            darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/80'
          }`}>
            <Home className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
          </button>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Pages</span>
            <ChevronRight className={`w-3 h-3 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
            <span className={`bg-gradient-to-r bg-clip-text text-transparent text-sm ${
              darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
            }`}>{getPageTitle(currentPage)}</span>
          </div>
        </div>

        {/* Mobile Page Title */}
        <div className="md:hidden">
          <span className={`bg-gradient-to-r bg-clip-text text-transparent ${
            darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
          }`}>{getPageTitle(currentPage)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {/* Search - Hidden on mobile */}
        <div className="hidden lg:block relative">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${
            searchFocused ? 'text-[#6366f1]' : darkMode ? 'text-gray-500' : 'text-gray-400'
          }`} />
          <input
            type="text"
            placeholder="Search deals, documents, investors..."
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className={`w-[280px] h-9 pl-10 pr-12 backdrop-blur-xl border rounded-lg text-sm focus:outline-none transition-all ${
              darkMode 
                ? 'bg-white/5 text-gray-300 placeholder-gray-500' 
                : 'bg-gray-100/80 text-gray-900 placeholder-gray-400'
            } ${
              searchFocused 
                ? 'border-[#6366f1] shadow-[0_0_20px_rgba(99,102,241,0.2)]' 
                : darkMode ? 'border-white/10' : 'border-gray-200'
            }`}
          />
          <kbd className={`absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 backdrop-blur-xl border rounded text-xs ${
            darkMode 
              ? 'bg-white/5 border-white/10 text-gray-500'
              : 'bg-gray-200/50 border-gray-300/50 text-gray-400'
          }`}>
            ⌘K
          </kbd>
        </div>

        {/* Mobile Search Icon */}
        <button className={`lg:hidden p-2 rounded-lg transition-colors ${
          darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/80'
        }`}>
          <Search className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
        </button>

        {/* User Profile - Hidden on small mobile */}
        <div className="hidden sm:block">
          <UserProfile
            name="Sarah Chen"
            level={12}
            currentXP={2850}
            maxXP={5000}
            darkMode={darkMode}
          />
        </div>

        {/* Theme Toggle */}
        <button 
          onClick={() => setDarkMode(!darkMode)}
          className={`p-2 rounded-lg transition-colors ${
            darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/80'
          }`}
        >
          {darkMode ? (
            <Sun className="w-4 h-4 text-gray-400" />
          ) : (
            <Moon className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {/* History - Hidden on mobile */}
        <button className={`hidden md:block p-2 rounded-lg transition-colors ${
          darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/80'
        }`}>
          <RotateCcw className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
        </button>

        {/* Notifications */}
        <button 
          onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
          className={`p-2 rounded-lg transition-all relative ${
            rightSidebarOpen 
              ? 'bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/20 border border-[#6366f1]/30' 
              : darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/80'
          }`}
        >
          <Bell className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] rounded-full shadow-[0_0_8px_rgba(99,102,241,0.6)]"></span>
        </button>

        {/* Grid - Hidden on mobile */}
        <button className={`hidden md:block p-2 rounded-lg transition-colors ${
          darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/80'
        }`}>
          <Grid3x3 className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
        </button>
      </div>
    </header>
  );
}