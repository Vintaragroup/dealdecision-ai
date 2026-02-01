import { Search, Bell, Grid3x3, Sun, Moon, RotateCcw, Home, ChevronRight, Menu, X, LogOut, Settings as SettingsIcon, Users, User as UserIcon } from 'lucide-react';
import { useState } from 'react';
import { useUserRole } from '../contexts/UserRoleContext';
import { useScoreSource } from '../contexts/ScoreSourceContext';
import { Switch } from './ui/switch';
import { useClerk, useUser } from '@clerk/clerk-react';
import type { PageView } from './Sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface HeaderProps {
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: (value: boolean) => void;
  currentPage?: string;
  mobileMenuOpen?: boolean;
  setMobileMenuOpen?: (value: boolean) => void;
  onNavigate?: (page: PageView) => void;
  onOpenCommandPalette?: () => void;
}

export function Header({ darkMode, setDarkMode, rightSidebarOpen, setRightSidebarOpen, currentPage = 'Dashboard', mobileMenuOpen, setMobileMenuOpen, onNavigate, onOpenCommandPalette }: HeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const { isAnalyst } = useUserRole();
  const { scoreSource, setScoreSource } = useScoreSource();
  const prefersFundability = scoreSource === 'fundability_v1';
  const { isLoaded: userLoaded, user } = useUser();
  const clerk = useClerk();

  const displayName = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Account';
  const avatarUrl = user?.imageUrl;

  const getPageTitle = (page: string) => {
    const pageTitles: Record<string, string> = {
      dashboard: 'Dashboard',
      dealsList: 'Deal Pipeline',
      analytics: 'Analytics',
      documents: 'Documents',
      aiStudio: isAnalyst ? 'Document Studio' : 'AI Studio',
      dueDiligence: 'Due Diligence Report',
      dealComparison: 'Deal Comparison',
      componentShowcase: 'Component Library',
      team: 'Team',
      templates: 'Templates',
      profile: 'Profile',
      roiCalculator: 'ROI Calculator',
      settings: 'Settings',
      dealWorkspace: 'Deal Workspace'
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
            readOnly
            onFocus={() => {
              setSearchFocused(true);
              onOpenCommandPalette?.();
            }}
            onBlur={() => setSearchFocused(false)}
            onClick={() => onOpenCommandPalette?.()}
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
        <button
          type="button"
          onClick={() => onOpenCommandPalette?.()}
          className={`lg:hidden p-2 rounded-lg transition-colors ${
          darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/80'
        }`}
        >
          <Search className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
        </button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open account menu"
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors focus:outline-none ${
                darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/50'
              }`}
            >
              <div className="relative">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${
                    avatarUrl ? '' : 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]'
                  }`}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon className="w-4 h-4 text-white" />
                  )}
                </div>
              </div>

              <div className="hidden sm:flex flex-col items-start leading-tight">
                <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {userLoaded ? displayName : 'Loading…'}
                </span>
                <span className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                  Account
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" sideOffset={8}>
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{userLoaded ? displayName : 'Loading…'}</span>
                <span className="text-xs text-muted-foreground">{user?.primaryEmailAddress?.emailAddress ?? ''}</span>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onNavigate?.('profile');
              }}
            >
              <UserIcon />
              Profile
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onNavigate?.('team');
              }}
            >
              <Users />
              Team
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onNavigate?.('settings');
              }}
            >
              <SettingsIcon />
              Settings
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <div className="px-2 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Score source</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{prefersFundability ? 'Fundability' : 'Fundamentals'}</span>
                  <Switch
                    checked={prefersFundability}
                    onCheckedChange={(checked) => setScoreSource(checked ? 'fundability_v1' : 'legacy')}
                    aria-label="Toggle score source"
                  />
                </div>
              </div>
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => {
                e.preventDefault();
                void clerk.signOut({ redirectUrl: '/' });
              }}
            >
              <LogOut />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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