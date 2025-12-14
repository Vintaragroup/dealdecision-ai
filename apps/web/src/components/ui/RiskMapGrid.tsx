import { useState } from 'react';
import { 
  TrendingUp, 
  Users, 
  DollarSign, 
  Target, 
  Zap, 
  Shield,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  XCircle
} from 'lucide-react';

interface Risk {
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  icon: any;
  description: string;
  details: string;
}

interface RiskMapGridProps {
  darkMode: boolean;
}

export function RiskMapGrid({ darkMode }: RiskMapGridProps) {
  const [selectedRisk, setSelectedRisk] = useState<Risk | null>(null);

  const risks: Risk[] = [
    {
      category: 'Market Risk',
      severity: 'low',
      icon: TrendingUp,
      description: 'Strong market positioning',
      details: 'Large addressable market ($12B TAM) with clear growth trajectory. Competitive landscape is manageable with strong differentiation.'
    },
    {
      category: 'Team Risk',
      severity: 'medium',
      icon: Users,
      description: 'Need technical co-founder',
      details: 'Strong business leadership but lacks technical expertise. Recommend bringing on a CTO with ML/AI background before Series A.'
    },
    {
      category: 'Financial Risk',
      severity: 'medium',
      icon: DollarSign,
      description: 'Funding runway: 8 months',
      details: 'Current burn rate sustainable but need Series A within 6-8 months. Revenue projections are realistic but customer acquisition costs need validation.'
    },
    {
      category: 'Competitive Risk',
      severity: 'low',
      icon: Target,
      description: 'Defensible moat',
      details: 'Patent pending on core AI algorithm. Strong early customer relationships and first-mover advantage in SMB segment.'
    },
    {
      category: 'Execution Risk',
      severity: 'low',
      icon: Zap,
      description: 'Clear roadmap',
      details: 'Well-defined product roadmap with realistic milestones. Team has strong execution track record from previous ventures.'
    },
    {
      category: 'Legal Risk',
      severity: 'low',
      icon: Shield,
      description: 'Clean cap table',
      details: 'No outstanding legal issues. IP properly assigned. Standard incorporation structure. Compliance frameworks in place.'
    }
  ];

  const severityConfig = {
    low: {
      label: 'LOW',
      color: 'from-green-500 to-emerald-600',
      bgColor: darkMode ? 'bg-green-500/10' : 'bg-green-50',
      borderColor: 'border-green-500/30',
      textColor: 'text-green-600',
      icon: CheckCircle
    },
    medium: {
      label: 'MEDIUM',
      color: 'from-yellow-500 to-orange-500',
      bgColor: darkMode ? 'bg-yellow-500/10' : 'bg-yellow-50',
      borderColor: 'border-yellow-500/30',
      textColor: 'text-yellow-600',
      icon: AlertTriangle
    },
    high: {
      label: 'HIGH',
      color: 'from-orange-500 to-red-500',
      bgColor: darkMode ? 'bg-orange-500/10' : 'bg-orange-50',
      borderColor: 'border-orange-500/30',
      textColor: 'text-orange-600',
      icon: AlertCircle
    },
    critical: {
      label: 'CRITICAL',
      color: 'from-red-500 to-red-700',
      bgColor: darkMode ? 'bg-red-500/10' : 'bg-red-50',
      borderColor: 'border-red-500/30',
      textColor: 'text-red-600',
      icon: XCircle
    }
  };

  return (
    <div className="space-y-4">
      {/* Risk Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {risks.map((risk) => {
          const Icon = risk.icon;
          const SeverityIcon = severityConfig[risk.severity].icon;
          const config = severityConfig[risk.severity];

          return (
            <button
              key={risk.category}
              onClick={() => setSelectedRisk(risk)}
              className={`p-4 rounded-lg backdrop-blur-xl border transition-all text-left ${
                config.bgColor
              } ${config.borderColor} ${
                selectedRisk?.category === risk.category
                  ? 'ring-2 ring-offset-2 ' + (darkMode ? 'ring-offset-[#0a0a0a]' : 'ring-offset-white')
                  : 'hover:scale-105'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br ${config.color}`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                  darkMode ? 'bg-black/20' : 'bg-white/50'
                } ${config.textColor}`}>
                  <SeverityIcon className="w-3 h-3" />
                  {config.label}
                </div>
              </div>
              
              <h3 className={`text-sm mb-1 ${
                darkMode ? 'text-white' : 'text-gray-900'
              }`}>
                {risk.category}
              </h3>
              
              <p className={`text-xs ${
                darkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {risk.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Selected Risk Details */}
      {selectedRisk && (
        <div className={`p-6 rounded-lg backdrop-blur-xl border ${
          darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
        }`}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center bg-gradient-to-br ${
                severityConfig[selectedRisk.severity].color
              }`}>
                {(() => {
                  const Icon = selectedRisk.icon;
                  return <Icon className="w-6 h-6 text-white" />;
                })()}
              </div>
              <div>
                <h3 className={`text-lg bg-gradient-to-r bg-clip-text text-transparent ${
                  darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                }`}>
                  {selectedRisk.category}
                </h3>
                <div className={`flex items-center gap-1 mt-1 text-xs ${
                  severityConfig[selectedRisk.severity].textColor
                }`}>
                  {(() => {
                    const SeverityIcon = severityConfig[selectedRisk.severity].icon;
                    return <SeverityIcon className="w-3 h-3" />;
                  })()}
                  {severityConfig[selectedRisk.severity].label} RISK
                </div>
              </div>
            </div>
            
            <button
              onClick={() => setSelectedRisk(null)}
              className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                darkMode 
                  ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
              }`}
            >
              Close
            </button>
          </div>
          
          <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {selectedRisk.details}
          </p>
        </div>
      )}

      {/* Risk Summary */}
      <div className={`p-4 rounded-lg backdrop-blur-xl border ${
        darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
      }`}>
        <div className="flex items-center justify-between">
          <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Risk Distribution:
          </span>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-green-500 to-emerald-600"></div>
              <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                {risks.filter(r => r.severity === 'low').length} Low
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-yellow-500 to-orange-500"></div>
              <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                {risks.filter(r => r.severity === 'medium').length} Medium
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-orange-500 to-red-500"></div>
              <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                {risks.filter(r => r.severity === 'high').length} High
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-red-500 to-red-700"></div>
              <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                {risks.filter(r => r.severity === 'critical').length} Critical
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
