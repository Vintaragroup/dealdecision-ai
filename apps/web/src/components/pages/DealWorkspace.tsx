import { useEffect, useRef, useState } from 'react';
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
import { DataTab } from '../workspace/DataTab';
import { ShareModal } from '../collaboration/ShareModal';
import { CommentsPanel } from '../collaboration/CommentsPanel';
import { AIDealAssistant } from '../workspace/AIDealAssistant';
import { EvidencePanel } from '../evidence/EvidencePanel';
import { apiGetDeal, apiPostAnalyze, apiGetJob, apiFetchEvidence, apiGetEvidence, apiGetDealReport, apiGetDocuments, isLiveBackend, subscribeToEvents, type DealReport, type JobUpdatedEvent } from '../../lib/apiClient';
import { debugLogger } from '../../lib/debugLogger';
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

type DealFormDataExtras = DealFormData & {
  fundingTarget?: string;
  year1Target?: string;
  categoryGrowth?: string;
  runway?: string;
  grossMargin?: string;
  brandAcquisitions?: string;
  partnerships?: string;
  breakEven?: string;
};

type FeedbackItem = {
  category: string;
  priority: 'high' | 'medium' | 'low';
  impact: string;
  issue: string;
};

export function DealWorkspace({ darkMode, onViewReport, dealData, dealId }: DealWorkspaceProps) {
  const { isFounder, isInvestor } = useUserRole();
  const dealDataExt = dealData as DealFormDataExtras | null | undefined;
  const [activeTab, setActiveTab] = useState('overview');
  const [investorScore, setInvestorScore] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; type: ToastType; title: string; message?: string }>>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showTemplateExportModal, setShowTemplateExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; user: string; message: string; timestamp: Date }>>([]);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [dioMeta, setDioMeta] = useState<{ dioVersionId?: string; dioStatus?: string; lastAnalyzedAt?: string; dioRunCount?: number; dioAnalysisVersion?: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const [jobUpdatedAt, setJobUpdatedAt] = useState<string | null>(null);
  const [sseReady, setSseReady] = useState(false);
  const [evidence, setEvidence] = useState<Array<{ evidence_id: string; deal_id: string; document_id?: string; source: string; kind: string; text: string; confidence?: number; created_at?: string }>>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [lastEvidenceRefresh, setLastEvidenceRefresh] = useState<string | null>(null);
  const [documentTitles, setDocumentTitles] = useState<Record<string, string>>({});
  const [dealFromApi, setDealFromApi] = useState<any>(null);
  const [reportFromApi, setReportFromApi] = useState<DealReport | null>(null);
  const lastEventIdRef = useRef<string | undefined>(undefined);

  const loadReport = async () => {
    if (!dealId || !isLiveBackend()) {
      setReportFromApi(null);
      return;
    }
    try {
      const report = await apiGetDealReport(dealId);
      setReportFromApi(report);
      if (typeof report?.overallScore === 'number' && Number.isFinite(report.overallScore)) {
        setInvestorScore(Math.round(report.overallScore));
      }
    } catch (err) {
      // Report may not exist yet (no DIO). Keep UI usable.
      setReportFromApi(null);
    }
  };

  // Fetch the actual deal from API
  useEffect(() => {
    if (!dealId || !isLiveBackend()) {
      setDealFromApi(null);
      setReportFromApi(null);
      return;
    }
    let active = true;
    apiGetDeal(dealId)
      .then((deal) => {
        if (!active) return;
        setDealFromApi(deal);
        debugLogger.logAPIData('DealWorkspace', 'dealFromApi', deal, `Fetched via apiGetDeal(${dealId})`);
        setDioMeta({
          dioVersionId: (deal as any).dioVersionId,
          dioStatus: (deal as any).dioStatus,
          lastAnalyzedAt: (deal as any).lastAnalyzedAt,
          dioRunCount: (deal as any).dioRunCount,
          dioAnalysisVersion: (deal as any).dioAnalysisVersion,
        });
      })
      .catch((err) => {
        if (!active) return;
        debugLogger.logMockData('DealWorkspace', 'dealFromApi', null, `API call failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        addToast('error', 'Failed to load deal', err instanceof Error ? err.message : 'Unknown error');
      });

    loadReport();

    return () => {
      active = false;
    };
  }, [dealId]);

  // Map dealId to deal information (in a real app, this would be from an API/database)
  const dealInfo = dealFromApi ? {
    name: dealFromApi.name || 'Unknown Deal',
    type: dealData?.type || 'series-a',
    stage: dealFromApi.stage || 'intake',
    fundingTarget: dealDataExt?.fundingTarget || 'TBD',
    score: dealFromApi.score || investorScore,
    updatedTime: dealFromApi.updated_at ? new Date(dealFromApi.updated_at).toLocaleDateString() : 'Recently',
    createdDate: dealFromApi.created_at ? new Date(dealFromApi.created_at).toLocaleDateString() : 'Unknown',
    description: dealData?.description || 'No description provided',
    metrics: {
      currentRevenue: dealData?.revenue || 'N/A',
      year1Target: dealDataExt?.year1Target || 'N/A',
      categoryGrowth: dealDataExt?.categoryGrowth || 'N/A',
      runway: dealDataExt?.runway || 'N/A',
      grossMargin: dealDataExt?.grossMargin || 'N/A',
      brandAcquisitions: dealDataExt?.brandAcquisitions || 'N/A',
      distributorPartnerships: dealDataExt?.partnerships || 'N/A',
      breakEven: dealDataExt?.breakEven || 'N/A'
    }
  } : null;

  // Use dealInfo if available, otherwise fall back to dealData
  const displayName = dealInfo?.name || dealData?.name || 'Unnamed Deal';
  const displayType = dealInfo?.type || dealData?.type || 'series-a';
  const displayScore = typeof dealInfo?.score === 'number' ? dealInfo.score : investorScore;

  // Log data sources for debugging
  useEffect(() => {
    if (typeof dealInfo?.score === 'number') {
      debugLogger.logAPIData('DealWorkspace', 'displayScore', displayScore, 'From dealInfo.score (API data)');
    } else {
      debugLogger.logFallbackData('DealWorkspace', 'displayScore', displayScore, `No API score available, using fallback investorScore (${investorScore})`);
    }
  }, [displayScore, investorScore]);

  const loadEvidence = async () => {
    if (!dealId || !isLiveBackend()) return;
    setEvidenceLoading(true);
    try {
      const res = await apiGetEvidence(dealId);
      setEvidence(res.evidence || []);
      setLastEvidenceRefresh(new Date().toISOString());
    } catch (err) {
      addToast('error', 'Failed to load evidence', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setEvidenceLoading(false);
    }
  };

  const loadDocumentTitles = async () => {
    if (!dealId || !isLiveBackend()) {
      setDocumentTitles({});
      return;
    }
    try {
      const res = await apiGetDocuments(dealId);
      const map: Record<string, string> = {};
      for (const d of res?.documents ?? []) {
        if (!d?.document_id) continue;
        map[d.document_id] = d?.title || d.document_id;
      }
      setDocumentTitles(map);
    } catch {
      // Non-blocking: Evidence can still render without titles.
      setDocumentTitles({});
    }
  };

  useEffect(() => {
    if (!dealId || !isLiveBackend()) {
      setEvidence([]);
      return;
    }
    loadEvidence();
    loadDocumentTitles();
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
          if (job.status === 'succeeded' && dealId) {
            apiGetDeal(dealId)
              .then((deal) => {
                setDealFromApi(deal);
                setDioMeta({
                  dioVersionId: (deal as any).dioVersionId,
                  dioStatus: (deal as any).dioStatus,
                  lastAnalyzedAt: (deal as any).lastAnalyzedAt,
                  dioRunCount: (deal as any).dioRunCount,
                  dioAnalysisVersion: (deal as any).dioAnalysisVersion,
                });
              })
              .catch(() => {});
            loadReport();
            loadEvidence();
          }
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
        if (job.type !== 'fetch_evidence' && jobId && job.job_id !== jobId) return;
        setSseReady(true);
        if (job.updated_at) {
          lastEventIdRef.current = job.updated_at;
        }
        setJobStatus(job.status);
        setJobProgress(typeof job.progress_pct === 'number' ? job.progress_pct : null);
        setJobMessage(job.message ?? null);
        setJobUpdatedAt(job.updated_at ?? null);
        if (job.type === 'fetch_evidence' && job.status === 'succeeded') {
          loadEvidence();
          addToast('success', 'Evidence updated', job.message || 'Fetch completed');
          return;
        }
        if (["succeeded", "failed", "cancelled"].includes(job.status)) {
          setAnalyzing(false);
          addToast(job.status === "succeeded" ? "success" : "error", "Analysis completed", job.message || job.status);
          if (job.status === 'succeeded') {
            loadReport();
            loadEvidence();
            if (dealId) {
              apiGetDeal(dealId)
                .then((deal) => {
                  setDealFromApi(deal);
                  setDioMeta({
                    dioVersionId: (deal as any).dioVersionId,
                    dioStatus: (deal as any).dioStatus,
                    lastAnalyzedAt: (deal as any).lastAnalyzedAt,
                    dioRunCount: (deal as any).dioRunCount,
                    dioAnalysisVersion: (deal as any).dioAnalysisVersion,
                  });
                })
                .catch(() => {});
            }
          }
        }
      },
      onError: () => {
        if (cancelled) return;
        // EventSource connection failed (likely CORS or backend unreachable)
        // App continues to work without real-time updates via polling
        setSseReady(false);
      },
    }, { cursor: lastEventIdRef.current });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [dealId, jobId]);

  // Role-specific tabs
  const tabs: Tab[] = isFounder ? [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'documents', label: 'Pitch Materials', icon: <Presentation className="w-4 h-4" />, badge: 7 },
    { id: 'evidence', label: 'Evidence', icon: <Shield className="w-4 h-4" /> },
    { id: 'analysis', label: 'AI Refinement', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'feedback', label: 'Investor Feedback', icon: <Lightbulb className="w-4 h-4" />, badge: 12 },
    { id: 'diligence', label: 'Fundraising Progress', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports Generated', icon: <FileText className="w-4 h-4" />, badge: 2 }
  ] : [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="w-4 h-4" />, badge: 8 },
    { id: 'evidence', label: 'Evidence', icon: <Shield className="w-4 h-4" /> },
    { id: 'analysis', label: 'AI Analysis', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'diligence', label: 'Due Diligence', icon: <Shield className="w-4 h-4" /> },
    { id: 'feedback', label: 'Investment Thesis', icon: <Target className="w-4 h-4" /> },
    { id: 'data', label: 'Data', icon: <Eye className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports Generated', icon: <FileCode className="w-4 h-4" />, badge: 2 }
  ];

  // Role-specific accordion items (Due Diligence vs Pitch Checklist)
  const dueDiligenceItems: AccordionItem[] = Array.isArray(reportFromApi?.sections)
    ? reportFromApi!.sections!.map((section) => ({
        id: section.id,
        title: section.title,
        icon: <FileText className="w-4 h-4" />,
        content: (
          <div className="space-y-2 whitespace-pre-wrap">
            <div>{section.content}</div>
          </div>
        ),
      }))
    : [];

  // Role-specific feedback items
  const feedbackItems: FeedbackItem[] = [];

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

  const handleFetchEvidence = async () => {
    if (!dealId || !isLiveBackend()) {
      addToast('info', 'Live mode required', 'Switch to live backend to fetch evidence');
      return;
    }
    try {
      const res = await apiFetchEvidence(dealId);
      addToast('info', 'Evidence fetch queued', `Job ${res.job_id}`);
    } catch (err) {
      addToast('error', 'Evidence fetch failed', err instanceof Error ? err.message : 'Unknown error');
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
                  {isFounder ? 'Created' : 'Added'} {dealInfo?.createdDate || 'Unknown'}
                </span>
                <span className={`${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>•</span>
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  {isFounder 
                    ? 'Engagement data not available'
                    : 'Partnership data not available'
                  }
                </span>
              </div>

              {isLiveBackend() && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs sm:text-sm">
                  <span className={`px-2 py-1 rounded-full border ${darkMode ? 'border-white/10 text-gray-200' : 'border-gray-200 text-gray-700'}`}>
                    DIO: {dioMeta?.dioVersionId ? dioMeta.dioVersionId : 'Not generated'}
                  </span>
                  {typeof dioMeta?.dioRunCount === 'number' && (
                    <span className={`px-2 py-1 rounded-full border ${darkMode ? 'border-white/10 text-gray-200' : 'border-gray-200 text-gray-700'}`}>
                      Runs: {dioMeta.dioRunCount}
                      {typeof dioMeta.dioAnalysisVersion === 'number' ? ` (latest v${dioMeta.dioAnalysisVersion})` : ''}
                    </span>
                  )}
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
            
            <div className="lg:col-span-3">
              <div className={`backdrop-blur-xl border rounded-xl p-6 h-full flex flex-col justify-center ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'
              }`}>
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {displayScore >= 70 
                    ? '✨ Strong investment profile. Run analysis for detailed insights.' 
                    : displayScore >= 40
                      ? '📊 Moderate potential. Additional due diligence recommended.'
                      : '🔍 Early stage. Complete documents and analysis to refine score.'}
                </p>
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
                      {dealInfo?.description || dealData?.description || 'No description provided'}
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
                      { label: 'Category Growth', value: dealInfo.metrics.categoryGrowth, change: 'Market analysis' },
                      { label: 'Gross Margin', value: dealInfo.metrics.grossMargin, change: 'Target margin' },
                      { label: 'Runway', value: dealInfo.metrics.runway, change: 'With funding' },
                      { label: 'Brand Acquisitions', value: dealInfo.metrics.brandAcquisitions, change: 'Strategic plan' },
                      { label: 'Distributors', value: dealInfo.metrics.distributorPartnerships || 'N/A', change: 'Partnership structure' },
                      { label: 'Break-even', value: dealInfo.metrics.breakEven, change: 'Projected' }
                    ] : [
                      { label: 'Metrics', value: 'N/A', change: 'No data available' },
                      { label: 'Revenue', value: 'N/A', change: 'Pending analysis' },
                      { label: 'Growth', value: 'N/A', change: 'Awaiting input' },
                      { label: 'Runway', value: 'N/A', change: 'To be determined' }
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

            {/* Evidence Tab */}
            {activeTab === 'evidence' && (
              <EvidencePanel
                darkMode={darkMode}
                evidence={evidence}
                loading={evidenceLoading}
                lastUpdated={lastEvidenceRefresh}
                onRefresh={loadEvidence}
                onFetchEvidence={handleFetchEvidence}
                reportSections={Array.isArray(reportFromApi?.sections) ? reportFromApi!.sections!.map((s) => ({ title: s.title, evidence_ids: s.evidence_ids })) : []}
                documentTitles={documentTitles}
              />
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
              dueDiligenceItems.length > 0 ? (
                <Accordion
                  items={dueDiligenceItems}
                  defaultOpenItems={['market']}
                  allowMultiple={true}
                  darkMode={darkMode}
                />
              ) : (
                <div className={`text-center py-12 rounded-lg border-2 border-dashed ${
                  darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'
                }`}>
                  <Shield className={`w-12 h-12 mx-auto mb-3 opacity-40 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
                  <h3 className={`text-base mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>No diligence items yet</h3>
                  <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    Run analysis to generate a report with diligence sections
                  </p>
                </div>
              )
            )}

            {/* Feedback Tab */}
            {activeTab === 'feedback' && (
              <div>
                {feedbackItems.length > 0 ? (
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
                ) : (
                  <div className={`text-center py-12 rounded-lg border-2 border-dashed ${
                    darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'
                  }`}>
                    <Lightbulb className={`w-12 h-12 mx-auto mb-3 opacity-40 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
                    <h3 className={`text-base mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>No feedback yet</h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Feedback will appear here after investor or stakeholder reviews
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Data Tab */}
            {activeTab === 'data' && (
              <DataTab dealId={dealId || 'demo'} darkMode={darkMode} />
            )}

            {/* Reports Generated Tab */}
            {activeTab === 'reports' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className={`text-lg mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Generated Reports
                    </h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Generated due diligence reports will appear here
                    </p>
                  </div>
                </div>

                <div className={`text-center py-12 rounded-lg border-2 border-dashed ${
                  darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'
                }`}>
                  <FileCode className={`w-12 h-12 mx-auto mb-3 opacity-40 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
                  <h3 className={`text-base mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>No reports generated yet</h3>
                  <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'} mb-4`}>
                    Run an analysis to generate a comprehensive due diligence report
                  </p>
                  <Button
                    variant="primary"
                    darkMode={darkMode}
                    icon={<Sparkles className="w-4 h-4" />}
                    onClick={runAIAnalysis}
                    loading={analyzing}
                  >
                    {analyzing ? 'Generating...' : 'Generate Report'}
                  </Button>
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
        dealId={dealId || 'demo'}
        dioVersionId={dioMeta?.dioVersionId}
        onRunAnalysis={runAIAnalysis}
        onFetchEvidence={handleFetchEvidence}
      />
    </div>
  );
}