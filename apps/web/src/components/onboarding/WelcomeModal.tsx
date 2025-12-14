import { Target, Sparkles, Users, Trophy, Zap, FileText, TrendingUp, BarChart3, Lightbulb, Rocket } from 'lucide-react';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useUserRole } from '../../contexts/UserRoleContext';
import { Button } from '../ui/Button';

interface WelcomeModalProps {
  darkMode: boolean;
  onGetStarted: () => void;
  onSkip: () => void;
}

export function WelcomeModal({ darkMode, onGetStarted, onSkip }: WelcomeModalProps) {
  const { settings } = useAppSettings();
  const { isFounder } = useUserRole();
  
  const investorFeatures = [
    {
      icon: <Target className="w-5 h-5" />,
      title: 'Due Diligence Analysis',
      description: 'Deep AI-powered analysis of investment opportunities'
    },
    {
      icon: <TrendingUp className="w-5 h-5" />,
      title: 'Deal Evaluation & Scoring',
      description: 'Comprehensive scoring across 15+ key metrics'
    },
    {
      icon: <FileText className="w-5 h-5" />,
      title: 'Investment Memo Generation',
      description: 'Auto-generate professional investment memos'
    },
    {
      icon: <BarChart3 className="w-5 h-5" />,
      title: 'Portfolio Analytics',
      description: 'Track and analyze your investment portfolio'
    }
  ];

  const founderFeatures = [
    {
      icon: <Rocket className="w-5 h-5" />,
      title: 'Pitch Deck Builder',
      description: 'Create compelling pitch decks with AI assistance'
    },
    {
      icon: <Sparkles className="w-5 h-5" />,
      title: 'AI Content Generation',
      description: 'Generate executive summaries and one-pagers'
    },
    {
      icon: <Target className="w-5 h-5" />,
      title: 'Investor Matching',
      description: 'Find and connect with the right investors'
    },
    {
      icon: <BarChart3 className="w-5 h-5" />,
      title: 'Fundraising Analytics',
      description: 'Track your fundraising progress and metrics'
    }
  ];

  const features = isFounder ? founderFeatures : investorFeatures;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className={`relative max-w-2xl w-full rounded-2xl shadow-2xl overflow-hidden border my-8 ${ 
          darkMode ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'
        }`}>
          {/* Decorative gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#6366f1]/10 via-transparent to-[#8b5cf6]/10 pointer-events-none"></div>
          
          {/* Animated orbs */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#6366f1]/20 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#8b5cf6]/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>

          <div className="relative p-8">
            {/* Logo & Welcome */}
            <div className="text-center mb-8">
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_30px_rgba(99,102,241,0.4)]">
                <Sparkles className="w-10 h-10 text-white" />
              </div>
              <h1 className={`text-3xl mb-2 bg-gradient-to-r bg-clip-text text-transparent ${
                darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
              }`}>
                Welcome to DealDecision AI
              </h1>
              <p className={`text-lg ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {isFounder 
                  ? 'Your AI-powered fundraising companion'
                  : 'Your AI-powered investment analysis platform'
                }
              </p>
            </div>

            {/* Features Grid */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg backdrop-blur-xl border transition-all hover:scale-105 ${
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className={`w-10 h-10 mb-3 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center text-white`}>
                    {feature.icon}
                  </div>
                  <h3 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {feature.title}
                  </h3>
                  <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col items-stretch gap-3">
              <Button 
                onClick={onGetStarted}
                className="w-full gap-2 py-3"
              >
                <Zap className="w-4 h-4" />
                Get Started
              </Button>
              <Button 
                onClick={onSkip}
                variant="ghost"
                className="w-full py-2"
              >
                Skip Tour
              </Button>
            </div>

            {/* Footer Note */}
            <p className={`text-center text-xs mt-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
              Takes only 2 minutes • Skip anytime
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}