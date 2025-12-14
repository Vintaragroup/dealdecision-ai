import { useState } from 'react';
import { Button } from '../ui/Button';
import { 
  Sparkles, 
  FileText, 
  TrendingUp, 
  Target,
  DollarSign,
  Lightbulb,
  ChevronRight,
  Save,
  Download,
  Eye,
  Clock,
  Paperclip,
  Mic,
  Send,
  Check,
  MoreHorizontal,
  Wand2,
  Expand,
  Scissors,
  Copy,
  RefreshCw,
  AlertCircle,
  BarChart3
} from 'lucide-react';

interface AIStudioProps {
  darkMode: boolean;
}

type TemplateType = 'idea' | 'executive' | 'pitch' | 'market' | 'business' | 'financial';
type DocumentSection = 'problem' | 'solution' | 'market' | 'team' | 'financials' | 'traction';
type ToneType = 'professional' | 'investor' | 'technical' | 'casual';

interface Template {
  id: TemplateType;
  name: string;
  icon: any;
  description: string;
  progress: number;
  scoreImpact: number;
  sections: DocumentSection[];
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

interface SectionContent {
  title: string;
  content: string;
  status: 'empty' | 'generated' | 'edited';
  hasWarning?: boolean;
  warningMessage?: string;
}

export function AIStudio({ darkMode }: AIStudioProps) {
  const [activeTemplate, setActiveTemplate] = useState<TemplateType>('pitch');
  const [activeSection, setActiveSection] = useState<DocumentSection>('problem');
  const [tone, setTone] = useState<ToneType>('professional');
  const [chatInput, setChatInput] = useState('');
  const [isAITyping, setIsAITyping] = useState(false);
  const [showSaveDropdown, setShowSaveDropdown] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);

  const templates: Template[] = [
    {
      id: 'idea',
      name: 'Idea Wizard',
      icon: Lightbulb,
      description: 'Transform your raw idea into structured format',
      progress: 0,
      scoreImpact: 0,
      sections: ['problem', 'solution', 'market']
    },
    {
      id: 'executive',
      name: 'Executive Summary',
      icon: FileText,
      description: 'Comprehensive 1-2 page overview for investors',
      progress: 45,
      scoreImpact: 5,
      sections: ['problem', 'solution', 'market', 'team', 'financials']
    },
    {
      id: 'pitch',
      name: 'Pitch Deck Outline',
      icon: Target,
      description: 'Full 10-15 slide pitch deck structure',
      progress: 65,
      scoreImpact: 8,
      sections: ['problem', 'solution', 'market', 'team', 'financials', 'traction']
    },
    {
      id: 'market',
      name: 'Market Analysis',
      icon: TrendingUp,
      description: 'Deep dive into TAM, SAM, SOM and competitors',
      progress: 30,
      scoreImpact: 6,
      sections: ['market']
    },
    {
      id: 'business',
      name: 'Business Model',
      icon: BarChart3,
      description: 'Revenue streams, pricing, and go-to-market',
      progress: 0,
      scoreImpact: 0,
      sections: ['solution', 'market', 'financials']
    },
    {
      id: 'financial',
      name: 'Financial Model',
      icon: DollarSign,
      description: 'Projections, assumptions, and unit economics',
      progress: 20,
      scoreImpact: 4,
      sections: ['financials']
    }
  ];

  const sectionTabs = {
    problem: { label: 'Problem', icon: AlertCircle },
    solution: { label: 'Solution', icon: Lightbulb },
    market: { label: 'Market', icon: TrendingUp },
    team: { label: 'Team', icon: Target },
    financials: { label: 'Financials', icon: DollarSign },
    traction: { label: 'Traction', icon: BarChart3 }
  };

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ai',
      content: 'Hello! I\'m your AI assistant. I can help you create compelling investor documents. What would you like to work on?',
      timestamp: new Date(Date.now() - 300000)
    },
    {
      id: '2',
      sender: 'user',
      content: 'Make the problem statement more compelling',
      timestamp: new Date(Date.now() - 120000)
    },
    {
      id: '3',
      sender: 'ai',
      content: '✅ Enhanced with market statistics and urgency. I\'ve added specific data points about the $12B market inefficiency and quantified the time waste (20 hours/week).',
      timestamp: new Date(Date.now() - 60000)
    }
  ]);

  const [sectionContent, setSectionContent] = useState<Record<DocumentSection, SectionContent>>({
    problem: {
      title: 'The Problem',
      content: `Small and medium-sized businesses waste an average of 20 hours per week on manual inventory tracking and management. This inefficiency leads to:\n\n• $12B in annual losses due to stockouts and overstocking\n• 34% of SMBs experiencing cash flow issues from poor inventory decisions\n• Critical decision delays averaging 3-5 days due to lack of real-time data\n\nTraditional inventory systems are too expensive (avg. $50K implementation) and complex for businesses under 50 employees, leaving them with error-prone spreadsheets and outdated processes.`,
      status: 'generated',
      hasWarning: true,
      warningMessage: 'Consider adding a specific customer pain story'
    },
    solution: {
      title: 'Our Solution',
      content: '',
      status: 'empty'
    },
    market: {
      title: 'Market Opportunity',
      content: '',
      status: 'empty'
    },
    team: {
      title: 'Team',
      content: '',
      status: 'empty'
    },
    financials: {
      title: 'Financial Overview',
      content: '',
      status: 'empty'
    },
    traction: {
      title: 'Traction',
      content: '',
      status: 'empty'
    }
  });

  const suggestedPrompts = [
    'Refine the problem statement',
    'Make this more concise',
    'Adapt for investors',
    'Add statistics',
    'Strengthen value prop',
    'Include market data'
  ];

  const toneOptions: { value: ToneType; label: string }[] = [
    { value: 'professional', label: 'Professional' },
    { value: 'investor', label: 'Investor-Focused' },
    { value: 'technical', label: 'Technical' },
    { value: 'casual', label: 'Casual' }
  ];

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      content: chatInput,
      timestamp: new Date()
    };
    
    setChatMessages([...chatMessages, newMessage]);
    setChatInput('');
    setIsAITyping(true);
    
    // Simulate AI response
    setTimeout(() => {
      const aiResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        content: '✨ I\'ve updated the section based on your feedback. The content now has stronger data points and clearer value proposition.',
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, aiResponse]);
      setIsAITyping(false);
    }, 2000);
  };

  const handleGenerateSection = (section: DocumentSection) => {
    setIsAITyping(true);
    setTimeout(() => {
      setSectionContent(prev => ({
        ...prev,
        [section]: {
          ...prev[section],
          content: `[AI-generated content for ${sectionContent[section].title}]\n\nThis section has been automatically generated based on your inputs and best practices for investor presentations.`,
          status: 'generated'
        }
      }));
      setIsAITyping(false);
    }, 2000);
  };

  const activeTemplateData = templates.find(t => t.id === activeTemplate)!;
  const currentSection = sectionContent[activeSection];

  return (
    <div className={`h-full flex flex-col ${darkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`h-14 px-4 sm:px-6 flex items-center justify-between backdrop-blur-xl border-b ${ 
        darkMode ? 'bg-[#0f0f0f]/80 border-white/5' : 'bg-white/80 border-gray-200/50'
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.3)]">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className={`bg-gradient-to-r bg-clip-text text-transparent ${ 
              darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
            }`}>Document Studio</h1>
            <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              Create and refine pitch documents with AI
            </p>
          </div>
        </div>
        
        {/* Action Buttons - Hidden on mobile, shown on larger screens */}
        <div className="hidden md:flex items-center gap-2">
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSaveDropdown(!showSaveDropdown)}
              className="gap-2"
            >
              <Save className="w-4 h-4" />
              Save to Deal
              <ChevronRight className={`w-3 h-3 transition-transform ${showSaveDropdown ? 'rotate-90' : ''}`} />
            </Button>
            {showSaveDropdown && (
              <div className={`absolute top-full right-0 mt-2 w-56 rounded-lg backdrop-blur-xl border shadow-lg z-10 ${
                darkMode ? 'bg-[#1a1a1a]/95 border-white/10' : 'bg-white/95 border-gray-200'
              }`}>
                <div className="p-2">
                  <button className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    darkMode ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
                  }`}>
                    TechVision AI Platform
                  </button>
                  <button className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    darkMode ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
                  }`}>
                    HealthTrack Wearables
                  </button>
                  <div className={`my-2 border-t ${darkMode ? 'border-white/5' : 'border-gray-200'}`}></div>
                  <button className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    darkMode ? 'hover:bg-white/5 text-[#6366f1]' : 'hover:bg-gray-100 text-[#6366f1]'
                  }`}>
                    + Create New Deal
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowExportDropdown(!showExportDropdown)}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              Export
              <ChevronRight className={`w-3 h-3 transition-transform ${showExportDropdown ? 'rotate-90' : ''}`} />
            </Button>
            {showExportDropdown && (
              <div className={`absolute top-full right-0 mt-2 w-48 rounded-lg backdrop-blur-xl border shadow-lg z-10 ${
                darkMode ? 'bg-[#1a1a1a]/95 border-white/10' : 'bg-white/95 border-gray-200'
              }`}>
                <div className="p-2">
                  <button className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    darkMode ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
                  }`}>
                    Export as PDF
                  </button>
                  <button className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    darkMode ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
                  }`}>
                    Export as PowerPoint
                  </button>
                  <button className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    darkMode ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
                  }`}>
                    Export as Word
                  </button>
                  <button className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    darkMode ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
                  }`}>
                    Export as Markdown
                  </button>
                  <div className={`my-2 border-t ${darkMode ? 'border-white/5' : 'border-gray-200'}`}></div>
                  <button className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    darkMode ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
                  }`}>
                    <Copy className="w-3 h-3 inline mr-2" />
                    Copy to Clipboard
                  </button>
                </div>
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" className="gap-2">
            <Eye className="w-4 h-4" />
            Preview
          </Button>

          <Button variant="outline" size="sm" className="gap-2">
            <Clock className="w-4 h-4" />
            History
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden flex-col md:flex-row">
        {/* Left Panel - Templates - Hidden on mobile by default */}
        <div className={`hidden md:block md:w-80 border-r overflow-y-auto ${ 
          darkMode ? 'bg-[#0f0f0f]/50 border-white/5' : 'bg-white/50 border-gray-200/50'
        }`}>
          <div className="p-4 sm:p-6 space-y-6">
            <div>
              <h2 className={`text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Document Templates
              </h2>
              <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                Select a template to start creating with AI
              </p>
            </div>

            <div className="space-y-3">
              {templates.map((template) => {
                const Icon = template.icon;
                const isActive = activeTemplate === template.id;
                
                return (
                  <button
                    key={template.id}
                    onClick={() => setActiveTemplate(template.id)}
                    className={`w-full p-4 rounded-lg backdrop-blur-xl border text-left transition-all ${
                      isActive
                        ? `${darkMode 
                            ? 'bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/20 border-[#6366f1]/30' 
                            : 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30'
                          } shadow-[0_0_20px_rgba(99,102,241,0.15)]`
                        : darkMode
                          ? 'bg-white/5 border-white/10 hover:bg-white/10'
                          : 'bg-white/80 border-gray-200 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isActive
                          ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] shadow-[0_0_20px_rgba(99,102,241,0.3)]'
                          : darkMode
                            ? 'bg-white/10'
                            : 'bg-gray-100'
                      }`}>
                        <Icon className={`w-5 h-5 ${isActive ? 'text-white' : darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className={`text-sm ${
                            isActive 
                              ? darkMode ? 'text-white' : 'text-gray-900'
                              : darkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                            {template.name}
                          </h3>
                          {isActive && (
                            <Check className="w-4 h-4 text-[#6366f1]" />
                          )}
                        </div>
                        <p className={`text-xs mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          {template.description}
                        </p>
                        
                        {template.progress > 0 && (
                          <>
                            <div className="mb-2">
                              <div className={`h-1.5 rounded-full overflow-hidden ${
                                darkMode ? 'bg-white/10' : 'bg-gray-200'
                              }`}>
                                <div 
                                  className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all"
                                  style={{ width: `${template.progress}%` }}
                                ></div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>
                                {template.progress}% complete
                              </span>
                              {template.scoreImpact > 0 && (
                                <span className="text-[#6366f1]">
                                  +{template.scoreImpact} score impact
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Tips */}
            <div className={`p-4 rounded-lg backdrop-blur-xl border ${
              darkMode 
                ? 'bg-[#6366f1]/5 border-[#6366f1]/20' 
                : 'bg-[#6366f1]/5 border-[#6366f1]/20'
            }`}>
              <div className="flex items-start gap-3">
                <Lightbulb className="w-4 h-4 text-[#6366f1] mt-0.5" />
                <div>
                  <h4 className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Pro Tip
                  </h4>
                  <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    Click any section in the document to generate content, or use the chat to refine specific parts.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Document Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Section Tabs */}
          <div className={`px-6 py-3 border-b backdrop-blur-xl ${
            darkMode ? 'bg-[#0f0f0f]/80 border-white/5' : 'bg-white/80 border-gray-200/50'
          }`}>
            <div className="flex items-center gap-2 overflow-x-auto">
              {activeTemplateData.sections.map((section) => {
                const tab = sectionTabs[section];
                const TabIcon = tab.icon;
                const isActive = activeSection === section;
                const sectionData = sectionContent[section];
                
                return (
                  <button
                    key={section}
                    onClick={() => setActiveSection(section)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-[0_0_16px_rgba(99,102,241,0.3)]'
                        : darkMode
                          ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                          : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                    }`}
                  >
                    <TabIcon className="w-4 h-4" />
                    {tab.label}
                    {sectionData.status === 'generated' && (
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        isActive ? 'bg-white' : 'bg-[#6366f1]'
                      }`}></div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Document Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
              {/* Section Warning */}
              {currentSection.hasWarning && currentSection.status === 'generated' && (
                <div className={`p-4 rounded-lg backdrop-blur-xl border flex items-start gap-3 ${
                  darkMode
                    ? 'bg-yellow-500/10 border-yellow-500/20'
                    : 'bg-yellow-50 border-yellow-200'
                }`}>
                  <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5" />
                  <div className="flex-1">
                    <p className={`text-sm ${darkMode ? 'text-yellow-200' : 'text-yellow-800'}`}>
                      💡 AI Suggestion: {currentSection.warningMessage}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <button className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                        darkMode
                          ? 'bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30'
                          : 'bg-yellow-200 text-yellow-900 hover:bg-yellow-300'
                      }`}>
                        ✨ Strengthen with AI
                      </button>
                      <button className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                        darkMode
                          ? 'text-gray-400 hover:text-white'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Section Content */}
              <div className={`p-6 rounded-lg backdrop-blur-xl border ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
              }`}>
                <h2 className={`text-xl mb-4 bg-gradient-to-r bg-clip-text text-transparent ${
                  darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
                }`}>
                  {currentSection.title}
                </h2>

                {currentSection.status === 'empty' ? (
                  <div className="text-center py-12">
                    <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
                      darkMode ? 'bg-white/5' : 'bg-gray-100'
                    }`}>
                      <Sparkles className={`w-8 h-8 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                    </div>
                    <p className={`text-sm mb-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      This section is empty. Let AI generate content for you.
                    </p>
                    <Button
                      onClick={() => handleGenerateSection(activeSection)}
                      className="gap-2"
                    >
                      <Wand2 className="w-4 h-4" />
                      Generate with AI
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className={`prose max-w-none mb-4 ${darkMode ? 'prose-invert' : ''}`}>
                      <div className={`whitespace-pre-wrap text-sm ${
                        darkMode ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {currentSection.content}
                      </div>
                    </div>

                    {/* Inline Actions */}
                    <div className="flex items-center gap-2 pt-4 border-t border-dashed">
                      <button className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
                        darkMode
                          ? 'bg-[#6366f1]/10 text-[#6366f1] hover:bg-[#6366f1]/20 border border-[#6366f1]/20'
                          : 'bg-[#6366f1]/10 text-[#6366f1] hover:bg-[#6366f1]/20 border border-[#6366f1]/20'
                      }`}>
                        <Wand2 className="w-3 h-3" />
                        Improve
                      </button>
                      <button className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        darkMode
                          ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                      }`}>
                        <Expand className="w-3 h-3" />
                        Expand
                      </button>
                      <button className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        darkMode
                          ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                      }`}>
                        <Scissors className="w-3 h-3" />
                        Shorten
                      </button>
                      <button className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        darkMode
                          ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                      }`}>
                        <RefreshCw className="w-3 h-3" />
                        Regenerate
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Panel - Chat Interface */}
      <div className={`border-t backdrop-blur-xl ${
        darkMode ? 'bg-[#0f0f0f]/95 border-white/5' : 'bg-white/95 border-gray-200/50'
      }`}>
        {/* Chat History */}
        <div className="px-6 py-4 max-h-64 overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-[#6366f1]" />
              <h3 className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                AI Conversation
              </h3>
            </div>
            {chatMessages.map((message) => (
              <div key={message.id} className="flex gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  message.sender === 'ai'
                    ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]'
                    : darkMode ? 'bg-white/10' : 'bg-gray-200'
                }`}>
                  {message.sender === 'ai' ? (
                    <Sparkles className="w-4 h-4 text-white" />
                  ) : (
                    <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>You</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    {message.sender === 'ai' ? 'AI Assistant' : 'You'} · {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {message.content}
                  </div>
                </div>
              </div>
            ))}
            {isAITyping && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1">
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    AI Assistant
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-[#6366f1] animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 rounded-full bg-[#6366f1] animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 rounded-full bg-[#6366f1] animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className={`px-6 py-4 border-t ${darkMode ? 'border-white/5' : 'border-gray-200/50'}`}>
          <div className="max-w-4xl mx-auto space-y-3">
            {/* Tone Selector */}
            <div className="flex items-center gap-2">
              <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Tone:</span>
              {toneOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setTone(option.value)}
                  className={`px-3 py-1 rounded-full text-xs transition-all ${
                    tone === option.value
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                      : darkMode
                        ? 'bg-white/5 text-gray-400 hover:bg-white/10'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Suggested Prompts */}
            <div className="flex items-center gap-2 flex-wrap">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setChatInput(prompt)}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                    darkMode
                      ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/10'
                      : 'bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 border border-gray-200'
                  }`}
                >
                  {prompt}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="flex items-center gap-2">
              <div className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-lg backdrop-blur-xl border ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
              }`}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask AI to improve your document..."
                  className={`flex-1 bg-transparent text-sm focus:outline-none ${
                    darkMode ? 'text-gray-300 placeholder-gray-600' : 'text-gray-900 placeholder-gray-400'
                  }`}
                />
                <button className={`p-1.5 rounded-lg transition-colors ${
                  darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
                }`}>
                  <Paperclip className={`w-4 h-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                </button>
                <button className={`p-1.5 rounded-lg transition-colors ${
                  darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
                }`}>
                  <Mic className={`w-4 h-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                </button>
              </div>
              <button
                onClick={handleSendMessage}
                disabled={!chatInput.trim()}
                className={`p-3 rounded-lg transition-all ${
                  chatInput.trim()
                    ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.4)]'
                    : darkMode
                      ? 'bg-white/5 text-gray-600'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}