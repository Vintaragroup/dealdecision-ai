import { OnboardingFlow, OnboardingData } from './components/onboarding/OnboardingFlow';
import { NewDealModal, DealFormData } from './components/NewDealModal';
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
import { Gamification } from './components/pages/Gamification';
import { Templates } from './components/pages/Templates';
import { Team } from './components/pages/Team';
import { Profile } from './components/pages/Profile';
import { ROICalculator } from './components/pages/ROICalculator';
import { Settings } from './components/pages/Settings';
import { ReportsGenerated } from './components/pages/ReportsGenerated';
import { LogoShowcase } from './components/LogoShowcase';
import { ComponentShowcase } from './components/ComponentShowcase';
import { AppSettingsProvider } from './contexts/AppSettingsContext';
import { UserRoleProvider } from './contexts/UserRoleContext';
import { ScoreSourceProvider } from './contexts/ScoreSourceContext';
import { ChatAssistant } from './components/ChatAssistant';
import { ApiAuthBridge } from './components/auth/ApiAuthBridge';
import { useLocation, useNavigate } from 'react-router-dom';

type LogoVariant = 'orbiting' | 'pulse' | 'network' | 'hexagon' | 'morph';

// Default notification preferences
const defaultNotificationPreferences: NotificationPreferences = {
  roiSavings: {
    enabled: true,
    savingsMilestones: true,
    weeklyRoiSummaries: true,
    achievementUnlocks: true,
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
    enabled: true,
    newBadges: true,
    levelUps: true,
    challengeCompletions: true,
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
  return null;
}

function pathFromPage(page: PageView): string {
  if (page === 'profile') return '/app/profile';
  if (page === 'team') return '/app/team';
  if (page === 'settings') return '/app/settings';
  return '/app';
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();

  const [darkMode, setDarkMode] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoVariant, setLogoVariant] = useState<LogoVariant>('network');
  const [currentPage, setCurrentPage] = useState<PageView>('dashboard');
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedDealData, setSelectedDealData] = useState<DealFormData | null>(null);
  const [createdDeal, setCreatedDeal] = useState<Deal | null>(null);
  const [showNewDealModal, setShowNewDealModal] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    // Check if user has completed onboarding before
    const completed = localStorage.getItem('onboardingCompleted');
    return completed !== 'true'; // Show onboarding if not completed
  });

  const routeDrivenPage = useMemo(() => pageFromPath(location.pathname), [location.pathname]);

  useEffect(() => {
    if (routeDrivenPage) {
      setCurrentPage(routeDrivenPage);
    }
  }, [routeDrivenPage]);

  const handleDealClick = (dealId: string) => {
    setSelectedDealId(dealId);
    setSelectedDealData(null); // Clear any new deal data when clicking existing deal
    setCurrentPage('dealWorkspace');
    setMobileMenuOpen(false); // Close mobile menu on navigation
    // Keep the app within /app; internal pages (deal workspace) are not routed yet.
    navigate('/app');
  };

  const handleNavigate = (page: PageView) => {
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
    console.log('Onboarding completed:', data);
    setShowOnboarding(false);
    localStorage.setItem('onboardingCompleted', 'true');
  };

  const handleRestartOnboarding = () => {
    localStorage.removeItem('onboardingCompleted');
    setShowOnboarding(true);
  };

  const handleSaveNotificationPreferences = (prefs: NotificationPreferences) => {
    setNotificationPreferences(prefs);
    // TODO: Save to backend/localStorage when ready
    console.log('Notification preferences saved:', prefs);
  };

  useEffect(() => {
    // Apply theme at the document root so portals (e.g. dropdown menus) inherit it.
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  return (
    <AppSettingsProvider>
      <UserRoleProvider>
        <ScoreSourceProvider>
          <ApiAuthBridge />
          <div className={darkMode ? 'dark' : ''}>
            {/* Onboarding Flow */}
            {showOnboarding && (
              <OnboardingFlow 
                darkMode={darkMode} 
                onComplete={handleOnboardingComplete}
              />
            )}

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
                />
                <main className="flex-1 overflow-auto">
                  {currentPage === 'logoShowcase' && (
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
                  {currentPage === 'componentShowcase' && (
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
                    <Analytics darkMode={darkMode} />
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
                  {currentPage === 'gamification' && (
                    <Gamification darkMode={darkMode} />
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

                {/* Chat Assistant */}
                <ChatAssistant darkMode={darkMode} />
              </div>
            </div>
          </div>
        </ScoreSourceProvider>
      </UserRoleProvider>
    </AppSettingsProvider>
  );
}
