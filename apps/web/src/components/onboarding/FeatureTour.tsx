import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useUserRole } from '../../contexts/UserRoleContext';
import { Button } from '../ui/button';

interface TourStep {
  title: string;
  description: string;
  icon: string;
  position: 'left' | 'right' | 'center';
}

interface FeatureTourProps {
  darkMode: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export function FeatureTour({ darkMode, onComplete, onSkip }: FeatureTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const { settings } = useAppSettings();
  const { isFounder } = useUserRole();

  const investorTourSteps: TourStep[] = [
    {
      title: 'Your Deal Command Center',
      description: settings.gamificationEnabled 
        ? 'The dashboard shows all your active deals, portfolio analytics, achievements, and AI insights at a glance.'
        : 'The dashboard shows all your active deals, portfolio analytics, and AI insights at a glance.',
      icon: '🎯',
      position: 'center'
    },
    {
      title: 'AI-Powered Due Diligence',
      description: 'Get instant analysis, risk assessments, and intelligent recommendations for every investment opportunity',
      icon: '🤖',
      position: 'center'
    },
    {
      title: 'Investment Reports',
      description: 'Generate investment memos, IC presentations, and due diligence reports with AI. Export instantly!',
      icon: '📄',
      position: 'center'
    },
    ...(settings.gamificationEnabled ? [{
      title: 'Level Up & Compete',
      description: 'Earn XP by analyzing deals, completing challenges, and maintaining streaks. Compete with your team on the leaderboard!',
      icon: '🏆',
      position: 'right' as const
    }] : []),
    {
      title: 'Team Collaboration',
      description: 'Share deals, comment, and collaborate with your investment team in real-time',
      icon: '👥',
      position: 'left' as const
    }
  ];

  const founderTourSteps: TourStep[] = [
    {
      title: 'Your Fundraising Hub',
      description: settings.gamificationEnabled 
        ? 'The dashboard tracks your fundraising progress, investor outreach, achievements, and AI-powered insights.'
        : 'The dashboard tracks your fundraising progress, investor outreach, and AI-powered insights.',
      icon: '🎯',
      position: 'center'
    },
    {
      title: 'AI-Powered Pitch Builder',
      description: 'Get instant feedback on your pitch, market analysis, and intelligent recommendations to attract investors',
      icon: '🤖',
      position: 'center'
    },
    {
      title: 'Pitch Materials',
      description: 'Create pitch decks, executive summaries, and one-pagers with AI. Export in multiple formats instantly!',
      icon: '📄',
      position: 'center'
    },
    ...(settings.gamificationEnabled ? [{
      title: 'Level Up & Compete',
      description: 'Earn XP by refining your pitch, completing challenges, and maintaining streaks. Compete with other founders!',
      icon: '🏆',
      position: 'right' as const
    }] : []),
    {
      title: 'Team Collaboration',
      description: 'Share your pitch materials, comment, and collaborate with your team in real-time',
      icon: '👥',
      position: 'left' as const
    }
  ];

  const tourSteps = isFounder ? founderTourSteps : investorTourSteps;

  const currentTour = tourSteps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === tourSteps.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-sm">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Tour Card */}
        <div className={`relative max-w-lg w-full rounded-xl shadow-2xl border my-8 ${ 
          darkMode ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'
        }`}>
          {/* Close Button */}
          <button
            onClick={onSkip}
            className={`absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
            }`}
          >
            <X className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
          </button>

          <div className="p-6">
            {/* Step Indicator */}
            <div className="flex items-center gap-1 mb-6">
              {tourSteps.map((_, index) => (
                <div
                  key={index}
                  className={`h-1 flex-1 rounded-full transition-all ${
                    index === currentStep
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                      : index < currentStep
                        ? darkMode ? 'bg-white/20' : 'bg-gray-300'
                        : darkMode ? 'bg-white/10' : 'bg-gray-200'
                  }`}
                ></div>
              ))}
            </div>

            {/* Icon */}
            <div className="text-center mb-4">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center text-5xl shadow-[0_0_30px_rgba(99,102,241,0.4)]">
                {currentTour.icon}
              </div>
            </div>

            {/* Content */}
            <div className="text-center mb-6">
              <h2 className={`text-2xl mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {currentTour.title}
              </h2>
              <p className={`text-base leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {currentTour.description}
              </p>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between gap-3">
              <Button
                onClick={handlePrev}
                variant="outline"
                disabled={isFirstStep}
                className="gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </Button>

              <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {currentStep + 1} of {tourSteps.length}
              </div>

              <Button
                onClick={handleNext}
                className="gap-2"
              >
                {isLastStep ? 'Finish' : 'Next'}
                {!isLastStep && <ChevronRight className="w-4 h-4" />}
              </Button>
            </div>

            {/* Skip Link */}
            {!isLastStep && (
              <button
                onClick={onSkip}
                className={`w-full text-center text-sm mt-4 ${
                  darkMode ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Skip tour
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}