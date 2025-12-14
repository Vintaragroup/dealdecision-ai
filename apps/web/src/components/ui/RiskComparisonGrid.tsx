import { CheckCircle, AlertTriangle, AlertCircle, XCircle } from 'lucide-react';

interface RiskLevel {
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface DealRisks {
  dealName: string;
  market: RiskLevel['severity'];
  team: RiskLevel['severity'];
  financial: RiskLevel['severity'];
  competitive: RiskLevel['severity'];
  execution: RiskLevel['severity'];
  legal: RiskLevel['severity'];
}

interface RiskComparisonGridProps {
  deals: DealRisks[];
  darkMode: boolean;
}

export function RiskComparisonGrid({ deals, darkMode }: RiskComparisonGridProps) {
  const riskCategories = [
    { id: 'market', label: 'Market Risk' },
    { id: 'team', label: 'Team Risk' },
    { id: 'financial', label: 'Financial Risk' },
    { id: 'competitive', label: 'Competitive Risk' },
    { id: 'execution', label: 'Execution Risk' },
    { id: 'legal', label: 'Legal Risk' }
  ];

  const severityConfig = {
    low: {
      icon: CheckCircle,
      label: 'LOW',
      color: 'text-green-500',
      bgColor: darkMode ? 'bg-green-500/20' : 'bg-green-100',
      borderColor: 'border-green-500/30'
    },
    medium: {
      icon: AlertTriangle,
      label: 'MED',
      color: 'text-yellow-500',
      bgColor: darkMode ? 'bg-yellow-500/20' : 'bg-yellow-100',
      borderColor: 'border-yellow-500/30'
    },
    high: {
      icon: AlertCircle,
      label: 'HIGH',
      color: 'text-orange-500',
      bgColor: darkMode ? 'bg-orange-500/20' : 'bg-orange-100',
      borderColor: 'border-orange-500/30'
    },
    critical: {
      icon: XCircle,
      label: 'CRIT',
      color: 'text-red-500',
      bgColor: darkMode ? 'bg-red-500/20' : 'bg-red-100',
      borderColor: 'border-red-500/30'
    }
  };

  return (
    <div className={`overflow-x-auto rounded-lg border ${
      darkMode ? 'border-white/10' : 'border-gray-200'
    }`}>
      <table className="w-full">
        <thead>
          <tr className={darkMode ? 'bg-white/5' : 'bg-gray-50'}>
            <th className={`px-4 py-3 text-left text-xs ${
              darkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              Risk Category
            </th>
            {deals.map((deal, index) => (
              <th key={index} className={`px-4 py-3 text-center text-xs ${
                darkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
                {deal.dealName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {riskCategories.map((category, catIndex) => (
            <tr 
              key={category.id}
              className={`border-t ${
                darkMode ? 'border-white/5' : 'border-gray-100'
              }`}
            >
              <td className={`px-4 py-3 text-sm ${
                darkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
                {category.label}
              </td>
              {deals.map((deal, dealIndex) => {
                const severity = deal[category.id as keyof Omit<DealRisks, 'dealName'>] as RiskLevel['severity'];
                const config = severityConfig[severity];
                const Icon = config.icon;

                return (
                  <td key={dealIndex} className="px-4 py-3">
                    <div className="flex justify-center">
                      <div className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border ${
                        config.bgColor
                      } ${config.borderColor}`}>
                        <Icon className={`w-3 h-3 ${config.color}`} />
                        <span className={`text-xs ${config.color}`}>
                          {config.label}
                        </span>
                      </div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Risk Summary */}
      <div className={`px-4 py-3 border-t ${
        darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
      }`}>
        <div className="flex items-center justify-between text-xs">
          <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
            Overall Risk Level:
          </span>
          <div className="flex gap-4">
            {deals.map((deal, index) => {
              // Calculate overall risk level
              const risks = [
                deal.market,
                deal.team,
                deal.financial,
                deal.competitive,
                deal.execution,
                deal.legal
              ];
              
              const riskScore = risks.reduce((acc, risk) => {
                if (risk === 'critical') return acc + 4;
                if (risk === 'high') return acc + 3;
                if (risk === 'medium') return acc + 2;
                return acc + 1;
              }, 0);

              const avgRisk = riskScore / risks.length;
              let overallRisk: RiskLevel['severity'] = 'low';
              if (avgRisk >= 3) overallRisk = 'high';
              else if (avgRisk >= 2) overallRisk = 'medium';

              const config = severityConfig[overallRisk];

              return (
                <div key={index} className="flex items-center gap-1">
                  <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                    {deal.dealName}:
                  </span>
                  <span className={`uppercase ${config.color}`}>
                    {config.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
