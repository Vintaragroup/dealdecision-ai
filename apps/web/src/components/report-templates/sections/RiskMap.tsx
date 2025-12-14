import { Shield, AlertTriangle, TrendingUp, TrendingDown, Minus, CheckCircle, Clock, Eye, Zap } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface RiskMapProps {
  data: DealReportData;
  darkMode: boolean;
}

export function RiskMap({ data, darkMode }: RiskMapProps) {
  const getRiskLevelColor = (level: 'low' | 'medium' | 'high' | 'critical') => {
    switch (level) {
      case 'low': return '#10b981';
      case 'medium': return '#f59e0b';
      case 'high': return '#ef4444';
      case 'critical': return '#991b1b';
    }
  };

  const getSeverityColor = (severity: 'low' | 'medium' | 'high' | 'critical') => {
    return getRiskLevelColor(severity);
  };

  const getStatusConfig = (status: 'identified' | 'monitoring' | 'mitigating' | 'resolved') => {
    switch (status) {
      case 'identified':
        return { label: 'Identified', color: '#ef4444', icon: AlertTriangle };
      case 'monitoring':
        return { label: 'Monitoring', color: '#f59e0b', icon: Eye };
      case 'mitigating':
        return { label: 'Mitigating', color: '#6366f1', icon: Shield };
      case 'resolved':
        return { label: 'Resolved', color: '#10b981', icon: CheckCircle };
    }
  };

  const getTrendIcon = (trend: 'improving' | 'stable' | 'worsening') => {
    switch (trend) {
      case 'improving': return TrendingDown;
      case 'stable': return Minus;
      case 'worsening': return TrendingUp;
    }
  };

  const getTrendColor = (trend: 'improving' | 'stable' | 'worsening') => {
    switch (trend) {
      case 'improving': return '#10b981';
      case 'stable': return '#6366f1';
      case 'worsening': return '#ef4444';
    }
  };

  // Calculate risk score (probability x impact)
  const getRiskScore = (probability: number, impact: number) => {
    return probability * impact;
  };

  // Get position in matrix (1-5 scale for both axes)
  const getMatrixPosition = (probability: number, impact: number) => {
    // Convert 1-5 scale to percentage position (20%, 40%, 60%, 80%, 100%)
    const x = (probability - 0.5) * 20;
    const y = 100 - ((impact - 0.5) * 20);
    return { x, y };
  };

  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Risk Assessment Map
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Comprehensive risk analysis across key categories with mitigation strategies
        </p>
      </div>

      {/* Overall Risk Score Gauge */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          background: `linear-gradient(135deg, ${getRiskLevelColor(data.riskMap.riskLevel)}20 0%, ${getRiskLevelColor(data.riskMap.riskLevel)}10 100%)`,
          border: `2px solid ${getRiskLevelColor(data.riskMap.riskLevel)}40`
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div 
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ backgroundColor: getRiskLevelColor(data.riskMap.riskLevel) }}
              >
                <Shield className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="text-lg mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Overall Risk Level
                </h3>
                <div className="flex items-center gap-2">
                  <span 
                    className="text-2xl uppercase tracking-wide"
                    style={{ color: getRiskLevelColor(data.riskMap.riskLevel) }}
                  >
                    {data.riskMap.riskLevel}
                  </span>
                  <span 
                    className="px-2 py-0.5 rounded text-sm"
                    style={{ 
                      backgroundColor: `${getRiskLevelColor(data.riskMap.riskLevel)}30`,
                      color: getRiskLevelColor(data.riskMap.riskLevel)
                    }}
                  >
                    Score: {data.riskMap.overallRiskScore}/100
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
              {(() => {
                const TrendIcon = getTrendIcon(data.riskMap.trend);
                const trendColor = getTrendColor(data.riskMap.trend);
                return (
                  <>
                    <TrendIcon className="w-4 h-4" style={{ color: trendColor }} />
                    <span>Trend: </span>
                    <span style={{ color: trendColor }} className="capitalize">{data.riskMap.trend}</span>
                    <span className="ml-2">•</span>
                    <span className="ml-2">Last assessed: {data.riskMap.lastAssessment}</span>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Risk Score Gauge */}
          <div className="relative w-32 h-32">
            <svg viewBox="0 0 100 100" className="transform -rotate-90">
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                strokeWidth="8"
              />
              {/* Progress circle */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={getRiskLevelColor(data.riskMap.riskLevel)}
                strokeWidth="8"
                strokeDasharray={`${(data.riskMap.overallRiskScore / 100) * 251.2} 251.2`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl" style={{ color: getRiskLevelColor(data.riskMap.riskLevel) }}>
                  {data.riskMap.overallRiskScore}
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  / 100
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Categories */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Zap className="w-5 h-5 text-[#6366f1]" />
          Risk Categories
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {data.riskMap.categories.map((category, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: `${getRiskLevelColor(category.level)}10`,
                border: `1px solid ${getRiskLevelColor(category.level)}40`
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                  {category.name}
                </span>
                <div 
                  className="px-2 py-0.5 rounded text-xs uppercase"
                  style={{ 
                    backgroundColor: `${getRiskLevelColor(category.level)}30`,
                    color: getRiskLevelColor(category.level)
                  }}
                >
                  {category.level}
                </div>
              </div>
              <div className="mb-2">
                <div className="text-2xl mb-1" style={{ color: getRiskLevelColor(category.level) }}>
                  {category.score}
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}>
                  <div 
                    className="h-full transition-all duration-500 rounded-full"
                    style={{ 
                      width: `${category.score}%`,
                      backgroundColor: getRiskLevelColor(category.level)
                    }}
                  />
                </div>
              </div>
              <p className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                {category.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Matrix */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          Risk Matrix (Probability vs Impact)
        </h3>
        <div 
          className="p-6 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
          }}
        >
          {/* Matrix Chart */}
          <div className="relative w-full" style={{ paddingBottom: '80%' }}>
            <div className="absolute inset-0">
              {/* Y-axis label */}
              <div 
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-8 -rotate-90 text-xs"
                style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}
              >
                Impact →
              </div>
              
              {/* Chart area */}
              <div className="ml-12 mb-8 h-full relative">
                {/* Background gradient zones */}
                <div className="absolute inset-0 rounded-lg overflow-hidden">
                  {/* Low risk (bottom-left) */}
                  <div 
                    className="absolute rounded-lg"
                    style={{ 
                      left: '0%', 
                      top: '60%', 
                      width: '40%', 
                      height: '40%',
                      background: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(16,185,129,0.1) 100%)'
                    }}
                  />
                  {/* Medium risk (middle) */}
                  <div 
                    className="absolute rounded-lg"
                    style={{ 
                      left: '30%', 
                      top: '30%', 
                      width: '40%', 
                      height: '40%',
                      background: 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(245,158,11,0.1) 100%)'
                    }}
                  />
                  {/* High risk (top-right) */}
                  <div 
                    className="absolute rounded-lg"
                    style={{ 
                      left: '60%', 
                      top: '0%', 
                      width: '40%', 
                      height: '40%',
                      background: 'linear-gradient(135deg, rgba(239,68,68,0.2) 0%, rgba(239,68,68,0.1) 100%)'
                    }}
                  />
                </div>

                {/* Grid lines */}
                <svg className="absolute inset-0 w-full h-full">
                  {[0, 25, 50, 75, 100].map((pos) => (
                    <g key={`grid-${pos}`}>
                      <line 
                        x1={`${pos}%`} 
                        y1="0" 
                        x2={`${pos}%`} 
                        y2="100%" 
                        stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'} 
                        strokeWidth="1"
                      />
                      <line 
                        x1="0" 
                        y1={`${pos}%`} 
                        x2="100%" 
                        y2={`${pos}%`} 
                        stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'} 
                        strokeWidth="1"
                      />
                    </g>
                  ))}
                </svg>

                {/* Risk points */}
                {data.riskMap.risks.map((risk, index) => {
                  const pos = getMatrixPosition(risk.probability, risk.impact);
                  const color = getSeverityColor(risk.severity);
                  return (
                    <div
                      key={index}
                      className="absolute w-8 h-8 rounded-full border-2 flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                      style={{ 
                        left: `${pos.x}%`,
                        top: `${pos.y}%`,
                        backgroundColor: `${color}90`,
                        borderColor: color,
                        transform: 'translate(-50%, -50%)'
                      }}
                      title={risk.title}
                    >
                      <span className="text-xs text-white">{index + 1}</span>
                    </div>
                  );
                })}

                {/* Axis labels */}
                <div className="absolute -bottom-6 left-0 right-0 flex justify-between text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  <span>Low</span>
                  <span>Probability →</span>
                  <span>High</span>
                </div>
                
                <div className="absolute -right-12 top-0 bottom-0 flex flex-col justify-between text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  <span>High</span>
                  <span>Low</span>
                </div>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-8 pt-4 border-t" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
            <div className="flex items-center gap-6 text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#10b981' }} />
                <span>Low Risk</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
                <span>Medium Risk</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#ef4444' }} />
                <span>High Risk</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#991b1b' }} />
                <span>Critical Risk</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Individual Risks with Mitigation */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Shield className="w-5 h-5 text-[#6366f1]" />
          Risk Details & Mitigation Strategies
        </h3>
        <div className="space-y-3">
          {data.riskMap.risks.map((risk, index) => {
            const statusConfig = getStatusConfig(risk.status);
            const StatusIcon = statusConfig.icon;
            const riskScore = getRiskScore(risk.probability, risk.impact);
            
            return (
              <div 
                key={index}
                className="p-4 rounded-lg"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-3 flex-1">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 mt-0.5"
                      style={{ 
                        backgroundColor: `${getSeverityColor(risk.severity)}30`,
                        color: getSeverityColor(risk.severity),
                        border: `1px solid ${getSeverityColor(risk.severity)}60`
                      }}
                    >
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                          {risk.title}
                        </h4>
                        <span 
                          className="px-2 py-0.5 rounded text-xs capitalize"
                          style={{ 
                            backgroundColor: `${getSeverityColor(risk.severity)}20`,
                            color: getSeverityColor(risk.severity),
                            border: `1px solid ${getSeverityColor(risk.severity)}40`
                          }}
                        >
                          {risk.severity}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded" style={{ 
                          backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                          color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'
                        }}>
                          {risk.category}
                        </span>
                      </div>
                      <p className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                        {risk.description}
                      </p>
                      
                      {/* Risk Scores */}
                      <div className="flex items-center gap-4 mb-2 text-xs">
                        <div className="flex items-center gap-1">
                          <span style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>Probability:</span>
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((level) => (
                              <div 
                                key={level}
                                className="w-3 h-3 rounded-sm"
                                style={{ 
                                  backgroundColor: level <= risk.probability 
                                    ? getSeverityColor(risk.severity)
                                    : darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                                }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>Impact:</span>
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((level) => (
                              <div 
                                key={level}
                                className="w-3 h-3 rounded-sm"
                                style={{ 
                                  backgroundColor: level <= risk.impact 
                                    ? getSeverityColor(risk.severity)
                                    : darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                                }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>Score:</span>
                          <span style={{ color: getSeverityColor(risk.severity) }}>{riskScore}/25</span>
                        </div>
                      </div>

                      {/* Mitigation */}
                      <div 
                        className="p-2 rounded text-xs mb-2"
                        style={{ 
                          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
                          border: '1px solid rgba(99,102,241,0.3)'
                        }}
                      >
                        <span className="text-[#6366f1]">Mitigation: </span>
                        <span style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                          {risk.mitigation}
                        </span>
                      </div>

                      {/* Owner and Status */}
                      <div className="flex items-center gap-3 text-xs">
                        <div className="flex items-center gap-1">
                          <span style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>Owner:</span>
                          <span style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>{risk.owner}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <StatusIcon className="w-3 h-3" style={{ color: statusConfig.color }} />
                          <span style={{ color: statusConfig.color }}>{statusConfig.label}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Risk Summary */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <Shield className="w-4 h-4" />
          Risk Management Summary
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          {data.companyName || 'The company'} has an overall risk score of {data.riskMap.overallRiskScore}/100, 
          classified as <span style={{ color: getRiskLevelColor(data.riskMap.riskLevel) }}>{data.riskMap.riskLevel} risk</span>. 
          The risk profile is currently <span style={{ color: getTrendColor(data.riskMap.trend) }}>{data.riskMap.trend}</span>. 
          Key risk categories include {data.riskMap.categories.map(c => c.name).join(', ')}. 
          Out of {data.riskMap.risks.length} identified risks, {data.riskMap.risks.filter(r => r.status === 'resolved').length} have been resolved, 
          {' '}{data.riskMap.risks.filter(r => r.status === 'mitigating').length} are being actively mitigated, 
          and {data.riskMap.risks.filter(r => r.status === 'monitoring').length} are under continuous monitoring. 
          All critical and high-severity risks have clear mitigation strategies and assigned owners, 
          demonstrating mature risk management practices.
        </p>
      </div>
    </div>
  );
}
