import { useEffect, useState } from 'react';
import { Tabs, Tab } from '../ui/tabs';
import { CircularProgress } from '../ui/CircularProgress';
import { Accordion, AccordionItem } from '../ui/accordion';
import { Button } from '../ui/button';
import { ToastContainer, ToastType } from '../ui/Toast';
import { DocumentsTab } from '../documents/DocumentsTab';
import { DealFormData } from '../NewDealModal';
import { AnimatedCounter } from '../AnimatedCounter';
import { ExportReportModal } from '../ExportReportModal';
import { TemplateExportModal } from '../TemplateExportModal';
import { AnalysisTab } from '../workspace/AnalysisTab';
import { ShareModal } from '../collaboration/ShareModal';
import { CommentsPanel } from '../collaboration/CommentsPanel';
import { AIDealAssistant } from '../workspace/AIDealAssistant';
import { apiGetDeal, apiPostAnalyze, apiGetJob, isLiveBackend, subscribeToEvents, type JobUpdatedEvent } from '../../lib/apiClient';
import { useUserRole } from '../../contexts/UserRoleContext';
import { 
  FileText, 
  TrendingUp, 
  Users, 
  Calendar,
  Sparkles,
  Upload,
  Download,
  Share2,
  CheckCircle,
  AlertCircle,
  Clock,
  Target,
  DollarSign,
  BarChart3,
  Shield,
  Lightbulb,
  Award,
  ArrowUpRight,
  Eye,
  FileCode,
  MessageSquare,
  Send,
  Presentation,
  TrendingDown,
  AlertTriangle,
  Zap,
  Link2,
  MoreVertical,
  Edit
} from 'lucide-react';

interface DealWorkspaceProps {
  darkMode: boolean;
  onViewReport?: () => void;
  dealData?: DealFormData | null;
  dealId?: string;
}

export function DealWorkspace({ darkMode, onViewReport, dealData, dealId }: DealWorkspaceProps) {
  const { isFounder, isInvestor } = useUserRole();
  const [activeTab, setActiveTab] = useState('overview');
  const [investorScore, setInvestorScore] = useState(82);
  const [analyzing, setAnalyzing] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; type: ToastType; title: string; message?: string }>>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showTemplateExportModal, setShowTemplateExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; user: string; message: string; timestamp: Date }>>([]);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [dioMeta, setDioMeta] = useState<{ dioVersionId?: string; dioStatus?: string; lastAnalyzedAt?: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const [jobUpdatedAt, setJobUpdatedAt] = useState<string | null>(null);
  const [sseReady, setSseReady] = useState(false);

  // Map dealId to deal information (in a real app, this would be from an API/database)
  const dealInfo = dealId === 'vintara-001' ? {
    name: 'Vintara Group LLC',
    type: 'series-a',
    stage: 'Investor Ready',
    fundingTarget: '$2M-$3M Series A',
    score: 86,
    updatedTime: '1 hour ago',
    createdDate: 'September 5, 2025',
    description: 'Vintara Group is a spirits brand accelerator acquiring and scaling premium brands in high-growth categories. Lead asset is Califino Tequila, a celebrity-backed brand with strong DTC momentum and strategic distribution partnerships. The holding company model enables rapid portfolio expansion while maintaining lean operations.',
    metrics: {
      currentRevenue: '$0 (pre-revenue)',
      year1Target: '$850K',
      categoryGrowth: '+40% YoY',
      runway: '24mo post-raise',
      grossMargin: '42%',
      brandAcquisitions: '2-3 per year',
      distributorPartnerships: 'Southern Glazer\'s, RNDC',
      breakEven: 'Q3 2026'
    }
  } : null;

  // Use dealInfo if available, otherwise fall back to dealData
  const displayName = dealInfo?.name || dealData?.name || 'TechVision AI Platform';
  const displayType = dealInfo?.type || dealData?.type || 'series-a';
  const displayScore = dealInfo?.score || investorScore;

  useEffect(() => {
    if (!dealId || !isLiveBackend()) return;
    let active = true;
    apiGetDeal(dealId)
      .then((deal) => {
        if (!active) return;
        setDioMeta({
          dioVersionId: (deal as any).dioVersionId,
          dioStatus: (deal as any).dioStatus,
          lastAnalyzedAt: (deal as any).lastAnalyzedAt,
        });
      })
      .catch((err) => {
        if (!active) return;
        addToast('error', 'Failed to load deal metadata', err instanceof Error ? err.message : 'Unknown error');
      });
    return () => {
      active = false;
    };
  }, [dealId]);

  useEffect(() => {
    if (!jobId || sseReady) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const job = await apiGetJob(jobId);
        if (cancelled) return;
        setJobStatus(job.status);
        setJobProgress(typeof job.progress_pct === 'number' ? job.progress_pct : null);
        setJobMessage(job.message || null);
        setJobUpdatedAt(job.updated_at || null);
        if (job.status === 'queued' || job.status === 'running' || job.status === 'retrying') {
          setTimeout(poll, 2000);
        } else {
          setAnalyzing(false);
          addToast(job.status === 'succeeded' ? 'success' : 'error', 'Analysis completed', job.message || job.status);
        }
      } catch (err) {
        if (cancelled) return;
        setAnalyzing(false);
        addToast('error', 'Job polling failed', err instanceof Error ? err.message : 'Unknown error');
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, sseReady]);

  useEffect(() => {
    if (!dealId || !isLiveBackend() || typeof EventSource === 'undefined') {
      setSseReady(false);
      return;
    }

    let cancelled = false;

    const unsubscribe = subscribeToEvents(dealId, {
      onReady: () => {
        if (cancelled) return;
        setSseReady(true);
      },
      onJobUpdated: (job: JobUpdatedEvent) => {
        if (cancelled) return;
        if (job.deal_id && dealId && job.deal_id !== dealId) return;
        if (jobId && job.job_id !== jobId) return;
        setSseReady(true);
        setJobStatus(job.status);
        setJobProgress(typeof job.progress_pct === 'number' ? job.progress_pct : null);
        setJobMessage(job.message ?? null);
        setJobUpdatedAt(job.updated_at ?? null);
        if (["succeeded", "failed", "cancelled"].includes(job.status)) {
          setAnalyzing(false);
          addToast(job.status === "succeeded" ? "success" : "error", "Analysis completed", job.message || job.status);
        }
      },
      onError: () => {
        if (cancelled) return;
        setSseReady(false);
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [dealId, jobId]);

  // Role-specific tabs
  const tabs: Tab[] = isFounder ? [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'documents', label: 'Pitch Materials', icon: <Presentation className="w-4 h-4" />, badge: 7 },
    { id: 'analysis', label: 'AI Refinement', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'feedback', label: 'Investor Feedback', icon: <Lightbulb className="w-4 h-4" />, badge: 12 },
    { id: 'diligence', label: 'Fundraising Progress', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports Generated', icon: <FileText className="w-4 h-4" />, badge: 2 }
  ] : [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="w-4 h-4" />, badge: 8 },
    { id: 'analysis', label: 'AI Analysis', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'diligence', label: 'Due Diligence', icon: <Shield className="w-4 h-4" /> },
    { id: 'feedback', label: 'Investment Thesis', icon: <Target className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports Generated', icon: <FileCode className="w-4 h-4" />, badge: 2 }
  ];

  // Role-specific accordion items (Due Diligence vs Pitch Checklist)
  const dueDiligenceItems: AccordionItem[] = isFounder ? [
    // FOUNDER: Pitch Checklist
    {
      id: 'deck',
      title: 'Pitch Deck Status',
      icon: <Presentation className="w-4 h-4" />,
      badge: '85%',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Slides Complete</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>14/16</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Design Quality</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Excellent</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Storytelling Flow</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Strong</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Data Backed</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Yes</div>
            </div>
          </div>
          <div className={`p-3 rounded-lg border ${darkMode ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5" />
              <div className="flex-1">
                <div className={`text-xs ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>Action needed</div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-amber-400/70' : 'text-amber-600'}`}>Add customer testimonials to slide 12 and competitive analysis to slide 8.</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'financials',
      title: 'Financial Model Readiness',
      icon: <DollarSign className="w-4 h-4" />,
      badge: '92%',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Revenue Model</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Complete</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>3-Year Forecast</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Done</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Unit Economics</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Validated</div>
            </div>
          </div>
          <div className={`p-3 rounded-lg border ${darkMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'}`}>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" />
              <div className="flex-1">
                <div className={`text-xs ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>Investor-ready</div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-emerald-400/70' : 'text-emerald-600'}`}>Financial projections are realistic and well-supported by market data.</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'outreach',
      title: 'Investor Outreach',
      icon: <Users className="w-4 h-4" />,
      badge: '67%',
      content: (
        <div className="space-y-3">
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Target Investor List</span>
              <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>35 investors</span>
            </div>
            <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>Sequoia, a16z, Benchmark, Founders Fund, and 31 others</div>
          </div>
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Meetings Scheduled</span>
              <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>12 meetings</span>
            </div>
            <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>3 this week, 9 next two weeks. 5 follow-up meetings pending.</div>
          </div>
        </div>
      )
    },
    {
      id: 'legal',
      title: 'Legal Documents',
      icon: <Shield className="w-4 h-4" />,
      badge: '75%',
      content: (
        <div className="space-y-3">
          <div className={`p-3 rounded-lg border ${darkMode ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5" />
              <div className="flex-1">
                <div className={`text-xs ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>Almost ready</div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-amber-400/70' : 'text-amber-600'}`}>Cap table ready. Need to upload IP assignment agreements and updated incorporation docs.</div>
              </div>
            </div>
          </div>
        </div>
      )
    }
  ] : [
    // INVESTOR: Due Diligence
    {
      id: 'market',
      title: 'Market Analysis',
      icon: <Target className="w-4 h-4" />,
      badge: '95%',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Total Addressable Market</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>$2.5B</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Target Market Share</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>5% by Y3</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Market Growth Rate</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>24% YoY</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Competitive Position</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Strong</div>
            </div>
          </div>
          <div className={`p-3 rounded-lg border ${darkMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'}`}>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" />
              <div className="flex-1">
                <div className={`text-xs ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>Strong validation</div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-emerald-400/70' : 'text-emerald-600'}`}>Market timing is excellent. Growing demand in enterprise AI space with limited direct competition.</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'financial',
      title: 'Financial Projections',
      icon: <DollarSign className="w-4 h-4" />,
      badge: '88%',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Year 1 Revenue</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>$850K</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Year 3 Revenue</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>$8.5M</div>
            </div>
            <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Break-even</div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Month 18</div>
            </div>
          </div>
          <div className={`p-3 rounded-lg border ${darkMode ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5" />
              <div className="flex-1">
                <div className={`text-xs ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>Minor concern</div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-amber-400/70' : 'text-amber-600'}`}>Customer acquisition cost assumptions are slightly optimistic. Consider adding 15-20% buffer.</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'team',
      title: 'Team Assessment',
      icon: <Users className="w-4 h-4" />,
      badge: '82%',
      content: (
        <div className="space-y-3">
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Core Team Strength</span>
              <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>5 members</span>
            </div>
            <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>Experienced founders with 2 prior exits. Strong technical team from FAANG companies.</div>
          </div>
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Advisory Board</span>
              <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>3 advisors</span>
            </div>
            <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>Industry experts from McKinsey, Sequoia, and enterprise SaaS veterans.</div>
          </div>
        </div>
      )
    },
    {
      id: 'legal',
      title: 'Legal & Compliance',
      icon: <Shield className="w-4 h-4" />,
      badge: '65%',
      content: (
        <div className="space-y-3">
          <div className={`p-3 rounded-lg border ${darkMode ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'}`}>
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
              <div className="flex-1">
                <div className={`text-xs ${darkMode ? 'text-red-300' : 'text-red-700'}`}>Action required</div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-red-400/70' : 'text-red-600'}`}>Missing incorporation documents and IP assignment agreements. Upload required before investor meetings.</div>
              </div>
            </div>
          </div>
        </div>
      )
    }
  ];

  // Role-specific feedback items
  const feedbackItems = isFounder ? [
    // FOUNDER: Pitch Improvement Feedback
    { category: 'Pitch Deck', issue: 'Add more specific customer testimonials on slide 12', priority: 'high', impact: '+5 pts' },
    { category: 'Financial Model', issue: 'Include sensitivity analysis for key assumptions', priority: 'medium', impact: '+3 pts' },
    { category: 'Market Research', issue: 'Strengthen competitive differentiation section', priority: 'medium', impact: '+4 pts' },
    { category: 'Executive Summary', issue: 'Highlight recent traction metrics more prominently', priority: 'high', impact: '+6 pts' },
    { category: 'Team Bios', issue: 'Add LinkedIn profiles for all founders', priority: 'low', impact: '+2 pts' }
  ] : [
    // INVESTOR: Investment Considerations
    { category: 'Market Risk', issue: 'Limited competition validates TAM, but watch for new entrants', priority: 'medium', impact: 'Monitor' },
    { category: 'Financial Concern', issue: 'CAC assumptions optimistic - add 15-20% buffer to projections', priority: 'high', impact: 'Key Risk' },
    { category: 'Team Strength', issue: '2 prior exits and strong FAANG team - major competitive advantage', priority: 'low', impact: 'Strength' },
    { category: 'Valuation Question', issue: '$20M pre-money seems high for stage - negotiate to $16-18M', priority: 'high', impact: 'Action Item' },
    { category: 'Portfolio Fit', issue: 'Aligns perfectly with AI/ML thesis - strong strategic fit', priority: 'low', impact: 'Alignment' }
  ];

  const addToast = (type: ToastType, title: string, message?: string) => {
    const newToast = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message
    };
    setToasts(prev => [...prev, newToast]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  const runAIAnalysis = async () => {
    if (!dealId || !isLiveBackend()) {
      addToast('info', 'Live mode required', 'Switch to live backend to run analysis');
      return;
    }
    setAnalyzing(true);
    setJobProgress(null);
    setJobMessage(null);
    setJobUpdatedAt(null);
    addToast('info', isFounder ? 'Pitch Analysis Started' : 'Investment Analysis Started', 'Queued analysis job...');
    try {
      const res = await apiPostAnalyze(dealId);
      setJobId(res.job_id);
      setJobStatus(res.status);
      addToast('info', 'Job queued', `Job ${res.job_id}`);
    } catch (err) {
      addToast('error', 'Analysis failed to start', err instanceof Error ? err.message : 'Unknown error');
      setAnalyzing(false);
      return;
    }
  };

  const getJobStatusBadge = (status: string | null) => {
    switch (status) {
      case 'queued':
        return 'bg-amber-500/10 border-amber-500/40 text-amber-200';
      case 'running':
      case 'retrying':
        return 'bg-blue-500/10 border-blue-500/40 text-blue-200';
      case 'succeeded':
        return 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200';
      case 'failed':
        return 'bg-red-500/10 border-red-500/40 text-red-200';
      default:
        return darkMode
          ? 'bg-white/5 border-white/10 text-gray-300'
          : 'bg-white/60 border-gray-200 text-gray-700';
    }
  };

  const isStageActive = (stage: 'queued' | 'running' | 'succeeded') => {
    const order: Record<'queued' | 'running' | 'succeeded', number> = {
      queued: 1,
      running: 2,
      succeeded: 3,
    };
    const normalized = jobStatus === 'retrying'
      ? 'running'
      : jobStatus === 'failed'
        ? 'running'
        : jobStatus as 'queued' | 'running' | 'succeeded' | null;
    const currentLevel = normalized ? order[normalized] || 0 : 0;
    return currentLevel >= order[stage];
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Header Section */}
        <div className={`backdrop-blur-xl border rounded-2xl p-4 sm:p-6 ${ 
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <div className="flex flex-col sm:flex-row items-start justify-between gap-4 sm:gap-0 sm:mb-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <h1 className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {displayName}
                </h1>
                <span className="px-3 py-1 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white text-xs rounded-full shadow-[0_0_12px_rgba(99,102,241,0.4)]">
                  {displayType === 'seed' ? 'Seed' : displayType === 'series-a' ? 'Series A' : displayType === 'series-b' ? 'Series B' : displayType === 'series-c' ? 'Series C' : displayType === 'series-d' ? 'Series D+' : 'Series A'}
                </span>
              </div>
              {/* Improved Metadata Layout - Single Flowing Row */}
              <div className={`text-sm flex flex-wrap items-center gap-x-4 gap-y-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Updated 2h ago
                </span>
                <span className={`${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>•</span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  {isFounder ? 'Created' : 'Added'} Nov 15, 2024
                </span>
                <span className={`${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>•</span>
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  {isFounder 
                    ? '24 views, 5 interested, 2 meetings'
                    : '3 partners, 2 reviewed'
                  }
                </span>
              </div>

              {isLiveBackend() && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs sm:text-sm">
                  <span className={`px-2 py-1 rounded-full border ${darkMode ? 'border-white/10 text-gray-200' : 'border-gray-200 text-gray-700'}`}>
                    DIO: {dioMeta?.dioVersionId ? dioMeta.dioVersionId : 'Not generated'}
                  </span>
                  <span className={`px-2 py-1 rounded-full ${darkMode ? 'bg-blue-500/10 text-blue-200' : 'bg-blue-50 text-blue-700'}`}>
                    Status: {dioMeta?.dioStatus ?? 'unknown'}
                  </span>
                  {dioMeta?.lastAnalyzedAt && (
                    <span className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Last analyzed: {new Date(dioMeta.lastAnalyzedAt).toLocaleString()}
                    </span>
                  )}
                  {jobStatus && (
                    <span className={`${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>
                      Job: {jobStatus}{jobId ? ` (${jobId})` : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
            
            {/* Streamlined Action Buttons - 3 Main + More Menu */}
            <div className="flex items-center gap-2 relative">
              {/* AI Assistant Button - New Feature! */}
              <Button 
                variant="primary" 
                darkMode={darkMode}
                icon={<MessageSquare className="w-4 h-4" />}
                onClick={() => dioMeta?.dioVersionId ? setShowAIAssistant(true) : addToast('info', 'AI Assistant needs DIO', 'Run analysis to generate DIO first')}
                disabled={!dioMeta?.dioVersionId && isLiveBackend()}
              >
                💬 AI Assistant
              </Button>
              
              {/* Main Actions */}
              <Button 
                variant="secondary" 
                darkMode={darkMode}
                icon={<Sparkles className="w-4 h-4" />}
                onClick={runAIAnalysis}
                loading={analyzing}
              >
                {analyzing ? 'Analyzing...' : 'Run Analysis'}
              </Button>
              <Button 
                variant="secondary" 
                darkMode={darkMode}
                icon={<Download className="w-4 h-4" />}
                onClick={() => setShowExportModal(true)}
              >
                Export
              </Button>
              <Button 
                variant="secondary" 
                darkMode={darkMode}
                icon={<Edit className="w-4 h-4" />}
                onClick={() => addToast('info', 'Edit Deal', 'Feature coming soon')}
              >
                Edit Deal
              </Button>

              {/* More Actions Dropdown */}
              <div className="relative">
                <Button 
                  variant="secondary" 
                  darkMode={darkMode}
                  icon={<MoreVertical className="w-4 h-4" />}
                  onClick={() => setShowMoreActions(!showMoreActions)}
                >
                  More
                </Button>

                {/* Dropdown Menu */}
                {showMoreActions && (
                  <>
                    {/* Backdrop to close dropdown */}
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowMoreActions(false)}
                    />
                    
                    {/* Dropdown Content */}
                    <div className={`absolute right-0 mt-2 w-56 rounded-xl border shadow-xl z-50 ${
                      darkMode 
                        ? 'bg-[#27272a] border-white/10' 
                        : 'bg-white border-gray-200'
                    }`}>
                      <div className="p-2 space-y-1">
                        <button
                          onClick={() => {
                            setShowMoreActions(false);
                            onViewReport?.();
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                            darkMode
                              ? 'hover:bg-white/10 text-gray-300'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <Eye className="w-4 h-4" />
                          View DD Report
                        </button>
                        <button
                          onClick={() => {
                            setShowMoreActions(false);
                            setShowTemplateExportModal(true);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                            darkMode
                              ? 'hover:bg-white/10 text-gray-300'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <FileCode className="w-4 h-4" />
                          Export with Template
                        </button>
                        <button
                          onClick={() => {
                            setShowMoreActions(false);
                            setShowShareModal(true);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                            darkMode
                              ? 'hover:bg-white/10 text-gray-300'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <Share2 className="w-4 h-4" />
                          Share Deal
                        </button>
                        <button
                          onClick={() => {
                            setShowMoreActions(false);
                            addToast('info', 'Upload Modal', 'Feature coming soon');
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                            darkMode
                              ? 'hover:bg-white/10 text-gray-300'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <Upload className="w-4 h-4" />
                          Upload Documents
                        </button>
                        <div className={`h-px my-1 ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`} />
                        <button
                          onClick={() => {
                            setShowMoreActions(false);
                            addToast('info', 'Copy Link', 'Link copied to clipboard!');
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                            darkMode
                              ? 'hover:bg-white/10 text-gray-300'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <Link2 className="w-4 h-4" />
                          Copy Link
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Score Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1 flex items-center justify-center">
              <CircularProgress
                value={displayScore}
                label={isFounder ? "Pitch Readiness" : "Investment Score"}
                darkMode={darkMode}
                size={160}
                strokeWidth={12}
              />
            </div>
            
            <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className={`backdrop-blur-xl border rounded-xl p-4 ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <Target className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    +12%
                  </span>
                </div>
                <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>95%</div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Market Validation</div>
              </div>

              <div className={`backdrop-blur-xl border rounded-xl p-4 ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <DollarSign className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
                  }`}>
                    +5%
                  </span>
                </div>
                <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>88%</div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Financial Strength</div>
              </div>

              <div className={`backdrop-blur-xl border rounded-xl p-4 ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <Users className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    Strong
                  </span>
                </div>
                <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>82%</div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Team Quality</div>
              </div>

              <div className={`backdrop-blur-xl border rounded-xl p-4 ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <FileText className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                </div>
                <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>7/8</div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Documents Complete</div>
              </div>

              <div className={`backdrop-blur-xl border rounded-xl p-4 ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <TrendingUp className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    +18%
                  </span>
                </div>
                <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>$8.5M</div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Y3 Revenue Target</div>
              </div>

              <div className={`backdrop-blur-xl border rounded-xl p-4 ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <Award className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
                  <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                </div>
                <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>3,250</div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Total XP Earned</div>
              </div>
            </div>
          </div>
        </div>

        {isLiveBackend() && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`backdrop-blur-xl border rounded-2xl p-4 sm:p-6 ${
              darkMode
                ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
                : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Job Center</div>
                  <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Track analyze jobs and backend progress. Polling runs while a job is active.
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full border text-xs font-medium ${getJobStatusBadge(jobStatus)}`}>
                  {jobStatus ?? 'idle'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div className={`p-3 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/70 border-gray-200'}`}>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Active job</div>
                  <div className={`text-sm font-mono break-all ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {jobId || 'None yet'}
                  </div>
                </div>

                <div className={`p-3 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/70 border-gray-200'}`}>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Last analyzed</div>
                  <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {dioMeta?.lastAnalyzedAt ? new Date(dioMeta.lastAnalyzedAt).toLocaleString() : 'Not yet run'}
                  </div>
                </div>
              </div>

              <div className={`mt-4 p-3 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/70 border-gray-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Status detail</div>
                  {jobUpdatedAt && (
                    <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      Updated {new Date(jobUpdatedAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
                {typeof jobProgress === 'number' ? (
                  <div className="space-y-2">
                    <div className={`h-2 rounded-full overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                      <div
                        className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all"
                        style={{ width: `${Math.min(Math.max(jobProgress, 0), 100)}%` }}
                      />
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {jobProgress}% complete
                    </div>
                  </div>
                ) : (
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {jobMessage || 'Waiting for worker update...'}
                  </div>
                )}
                {jobMessage && typeof jobProgress === 'number' && (
                  <div className={`text-xs mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{jobMessage}</div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                {[{ id: 'queued', label: 'Queued' }, { id: 'running', label: 'Processing' }, { id: 'succeeded', label: 'Completed' }].map(stage => {
                  const active = isStageActive(stage.id as 'queued' | 'running' | 'succeeded');
                  const failed = jobStatus === 'failed' && stage.id === 'succeeded';
                  return (
                    <span
                      key={stage.id}
                      className={`px-3 py-1 rounded-full border text-xs ${
                        failed
                          ? 'bg-red-500/10 border-red-500/40 text-red-200'
                          : active
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                            : darkMode
                              ? 'border-white/10 text-gray-400'
                              : 'border-gray-200 text-gray-700'
                      }`}
                    >
                      {stage.label}
                    </span>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-4">
                <Button
                  variant="secondary"
                  darkMode={darkMode}
                  icon={<Zap className="w-4 h-4" />}
                  onClick={runAIAnalysis}
                  loading={analyzing}
                >
                  {analyzing ? 'Analyzing...' : 'Run / Re-run analysis'}
                </Button>
                {jobStatus && (
                  <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Auto-polling every 2s. Status updates when the job finishes.
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tabs Section */}
        <div className={`backdrop-blur-xl border rounded-2xl overflow-hidden ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <Tabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            darkMode={darkMode}
          />

          <div className="p-6">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* VALUE CARD - Hero Element */}
                {dealData?.estimatedSavings && (
                  <div className={`p-6 rounded-2xl border-2 shadow-[0_0_40px_rgba(99,102,241,0.25)] ${
                    darkMode 
                      ? 'bg-gradient-to-br from-[#6366f1]/20 via-[#8b5cf6]/15 to-[#6366f1]/10 border-[#6366f1]/40' 
                      : 'bg-gradient-to-br from-[#6366f1]/10 via-[#8b5cf6]/5 to-white border-[#6366f1]/30'
                  }`}>
                    <div className="flex items-start justify-between mb-6">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="w-6 h-6 text-emerald-400" />
                          <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            Your DealDecision AI Value
                          </h3>
                        </div>
                        <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Estimated savings vs. traditional methods
                        </p>
                      </div>
                      <div className={`px-3 py-1.5 rounded-full text-xs ${
                        darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        🎉 Active Savings
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6 mb-6">
                      {/* Money Saved */}
                      <div className={`p-5 rounded-xl border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'}`}>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-lg">
                            <DollarSign className="w-6 h-6 text-white" />
                          </div>
                          <div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Cost Savings</div>
                            <div className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              $<AnimatedCounter end={dealData.estimatedSavings.money} duration={1500} />
                            </div>
                          </div>
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          vs. $5K-$15K legal fees + $8K-$25K consultant costs
                        </div>
                      </div>

                      {/* Time Saved */}
                      <div className={`p-5 rounded-xl border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'}`}>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg">
                            <Clock className="w-6 h-6 text-white" />
                          </div>
                          <div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Time Saved</div>
                            <div className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              <AnimatedCounter end={dealData.estimatedSavings.hours} duration={1500} /> hrs
                            </div>
                          </div>
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          vs. 60-120 hours of manual research & analysis
                        </div>
                      </div>
                    </div>

                    {/* Breakdown */}
                    <div className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white/50'}`}>
                      <div className={`text-xs mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        What you&apos;re saving on:
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: 'Document drafting', icon: <FileText className="w-4 h-4" />, saved: '$5K-$15K' },
                          { label: 'Due diligence analysis', icon: <Shield className="w-4 h-4" />, saved: '$8K-$25K' },
                          { label: 'Market research', icon: <Target className="w-4 h-4" />, saved: '40-60 hrs' },
                          { label: 'Risk assessment', icon: <AlertCircle className="w-4 h-4" />, saved: '20-40 hrs' }
                        ].map((item, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                              darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
                            }`}>
                              {item.icon}
                            </div>
                            <div>
                              <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {item.label}
                              </div>
                              <div className={`text-xs text-emerald-400`}>
                                {item.saved}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Executive Summary
                  </h3>
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
                    <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {dealInfo?.description || dealData?.description || 'TechVision AI is building the next generation of enterprise AI infrastructure, enabling companies to deploy custom AI models at scale. With 2 prior exits and a team from Google, Meta, and OpenAI, we\'re uniquely positioned to capture the $2.5B market opportunity. Currently serving 15 enterprise customers with $850K ARR and 40% MoM growth.'}
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Key Metrics
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {(dealInfo?.metrics ? [
                      { label: 'Current Revenue', value: dealInfo.metrics.currentRevenue, change: 'Pre-revenue' },
                      { label: 'Year 1 Target', value: dealInfo.metrics.year1Target, change: 'First full year' },
                      { label: 'Category Growth', value: dealInfo.metrics.categoryGrowth, change: 'Tequila market' },
                      { label: 'Gross Margin', value: dealInfo.metrics.grossMargin, change: 'Target margin' },
                      { label: 'Runway', value: dealInfo.metrics.runway, change: 'With funding' },
                      { label: 'Brand Acquisitions', value: dealInfo.metrics.brandAcquisitions, change: 'HoldCo model' },
                      { label: 'Distributors', value: 'SG + RNDC', change: dealInfo.metrics.distributorPartnerships },
                      { label: 'Break-even', value: dealInfo.metrics.breakEven, change: 'Projected' }
                    ] : [
                      { label: 'ARR', value: '$850K', change: '+145%' },
                      { label: 'Enterprise Customers', value: '15', change: '+8 this month' },
                      { label: 'MoM Growth', value: '40%', change: 'Accelerating' },
                      { label: 'Burn Rate', value: '$125K', change: '18mo runway' }
                    ]).map((metric, i) => (
                      <div key={i} className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
                        <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{metric.label}</div>
                        <div className={`text-xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{metric.value}</div>
                        <div className="text-xs text-emerald-400">{metric.change}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Documents Tab */}
            {activeTab === 'documents' && (
              <DocumentsTab dealId={dealId || 'demo'} darkMode={darkMode} />
            )}

            {/* AI Analysis Tab */}
            {activeTab === 'analysis' && (
              <AnalysisTab 
                dealData={dealData || {
                  id: 'deal-fallback',
                  name: 'TechVision AI Platform',
                  company: 'TechVision AI',
                  type: 'series-a',
                  stage: 'Series A',
                  investmentAmount: 5000000,
                  industry: 'Enterprise SaaS',
                  targetMarket: 'Enterprise companies using AI',
                  fundingAmount: '$5M',
                  revenue: '$850,000',
                  customers: '15',
                  teamSize: '8',
                  description: 'Building next-gen AI infrastructure',
                  estimatedSavings: { money: 18500, hours: 85 }
                }} 
                darkMode={darkMode} 
              />
            )}

            {/* Due Diligence Tab */}
            {activeTab === 'diligence' && (
              <Accordion
                items={dueDiligenceItems}
                defaultOpenItems={['market']}
                allowMultiple={true}
                darkMode={darkMode}
              />
            )}

            {/* Feedback Tab */}
            {activeTab === 'feedback' && (
              <div className="space-y-3">
                {feedbackItems.map((item, i) => (
                  <div key={i} className={`p-4 rounded-lg border ${
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Lightbulb className={`w-4 h-4 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-200 text-gray-600'
                        }`}>
                          {item.category}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          item.priority === 'high'
                            ? 'bg-red-500/20 text-red-400'
                            : item.priority === 'medium'
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-blue-500/20 text-blue-400'
                        }`}>
                          {item.priority}
                        </span>
                        <span className="text-xs text-emerald-400">{item.impact}</span>
                      </div>
                    </div>
                    <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{item.issue}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Reports Generated Tab */}
            {activeTab === 'reports' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className={`text-lg mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Generated Reports
                    </h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Access and export previously generated due diligence reports
                    </p>
                  </div>
                </div>

                {/* Report Cards */}
                <div className="space-y-3">
                  {/* Vintara Group LLC Report */}
                  <div className={`p-5 rounded-xl border transition-all hover:shadow-lg ${
                    darkMode 
                      ? 'bg-white/5 border-white/10 hover:bg-white/10' 
                      : 'bg-white border-gray-200 hover:border-[#6366f1]/30'
                  }`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-start gap-4">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                          darkMode ? 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20' : 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10'
                        }`}>
                          <FileCode className="w-6 h-6 text-[#6366f1]" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              Vintara Group LLC - Due Diligence Report
                            </h4>
                            <span className={`px-2 py-0.5 rounded-full text-xs ${
                              darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              Complete
                            </span>
                          </div>
                          <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Beverage Alcohol / CPG • Series A • $2M-$3M
                          </p>
                          <div className="flex items-center gap-4">
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                Generated: Sep 5, 2025
                              </span>
                            </div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              <span className="flex items-center gap-1">
                                <Target className="w-3 h-3" />
                                Score: 86/100
                              </span>
                            </div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              <span className="flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                48 pages
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        darkMode={darkMode}
                        icon={<Eye className="w-4 h-4" />}
                        onClick={() => {
                          onViewReport?.();
                        }}
                      >
                        View Report
                      </Button>
                      <Button
                        variant="secondary"
                        darkMode={darkMode}
                        icon={<Download className="w-4 h-4" />}
                        onClick={() => {
                          setShowExportModal(true);
                          addToast('info', 'Export Ready', 'Choose your preferred format');
                        }}
                      >
                        Export
                      </Button>
                      <Button
                        variant="secondary"
                        darkMode={darkMode}
                        icon={<Share2 className="w-4 h-4" />}
                        onClick={() => {
                          setShowShareModal(true);
                        }}
                      >
                        Share
                      </Button>
                    </div>
                  </div>

                  {/* TechVision AI Platform Report */}
                  <div className={`p-5 rounded-xl border transition-all hover:shadow-lg ${
                    darkMode 
                      ? 'bg-white/5 border-white/10 hover:bg-white/10' 
                      : 'bg-white border-gray-200 hover:border-[#6366f1]/30'
                  }`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-start gap-4">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                          darkMode ? 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20' : 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10'
                        }`}>
                          <FileCode className="w-6 h-6 text-[#6366f1]" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              TechVision AI Platform - Due Diligence Report
                            </h4>
                            <span className={`px-2 py-0.5 rounded-full text-xs ${
                              darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              Complete
                            </span>
                          </div>
                          <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Enterprise SaaS • Series A • $5M
                          </p>
                          <div className="flex items-center gap-4">
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                Generated: Dec 1, 2024
                              </span>
                            </div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              <span className="flex items-center gap-1">
                                <Target className="w-3 h-3" />
                                Score: 87/100
                              </span>
                            </div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              <span className="flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                52 pages
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        darkMode={darkMode}
                        icon={<Eye className="w-4 h-4" />}
                        onClick={() => {
                          addToast('info', 'Opening Report', 'Loading TechVision AI report...');
                        }}
                      >
                        View Report
                      </Button>
                      <Button
                        variant="secondary"
                        darkMode={darkMode}
                        icon={<Download className="w-4 h-4" />}
                        onClick={() => {
                          setShowExportModal(true);
                          addToast('info', 'Export Ready', 'Choose your preferred format');
                        }}
                      >
                        Export
                      </Button>
                      <Button
                        variant="secondary"
                        darkMode={darkMode}
                        icon={<Share2 className="w-4 h-4" />}
                        onClick={() => {
                          setShowShareModal(true);
                        }}
                      >
                        Share
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast Container */}
      <ToastContainer
        toasts={toasts}
        onClose={removeToast}
        darkMode={darkMode}
      />

      {/* Export Report Modal */}
      <ExportReportModal
        isOpen={showExportModal}
        darkMode={darkMode}
        dealName={displayName}
        dealId={dealId}
        onClose={() => setShowExportModal(false)}
      />

      {/* Template Export Modal */}
      <TemplateExportModal
        isOpen={showTemplateExportModal}
        darkMode={darkMode}
        dealData={dealData ?? null}
        onClose={() => setShowTemplateExportModal(false)}
      />

      {/* Share Modal */}
      {showShareModal && (
        <ShareModal
          darkMode={darkMode}
          onClose={() => setShowShareModal(false)}
          itemName={dealData?.name || 'TechVision AI Platform'}
          itemType="deal"
        />
      )}

      {/* Comments Panel */}
      {showCommentsPanel && (
        <CommentsPanel
          darkMode={darkMode}
          dealId="1"
          onClose={() => setShowCommentsPanel(false)}
        />
      )}

      {/* AI Deal Assistant - NEW! */}
      <AIDealAssistant
        darkMode={darkMode}
        isOpen={showAIAssistant}
        onClose={() => setShowAIAssistant(false)}
        dealData={dealData || {
          id: 'deal-fallback',
          name: 'TechVision AI Platform',
          company: 'TechVision AI',
          type: 'series-a',
          stage: 'Series A',
          investmentAmount: 5000000,
          industry: 'Enterprise SaaS',
          targetMarket: 'Enterprise companies using AI',
          fundingAmount: '$5M',
          revenue: '$850,000',
          customers: '15',
          teamSize: '8',
          description: 'Building next-gen AI infrastructure',
          estimatedSavings: { money: 18500, hours: 85 }
        }}
        dealId="1"
      />
    </div>
  );
}