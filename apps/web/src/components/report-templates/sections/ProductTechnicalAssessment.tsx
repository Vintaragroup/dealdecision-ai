import { Zap, Code, Server, Database, Shield, CheckCircle, AlertTriangle, XCircle, TrendingUp, FileCode, Clock, Activity, Award, GitBranch } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface ProductTechnicalAssessmentProps {
  data: DealReportData;
  darkMode: boolean;
}

export function ProductTechnicalAssessment({ data, darkMode }: ProductTechnicalAssessmentProps) {
  const getScoreColor = (score: number) => {
    if (score >= 85) return '#10b981';
    if (score >= 70) return '#f59e0b';
    return '#ef4444';
  };

  const getSeverityColor = (severity: 'high' | 'medium' | 'low') => {
    switch (severity) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      case 'low': return '#10b981';
    }
  };

  const getStatusConfig = (status: 'completed' | 'in-progress' | 'planned') => {
    switch (status) {
      case 'completed':
        return { icon: CheckCircle, color: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' };
      case 'in-progress':
        return { icon: Clock, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' };
      case 'planned':
        return { icon: TrendingUp, color: '#6366f1', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.3)' };
    }
  };

  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Product & Technical Assessment
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Technology stack, architecture, scalability, and development metrics
        </p>
      </div>

      {/* Product Stage */}
      <div 
        className="p-5 rounded-xl"
        style={{ 
          background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.2) 100%)',
          border: '2px solid rgba(99,102,241,0.4)'
        }}
      >
        <div className="flex items-center gap-4">
          <div 
            className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
          >
            <Zap className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
              Product Stage: {data.productTechnical.productStage}
            </h3>
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              Production-ready platform with proven scalability and enterprise-grade security
            </p>
          </div>
        </div>
      </div>

      {/* Technical Scores */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Award className="w-5 h-5 text-[#6366f1]" />
          Technical Assessment Scores
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Architecture Quality', score: data.productTechnical.architectureScore, icon: Server },
            { label: 'Scalability', score: data.productTechnical.scalabilityScore, icon: TrendingUp },
            { label: 'Security & Compliance', score: data.productTechnical.securityScore, icon: Shield },
            { label: 'Code Quality', score: data.productTechnical.codeQualityScore, icon: FileCode }
          ].map((item, index) => {
            const Icon = item.icon;
            const color = getScoreColor(item.score);
            return (
              <div 
                key={index}
                className="p-4 rounded-lg"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" style={{ color }} />
                    <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                      {item.label}
                    </span>
                  </div>
                  <span className="text-xl" style={{ color }}>
                    {item.score}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}>
                  <div 
                    className="h-full transition-all duration-500 rounded-full"
                    style={{ 
                      width: `${item.score}%`,
                      backgroundColor: color
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Technology Stack */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Code className="w-5 h-5 text-[#6366f1]" />
          Technology Stack
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Frontend', items: data.productTechnical.techStack.frontend, color: '#6366f1' },
            { label: 'Backend', items: data.productTechnical.techStack.backend, color: '#8b5cf6' },
            { label: 'Infrastructure', items: data.productTechnical.techStack.infrastructure, color: '#10b981' },
            { label: 'Databases', items: data.productTechnical.techStack.databases, color: '#f59e0b' },
            { label: 'DevOps & Tools', items: data.productTechnical.techStack.other, color: '#ef4444' }
          ].filter(stack => stack.items.length > 0).map((stack, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="text-xs mb-2" style={{ color: stack.color }}>
                {stack.label}
              </div>
              <div className="flex flex-wrap gap-2">
                {stack.items.map((tech, idx) => (
                  <div 
                    key={idx}
                    className="px-2 py-1 rounded text-xs"
                    style={{ 
                      backgroundColor: `${stack.color}20`,
                      color: stack.color,
                      border: `1px solid ${stack.color}40`
                    }}
                  >
                    {tech}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Technical Strengths & Weaknesses */}
      <div className="grid grid-cols-2 gap-4">
        <div 
          className="p-5 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
            border: '1px solid rgba(16,185,129,0.3)'
          }}
        >
          <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#10b981' }}>
            <CheckCircle className="w-4 h-4" />
            Technical Strengths
          </h4>
          <ul className="space-y-2">
            {data.productTechnical.strengths.map((strength, index) => (
              <li key={index} className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>{strength}</span>
              </li>
            ))}
          </ul>
        </div>

        <div 
          className="p-5 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.05)',
            border: '1px solid rgba(239,68,68,0.3)'
          }}
        >
          <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#ef4444' }}>
            <XCircle className="w-4 h-4" />
            Areas for Improvement
          </h4>
          <ul className="space-y-2">
            {data.productTechnical.weaknesses.map((weakness, index) => (
              <li key={index} className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                <span className="text-red-500 mt-0.5">•</span>
                <span>{weakness}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Technical Risks */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          Technical Risks & Mitigation
        </h3>
        <div className="space-y-3">
          {data.productTechnical.technicalRisks.map((risk, index) => {
            const severityColor = getSeverityColor(risk.severity);
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
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {risk.risk}
                      </span>
                      <div 
                        className="px-2 py-0.5 rounded text-xs capitalize"
                        style={{ 
                          backgroundColor: `${severityColor}20`,
                          color: severityColor,
                          border: `1px solid ${severityColor}40`
                        }}
                      >
                        {risk.severity}
                      </div>
                    </div>
                    <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      <span className="text-emerald-500">Mitigation: </span>
                      {risk.mitigation}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Product Roadmap */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <GitBranch className="w-5 h-5 text-[#6366f1]" />
          Product Roadmap
        </h3>
        <div className="space-y-3">
          {data.productTechnical.roadmap.map((quarter, index) => {
            const statusConfig = getStatusConfig(quarter.status);
            const StatusIcon = statusConfig.icon;
            return (
              <div 
                key={index}
                className="p-4 rounded-lg"
                style={{ 
                  backgroundColor: statusConfig.bg,
                  border: `1px solid ${statusConfig.border}`
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <StatusIcon className="w-4 h-4" style={{ color: statusConfig.color }} />
                    <span className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                      {quarter.quarter}
                    </span>
                  </div>
                  <div 
                    className="px-2 py-0.5 rounded text-xs capitalize"
                    style={{ 
                      backgroundColor: statusConfig.color + '30',
                      color: statusConfig.color
                    }}
                  >
                    {quarter.status.replace('-', ' ')}
                  </div>
                </div>
                <ul className="space-y-1">
                  {quarter.milestones.map((milestone, idx) => (
                    <li key={idx} className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                      <span style={{ color: statusConfig.color }}>•</span>
                      <span>{milestone}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* IP & Patents */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h3 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <Award className="w-4 h-4" />
          Intellectual Property
        </h3>
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Patents Filed
            </div>
            <div className="text-2xl" style={{ color: '#6366f1' }}>
              {data.productTechnical.patents.filed}
            </div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Granted
            </div>
            <div className="text-2xl" style={{ color: '#10b981' }}>
              {data.productTechnical.patents.granted}
            </div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Pending
            </div>
            <div className="text-2xl" style={{ color: '#f59e0b' }}>
              {data.productTechnical.patents.pending}
            </div>
          </div>
        </div>
        <p className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          {data.productTechnical.patents.description}
        </p>
      </div>

      {/* Development Metrics */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Activity className="w-5 h-5 text-[#6366f1]" />
          Development Metrics
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Development Team Size
            </div>
            <div className="text-2xl" style={{ color: '#6366f1' }}>
              {data.productTechnical.developmentMetrics.teamSize}
            </div>
          </div>
          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Deployment Frequency
            </div>
            <div className="text-2xl" style={{ color: '#10b981' }}>
              {data.productTechnical.developmentMetrics.deploymentFrequency}
            </div>
          </div>
          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Avg Bug Fix Time
            </div>
            <div className="text-2xl" style={{ color: '#8b5cf6' }}>
              {data.productTechnical.developmentMetrics.averageBugFixTime}
            </div>
          </div>
          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Test Coverage
            </div>
            <div className="text-2xl" style={{ color: '#10b981' }}>
              {data.productTechnical.developmentMetrics.testCoverage}%
            </div>
          </div>
          <div 
            className="p-4 rounded-lg col-span-2"
            style={{ 
              backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
              border: '1px solid rgba(16,185,129,0.3)'
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  System Uptime
                </div>
                <div className="text-2xl" style={{ color: '#10b981' }}>
                  {data.productTechnical.developmentMetrics.uptime}%
                </div>
              </div>
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Technical Summary */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <Zap className="w-4 h-4" />
          Technical Assessment Summary
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          {data.companyName || 'The company'} has built a robust technical platform with strong architecture (score: {data.productTechnical.architectureScore}/100), 
          excellent scalability ({data.productTechnical.scalabilityScore}/100), and industry-leading code quality ({data.productTechnical.codeQualityScore}/100). 
          The technology stack leverages modern, proven technologies with a {data.productTechnical.techStack.frontend.join(', ')} frontend 
          and {data.productTechnical.techStack.backend.join(', ')} backend. Security measures are strong ({data.productTechnical.securityScore}/100) 
          with {data.productTechnical.developmentMetrics.uptime}% uptime. The team maintains {data.productTechnical.developmentMetrics.testCoverage}% test coverage 
          and deploys {data.productTechnical.developmentMetrics.deploymentFrequency.toLowerCase()}, demonstrating mature development practices. 
          With {data.productTechnical.patents.filed} patents filed ({data.productTechnical.patents.granted} granted) covering their proprietary technology, 
          the company has built meaningful IP protection. Key technical risks have clear mitigation strategies in place.
        </p>
      </div>
    </div>
  );
}
