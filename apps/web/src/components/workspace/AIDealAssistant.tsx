import { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Send, 
  Sparkles, 
  User, 
  RotateCcw
} from 'lucide-react';
import { DealFormData } from '../NewDealModal';
import { apiChatDeal, apiRegenerateInvestorInsights } from '../../lib/apiClient';
import type { DealChatActionV1, DealChatSourceV1 } from '@dealdecision/contracts';
import { EvidenceChip } from '../evidence/EvidenceChip';

interface AIDealAssistantProps {
  darkMode: boolean;
  isOpen: boolean;
  onClose: () => void;
  dealData: DealFormData;
  dealId: string;
  dioVersionId?: string;
  onRunAnalysis?: () => Promise<void>;
  onFetchEvidence?: () => void;
  onOpenFullReport?: () => void;
  onOpenExportPdf?: () => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  content: string;
  timestamp: Date;
  suggestions?: string[];
  sources?: DealChatSourceV1[];
  actions?: DealChatActionV1[];
  confidence?: 'high' | 'medium' | 'low';
}

export function AIDealAssistant({ darkMode, isOpen, onClose, dealData, dealId, dioVersionId, onRunAnalysis, onFetchEvidence, onOpenFullReport, onOpenExportPdf }: AIDealAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sourcesVisibleForMessageId, setSourcesVisibleForMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize with context-aware greeting
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greeting: ChatMessage = {
        id: '1',
        sender: 'ai',
        content: `Hi! I'm your AI assistant for evaluating **${dealData.companyName ?? dealData.company ?? 'this deal'}**. I have context on this deal's data, documents, and scores. How can I help you assess this opportunity?`,
        timestamp: new Date(),
        suggestions: [
          'What are the biggest red flags?',
          'Compare to typical Series A deals',
          'Draft an investment memo',
          'What questions should I ask the team?'
        ]
      };
      setMessages([greeting]);
    }
  }, [isOpen, dealData.companyName]);

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

  const handleAction = async (action: DealChatActionV1, messageId?: string) => {
    if (action.type === 'RUN_ANALYZE' && onRunAnalysis) {
      await onRunAnalysis();
      return;
    }
    if (action.type === 'REGENERATE_INSIGHTS') {
      try {
        await apiRegenerateInvestorInsights(dealId);
      } catch {
        // non-fatal
      }
      return;
    }
    if (action.type === 'SHOW_SOURCES' && messageId) {
      setSourcesVisibleForMessageId(prev => prev === messageId ? null : messageId);
      return;
    }
    if (action.type === 'OPEN_FULL_REPORT') {
      onOpenFullReport?.();
      return;
    }
    if (action.type === 'EXPORT_PDF') {
      onOpenExportPdf?.();
      return;
    }
  };

  const actionLabel = (action: DealChatActionV1, messageId?: string): string => {
    switch (action.type) {
      case 'RUN_ANALYZE': return 'Run Analysis';
      case 'REGENERATE_INSIGHTS': return 'Regenerate Insights';
      case 'OPEN_FULL_REPORT': return 'View Full Report';
      case 'SHOW_SOURCES': return sourcesVisibleForMessageId === messageId ? 'Hide Sources' : 'Show Sources';
      case 'EXPORT_PDF': return 'Export PDF';
    }
  };

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

    const canHitLive = !!dealId;

    if (canHitLive) {
      try {
        const res = await apiChatDeal(dealId, input, dioVersionId);
        const aiMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          content: res.message,
          timestamp: new Date(),
          sources: res.sources,
          actions: res.suggested_actions,
          confidence: res.confidence,
        };
        setMessages(prev => [...prev, aiMessage]);
      } catch (err) {
        const aiMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          content: `I couldn't reach the analysis service right now. ${err instanceof Error ? err.message : 'Please try again.'}`,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, aiMessage]);
      } finally {
        setIsTyping(false);
      }
      return;
    }

    // No dealId — shouldn't happen, but handle gracefully
    const fallbackMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      sender: 'ai',
      content: 'Unable to process your request — no deal context is available.',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, fallbackMessage]);
    setIsTyping(false);
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
      content: `Chat cleared. How else can I help you evaluate **${dealData.companyName ?? dealData.company ?? 'this deal'}**?`,
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
                Deal Assistant
              </h3>
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Analyzing: {dealData.companyName ?? dealData.company ?? 'this deal'}
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
                      {message.sender === 'ai' ? 'Deal Assistant' : 'You'} · {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

              {sourcesVisibleForMessageId === message.id && message.sources && message.sources.length > 0 && (
                <div className="ml-12 flex flex-wrap gap-2">
                  {message.sources.map((source) => (
                    <EvidenceChip
                      key={source.evidence_id}
                      evidenceId={source.evidence_id}
                      excerpt={source.excerpt}
                      darkMode={darkMode}
                    />
                  ))}
                </div>
              )}

              {message.actions && message.actions.length > 0 && (
                <div className="ml-12 flex flex-wrap gap-2">
                  {message.actions.map((action, idx) => (
                    <button
                      key={`${action.type}-${idx}`}
                      onClick={() => handleAction(action, message.id)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        darkMode
                          ? 'border-white/10 text-gray-200 hover:border-[#6366f1]/60'
                          : 'border-gray-200 text-gray-700 hover:border-[#6366f1]/60'
                      }`}
                    >
                      {actionLabel(action, message.id)}
                    </button>
                  ))}
                </div>
              )}

              {/* Suggestions */}
              {message.suggestions && message.suggestions.length > 0 && (
                <div className="ml-12 space-y-2">
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
