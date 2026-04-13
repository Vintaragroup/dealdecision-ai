import { OnboardingFlow, OnboardingData } from './components/onboarding/OnboardingFlow';
import { NewDealModal } from './components/newDeal_Modal';
import type { DealFormData } from './components/Modal_Legacy/NewDealModal';
import { useEffect, useMemo, useState } from 'react';
import type { Deal } from '@dealdecision/contracts';
import { Sidebar, PageView } from './components/Sidebar';
import { Header } from './components/Header';
import { RightSidebar, NotificationPreferences } from './components/RightSidebar';
import { DashboardContent } from './components/DashboardContent';
import { DealsList } from './components/pages/DealsList';
import { DealWorkspace } from './components/pages/DealWorkspace';
import { Analytics } from './components/pages/Analytics';
import { DocumentsPage } from './components/pages/DocumentsPage';
import { AIStudio } from './components/pages/AIStudio';
import { DueDiligenceReport } from './components/pages/DueDiligenceReport';
import { DealComparison } from './components/pages/DealComparison';
import { Templates } from './components/pages/Templates';
import { Team } from './components/pages/Team';
import { Profile } from './components/pages/Profile';
import { ROICalculator } from './components/pages/ROICalculator';
import { Settings } from './components/pages/Settings';
import { ReportsGenerated } from './components/pages/ReportsGenerated';
import AdminControlPanel from './components/pages/SystemAdminPage';
import { LogoShowcase } from './components/LogoShowcase';
import { ComponentShowcase } from './components/ComponentShowcase';
import { AppSettingsProvider } from './contexts/AppSettingsContext';
import { UserRoleProvider } from './contexts/UserRoleContext';
import { ScoreSourceProvider } from './contexts/ScoreSourceContext';
import { ChatAssistant } from './components/ChatAssistant';
import { CommandPalette } from './components/CommandPalette';
import { ApiAuthBridge } from './components/auth/ApiAuthBridge';
import { ApiMutationsPanel } from './components/debug/ApiMutationsPanel';
import { DealsListDebugBadge } from './components/debug/DealsListDebugBadge';
import { apiTrackDealView } from './lib/apiClient';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import { clearLocalOnboardingComplete, getPostLoginRoute, markOnboardingComplete, maybeBackfillOnboardingComplete } from './lib/postLoginRouting';

type LogoVariant = 'orbiting' | 'pulse' | 'network' | 'hexagon' | 'morph';

// Default notification preferences
const defaultNotificationPreferences: NotificationPreferences = {
  roiSavings: {
    enabled: true,
    savingsMilestones: true,
    weeklyRoiSummaries: true,
    achievementUnlocks: false,
  },
  dealUpdates: {
    enabled: true,
    statusChanges: true,
    scoreImprovements: true,
    milestonesReached: true,
  },
  aiAnalysis: {
    enabled: true,
    analysisComplete: true,
    documentGeneration: true,
    reportReady: true,
  },
  teamCollaboration: {
    enabled: true,
    mentions: true,
    comments: true,
    teamActivity: false, // Default off to reduce noise
  },
  achievements: {
    enabled: false,
    newBadges: false,
    levelUps: false,
    challengeCompletions: false,
  },
  documents: {
    enabled: true,
    uploaded: false, // Default off
    versionUpdates: true,
    reviewRequests: true,
  },
};

function pageFromPath(pathname: string): PageView | null {
  if (pathname === '/app' || pathname === '/app/') return null;
  if (pathname.startsWith('/app/profile')) return 'profile';
  if (pathname.startsWith('/app/team')) return 'team';
  if (pathname.startsWith('/app/settings')) return 'settings';
  if (pathname.startsWith('/app/admin')) return 'systemAdmin';
  return null;
}

function pathFromPage(page: PageView): string {
  if (page === 'profile') return '/app/profile';
  if (page === 'team') return '/app/team';
  if (page === 'settings') return '/app/settings';
  if (page === 'systemAdmin') return '/app/admin';
  return '/app';
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoaded: userLoaded } = useUser();

  const [darkMode, setDarkMode] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [logoVariant, setLogoVariant] = useState<LogoVariant>('network');
  const [currentPage, setCurrentPage] = useState<PageView>('dashboard');
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedDealData, setSelectedDealData] = useState<DealFormData | null>(null);
  const [createdDeal, setCreatedDeal] = useState<Deal | null>(null);
  const [showNewDealModal, setShowNewDealModal] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);

  const routeDrivenPage = useMemo(() => pageFromPath(location.pathname), [location.pathname]);

  const isRyanAdmin = useMemo(() => {
    // COSMETIC ONLY — gates logo/component showcase pages (internal dev tools).
    // Not a security guard. Admin access to /system/admin is DB-backed (platform_access.is_admin).
    if (!userLoaded) return false;
    const email = user?.primaryEmailAddress?.emailAddress;
    return typeof email === 'string' && email.toLowerCase() === 'ryan@vintaragroup.com';
  }, [userLoaded, user]);

  useEffect(() => {
    if (routeDrivenPage) {
      setCurrentPage(routeDrivenPage);
    }
  }, [routeDrivenPage]);

  useEffect(() => {
    if (!userLoaded) return;
    const decision = getPostLoginRoute({ user, pathname: location.pathname });
    if (import.meta.env.DEV) {
      // Minimal trace to debug production routing issues during dev/staging.
      console.debug('[post-login-route]', {
        pathname: location.pathname,
        decided: decision.route,
        reason: decision.reason,
      });
    }
    if (decision.route !== location.pathname) {
      navigate(decision.route, { replace: true });
    }
  }, [location.pathname, navigate, user, userLoaded]);

  useEffect(() => {
    if (!userLoaded) return;
    // Best-effort: for existing users missing the flag, persist onboardingComplete
    // so they don't get forced into onboarding on future sessions/devices.
    void maybeBackfillOnboardingComplete({ user });
  }, [userLoaded, user?.id]);

  useEffect(() => {
    if (!userLoaded) return;
    if (!isRyanAdmin && (currentPage === 'logoShowcase' || currentPage === 'componentShowcase')) {
      setCurrentPage('dashboard');
      navigate('/app');
    }
  }, [currentPage, isRyanAdmin, navigate, userLoaded]);

  const handleDealClick = (dealId: string) => {
    void apiTrackDealView(dealId).catch((err) => {
      if (import.meta.env.DEV) {
        console.debug('[deal-view-track-failed]', { dealId, err });
      }
    });
    setSelectedDealId(dealId);
    setSelectedDealData(null); // Clear any new deal data when clicking existing deal
    setCurrentPage('dealWorkspace');
    setMobileMenuOpen(false); // Close mobile menu on navigation
    // Keep the app within /app; internal pages (deal workspace) are not routed yet.
    navigate('/app');
  };

  const handleNavigate = (page: PageView) => {
    if (page === 'gamification') {
      setCurrentPage('dashboard');
      setMobileMenuOpen(false);
      navigate('/app');
      return;
    }
    if (!isRyanAdmin && (page === 'logoShowcase' || page === 'componentShowcase')) {
      setCurrentPage('dashboard');
      setMobileMenuOpen(false);
      navigate('/app');
      return;
    }
    setCurrentPage(page);
    setMobileMenuOpen(false); // Close mobile menu on navigation
    navigate(pathFromPage(page));
  };

  const handleNewDeal = () => {
    setShowNewDealModal(true);
  };

  const handleNewDealSuccess = (dealData: DealFormData, created?: Deal) => {
    if (created) {
      setCreatedDeal(created);
      setSelectedDealId(created.id);
    } else {
      setSelectedDealId(null);
    }
    setSelectedDealData(dealData);
    setShowNewDealModal(false);
    setCurrentPage('dealWorkspace');
    navigate('/app');
  };

  const handleOnboardingComplete = (data: OnboardingData) => {
    if (import.meta.env.DEV) {
      console.debug('[onboarding] completed', data);
    }
    void markOnboardingComplete({ user }).finally(() => {
      navigate('/app', { replace: true });
    });
  };

  const handleRestartOnboarding = () => {
    clearLocalOnboardingComplete();
    navigate('/app/onboarding');
  };

  const handleSaveNotificationPreferences = (prefs: NotificationPreferences) => {
    setNotificationPreferences(prefs);
    // TODO: Save to backend/localStorage when ready
    if (import.meta.env.DEV) console.debug('[AppShell] notification preferences saved:', prefs);
  };

  useEffect(() => {
    // Apply theme at the document root so portals (e.g. dropdown menus) inherit it.
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === 'k';
      if (!isK) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setCommandPaletteOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <AppSettingsProvider>
      <UserRoleProvider>
        <ScoreSourceProvider>
          <ApiAuthBridge />
          <div className={darkMode ? 'dark' : ''}>
            {location.pathname.startsWith('/app/onboarding') ? (
              <OnboardingFlow darkMode={darkMode} onComplete={handleOnboardingComplete} />
            ) : null}

            {/* Main App */}
            <div className={`flex h-screen overflow-hidden ${
              darkMode ? 'bg-[#0a0a0a]' : 'bg-gradient-to-br from-gray-50 via-white to-gray-100'
            }`}>
              <Sidebar 
                darkMode={darkMode} 
                logoVariant={logoVariant}
                currentPage={currentPage}
                onNavigate={handleNavigate}
                onRestartOnboarding={handleRestartOnboarding}
                onNewDeal={handleNewDeal}
                mobileMenuOpen={mobileMenuOpen}
                setMobileMenuOpen={setMobileMenuOpen}
              />
              <div className="flex-1 flex flex-col min-w-0 relative">
                <Header 
                  darkMode={darkMode} 
                  setDarkMode={setDarkMode}
                  rightSidebarOpen={rightSidebarOpen}
                  setRightSidebarOpen={setRightSidebarOpen}
                  currentPage={currentPage}
                  mobileMenuOpen={mobileMenuOpen}
                  setMobileMenuOpen={setMobileMenuOpen}
                  onNavigate={handleNavigate}
                  onOpenCommandPalette={() => setCommandPaletteOpen(true)}
                />
                <main className="flex-1 overflow-auto">
                  {currentPage === 'logoShowcase' && isRyanAdmin && (
                    <div className="p-6">
                      <LogoShowcase 
                        darkMode={darkMode} 
                        onSelect={(variant) => {
                          setLogoVariant(variant);
                          setTimeout(() => setCurrentPage('dashboard'), 500);
                          navigate('/app');
                        }} 
                      />
                    </div>
                  )}
                  {currentPage === 'componentShowcase' && isRyanAdmin && (
                    <ComponentShowcase darkMode={darkMode} />
                  )}
                  {currentPage === 'dashboard' && (
                    <DashboardContent 
                      darkMode={darkMode}
                      onNavigate={handleNavigate}
                      onDealClick={handleDealClick}
                      onNewDeal={handleNewDeal}
                    />
                  )}
                  {currentPage === 'dealsList' && (
                    <DealsList 
                      darkMode={darkMode} 
                      onDealClick={handleDealClick} 
                      onNewDeal={handleNewDeal}
                      createdDeal={createdDeal}
                    />
                  )}
                  {currentPage === 'dealWorkspace' && (
                    <DealWorkspace 
                      darkMode={darkMode} 
                      onViewReport={() => setCurrentPage('dueDiligence')}
                      dealData={selectedDealData}
                      dealId={selectedDealId || undefined}
                    />
                  )}
                  {currentPage === 'analytics' && (
                    <Analytics darkMode={darkMode} onNavigate={handleNavigate} onDealClick={handleDealClick} />
                  )}
                  {currentPage === 'documents' && (
                    <DocumentsPage darkMode={darkMode} />
                  )}
                  {currentPage === 'aiStudio' && (
                    <AIStudio darkMode={darkMode} />
                  )}
                  {currentPage === 'dueDiligence' && (
                    <DueDiligenceReport 
                      darkMode={darkMode}
                      dealId={selectedDealId || undefined}
                      onBack={() => setCurrentPage('dealWorkspace')}
                      onCompare={() => setCurrentPage('dealComparison')}
                    />
                  )}
                  {currentPage === 'dealComparison' && (
                    <DealComparison 
                      darkMode={darkMode}
                      onBack={() => setCurrentPage('dueDiligence')}
                    />
                  )}
                  {currentPage === 'templates' && (
                    <Templates darkMode={darkMode} />
                  )}
                  {currentPage === 'team' && (
                    <Team darkMode={darkMode} />
                  )}
                  {currentPage === 'profile' && (
                    <Profile darkMode={darkMode} setDarkMode={setDarkMode} />
                  )}
                  {currentPage === 'roiCalculator' && (
                    <ROICalculator darkMode={darkMode} />
                  )}
                  {currentPage === 'settings' && (
                    <Settings
                      darkMode={darkMode}
                      notificationPreferences={notificationPreferences}
                      onSavePreferences={handleSaveNotificationPreferences}
                    />
                  )}
                  {currentPage === 'reportsGenerated' && (
                    <ReportsGenerated darkMode={darkMode} />
                  )}
                  {currentPage === 'systemAdmin' && (
                    <AdminControlPanel />
                  )}
                </main>

                {/* New Deal Modal */}
                {showNewDealModal && (
                  <NewDealModal
                    isOpen={showNewDealModal}
                    darkMode={darkMode}
                    onClose={() => setShowNewDealModal(false)}
                    onSuccess={handleNewDealSuccess}
                  />
                )}

                {/* Right Sidebar */}
                <RightSidebar
                  darkMode={darkMode}
                  isOpen={rightSidebarOpen}
                  notificationPreferences={notificationPreferences}
                />

                <CommandPalette
                  open={commandPaletteOpen}
                  onOpenChange={setCommandPaletteOpen}
                  onNavigate={handleNavigate}
                  onToggleDarkMode={() => setDarkMode((d) => !d)}
                  onToggleNotifications={() => setRightSidebarOpen((o) => !o)}
                />

                {/* Chat Assistant — hidden when Deal Workspace is open (AIDealAssistant handles chat there) */}
                {currentPage !== 'dealWorkspace' && <ChatAssistant darkMode={darkMode} />}

                {/* Runtime-only production debug panel (disabled unless opted-in via localStorage/query param) */}
                <ApiMutationsPanel />

                {/* Runtime-only DealsList visibility badge (disabled unless opted-in via localStorage/query param) */}
                <DealsListDebugBadge />
              </div>
            </div>
          </div>
        </ScoreSourceProvider>
      </UserRoleProvider>
    </AppSettingsProvider>
  );
}
