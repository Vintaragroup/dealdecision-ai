import { useState } from 'react';
import { Button } from '../ui/button';
import { User, Briefcase, Target, Mail, Rocket } from 'lucide-react';
import { useUserRole } from '../../contexts/UserRoleContext';

interface ProfileSetupProps {
  darkMode: boolean;
  onComplete: (data: ProfileData) => void;
  onBack: () => void;
}

export interface ProfileData {
  name: string;
  email: string;
  role: string;
  focus: string[];
}

export function ProfileSetup({ darkMode, onComplete, onBack }: ProfileSetupProps) {
  const { isFounder } = useUserRole();
  const [formData, setFormData] = useState<ProfileData>({
    name: '',
    email: '',
    role: '',
    focus: []
  });

  const investorRoles = [
    { id: 'partner', label: 'Partner', icon: '👔' },
    { id: 'principal', label: 'Principal', icon: '💼' },
    { id: 'associate', label: 'Associate', icon: '📊' },
    { id: 'analyst', label: 'Analyst', icon: '📈' },
    { id: 'md', label: 'Managing Director', icon: '🎯' },
    { id: 'vp', label: 'VP/Director', icon: '⚡' }
  ];

  const founderRoles = [
    { id: 'ceo', label: 'CEO/Founder', icon: '👑' },
    { id: 'cto', label: 'CTO/Co-founder', icon: '💻' },
    { id: 'cpo', label: 'CPO', icon: '🎨' },
    { id: 'cmo', label: 'CMO', icon: '📣' },
    { id: 'cfo', label: 'CFO', icon: '💰' },
    { id: 'other', label: 'Other Exec', icon: '⚙️' }
  ];

  const investorFocusAreas = [
    { id: 'early-stage', label: 'Early-Stage', icon: '🌱' },
    { id: 'growth', label: 'Growth', icon: '📈' },
    { id: 'late-stage', label: 'Late-Stage', icon: '🚀' },
    { id: 'saas-b2b', label: 'B2B SaaS', icon: '☁️' },
    { id: 'fintech', label: 'FinTech', icon: '💳' },
    { id: 'healthtech', label: 'HealthTech', icon: '🏥' },
    { id: 'ai-ml', label: 'AI/ML', icon: '🤖' },
    { id: 'enterprise', label: 'Enterprise', icon: '🏢' },
    { id: 'consumer', label: 'Consumer', icon: '🛍️' }
  ];

  const founderFocusAreas = [
    { id: 'saas', label: 'SaaS', icon: '☁️' },
    { id: 'fintech', label: 'FinTech', icon: '💳' },
    { id: 'healthtech', label: 'HealthTech', icon: '🏥' },
    { id: 'ai-ml', label: 'AI/ML', icon: '🤖' },
    { id: 'ecommerce', label: 'E-commerce', icon: '🛒' },
    { id: 'marketplace', label: 'Marketplace', icon: '🏪' },
    { id: 'b2b', label: 'B2B', icon: '🏢' },
    { id: 'b2c', label: 'B2C', icon: '👥' },
    { id: 'hardware', label: 'Hardware', icon: '⚙️' }
  ];

  const roles = isFounder ? founderRoles : investorRoles;
  const focusAreas = isFounder ? founderFocusAreas : investorFocusAreas;

  const toggleFocus = (focusId: string) => {
    setFormData(prev => ({
      ...prev,
      focus: prev.focus.includes(focusId)
        ? prev.focus.filter(f => f !== focusId)
        : [...prev.focus, focusId]
    }));
  };

  const isValid = formData.name && formData.email && formData.role && formData.focus.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid) {
      onComplete(formData);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className={`relative max-w-2xl w-full rounded-2xl shadow-2xl overflow-hidden border my-8 ${ 
          darkMode ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="p-4 sm:p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                {isFounder ? <Rocket className="w-8 h-8 text-white" /> : <User className="w-8 h-8 text-white" />}
              </div>
              <h2 className={`text-2xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {isFounder ? 'Set up your founder profile' : 'Set up your investor profile'}
              </h2>
              <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {isFounder 
                  ? 'Tell us about your company and role'
                  : 'Help us personalize your deal flow experience'
                }
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Name & Email */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Full Name
                  </label>
                  <div className="relative">
                    <User className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      darkMode ? 'text-gray-500' : 'text-gray-400'
                    }`} />
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Sarah Chen"
                      className={`w-full pl-10 pr-4 py-2.5 rounded-lg border transition-all ${
                        darkMode
                          ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-[#6366f1]'
                          : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-[#6366f1]'
                      }`}
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Email
                  </label>
                  <div className="relative">
                    <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      darkMode ? 'text-gray-500' : 'text-gray-400'
                    }`} />
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="sarah@company.com"
                      className={`w-full pl-10 pr-4 py-2.5 rounded-lg border transition-all ${
                        darkMode
                          ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-[#6366f1]'
                          : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-[#6366f1]'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Role Selection */}
              <div>
                <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {isFounder ? 'Your Role' : 'Investment Role'}
                </label>
                <div className={`grid ${isFounder ? 'grid-cols-3' : 'grid-cols-3'} gap-3`}>
                  {roles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, role: role.id })}
                      className={`p-4 rounded-lg border transition-all ${
                        formData.role === role.id
                          ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] border-[#6366f1] shadow-[0_0_20px_rgba(99,102,241,0.3)]'
                          : darkMode
                            ? 'bg-white/5 border-white/10 hover:bg-white/10'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <div className="text-2xl mb-2">{role.icon}</div>
                      <div className={`text-sm ${
                        formData.role === role.id
                          ? 'text-white'
                          : darkMode ? 'text-white' : 'text-gray-900'
                      }`}>
                        {role.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Focus Areas */}
              <div>
                <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {isFounder ? 'Industry & Focus' : 'Investment Focus'} <span className="text-xs opacity-60">(Select multiple)</span>
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {focusAreas.map((area) => (
                    <button
                      key={area.id}
                      type="button"
                      onClick={() => toggleFocus(area.id)}
                      className={`p-3 rounded-lg border transition-all ${
                        formData.focus.includes(area.id)
                          ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] border-[#6366f1] shadow-[0_0_15px_rgba(99,102,241,0.3)]'
                          : darkMode
                            ? 'bg-white/5 border-white/10 hover:bg-white/10'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <div className="text-xl mb-1">{area.icon}</div>
                      <div className={`text-xs ${
                        formData.focus.includes(area.id)
                          ? 'text-white'
                          : darkMode ? 'text-white' : 'text-gray-900'
                      }`}>
                        {area.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-4">
                <Button
                  type="button"
                  onClick={onBack}
                  variant="outline"
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={!isValid}
                  className="flex-1"
                >
                  Continue
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}