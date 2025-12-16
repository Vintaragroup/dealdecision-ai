import { useState } from 'react';
import { FileText, CheckCircle, Download, Printer, X } from 'lucide-react';
import { CompetitiveLandscape } from './sections/CompetitiveLandscape';
import { TractionMetrics } from './sections/TractionMetrics';
import { ProductTechnicalAssessment } from './sections/ProductTechnicalAssessment';
import { RiskMap } from './sections/RiskMap';
import { VerificationChecklist } from './sections/VerificationChecklist';
import { DealTermsSummary } from './sections/DealTermsSummary';
import { ExecutiveSummary } from './sections/ExecutiveSummary';
import { GoNoGoRecommendation } from './sections/GoNoGoRecommendation';
import { ROISummary } from './sections/ROISummary';
import { MarketAnalysis } from './sections/MarketAnalysis';
import { FinancialAnalysis } from './sections/FinancialAnalysis';
import { TeamAssessment } from './sections/TeamAssessment';
import { KeyFindings } from './sections/KeyFindings';
import { AIConfidenceScores } from './sections/AIConfidenceScores';
import { Button } from '../ui/button';
import { DealReportData, generateSampleReportData } from './lib/report-config';

interface ReportPreviewProps {
  isOpen: boolean;
  darkMode: boolean;
  dealName: string;
  dealId?: string;
  selectedSections: string[];
  onClose: () => void;
  reportData?: DealReportData;
}

export function ReportPreview({ 
  isOpen, 
  darkMode, 
  dealName,
  dealId,
  selectedSections,
  onClose,
  reportData
}: ReportPreviewProps) {
  const [isPrinting, setIsPrinting] = useState(false);

  if (!isOpen) return null;

  // Use provided data or generate sample data with dealId
  const data = reportData || generateSampleReportData(dealName, dealId);

  const handlePrint = () => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 100);
  };

  const handleDownloadPDF = () => {
    // Trigger browser print dialog which can save as PDF
    handlePrint();
  };

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(`section-${sectionId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Section mapping
  const sectionComponents: Record<string, React.ReactNode> = {
    'executive-summary': <ExecutiveSummary data={data} darkMode={darkMode} />,
    'go-no-go': <GoNoGoRecommendation data={data} darkMode={darkMode} />,
    'roi-summary': <ROISummary data={data} darkMode={darkMode} />,
    'market-analysis': <MarketAnalysis data={data} darkMode={darkMode} />,
    'financial-analysis': <FinancialAnalysis data={data} darkMode={darkMode} />,
    'team-assessment': <TeamAssessment data={data} darkMode={darkMode} />,
    'key-findings': <KeyFindings data={data} darkMode={darkMode} />,
    'ai-confidence-scores': <AIConfidenceScores data={data} darkMode={darkMode} />,
    'competitive-landscape': <CompetitiveLandscape data={data} darkMode={darkMode} />,
    'traction-metrics': <TractionMetrics data={data} darkMode={darkMode} />,
    'product-technical-assessment': <ProductTechnicalAssessment data={data} darkMode={darkMode} />,
    'risk-map': <RiskMap data={data} darkMode={darkMode} />,
    'verification-checklist': <VerificationChecklist data={data} darkMode={darkMode} />,
    'deal-terms-summary': <DealTermsSummary data={data} darkMode={darkMode} />,
  };

  const sectionTitles: Record<string, string> = {
    'executive-summary': 'Executive Summary',
    'go-no-go': 'Go/No-Go Recommendation',
    'roi-summary': 'ROI Summary',
    'market-analysis': 'Market Analysis',
    'financial-analysis': 'Financial Analysis',
    'team-assessment': 'Team Assessment',
    'key-findings': 'Key Findings',
    'ai-confidence-scores': 'AI Confidence Scores',
    'competitive-landscape': 'Competitive Landscape',
    'traction-metrics': 'Traction Metrics',
    'product-technical-assessment': 'Product Technical Assessment',
    'risk-map': 'Risk Map',
    'verification-checklist': 'Verification Checklist',
    'deal-terms-summary': 'Deal Terms Summary',
  };

  return (
    <>
      {/* Modal Overlay */}
      <div 
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
        onClick={onClose}
      >
        {/* Modal Content */}
        <div
          className="relative w-full h-full max-w-5xl flex flex-col rounded-2xl shadow-2xl overflow-hidden"
          style={{
            backgroundColor: darkMode ? '#1a1a1a' : '#ffffff',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header - Fixed */}
          <div 
            className="flex items-center justify-between p-6 border-b"
            style={{ 
              backgroundColor: darkMode ? '#0a0a0a' : '#f9fafb',
              borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
            }}
          >
            <div className="flex items-center gap-3">
              <div 
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
              >
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Due Diligence Report Preview
                </h2>
                <p className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  {dealName} • {selectedSections.length} sections
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                darkMode={darkMode}
                icon={<Download className="w-4 h-4" />}
                onClick={handleDownloadPDF}
                loading={isPrinting}
              >
                Download PDF
              </Button>
              <Button
                variant="secondary"
                size="sm"
                darkMode={darkMode}
                icon={<Printer className="w-4 h-4" />}
                onClick={handlePrint}
              >
                Print
              </Button>
              <Button
                variant="ghost"
                size="sm"
                darkMode={darkMode}
                icon={<X className="w-4 h-4" />}
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          </div>

          {/* Report Content - Scrollable */}
          <div 
            className="flex-1 overflow-y-auto"
            style={{ 
              backgroundColor: darkMode ? '#0f0f0f' : '#f9fafb'
            }}
          >
            <div className="max-w-4xl mx-auto p-8">
              {/* Cover Page */}
              <div 
                className="mb-12 p-12 rounded-2xl text-center"
                style={{
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.2) 100%)',
                  border: '2px solid rgba(99,102,241,0.3)'
                }}
              >
                <div className="mb-6">
                  <div 
                    className="w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4"
                    style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
                  >
                    <FileText className="w-10 h-10 text-white" />
                  </div>
                  <h1 className="text-4xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
                    Due Diligence Report
                  </h1>
                  <div className="text-xl mb-4" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                    {data.companyName || data.dealName}
                  </div>
                  <div className="flex items-center justify-center gap-3 text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                    <span>{data.stage}</span>
                    <span>•</span>
                    <span>{data.fundingAmount}</span>
                    <span>•</span>
                    <span>{data.industry}</span>
                  </div>
                </div>

                <div 
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm"
                  style={{
                    backgroundColor: darkMode ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.1)',
                    color: '#10b981',
                    border: '1px solid rgba(16,185,129,0.4)'
                  }}
                >
                  <CheckCircle className="w-4 h-4" />
                  Overall Score: {data.investorScore}/100
                </div>

                <div className="mt-8 pt-8 border-t" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                  <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                    Generated by DealDecision AI
                  </div>
                  <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                    {data.date}
                  </div>
                </div>
              </div>

              {/* Table of Contents */}
              <div 
                className="mb-12 p-8 rounded-2xl"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                }}
              >
                <h2 className="text-2xl mb-6" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Table of Contents
                </h2>
                <div className="space-y-3">
                  {selectedSections.map((sectionId, index) => (
                    <button
                      key={sectionId}
                      onClick={() => scrollToSection(sectionId)}
                      className="w-full flex items-center justify-between p-3 rounded-lg transition-all duration-200 hover:scale-[1.02]"
                      style={{
                        backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                        cursor: 'pointer',
                        border: '1px solid transparent'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)';
                        e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)';
                        e.currentTarget.style.borderColor = 'transparent';
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                          style={{
                            backgroundColor: 'rgba(99,102,241,0.2)',
                            color: '#6366f1'
                          }}
                        >
                          {index + 1}
                        </div>
                        <span style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                          {sectionTitles[sectionId] || sectionId}
                        </span>
                      </div>
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Report Sections */}
              <div className="space-y-16">
                {selectedSections.map((sectionId) => (
                  <div key={sectionId} id={`section-${sectionId}`} style={{ scrollMarginTop: '100px' }}>
                    {sectionComponents[sectionId] || (
                      <div 
                        className="p-8 rounded-2xl text-center"
                        style={{
                          backgroundColor: darkMode ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)',
                          border: '1px solid rgba(245,158,11,0.3)'
                        }}
                      >
                        <p style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                          Section "{sectionTitles[sectionId] || sectionId}" is not yet implemented.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div 
                className="mt-16 pt-8 text-center border-t"
                style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
              >
                <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  This report was generated by DealDecision AI
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>
                  Confidential & Proprietary Information • {data.date}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .report-section,
          .report-section * {
            visibility: visible;
          }
          .report-section {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}