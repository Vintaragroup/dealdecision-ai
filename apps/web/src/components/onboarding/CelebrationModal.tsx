import { useEffect, useState } from 'react';
import { Trophy, Sparkles, Zap } from 'lucide-react';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useUserRole } from '../../contexts/UserRoleContext';
import { Button } from '../ui/Button';

interface CelebrationModalProps {
  darkMode: boolean;
  onComplete: () => void;
}

export function CelebrationModal({ darkMode, onComplete }: CelebrationModalProps) {
  const [showConfetti, setShowConfetti] = useState(true);
  const { settings } = useAppSettings();
  const { isFounder } = useUserRole();

  useEffect(() => {
    // Hide confetti after 3 seconds
    const timer = setTimeout(() => {
      setShowConfetti(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm">
      {/* Confetti Effect */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute animate-fall"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-${Math.random() * 20}%`,
                animationDelay: `${Math.random() * 3}s`,
                animationDuration: `${2 + Math.random() * 2}s`
              }}
            >
              <div
                className={`w-2 h-2 rounded-full`}
                style={{
                  backgroundColor: ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'][Math.floor(Math.random() * 5)]
                }}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-screen items-center justify-center p-4">
        <div className={`relative max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden border my-8 ${ 
          darkMode ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'
        }`}>
          {/* Animated gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#6366f1]/20 via-transparent to-[#8b5cf6]/20 animate-pulse"></div>

          <div className="relative p-8 text-center">
            {/* Celebration Icon */}
            <div className="mb-6 relative">
              <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_50px_rgba(99,102,241,0.5)] animate-bounce">
                <Trophy className="w-12 h-12 text-white" />
              </div>
              {/* Sparkles around the icon */}
              <Sparkles className="absolute top-0 left-1/4 w-6 h-6 text-yellow-400 animate-ping" />
              <Zap className="absolute bottom-1/4 left-1/3 w-5 h-5 text-blue-400 animate-ping" style={{ animationDelay: '1s' }} />
            </div>

            {/* Title */}
            <h2 className={`text-3xl mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              🎉 You're all set!
            </h2>

            {/* Achievement Unlocked - Only show if gamification enabled */}
            {settings.gamificationEnabled && (
              <div className={`inline-block px-4 py-2 rounded-full mb-4 border ${
                darkMode 
                  ? 'bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/20 border-[#6366f1]/30'
                  : 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30'
              }`}>
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Achievement Unlocked: <strong>Getting Started</strong>
                  </span>
                </div>
              </div>
            )}

            {/* Description */}
            <p className={`text-lg mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {settings.gamificationEnabled 
                ? `Welcome to DealDecision AI! You've earned your first achievement and +250 XP`
                : isFounder
                  ? "Welcome to DealDecision AI! You're all set to start building your pitch."
                  : "Welcome to DealDecision AI! You're all set to start analyzing deals."}
            </p>

            {/* Rewards Grid - Only show if gamification enabled */}
            {settings.gamificationEnabled ? (
              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className={`p-4 rounded-lg border ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="text-2xl mb-2">🏆</div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Level 1
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Unlocked
                  </div>
                </div>

                <div className={`p-4 rounded-lg border ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="text-2xl mb-2">⚡</div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Bonus XP
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    +250 XP
                  </div>
                </div>

                <div className={`p-4 rounded-lg border ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="text-2xl mb-2">🎯</div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Ready to
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Analyze
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className={`p-4 rounded-lg border ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="text-2xl mb-2">🤖</div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    AI-Powered
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Analysis
                  </div>
                </div>

                <div className={`p-4 rounded-lg border ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="text-2xl mb-2">🎯</div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Ready to
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Analyze
                  </div>
                </div>
              </div>
            )}

            {/* Next Steps */}
            <div className={`p-4 rounded-lg border mb-6 text-left ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
            }`}>
              <div className={`text-sm mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                🚀 Quick Start Tips:
              </div>
              <ul className={`space-y-2 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 flex-shrink-0">✓</span>
                  <span>
                    {isFounder 
                      ? 'Check your dashboard for pitch refinement insights'
                      : 'Check your dashboard for AI-powered insights'
                    }
                  </span>
                </li>
                {settings.gamificationEnabled && (
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 flex-shrink-0">✓</span>
                    <span>Complete daily challenges to earn more XP</span>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <span className="text-green-500 flex-shrink-0">✓</span>
                  <span>
                    {isFounder
                      ? 'Use AI Studio to generate pitch materials instantly'
                      : 'Use AI Studio to generate documents instantly'
                    }
                  </span>
                </li>
                {settings.gamificationEnabled && (
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 flex-shrink-0">✓</span>
                    <span>Compete on the leaderboard with your team</span>
                  </li>
                )}
              </ul>
            </div>

            {/* CTA */}
            <Button onClick={onComplete} className="w-full gap-2 py-3">
              <Zap className="w-4 h-4" />
              {isFounder ? 'Start Building Your Pitch' : 'Start Analyzing Deals'}
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fall {
          to {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
          }
        }
        .animate-fall {
          animation: fall linear forwards;
        }
      `}</style>
    </div>
  );
}