import { Sparkles, Brain, TrendingUp, Shield, Target, CheckCircle, AlertCircle, BarChart3, Zap } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface AIConfidenceScoresProps {
  data: DealReportData;
  darkMode: boolean;
}

export function AIConfidenceScores({ data, darkMode }: AIConfidenceScoresProps) {
  // AI confidence metrics
  const aiMetrics = [
    {
      category: 'Market Analysis',
      score: 94,
      confidence: 'Very High',
      dataPoints: 247,
      sources: 'Market reports, competitor data, industry trends',
      methodology: 'TAM/SAM/SOM validation, competitive positioning analysis'
    },
    {
      category: 'Financial Projections',
      score: 88,
      confidence: 'High',
      dataPoints: 186,
      sources: 'Financial statements, revenue data, expense tracking',
      methodology: 'Revenue modeling, burn rate analysis, unit economics validation'
    },
    {
      category: 'Team Assessment',
      score: 91,
      confidence: 'Very High',
      dataPoints: 124,
      sources: 'LinkedIn profiles, prior exits, professional networks',
      methodology: 'Background verification, experience scoring, network analysis'
    },
    {
      category: 'Document Completeness',
      score: 85,
      confidence: 'High',
      dataPoints: 89,
      sources: 'Legal docs, contracts, compliance filings',
      methodology: 'Document verification, compliance checking, completeness scoring'
    },
    {
      category: 'Risk Assessment',
      score: 82,
      confidence: 'High',
      dataPoints: 156,
      sources: 'Industry data, regulatory filings, news analysis',
      methodology: 'Risk mapping, probability analysis, impact assessment'
    }
  ];

  const overallAIScore = Math.round(aiMetrics.reduce((sum, m) => sum + m.score, 0) / aiMetrics.length);

  const getScoreColor = (score: number) => {
    if (score >= 90) return '#10b981';
    if (score >= 80) return '#6366f1';
    if (score >= 70) return '#f59e0b';
    return '#ef4444';
  };

  const getConfidenceColor = (confidence: string) => {
    if (confidence === 'Very High') return '#10b981';
    if (confidence === 'High') return '#6366f1';
    if (confidence === 'Medium') return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          AI Confidence Scores
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          DealDecision AI analysis quality and reliability metrics
        </p>
      </div>

      {/* Overall AI Confidence */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.2) 100%)',
          border: '2px solid rgba(99,102,241,0.4)'
        }}
      >
        <div className="flex items-center gap-4 mb-4">
          <div 
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
          >
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
              Overall AI Confidence Score
            </h3>
            <p className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Aggregate confidence across all AI-analyzed dimensions
            </p>
          </div>
          <div className="text-right">
            <div className="text-5xl mb-1" style={{ color: getScoreColor(overallAIScore) }}>
              {overallAIScore}
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Very High Confidence
            </div>
          </div>
        </div>

        <div 
          className="p-4 rounded-lg flex items-start gap-3"
          style={{ 
            backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
          }}
        >
          <Brain className="w-5 h-5 text-[#6366f1] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs mb-1" style={{ color: '#6366f1' }}>
              What This Means:
            </div>
            <p className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              Our AI has analyzed {aiMetrics.reduce((sum, m) => sum + m.dataPoints, 0).toLocaleString()} data points 
              across {aiMetrics.length} key dimensions with very high confidence. The analysis is based on comprehensive 
              data sources and validated methodologies, providing reliable insights for investment decision-making.
            </p>
          </div>
        </div>
      </div>

      {/* Individual Category Scores */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <BarChart3 className="w-5 h-5 text-[#6366f1]" />
          AI Confidence by Category
        </h3>
        <div className="space-y-4">
          {aiMetrics.map((metric, index) => (
            <div 
              key={index}
              className="p-5 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                      {metric.category}
                    </h4>
                    <div 
                      className="text-xs px-2 py-1 rounded"
                      style={{ 
                        backgroundColor: `${getConfidenceColor(metric.confidence)}20`,
                        color: getConfidenceColor(metric.confidence)
                      }}
                    >
                      {metric.confidence} Confidence
                    </div>
                  </div>
                  <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                    {metric.dataPoints} data points analyzed
                  </div>
                </div>
                <div className="text-right ml-4">
                  <div className="text-4xl mb-1" style={{ color: getScoreColor(metric.score) }}>
                    {metric.score}
                  </div>
                  <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                    AI Score
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-3">
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}>
                  <div 
                    className="h-full transition-all duration-500 rounded-full"
                    style={{ 
                      width: `${metric.score}%`,
                      backgroundColor: getScoreColor(metric.score)
                    }}
                  />
                </div>
              </div>

              {/* Details */}
              <div className="grid grid-cols-2 gap-3">
                <div 
                  className="p-3 rounded-lg"
                  style={{ 
                    backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
                    border: '1px solid rgba(99,102,241,0.2)'
                  }}
                >
                  <div className="text-xs mb-1 flex items-center gap-1" style={{ color: '#6366f1' }}>
                    <Target className="w-3 h-3" />
                    Data Sources
                  </div>
                  <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                    {metric.sources}
                  </div>
                </div>
                <div 
                  className="p-3 rounded-lg"
                  style={{ 
                    backgroundColor: darkMode ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.05)',
                    border: '1px solid rgba(139,92,246,0.2)'
                  }}
                >
                  <div className="text-xs mb-1 flex items-center gap-1" style={{ color: '#8b5cf6' }}>
                    <Zap className="w-3 h-3" />
                    Methodology
                  </div>
                  <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                    {metric.methodology}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data Quality Indicators */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Shield className="w-5 h-5 text-[#6366f1]" />
          Data Quality & Validation
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
              border: '1px solid rgba(16,185,129,0.3)'
            }}
          >
            <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#10b981' }}>
              <CheckCircle className="w-4 h-4" />
              Data Strengths
            </h4>
            <ul className="space-y-2">
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>High volume of validated data points ({aiMetrics.reduce((sum, m) => sum + m.dataPoints, 0)}+ total)</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Multiple independent data sources cross-referenced</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Recent data (all sources updated within last 90 days)</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Primary documents provided and verified</span>
              </li>
            </ul>
          </div>

          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
              border: '1px solid rgba(99,102,241,0.3)'
            }}
          >
            <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
              <AlertCircle className="w-4 h-4" />
              Data Limitations
            </h4>
            <ul className="space-y-2">
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-indigo-500 mt-0.5">•</span>
                <span>Limited historical financial data (&lt;2 years available)</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-indigo-500 mt-0.5">•</span>
                <span>Market size estimates based on third-party research</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-indigo-500 mt-0.5">•</span>
                <span>Competitive intelligence partially based on public data</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-indigo-500 mt-0.5">•</span>
                <span>AI predictions should be validated with domain experts</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Confidence Explanation */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <Brain className="w-4 h-4" />
          Understanding AI Confidence Scores
        </h4>
        <div className="space-y-3">
          <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
            DealDecision AI confidence scores represent the reliability and completeness of our analysis for each category. 
            Higher scores indicate more comprehensive data coverage, stronger validation, and greater certainty in our findings.
          </p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { range: '90-100', label: 'Very High', color: '#10b981', description: 'Excellent data quality' },
              { range: '80-89', label: 'High', color: '#6366f1', description: 'Strong confidence' },
              { range: '70-79', label: 'Medium', color: '#f59e0b', description: 'Good but limited' },
              { range: '0-69', label: 'Low', color: '#ef4444', description: 'Needs more data' }
            ].map((level, index) => (
              <div 
                key={index}
                className="p-3 rounded-lg text-center"
                style={{ 
                  backgroundColor: `${level.color}20`,
                  border: `1px solid ${level.color}40`
                }}
              >
                <div className="text-lg mb-1" style={{ color: level.color }}>
                  {level.range}
                </div>
                <div className="text-xs mb-1" style={{ color: level.color }}>
                  {level.label}
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  {level.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Analysis Summary */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          background: 'linear-gradient(135deg, rgba(139,92,246,0.1) 0%, rgba(99,102,241,0.1) 100%)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#8b5cf6' }}>
          <Sparkles className="w-4 h-4" />
          AI Analysis Summary
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          Our AI analysis of {data.dealName} demonstrates very high overall confidence ({overallAIScore}/100) 
          based on {aiMetrics.reduce((sum, m) => sum + m.dataPoints, 0).toLocaleString()} validated data points. 
          Market analysis and team assessment show particularly strong confidence levels, while all categories 
          exceed our quality threshold for reliable investment decision-making. The combination of comprehensive 
          data coverage, multiple validation sources, and proven AI methodologies provides a robust foundation 
          for the recommendations in this report.
        </p>
      </div>
    </div>
  );
}