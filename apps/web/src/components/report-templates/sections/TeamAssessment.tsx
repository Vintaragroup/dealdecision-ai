import { Users, Award, Briefcase, TrendingUp, Star, CheckCircle, Target, Zap } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface TeamAssessmentProps {
  data: DealReportData;
  darkMode: boolean;
}

export function TeamAssessment({ data, darkMode }: TeamAssessmentProps) {
  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Team Assessment
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Founder and team evaluation
        </p>
      </div>

      {/* Team Score */}
      <div 
        className="p-5 rounded-xl text-center"
        style={{ 
          backgroundColor: 'rgba(139,92,246,0.1)',
          border: '2px solid rgba(139,92,246,0.3)'
        }}
      >
        <div className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
          Team Quality Score
        </div>
        <div className="text-5xl mb-2" style={{ color: '#8b5cf6' }}>
          {data.teamScore}/100
        </div>
        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Strong team with proven track record
        </div>
      </div>

      {/* Team Overview */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Users className="w-5 h-5 text-[#6366f1]" />
          Team Overview
        </h3>
        <div className="grid grid-cols-4 gap-4">
          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
              Founders
            </div>
            <div className="text-3xl mb-1" style={{ color: '#6366f1' }}>
              {data.teamAssessment.founderCount}
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Co-founders
            </div>
          </div>

          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
              Team Size
            </div>
            <div className="text-3xl mb-1" style={{ color: '#8b5cf6' }}>
              {data.teamAssessment.teamSize}
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Full-time employees
            </div>
          </div>

          {data.teamAssessment.priorExits !== undefined && data.teamAssessment.priorExits > 0 && (
            <div 
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                border: '1px solid rgba(16,185,129,0.3)'
              }}
            >
              <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                Prior Exits
              </div>
              <div className="text-3xl mb-1" style={{ color: '#10b981' }}>
                {data.teamAssessment.priorExits}
              </div>
              <div className="text-xs flex items-center gap-1" style={{ color: '#10b981' }}>
                <Star className="w-3 h-3" />
                Excellent
              </div>
            </div>
          )}

          {data.teamAssessment.advisors !== undefined && data.teamAssessment.advisors > 0 && (
            <div 
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                Advisors
              </div>
              <div className="text-3xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                {data.teamAssessment.advisors}
              </div>
              <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                Strategic advisors
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Key Members */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Award className="w-5 h-5 text-[#6366f1]" />
          Key Team Members
        </h3>
        <div className="space-y-4">
          {data.teamAssessment.keyMembers.map((member, index) => (
            <div 
              key={index}
              className="p-5 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-start gap-4">
                <div 
                  className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
                >
                  <span className="text-white text-lg">
                    {member.name.split(' ').map(n => n[0]).join('')}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {member.name}
                      </h4>
                      <div 
                        className="text-xs px-2 py-1 rounded inline-block"
                        style={{ 
                          backgroundColor: 'rgba(99,102,241,0.2)',
                          color: '#6366f1'
                        }}
                      >
                        {member.role}
                      </div>
                    </div>
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                  </div>
                  <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                    {member.background}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Team Strengths */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Zap className="w-5 h-5 text-[#6366f1]" />
          Key Strengths
        </h3>
        <div className="space-y-3">
          {data.teamAssessment.keyStrengths.map((strength, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg flex items-start gap-3"
              style={{ 
                backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                border: '1px solid rgba(16,185,129,0.3)'
              }}
            >
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'rgba(16,185,129,0.3)' }}
              >
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <span className="text-sm flex-1" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                {strength}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Team Composition Analysis */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Target className="w-5 h-5 text-[#6366f1]" />
          Team Composition Analysis
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
              Strengths
            </h4>
            <ul className="space-y-2">
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Complementary skill sets across business, product, and technology</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Proven execution ability with prior successful exits</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Deep domain expertise in target market</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Strong professional networks and industry relationships</span>
              </li>
            </ul>
          </div>

          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)',
              border: '1px solid rgba(245,158,11,0.3)'
            }}
          >
            <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#f59e0b' }}>
              <TrendingUp className="w-4 h-4" />
              Growth Areas
            </h4>
            <ul className="space-y-2">
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Need to expand sales leadership for enterprise growth</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Marketing function requires additional senior expertise</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Customer success team needs scaling with growth</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Consider adding independent board members</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Team Summary */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <Briefcase className="w-4 h-4" />
          Team Assessment Summary
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          The founding team demonstrates exceptional quality with {data.teamAssessment.founderCount} experienced co-founders 
          {data.teamAssessment.priorExits && data.teamAssessment.priorExits > 0 && ` who have successfully exited ${data.teamAssessment.priorExits} prior venture${data.teamAssessment.priorExits > 1 ? 's' : ''}`}. 
          The team of {data.teamAssessment.teamSize} brings complementary skills across technology, product, and business development. 
          Key strengths include deep domain expertise, proven execution ability, and strong industry networks. 
          As the company scales, strategic additions in sales leadership and marketing will be critical to maintaining growth momentum. 
          Overall, this is a world-class team well-positioned to execute on their vision.
        </p>
      </div>
    </div>
  );
}
