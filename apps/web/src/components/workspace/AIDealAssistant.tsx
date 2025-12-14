import { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Send, 
  Sparkles, 
  User, 
  Lightbulb,
  TrendingUp,
  AlertTriangle,
  FileText,
  CheckCircle2,
  Trash2,
  RotateCcw
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useUserRole } from '../../contexts/UserRoleContext';
import { DealFormData } from '../NewDealModal';

interface AIDealAssistantProps {
  darkMode: boolean;
  isOpen: boolean;
  onClose: () => void;
  dealData: DealFormData;
  dealId: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  content: string;
  timestamp: Date;
  suggestions?: string[];
}

export function AIDealAssistant({ darkMode, isOpen, onClose, dealData, dealId }: AIDealAssistantProps) {
  const { isInvestor, isFounder } = useUserRole();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize with context-aware greeting
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greeting: ChatMessage = {
        id: '1',
        sender: 'ai',
        content: isInvestor
          ? `Hi! I'm your AI assistant for analyzing **${dealData.companyName}**. I have full context of this deal's data, documents, and scores. How can I help you evaluate this opportunity?`
          : `Hi! I'm your AI assistant for improving **${dealData.companyName}**. I can help you strengthen your pitch, improve scores, and address investor concerns. What would you like to work on?`,
        timestamp: new Date(),
        suggestions: isInvestor
          ? [
            'What are the biggest red flags?',
            'Compare to typical Series A deals',
            'Draft an investment memo',
            'What questions should I ask founders?'
          ]
          : [
            'How do I improve my market score?',
            'What\'s missing from my pitch?',
            'Help me strengthen my value proposition',
            'What documents should I add next?'
          ]
      };
      setMessages([greeting]);
    }
  }, [isOpen, dealData.companyName, isInvestor]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const aiResponse = generateAIResponse(input, dealData, isInvestor);
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        content: aiResponse.content,
        timestamp: new Date(),
        suggestions: aiResponse.suggestions
      };
      setMessages(prev => [...prev, aiMessage]);
      setIsTyping(false);
    }, 1500);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const handleClearChat = () => {
    setMessages([]);
    // Re-trigger greeting
    const greeting: ChatMessage = {
      id: Date.now().toString(),
      sender: 'ai',
      content: isInvestor
        ? `Chat cleared. How else can I help you evaluate **${dealData.companyName}**?`
        : `Chat cleared. What would you like to improve about **${dealData.companyName}**?`,
      timestamp: new Date()
    };
    setMessages([greeting]);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className={`fixed right-0 top-0 bottom-0 w-full sm:w-[480px] z-50 shadow-2xl backdrop-blur-xl border-l flex flex-col ${
        darkMode 
          ? 'bg-[#0f0f0f]/95 border-white/10' 
          : 'bg-white/95 border-gray-200'
      }`}>
        {/* Header */}
        <div className={`h-14 px-4 flex items-center justify-between border-b ${
          darkMode ? 'border-white/10' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.3)]">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                AI Deal Assistant
              </h3>
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Analyzing: {dealData.companyName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleClearChat}
              className={`p-2 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
              }`}
              title="Clear conversation"
            >
              <RotateCcw className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            </button>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
              }`}
            >
              <X className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div key={message.id} className="space-y-2">
              <div className={`flex gap-3 ${message.sender === 'user' ? 'justify-end' : ''}`}>
                {message.sender === 'ai' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className={`flex-1 max-w-[85%] ${message.sender === 'user' ? 'flex justify-end' : ''}`}>
                  <div className={`rounded-2xl px-4 py-3 ${
                    message.sender === 'ai'
                      ? darkMode
                        ? 'bg-white/5 border border-white/10'
                        : 'bg-gray-100 border border-gray-200'
                      : 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                  }`}>
                    <div className={`text-xs mb-1 ${
                      message.sender === 'ai'
                        ? darkMode ? 'text-gray-500' : 'text-gray-400'
                        : 'text-white/70'
                    }`}>
                      {message.sender === 'ai' ? 'AI Assistant' : 'You'} · {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className={`text-sm whitespace-pre-wrap ${
                      message.sender === 'ai'
                        ? darkMode ? 'text-gray-300' : 'text-gray-700'
                        : 'text-white'
                    }`}>
                      {message.content}
                    </div>
                  </div>
                </div>
                {message.sender === 'user' && (
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    darkMode ? 'bg-white/10' : 'bg-gray-200'
                  }`}>
                    <User className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                  </div>
                )}
              </div>

              {/* Suggestions */}
              {message.suggestions && message.suggestions.length > 0 && (
                <div className="ml-11 space-y-2">
                  <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    💡 Suggested questions:
                  </p>
                  <div className="space-y-1.5">
                    {message.suggestions.map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSuggestionClick(suggestion)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                          darkMode
                            ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/10'
                            : 'bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 border border-gray-200'
                        }`}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Typing Indicator */}
          {isTyping && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className={`rounded-2xl px-4 py-3 ${
                darkMode ? 'bg-white/5 border border-white/10' : 'bg-gray-100 border border-gray-200'
              }`}>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-[#6366f1] animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 rounded-full bg-[#6366f1] animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 rounded-full bg-[#6366f1] animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className={`p-4 border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="Ask AI anything about this deal..."
                className={`w-full px-4 py-3 rounded-lg border text-sm focus:outline-none transition-all ${
                  darkMode
                    ? 'bg-white/5 border-white/10 text-gray-300 placeholder-gray-600 focus:border-[#6366f1]'
                    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-[#6366f1]'
                }`}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className={`p-3 rounded-lg transition-all ${
                input.trim() && !isTyping
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
    </>
  );
}

// Helper function to generate contextual AI responses
function generateAIResponse(userInput: string, dealData: DealFormData, isInvestor: boolean): { content: string; suggestions?: string[] } {
  const input = userInput.toLowerCase();

  // Investor responses
  if (isInvestor) {
    if (input.includes('red flag') || input.includes('risk')) {
      return {
        content: `Based on my analysis of **${dealData.companyName}**, here are the key red flags:\n\n🚩 **Revenue Concerns**: ${dealData.revenue || 'No revenue data provided'} - Consider validating revenue claims\n🚩 **Market Position**: ${dealData.targetMarket || 'Target market not clearly defined'}\n🚩 **Team Size**: ${dealData.teamSize || 'Team composition unclear'} - May need more bandwidth for scaling\n\nI recommend focusing your due diligence on unit economics and customer retention metrics.`,
        suggestions: [
          'What questions should I ask founders?',
          'Compare to similar deals in my portfolio',
          'Draft investment memo'
        ]
      };
    }

    if (input.includes('compare') || input.includes('benchmark')) {
      return {
        content: `Comparing **${dealData.companyName}** to typical ${dealData.stage || 'Series A'} ${dealData.industry || 'SaaS'} deals:\n\n📊 **Revenue**: ${dealData.revenue || '$0'} (Avg: $850K ARR)\n📊 **Customers**: ${dealData.customers || '0'} (Avg: 25-50 customers)\n📊 **Funding Ask**: ${dealData.fundingAmount || 'Not specified'} (Typical: $3-5M)\n\nThis deal appears ${parseFloat(dealData.revenue?.replace(/[^0-9]/g, '') || '0') > 500000 ? 'above' : 'below'} average for this stage.`,
        suggestions: [
          'What makes this deal unique?',
          'Show me market opportunity analysis',
          'Calculate potential ROI'
        ]
      };
    }

    if (input.includes('memo') || input.includes('summary')) {
      return {
        content: `Here's a draft investment memo outline for **${dealData.companyName}**:\n\n**Executive Summary**\n${dealData.companyName} is a ${dealData.industry || '[Industry]'} company seeking ${dealData.fundingAmount || '$[X]M'} for ${dealData.stage || 'growth'}.\n\n**Market Opportunity**\n${dealData.targetMarket || '[Define TAM/SAM/SOM]'}\n\n**Key Metrics**\n• Revenue: ${dealData.revenue || 'TBD'}\n• Customers: ${dealData.customers || 'TBD'}\n• Team: ${dealData.teamSize || 'TBD'} employees\n\n**Recommendation**: [To be determined after further diligence]`,
        suggestions: [
          'Add competitive analysis',
          'Include risk assessment',
          'Suggest deal terms'
        ]
      };
    }

    return {
      content: `I'm analyzing **${dealData.companyName}** based on the available data. The company is in the ${dealData.industry || 'technology'} space, targeting ${dealData.targetMarket || 'a specific market segment'}.\n\nWhat specific aspect would you like me to focus on?`,
      suggestions: [
        'Analyze financial health',
        'Evaluate team strength',
        'Compare to market benchmarks',
        'Identify key risks'
      ]
    };
  }

  // Founder responses
  if (input.includes('score') || input.includes('improve')) {
    return {
      content: `To improve your overall score for **${dealData.companyName}**, I recommend:\n\n✅ **Market Opportunity** (+15 points): Add TAM/SAM/SOM calculations with data sources\n✅ **Financial Projections** (+12 points): Upload detailed 3-year model with unit economics\n✅ **Traction Metrics** (+10 points): Showcase MoM growth, customer testimonials, and key wins\n\nPrioritize the market opportunity section first - it has the highest impact with moderate effort.`,
      suggestions: [
        'Show me market opportunity template',
        'Help me write financial projections',
        'What documents am I missing?'
      ]
    };
  }

  if (input.includes('missing') || input.includes('document')) {
    return {
      content: `Based on investor expectations for ${dealData.stage || 'your stage'}, you're missing:\n\n📄 **Critical**: Financial Model (3-year projections)\n📄 **Important**: Competitive Analysis Matrix\n📄 **Recommended**: Customer Case Studies\n📄 **Nice-to-have**: Product Roadmap\n\nFocus on the financial model first - it's required for 95% of investor conversations.`,
      suggestions: [
        'Generate financial model template',
        'Create competitive analysis',
        'Draft customer case study'
      ]
    };
  }

  if (input.includes('value prop') || input.includes('pitch')) {
    return {
      content: `Let's strengthen your value proposition for **${dealData.companyName}**:\n\n**Current**: [Based on your data]\n**Improved**: "${dealData.companyName} helps ${dealData.targetMarket || '[target customers]'} ${dealData.type === 'product' ? 'achieve' : 'solve'} [specific outcome] through [unique approach], resulting in [quantifiable benefit]."\n\nWould you like me to refine this further based on your specific metrics?`,
      suggestions: [
        'Add market statistics',
        'Include customer testimonials',
        'Make it more concise'
      ]
    };
  }

  return {
    content: `I'm here to help you strengthen **${dealData.companyName}**'s pitch. Your company is ${dealData.type || 'focused on'} in the ${dealData.industry || 'technology'} space.\n\nWhat would you like to work on?`,
    suggestions: [
      'Improve my pitch deck',
      'Strengthen value proposition',
      'Address investor concerns',
      'Generate missing documents'
    ]
  };
}
