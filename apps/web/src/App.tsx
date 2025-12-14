import { OnboardingFlow, OnboardingData } from './components/onboarding/OnboardingFlow';
import { NewDealModal, DealFormData } from './components/NewDealModal';
import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
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
import { ChatAssistant } from './components/ChatAssistant';

type LogoVariant = 'orbiting' | 'pulse' | 'network' | 'hexagon' | 'morph';
type PageView = 'dashboard' | 'dealsList' | 'dealWorkspace' | 'analytics' | 'documents' | 'aiStudio' | 'dueDiligence' | 'dealComparison' | 'gamification' | 'templates' | 'team' | 'profile' | 'roiCalculator' | 'settings' | 'logoShowcase' | 'componentShowcase' | 'reportsGenerated';

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

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoVariant, setLogoVariant] = useState<LogoVariant>('network');
  const [currentPage, setCurrentPage] = useState<PageView>('dashboard');
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedDealData, setSelectedDealData] = useState<DealFormData | null>(null);
  const [showNewDealModal, setShowNewDealModal] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    // Check if user has completed onboarding before
    const completed = localStorage.getItem('onboardingCompleted');
    return completed !== 'true'; // Show onboarding if not completed
  });

  const handleDealClick = (dealId: string) => {
    setSelectedDealId(dealId);
    setSelectedDealData(null); // Clear any new deal data when clicking existing deal
    setCurrentPage('dealWorkspace');
    setMobileMenuOpen(false); // Close mobile menu on navigation
  };

  const handleNavigate = (page: PageView) => {
    setCurrentPage(page);
    setMobileMenuOpen(false); // Close mobile menu on navigation
  };

  const handleNewDeal = () => {
    setShowNewDealModal(true);
  };

  const handleNewDealSuccess = (dealData: DealFormData) => {
    setSelectedDealData(dealData);
    setSelectedDealId(null); // Clear any selected deal ID
    setShowNewDealModal(false);
    setCurrentPage('dealWorkspace');
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

  return (
    <AppSettingsProvider>
      <UserRoleProvider>
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
                  <ReportsGenerated 
                    darkMode={darkMode}
                    onViewReport={(dealId) => {
                      if (dealId === 'vintara-001') {
                        setSelectedDealId(dealId);
                        setCurrentPage('dueDiligence');
                      }
                    }}
                  />
                )}
              </main>
              <RightSidebar 
                isOpen={rightSidebarOpen} 
                darkMode={darkMode}
                notificationPreferences={notificationPreferences}
              />
            </div>

            {/* Global Chat Assistant */}
            <ChatAssistant darkMode={darkMode} />
          </div>

          {/* New Deal Modal */}
          {showNewDealModal && (
            <NewDealModal 
              isOpen={showNewDealModal}
              darkMode={darkMode} 
              onSuccess={handleNewDealSuccess}
              onClose={() => setShowNewDealModal(false)}
            />
          )}
        </div>
      </UserRoleProvider>
    </AppSettingsProvider>
  );
}