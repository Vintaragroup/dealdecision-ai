import { X, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';

interface PitchDeckPreviewProps {
  isOpen: boolean;
  darkMode: boolean;
  templateName: string;
  onClose: () => void;
}

export function PitchDeckPreview({ isOpen, darkMode, templateName, onClose }: PitchDeckPreviewProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  if (!isOpen) return null;

  const slides = [
    {
      title: 'Company Overview',
      subtitle: 'Your Mission & Vision',
      content: ['Company name and tagline', 'One-line description', 'Founded date and location', 'Mission statement']
    },
    {
      title: 'Problem',
      subtitle: 'The Pain Point We\'re Solving',
      content: ['Market problem statement', 'Current solutions and limitations', 'Size of the problem', 'Why now?']
    },
    {
      title: 'Solution',
      subtitle: 'Our Unique Approach',
      content: ['Product/service description', 'Key features and benefits', 'How it solves the problem', 'Competitive advantages']
    },
    {
      title: 'Market Opportunity',
      subtitle: 'TAM / SAM / SOM Analysis',
      content: ['Total Addressable Market (TAM)', 'Serviceable Addressable Market (SAM)', 'Serviceable Obtainable Market (SOM)', 'Market growth trends']
    },
    {
      title: 'Product Demo',
      subtitle: 'See It In Action',
      content: ['Product screenshots', 'Key user flows', 'Feature highlights', 'Value proposition']
    },
    {
      title: 'Business Model',
      subtitle: 'How We Make Money',
      content: ['Revenue streams', 'Pricing strategy', 'Unit economics', 'Customer acquisition cost']
    },
    {
      title: 'Traction',
      subtitle: 'Proof of Concept',
      content: ['Key metrics and KPIs', 'Growth rate', 'Customer testimonials', 'Partnerships and pilots']
    },
    {
      title: 'Go-to-Market Strategy',
      subtitle: 'Our Path to Customers',
      content: ['Target customer segments', 'Marketing channels', 'Sales strategy', 'Customer acquisition plan']
    },
    {
      title: 'Competitive Landscape',
      subtitle: 'Market Positioning',
      content: ['Key competitors', 'Competitive matrix', 'Our differentiation', 'Barriers to entry']
    },
    {
      title: 'Team',
      subtitle: 'Who We Are',
      content: ['Founder backgrounds', 'Key team members', 'Advisors and board', 'Why this team will win']
    },
    {
      title: 'Financial Projections',
      subtitle: '3-Year Forecast',
      content: ['Revenue projections', 'Expense breakdown', 'Path to profitability', 'Key assumptions']
    },
    {
      title: 'Use of Funds',
      subtitle: 'Investment Allocation',
      content: ['Funding amount sought', 'Allocation breakdown', 'Milestones to achieve', 'Runway extension']
    },
    {
      title: 'The Ask',
      subtitle: 'Investment Terms',
      content: ['Funding round details', 'Valuation', 'Investment structure', 'Timeline and next steps']
    },
    {
      title: 'Vision',
      subtitle: 'The Future We\'re Building',
      content: ['5-year vision', 'Impact potential', 'Exit opportunities', 'Long-term goals']
    },
    {
      title: 'Contact',
      subtitle: 'Let\'s Talk',
      content: ['Founder contact info', 'Website and social links', 'Schedule a meeting', 'Thank you']
    }
  ];

  const nextSlide = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full h-full max-w-5xl flex flex-col rounded-2xl shadow-2xl overflow-hidden ${
          darkMode ? 'bg-[#18181b]' : 'bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div>
            <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {templateName}
            </h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Slide {currentSlide + 1} of {slides.length}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" darkMode={darkMode} icon={<Download className="w-4 h-4" />}>
              Download
            </Button>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Slide Content */}
        <div className="flex-1 overflow-auto p-8">
          <div className={`max-w-4xl mx-auto rounded-2xl p-16 min-h-[600px] flex flex-col justify-center ${
            darkMode 
              ? 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20 border border-white/10'
              : 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border border-gray-200'
          }`}>
            <div className="text-center mb-8">
              <div className={`inline-block px-4 py-1 rounded-full text-sm mb-4 ${
                darkMode ? 'bg-[#6366f1]/30 text-purple-300' : 'bg-[#6366f1]/20 text-purple-700'
              }`}>
                Slide {currentSlide + 1}
              </div>
              <h1 className={`text-4xl mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {slides[currentSlide].title}
              </h1>
              <p className={`text-xl ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {slides[currentSlide].subtitle}
              </p>
            </div>

            <div className="space-y-4 max-w-2xl mx-auto">
              {slides[currentSlide].content.map((item, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${
                    darkMode 
                      ? 'bg-[#27272a]/50 border-white/10'
                      : 'bg-white/50 border-gray-200'
                  }`}
                >
                  <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    • {item}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className={`px-6 py-4 border-t flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <Button
            variant="outline"
            darkMode={darkMode}
            onClick={prevSlide}
            disabled={currentSlide === 0}
            icon={<ChevronLeft className="w-4 h-4" />}
          >
            Previous
          </Button>
          
          <div className="flex items-center gap-2">
            {slides.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentSlide(index)}
                className={`w-2 h-2 rounded-full transition-all ${
                  index === currentSlide
                    ? 'bg-[#6366f1] w-8'
                    : darkMode 
                      ? 'bg-white/20 hover:bg-white/30'
                      : 'bg-gray-300 hover:bg-gray-400'
                }`}
              />
            ))}
          </div>

          <Button
            variant="primary"
            darkMode={darkMode}
            onClick={nextSlide}
            disabled={currentSlide === slides.length - 1}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
