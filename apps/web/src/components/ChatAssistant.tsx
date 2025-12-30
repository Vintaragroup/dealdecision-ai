import { useState, useRef, useEffect } from 'react';
import { 
  MessageCircle, 
  X, 
  Send, 
  Home, 
  MessageSquare, 
  HelpCircle,
  Sparkles,
  FileText,
  BarChart3,
  Target,
  TrendingUp,
  ChevronRight
} from 'lucide-react';
import { useUserRole } from '../contexts/UserRoleContext';
import { apiChatWorkspace, isLiveBackend } from '../lib/apiClient';
import type { ChatAction } from '@dealdecision/contracts';

interface ChatAssistantProps {
  darkMode: boolean;
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
}

export function ChatAssistant({ darkMode }: ChatAssistantProps) {
  const { isFounder } = useUserRole();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<ChatAction[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'messages' | 'help'>('home');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (text?: string) => {
    const outgoing = text ?? message;
    if (!outgoing.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: outgoing,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newMessage]);
    setMessage('');
    setActiveTab('messages');
    setIsTyping(true);

    if (isLiveBackend()) {
      try {
        const res = await apiChatWorkspace(outgoing);
        const aiResponse: Message = {
          id: (Date.now() + 1).toString(),
          text: res.reply,
          sender: 'assistant',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, aiResponse]);
        setSuggestedActions(res.suggested_actions ?? []);
      } catch (err) {
        const aiResponse: Message = {
          id: (Date.now() + 1).toString(),
          text: err instanceof Error ? err.message : 'Chat is unavailable right now.',
          sender: 'assistant',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, aiResponse]);
        setSuggestedActions([]);
      } finally {
        setIsTyping(false);
      }
      return;
    }

    // Simulated response for mock mode
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        text: isFounder 
          ? "I can help you with pitch decks, financial projections, investor outreach, and more. What would you like to work on?"
          : "I can assist with due diligence analysis, deal evaluation, market research, and investment memos. How can I help you today?",
        sender: 'assistant',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiResponse]);
      setSuggestedActions([]);
      setIsTyping(false);
    }, 800);
  };

  const handleSuggestedAction = (action: ChatAction) => {
    const label =
      action.type === 'run_analysis'
        ? 'Run analysis on my deal'
        : action.type === 'fetch_evidence'
          ? 'Fetch evidence for my deal'
          : action.type === 'summarize_evidence'
            ? 'Summarize recent evidence'
            : 'Help me with my deal';
    setMessage(label);
    setActiveTab('messages');
  };

  const quickActions = isFounder
    ? [
        { label: 'Help with my pitch deck', icon: <FileText className="w-4 h-4" /> },
        { label: 'Analyze my market size', icon: <Target className="w-4 h-4" /> },
        { label: 'Review financial projections', icon: <BarChart3 className="w-4 h-4" /> },
        { label: 'Improve executive summary', icon: <Sparkles className="w-4 h-4" /> }
      ]
    : [
        { label: 'Run due diligence analysis', icon: <FileText className="w-4 h-4" /> },
        { label: 'Evaluate market opportunity', icon: <Target className="w-4 h-4" /> },
        { label: 'Assess financial metrics', icon: <BarChart3 className="w-4 h-4" /> },
        { label: 'Generate investment memo', icon: <Sparkles className="w-4 h-4" /> }
      ];

  const helpLinks = [
    { label: 'Account Verification', action: 'verify' },
    { label: 'API Developer Documentation', action: 'api-docs' },
    { label: 'Getting Started Guide', action: 'guide' },
    { label: 'Contact Support', action: 'support' }
  ];

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={`fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 z-50 ${
            darkMode
              ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] hover:shadow-[#6366f1]/50'
              : 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] hover:shadow-[#6366f1]/30'
          }`}
        >
          <MessageCircle className="w-6 h-6 text-white" />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div
          className={`fixed bottom-6 right-6 w-[380px] h-[600px] rounded-2xl shadow-2xl flex flex-col overflow-hidden z-50 ${
            darkMode
              ? 'bg-[#18181b] border border-white/10'
              : 'bg-white border border-gray-200'
          }`}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-white" />
              <span className="text-white font-medium">DealDecision AI</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white/80 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === 'home' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Greeting */}
                <div>
                  <h2 className={`text-xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Hi there 👋
                  </h2>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    How can we help?
                  </p>
                </div>

                {/* Message Input */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Send us a message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    className={`w-full px-4 py-3 pr-12 rounded-xl border text-sm ${
                      darkMode
                        ? 'bg-[#27272a] border-white/10 text-white placeholder-gray-500'
                        : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                    }`}
                  />
                  <button
                    onClick={handleSend}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6366f1] hover:text-[#8b5cf6] transition-colors"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>

                {/* Quick Actions */}
                <div className="space-y-2">
                  {quickActions.map((action, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        handleSend(action.label);
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all hover:scale-[1.02] ${
                        darkMode
                          ? 'bg-[#27272a]/50 border-white/10 hover:border-[#6366f1]/50'
                          : 'bg-gray-50 border-gray-200 hover:border-[#6366f1]/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
                        }`}>
                          {action.icon}
                        </div>
                        <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {action.label}
                        </span>
                      </div>
                      <ChevronRight className={`w-4 h-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                    </button>
                  ))}
                </div>

                {/* Search for Help */}
                <div>
                  <button
                    onClick={() => setActiveTab('help')}
                    className={`w-full flex items-center gap-2 p-3 rounded-xl border transition-all ${
                      darkMode
                        ? 'bg-[#27272a]/50 border-white/10 hover:border-[#6366f1]/50'
                        : 'bg-gray-50 border-gray-200 hover:border-[#6366f1]/50'
                    }`}
                  >
                    <HelpCircle className="w-5 h-5 text-[#6366f1]" />
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Search for help
                    </span>
                  </button>
                </div>

                {/* Help Links */}
                <div className="space-y-1">
                  {helpLinks.map((link, i) => (
                    <button
                      key={i}
                      className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
                        darkMode
                          ? 'hover:bg-white/5 text-gray-400 hover:text-gray-300'
                          : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <span className="text-sm">{link.label}</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'messages' && (
              <div className="flex-1 flex flex-col">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.length === 0 ? (
                    <div className={`text-center py-12 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">No messages yet</p>
                      <p className="text-xs mt-1">Start a conversation below</p>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                            msg.sender === 'user'
                              ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                              : darkMode
                                ? 'bg-[#27272a] text-gray-200'
                                : 'bg-gray-100 text-gray-900'
                          }`}
                        >
                          <p className="text-sm">{msg.text}</p>
                        </div>
                      </div>
                    ))
                  )}

                  {isTyping && (
                    <div className="flex justify-start">
                      <div className={`max-w-[60%] rounded-2xl px-4 py-2 ${
                        darkMode ? 'bg-[#27272a] text-gray-200' : 'bg-gray-100 text-gray-900'
                      }`}>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-[#6366f1] animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 rounded-full bg-[#6366f1] animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 rounded-full bg-[#6366f1] animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                      </div>
                    </div>
                  )}

                  {suggestedActions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {suggestedActions.map((action, idx) => (
                        <button
                          key={`${action.type}-${idx}`}
                          onClick={() => handleSuggestedAction(action)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                            darkMode
                              ? 'border-white/10 text-gray-200 hover:border-[#6366f1]/60'
                              : 'border-gray-200 text-gray-700 hover:border-[#6366f1]/60'
                          }`}
                        >
                          {action.type === 'run_analysis' && 'Run Analysis'}
                          {action.type === 'fetch_evidence' && 'Fetch Evidence'}
                          {action.type === 'summarize_evidence' && 'Summarize Evidence'}
                          {action.type === 'generate_report' && 'Generate Report'}
                          {action.type === 'fetch_dio' && 'Load Latest DIO'}
                        </button>
                      ))}
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Input */}
                <div className={`p-4 border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Type your message..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                      className={`w-full px-4 py-3 pr-12 rounded-xl border text-sm ${
                        darkMode
                          ? 'bg-[#27272a] border-white/10 text-white placeholder-gray-500'
                          : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                      }`}
                    />
                    <button
                      onClick={handleSend}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6366f1] hover:text-[#8b5cf6] transition-colors"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'help' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                  <h2 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Help Center
                  </h2>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Find answers and resources
                  </p>
                </div>

                <div className="space-y-2">
                  {helpLinks.map((link, i) => (
                    <button
                      key={i}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                        darkMode
                          ? 'bg-[#27272a]/50 border-white/10 hover:border-[#6366f1]/50'
                          : 'bg-gray-50 border-gray-200 hover:border-[#6366f1]/50'
                      }`}
                    >
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {link.label}
                      </span>
                      <ChevronRight className={`w-4 h-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Navigation */}
          <div className={`border-t ${darkMode ? 'border-white/10 bg-[#18181b]' : 'border-gray-200 bg-white'}`}>
            <div className="grid grid-cols-3">
              <button
                onClick={() => setActiveTab('home')}
                className={`flex flex-col items-center gap-1 py-3 transition-colors ${
                  activeTab === 'home'
                    ? 'text-[#6366f1]'
                    : darkMode
                      ? 'text-gray-500 hover:text-gray-400'
                      : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Home className="w-5 h-5" />
                <span className="text-xs">Home</span>
              </button>
              <button
                onClick={() => setActiveTab('messages')}
                className={`flex flex-col items-center gap-1 py-3 transition-colors ${
                  activeTab === 'messages'
                    ? 'text-[#6366f1]'
                    : darkMode
                      ? 'text-gray-500 hover:text-gray-400'
                      : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <MessageSquare className="w-5 h-5" />
                <span className="text-xs">Messages</span>
              </button>
              <button
                onClick={() => setActiveTab('help')}
                className={`flex flex-col items-center gap-1 py-3 transition-colors ${
                  activeTab === 'help'
                    ? 'text-[#6366f1]'
                    : darkMode
                      ? 'text-gray-500 hover:text-gray-400'
                      : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <HelpCircle className="w-5 h-5" />
                <span className="text-xs">Help</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
