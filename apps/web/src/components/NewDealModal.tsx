import { useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Textarea } from './ui/Textarea';
import { 
  Rocket, 
  DollarSign, 
  Clock, 
  TrendingUp, 
  Sparkles,
  CheckCircle,
  ArrowRight,
  PartyPopper
} from 'lucide-react';
import { AnimatedCounter } from './AnimatedCounter';

interface NewDealModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (dealData: DealFormData) => void;
  darkMode: boolean;
}

export interface DealFormData {
  id: string;
  name: string;
  company: string;
  type: 'seed' | 'series-a' | 'series-b' | 'series-c' | 'series-d';
  stage: 'idea' | 'mvp' | 'growth' | 'scale';
  investmentAmount: number;
  description: string;
  estimatedSavings: {
    money: number;
    hours: number;
  };
}

export function NewDealModal({ isOpen, onClose, onSuccess, darkMode }: NewDealModalProps) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Partial<DealFormData>>({
    type: 'seed',
    stage: 'idea',
    investmentAmount: 500000
  });
  const [showSuccess, setShowSuccess] = useState(false);

  const dealTypes = [
    { value: 'seed', label: 'Seed Round' },
    { value: 'series-a', label: 'Series A' },
    { value: 'series-b', label: 'Series B' },
    { value: 'series-c', label: 'Series C' },
    { value: 'series-d', label: 'Series D+' }
  ];

  const dealStages = [
    { value: 'idea', label: 'Idea Stage' },
    { value: 'mvp', label: 'MVP / Early Traction' },
    { value: 'growth', label: 'Growth Stage' },
    { value: 'scale', label: 'Scaling' }
  ];

  // Calculate estimated savings based on deal complexity
  const calculateSavings = () => {
    const baseAmount = formData.investmentAmount || 500000;
    const typeMultiplier = {
      'seed': 1.0,
      'series-a': 1.3,
      'series-b': 1.6,
      'series-c': 2.0,
      'series-d': 2.5
    }[formData.type || 'seed'];

    const stageMultiplier = {
      'idea': 1.5,
      'mvp': 1.2,
      'growth': 1.0,
      'scale': 0.9
    }[formData.stage || 'idea'];

    // Traditional costs breakdown:
    // - Legal fees for document drafting: $5,000 - $15,000
    // - Consultant fees for due diligence: $8,000 - $25,000
    // - Manual research time: 60-120 hours @ $150/hr = $9,000 - $18,000
    // - Risk of missed red flags: varies
    
    const baseMoneySaved = 22000 * typeMultiplier * stageMultiplier;
    const baseHoursSaved = 85 * typeMultiplier * stageMultiplier;

    return {
      money: Math.round(baseMoneySaved),
      hours: Math.round(baseHoursSaved)
    };
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      // Calculate savings and show success screen
      const savings = calculateSavings();
      const dealData: DealFormData = {
        id: `deal-${Date.now()}`,
        name: formData.name || 'Untitled Deal',
        company: formData.company || 'Unknown Company',
        type: formData.type || 'seed',
        stage: formData.stage || 'idea',
        investmentAmount: formData.investmentAmount || 500000,
        description: formData.description || '',
        estimatedSavings: savings
      };
      setFormData({ ...formData, estimatedSavings: savings });
      setShowSuccess(true);
      
      // Auto-proceed to workspace after showing success
      setTimeout(() => {
        onSuccess(dealData);
        handleClose();
      }, 3500);
    }
  };

  const handleClose = () => {
    setStep(1);
    setShowSuccess(false);
    setFormData({
      type: 'seed',
      stage: 'idea',
      investmentAmount: 500000
    });
    onClose();
  };

  const isStep1Valid = formData.name && formData.company && formData.type;
  const isStep2Valid = formData.investmentAmount && formData.investmentAmount > 0;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg" darkMode={darkMode}>
      {!showSuccess ? (
        <>
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.4)]">
              <Rocket className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Create New Deal
              </h2>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Step {step} of 2
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className={`h-2 rounded-full mb-8 overflow-hidden ${
            darkMode ? 'bg-white/5' : 'bg-gray-200'
          }`}>
            <div 
              className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all duration-300"
              style={{ width: `${(step / 2) * 100}%` }}
            />
          </div>

          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Deal Name <span className="text-red-400">*</span>
                </label>
                <Input
                  darkMode={darkMode}
                  placeholder="e.g., CloudScale SaaS Investment"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  autoFocus
                />
              </div>

              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Company Name <span className="text-red-400">*</span>
                </label>
                <Input
                  darkMode={darkMode}
                  placeholder="e.g., CloudScale Inc."
                  value={formData.company || ''}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Deal Type <span className="text-red-400">*</span>
                  </label>
                  <Select
                    darkMode={darkMode}
                    value={formData.type || 'seed'}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    options={dealTypes}
                  />
                </div>

                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Current Stage
                  </label>
                  <Select
                    darkMode={darkMode}
                    value={formData.stage || 'idea'}
                    onChange={(e) => setFormData({ ...formData, stage: e.target.value as any })}
                    options={dealStages}
                  />
                </div>
              </div>

              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Description (optional)
                </label>
                <Textarea
                  darkMode={darkMode}
                  placeholder="Brief description of the opportunity..."
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Step 2: Investment Details */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Target Investment Amount <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2">
                    <DollarSign className={`w-5 h-5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                  </div>
                  <Input
                    darkMode={darkMode}
                    type="number"
                    placeholder="500000"
                    value={formData.investmentAmount || ''}
                    onChange={(e) => setFormData({ ...formData, investmentAmount: parseInt(e.target.value) || 0 })}
                    className="pl-12"
                  />
                </div>
                <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                  Enter the investment amount you're considering
                </p>
              </div>

              {/* Preview Calculation */}
              {formData.investmentAmount && formData.investmentAmount > 0 && (
                <div className={`p-4 rounded-xl border ${
                  darkMode 
                    ? 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30' 
                    : 'bg-gradient-to-br from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
                }`}>
                  <div className="flex items-start gap-3 mb-3">
                    <Sparkles className="w-5 h-5 text-[#6366f1] mt-0.5" />
                    <div className="flex-1">
                      <h4 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Estimated Value with DealDecision AI
                      </h4>
                      <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Based on deal complexity and stage
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white/50'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="w-4 h-4 text-emerald-400" />
                        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Cost Savings
                        </span>
                      </div>
                      <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        ${calculateSavings().money.toLocaleString()}
                      </div>
                    </div>
                    
                    <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white/50'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-blue-400" />
                        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Time Saved
                        </span>
                      </div>
                      <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {calculateSavings().hours} hours
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* What's Included */}
              <div>
                <h4 className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  What you save vs. traditional methods:
                </h4>
                <div className="space-y-2">
                  {[
                    'Legal document drafting fees ($5K - $15K)',
                    'Due diligence consultant costs ($8K - $25K)',
                    'Manual research & analysis time (60-120 hrs)',
                    'Risk of missing critical red flags',
                    'Faster time to investment decision (weeks vs months)'
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                      <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {item}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between mt-8 pt-6 border-t border-white/5">
            {step > 1 ? (
              <Button
                variant="secondary"
                darkMode={darkMode}
                onClick={() => setStep(step - 1)}
              >
                Back
              </Button>
            ) : (
              <Button
                variant="secondary"
                darkMode={darkMode}
                onClick={handleClose}
              >
                Cancel
              </Button>
            )}

            <Button
              variant="primary"
              darkMode={darkMode}
              onClick={handleNext}
              disabled={step === 1 ? !isStep1Valid : !isStep2Valid}
              icon={step === 2 ? <Rocket className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
            >
              {step === 1 ? 'Continue' : 'Create Deal'}
            </Button>
          </div>
        </>
      ) : (
        /* Success Screen */
        <div className="py-8 text-center">
          <div className="mb-6 flex justify-center">
            <div className="w-20 h-20 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(99,102,241,0.5)] animate-pulse">
              <PartyPopper className="w-10 h-10 text-white" />
            </div>
          </div>

          <h3 className={`text-2xl mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Deal Created Successfully! 🎉
          </h3>
          
          <p className={`text-sm mb-8 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            You're already saving time and money with DealDecision AI
          </p>

          {/* Savings Display */}
          <div className="max-w-md mx-auto">
            <div className={`p-6 rounded-2xl border ${
              darkMode 
                ? 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30' 
                : 'bg-gradient-to-br from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
            }`}>
              <div className="flex items-center justify-center gap-2 mb-6">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                <h4 className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Your Estimated Savings
                </h4>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className={`p-4 rounded-xl ${darkMode ? 'bg-white/5' : 'bg-white/50'}`}>
                  <DollarSign className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                  <div className={`text-3xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    <AnimatedCounter 
                      value={formData.estimatedSavings?.money || 0} 
                      prefix="$"
                      duration={2000}
                    />
                  </div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Cost Savings
                  </div>
                </div>

                <div className={`p-4 rounded-xl ${darkMode ? 'bg-white/5' : 'bg-white/50'}`}>
                  <Clock className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                  <div className={`text-3xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    <AnimatedCounter 
                      value={formData.estimatedSavings?.hours || 0} 
                      suffix=" hrs"
                      duration={2000}
                    />
                  </div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Time Saved
                  </div>
                </div>
              </div>

              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                vs. traditional legal/consultant fees
              </div>
            </div>
          </div>

          <div className={`mt-6 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Opening your deal workspace...
          </div>
        </div>
      )}
    </Modal>
  );
}
