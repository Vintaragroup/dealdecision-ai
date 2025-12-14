import { useState } from 'react';
import { WelcomeModal } from './WelcomeModal';
import { FeatureTour } from './FeatureTour';
import { ProfileSetup, ProfileData } from './ProfileSetup';
import { FirstDealGuide, DealData } from './FirstDealGuide';
import { CelebrationModal } from './CelebrationModal';

interface OnboardingFlowProps {
  darkMode: boolean;
  onComplete: (data: OnboardingData) => void;
}

export interface OnboardingData {
  profile?: ProfileData;
  deal?: DealData;
  skippedSteps: string[];
  completedAt: string;
}

type OnboardingStep = 
  | 'welcome' 
  | 'tour' 
  | 'profile' 
  | 'firstDeal' 
  | 'celebration' 
  | 'completed';

export function OnboardingFlow({ darkMode, onComplete }: OnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({
    skippedSteps: [],
    completedAt: ''
  });

  // Welcome handlers
  const handleWelcomeGetStarted = () => {
    setCurrentStep('tour');
  };

  const handleWelcomeSkip = () => {
    setOnboardingData(prev => ({
      ...prev,
      skippedSteps: [...prev.skippedSteps, 'welcome', 'tour']
    }));
    setCurrentStep('profile');
  };

  // Tour handlers
  const handleTourComplete = () => {
    setCurrentStep('profile');
  };

  const handleTourSkip = () => {
    setOnboardingData(prev => ({
      ...prev,
      skippedSteps: [...prev.skippedSteps, 'tour']
    }));
    setCurrentStep('profile');
  };

  // Profile handlers
  const handleProfileComplete = (profileData: ProfileData) => {
    setOnboardingData(prev => ({
      ...prev,
      profile: profileData
    }));
    setCurrentStep('firstDeal');
  };

  const handleProfileBack = () => {
    if (onboardingData.skippedSteps.includes('tour')) {
      setCurrentStep('welcome');
    } else {
      setCurrentStep('tour');
    }
  };

  // First Deal handlers
  const handleFirstDealComplete = (dealData: DealData) => {
    setOnboardingData(prev => ({
      ...prev,
      deal: dealData
    }));
    setCurrentStep('celebration');
  };

  const handleFirstDealSkip = () => {
    setOnboardingData(prev => ({
      ...prev,
      skippedSteps: [...prev.skippedSteps, 'firstDeal']
    }));
    setCurrentStep('celebration');
  };

  // Celebration handlers
  const handleCelebrationComplete = () => {
    const finalData: OnboardingData = {
      ...onboardingData,
      completedAt: new Date().toISOString()
    };
    setCurrentStep('completed');
    onComplete(finalData);
  };

  // Render current step
  switch (currentStep) {
    case 'welcome':
      return (
        <WelcomeModal
          darkMode={darkMode}
          onGetStarted={handleWelcomeGetStarted}
          onSkip={handleWelcomeSkip}
        />
      );

    case 'tour':
      return (
        <FeatureTour
          darkMode={darkMode}
          onComplete={handleTourComplete}
          onSkip={handleTourSkip}
        />
      );

    case 'profile':
      return (
        <ProfileSetup
          darkMode={darkMode}
          onComplete={handleProfileComplete}
          onBack={handleProfileBack}
        />
      );

    case 'firstDeal':
      return (
        <FirstDealGuide
          darkMode={darkMode}
          onComplete={handleFirstDealComplete}
          onSkip={handleFirstDealSkip}
        />
      );

    case 'celebration':
      return (
        <CelebrationModal
          darkMode={darkMode}
          onComplete={handleCelebrationComplete}
        />
      );

    case 'completed':
      return null;

    default:
      return null;
  }
}
