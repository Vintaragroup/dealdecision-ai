import { 
  DollarSign, 
  TrendingUp, 
  Shield,
  Users,
  FileText,
  CheckCircle,
  Calendar
} from 'lucide-react';

interface InvestmentTermsProps {
  data: any;
  darkMode: boolean;
}

export function InvestmentTerms({ data, darkMode }: InvestmentTermsProps) {
  const dealTerms = [
    { label: 'Round Size', value: '$5M', icon: DollarSign },
    { label: 'Pre-Money Valuation', value: '$20M', icon: TrendingUp },
    { label: 'Post-Money Valuation', value: '$25M', icon: TrendingUp },
    { label: 'Price Per Share', value: '$2.50', icon: DollarSign }
  ];

  const terms = {
    type: 'Series A Preferred Stock',
    liquidationPreference: '1x non-participating',
    dividends: 'None',
    voting: 'As-converted basis',
    antiDilution: 'Broad-based weighted average',
    redemption: 'None',
    conversion: 'Voluntary at any time, automatic on IPO or qualified sale',
    informationRights: 'Standard VC information rights',
    dragAlong: 'Standard drag-along rights',
    rightOfFirstRefusal: 'Standard ROFR and co-sale rights'
  };

  const boardComposition = [
    { role: 'Founder Seat', name: 'CEO', type: 'Founder' },
    { role: 'Investor Seat', name: 'Lead Investor', type: 'Investor' },
    { role: 'Independent', name: 'TBD - Industry Expert', type: 'Independent' }
  ];

  const useOfProceeds = [
    { category: 'Product & Engineering', amount: '$2.0M', percentage: 40, color: '#6366f1' },
    { category: 'Sales & Marketing', amount: '$1.5M', percentage: 30, color: '#10b981' },
    { category: 'Operations & G&A', amount: '$1.0M', percentage: 20, color: '#f59e0b' },
    { category: 'Working Capital', amount: '$0.5M', percentage: 10, color: '#8b5cf6' }
  ];

  const protections = [
    'Board approval required for hiring/firing C-level executives',
    'Board approval for budgets exceeding 20% variance',
    'Board approval for debt financing >$500K',
    'Board approval for any acquisition or sale of assets >$1M',
    'Standard protective provisions for Series A investors'
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#4f46e5] flex items-center justify-center">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
              Investment Terms
            </h2>
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Series A term sheet summary
            </p>
          </div>
        </div>
      </div>

      {/* Deal Overview */}
      <div className="grid grid-cols-4 gap-4">
        {dealTerms.map((term, index) => {
          const Icon = term.icon;
          return (
            <div
              key={index}
              className="p-4 rounded-xl text-center"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <Icon className="w-5 h-5 mx-auto mb-2 text-[#6366f1]" />
              <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                {term.value}
              </div>
              <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                {term.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Key Terms */}
      <div
        className="p-5 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
        }}
      >
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Key Terms & Conditions
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(terms).map(([key, value], index) => (
            <div key={index} className="flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                  <strong>{key.replace(/([A-Z])/g, ' $1').trim()}:</strong>
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  {value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Board Composition */}
      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Board of Directors
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {boardComposition.map((seat, index) => (
            <div
              key={index}
              className="p-4 rounded-xl text-center"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <Users className="w-8 h-8 mx-auto mb-2 text-[#6366f1]" />
              <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                {seat.role}
              </div>
              <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                {seat.name}
              </div>
              <div 
                className="px-2 py-1 rounded text-xs inline-block"
                style={{ 
                  backgroundColor: '#6366f120',
                  color: '#6366f1'
                }}
              >
                {seat.type}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Use of Proceeds */}
      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Use of Proceeds
        </h3>
        <div className="space-y-3">
          {useOfProceeds.map((item, index) => (
            <div
              key={index}
              className="p-4 rounded-xl"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                  {item.category}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm" style={{ color: item.color }}>
                    {item.amount}
                  </span>
                  <span 
                    className="px-2 py-1 rounded text-xs"
                    style={{ 
                      backgroundColor: item.color + '20',
                      color: item.color
                    }}
                  >
                    {item.percentage}%
                  </span>
                </div>
              </div>
              <div 
                className="h-2 rounded-full"
                style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
              >
                <div 
                  className="h-full rounded-full"
                  style={{ 
                    width: `${item.percentage}%`,
                    backgroundColor: item.color
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Protective Provisions */}
      <div
        className="p-5 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.2)'
        }}
      >
        <h3 className="text-lg mb-3 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Shield className="w-5 h-5 text-[#6366f1]" />
          Protective Provisions
        </h3>
        <div className="space-y-2">
          {protections.map((protection, index) => (
            <div key={index} className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-[#6366f1] mt-0.5 flex-shrink-0" />
              <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                {protection}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div
        className="p-4 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-4 h-4 text-[#6366f1]" />
          <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
            <strong>Expected Closing:</strong> 30 days from term sheet execution
          </span>
        </div>
        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Subject to completion of due diligence and customary closing conditions
        </div>
      </div>
    </div>
  );
}
