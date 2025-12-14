import { CheckCircle, XCircle, AlertCircle, FileCheck, Clock, TrendingUp } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface VerificationChecklistProps {
  data: DealReportData;
  darkMode: boolean;
}

export function VerificationChecklist({ data, darkMode }: VerificationChecklistProps) {
  const getStatusColor = (status: 'complete' | 'partial' | 'missing') => {
    switch (status) {
      case 'complete': return '#10b981';
      case 'partial': return '#f59e0b';
      case 'missing': return '#ef4444';
    }
  };

  const getStatusIcon = (status: 'complete' | 'partial' | 'missing') => {
    switch (status) {
      case 'complete': return CheckCircle;
      case 'partial': return Clock;
      case 'missing': return XCircle;
    }
  };

  const getStatusLabel = (status: 'complete' | 'partial' | 'missing') => {
    switch (status) {
      case 'complete': return 'Complete';
      case 'partial': return 'Partial';
      case 'missing': return 'Missing';
    }
  };

  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Verification Checklist
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Comprehensive document verification and due diligence tracking
        </p>
      </div>

      {/* Overall Completion */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          background: `linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.2) 100%)`,
          border: '2px solid rgba(99,102,241,0.3)'
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <div 
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
              >
                <FileCheck className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="text-lg mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Overall Verification Status
                </h3>
                <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  {data.verificationChecklist.completedItems} of {data.verificationChecklist.totalItems} items verified
                </p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-4">
              <div 
                className="p-3 rounded-lg text-center"
                style={{ 
                  backgroundColor: 'rgba(16,185,129,0.2)',
                  border: '1px solid rgba(16,185,129,0.4)'
                }}
              >
                <div className="text-2xl mb-1" style={{ color: '#10b981' }}>
                  {data.verificationChecklist.completedItems}
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Complete
                </div>
              </div>
              
              <div 
                className="p-3 rounded-lg text-center"
                style={{ 
                  backgroundColor: 'rgba(245,158,11,0.2)',
                  border: '1px solid rgba(245,158,11,0.4)'
                }}
              >
                <div className="text-2xl mb-1" style={{ color: '#f59e0b' }}>
                  {data.verificationChecklist.partialItems}
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Partial
                </div>
              </div>
              
              <div 
                className="p-3 rounded-lg text-center"
                style={{ 
                  backgroundColor: 'rgba(239,68,68,0.2)',
                  border: '1px solid rgba(239,68,68,0.4)'
                }}
              >
                <div className="text-2xl mb-1" style={{ color: '#ef4444' }}>
                  {data.verificationChecklist.missingItems}
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Missing
                </div>
              </div>
              
              <div 
                className="p-3 rounded-lg text-center"
                style={{ 
                  backgroundColor: 'rgba(99,102,241,0.2)',
                  border: '1px solid rgba(99,102,241,0.4)'
                }}
              >
                <div className="text-2xl mb-1" style={{ color: '#6366f1' }}>
                  {data.verificationChecklist.totalItems}
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Total Items
                </div>
              </div>
            </div>

            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Last reviewed: {data.verificationChecklist.lastReview}
            </div>
          </div>

          {/* Completion Ring */}
          <div className="relative w-40 h-40 ml-6">
            <svg viewBox="0 0 100 100" className="transform -rotate-90">
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                strokeWidth="10"
              />
              {/* Progress circle */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="url(#completionGradient)"
                strokeWidth="10"
                strokeDasharray={`${(data.verificationChecklist.overallCompletion / 100) * 251.2} 251.2`}
                strokeLinecap="round"
              />
              {/* Gradient definition */}
              <defs>
                <linearGradient id="completionGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-3xl" style={{ color: '#6366f1' }}>
                  {data.verificationChecklist.overallCompletion}%
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  Complete
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Critical Missing Items Alert */}
      {data.verificationChecklist.criticalMissing.length > 0 && (
        <div 
          className="p-5 rounded-lg"
          style={{ 
            backgroundColor: 'rgba(239,68,68,0.1)',
            border: '2px solid rgba(239,68,68,0.4)'
          }}
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm mb-2" style={{ color: '#ef4444' }}>
                Critical Items Missing
              </h4>
              <p className="text-sm mb-3" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                The following critical documents are missing and must be obtained before proceeding:
              </p>
              <ul className="space-y-1">
                {data.verificationChecklist.criticalMissing.map((item, index) => (
                  <li 
                    key={index}
                    className="text-sm flex items-center gap-2"
                    style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}
                  >
                    <XCircle className="w-4 h-4 text-red-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Checklist by Category */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <TrendingUp className="w-5 h-5 text-[#6366f1]" />
          Verification Categories
        </h3>
        <div className="space-y-6">
          {data.verificationChecklist.categories.map((category, catIndex) => (
            <div 
              key={catIndex}
              className="rounded-lg overflow-hidden"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              {/* Category Header */}
              <div 
                className="p-4"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
                  borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                    {category.name}
                  </h4>
                  <span 
                    className="text-sm px-3 py-1 rounded-full"
                    style={{ 
                      backgroundColor: 'rgba(99,102,241,0.2)',
                      color: '#6366f1'
                    }}
                  >
                    {category.completion}% Complete
                  </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}>
                  <div 
                    className="h-full transition-all duration-500 rounded-full"
                    style={{ 
                      width: `${category.completion}%`,
                      background: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)'
                    }}
                  />
                </div>
              </div>

              {/* Category Items */}
              <div className="p-4">
                <div className="space-y-3">
                  {category.items.map((item, itemIndex) => {
                    const StatusIcon = getStatusIcon(item.status);
                    const statusColor = getStatusColor(item.status);
                    
                    return (
                      <div 
                        key={itemIndex}
                        className="flex items-start gap-3 p-3 rounded-lg transition-all"
                        style={{ 
                          backgroundColor: darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                          border: `1px solid ${item.isCritical && item.status === 'missing' 
                            ? 'rgba(239,68,68,0.4)' 
                            : darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                        }}
                      >
                        <div 
                          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ 
                            backgroundColor: `${statusColor}20`,
                            border: `2px solid ${statusColor}`
                          }}
                        >
                          <StatusIcon className="w-3.5 h-3.5" style={{ color: statusColor }} />
                        </div>

                        <div className="flex-1">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                                {item.title}
                              </span>
                              {item.isCritical && (
                                <span 
                                  className="text-xs px-2 py-0.5 rounded uppercase"
                                  style={{ 
                                    backgroundColor: item.status === 'missing' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                                    color: item.status === 'missing' ? '#ef4444' : '#f59e0b',
                                    border: `1px solid ${item.status === 'missing' ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)'}`
                                  }}
                                >
                                  Critical
                                </span>
                              )}
                            </div>
                            <span 
                              className="text-xs px-2 py-1 rounded capitalize whitespace-nowrap"
                              style={{ 
                                backgroundColor: `${statusColor}20`,
                                color: statusColor,
                                border: `1px solid ${statusColor}40`
                              }}
                            >
                              {getStatusLabel(item.status)}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                            {item.description}
                          </p>
                          {item.notes && (
                            <div 
                              className="mt-2 p-2 rounded text-xs"
                              style={{ 
                                backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
                                border: '1px solid rgba(99,102,241,0.3)',
                                color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)'
                              }}
                            >
                              <span className="text-[#6366f1]">Note: </span>
                              {item.notes}
                            </div>
                          )}
                          {item.lastUpdated && (
                            <div className="mt-1 text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                              Last updated: {item.lastUpdated}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <FileCheck className="w-4 h-4" />
          Verification Summary
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          The due diligence verification process for {data.companyName || 'the company'} is {data.verificationChecklist.overallCompletion}% complete, 
          with {data.verificationChecklist.completedItems} of {data.verificationChecklist.totalItems} items fully verified. 
          {data.verificationChecklist.partialItems > 0 && (
            <> {data.verificationChecklist.partialItems} item{data.verificationChecklist.partialItems > 1 ? 's' : ''} {data.verificationChecklist.partialItems > 1 ? 'are' : 'is'} partially complete and require{data.verificationChecklist.partialItems === 1 ? 's' : ''} additional documentation.</>
          )}
          {' '}
          {data.verificationChecklist.criticalMissing.length > 0 ? (
            <>
              <span style={{ color: '#ef4444' }}>Critical action required:</span> The following critical document{data.verificationChecklist.criticalMissing.length > 1 ? 's are' : ' is'} missing and must be obtained before proceeding: {data.verificationChecklist.criticalMissing.join(', ')}. 
              All other categories show strong compliance with standard due diligence requirements.
            </>
          ) : (
            <>All critical documents have been verified and the deal is ready to proceed from a documentation standpoint.</>
          )}
        </p>
      </div>
    </div>
  );
}
