import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, Tab } from '../ui/tabs';
import { Accordion, AccordionItem } from '../ui/accordion';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ToastContainer, ToastType } from '../ui/Toast';
import { DocumentsTab } from '../documents/DocumentsTab';
import { DealFormData } from '../NewDealModal';
import { AnimatedCounter } from '../AnimatedCounter';
import { ExportReportModal } from '../ExportReportModal';
import { TemplateExportModal } from '../TemplateExportModal';
import { AnalysisTab } from '../workspace/AnalysisTab';
import { DataTab } from '../workspace/DataTab';
import { DealAnalystTab } from '../deals/tabs/DealAnalystTab';
import { ShareModal } from '../collaboration/ShareModal';
import { CommentsPanel } from '../collaboration/CommentsPanel';
import { AIDealAssistant } from '../workspace/AIDealAssistant';
import { EvidencePanel, type ScoreSectionKey, type ScoreEvidencePayload } from '../evidence/EvidencePanel';
import { apiAutoProfileDeal, apiConfirmDealProfile, apiGetDeal, apiUpdateDeal, apiAutoProgressDeal, apiPostAnalyze, apiPostExtractVisuals, apiPostReextractDocuments, apiGetJob, apiGetDealJobs, apiFetchEvidence, apiGetEvidence, apiGetDealReport, apiGetDocuments, apiResolveEvidence, subscribeToEvents, type AutoProfileResponse, type DealReport, type EvidenceResolveResult, type JobUpdatedEvent, type ProposedDealProfile, type DealJobRowV2 } from '../../lib/apiClient';
import type { JobProgressEventV1 } from '@dealdecision/contracts';
import { debugLogger } from '../../lib/debugLogger';
import { debugApiGetEntries, debugApiIsEnabled, debugApiSubscribe, type DebugApiEntry } from '../../lib/debugApi';
import { derivePhaseBInsights } from '../../lib/phaseb-findings';
import { useUserRole } from '../../contexts/UserRoleContext';
import { useScoreSource } from '../../contexts/ScoreSourceContext';
import { extractFundabilityScore0_100 } from '../../lib/dealScore';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
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
  Clipboard,
  ChevronDown,
  ChevronUp,
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
  const { isAnalyst, isInvestor } = useUserRole();
  const { scoreSource, setScoreSource } = useScoreSource();
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
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [showScoreTraceDebug, setShowScoreTraceDebug] = useState(false);
  const [showAllMissingChips, setShowAllMissingChips] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [stageActionLoading, setStageActionLoading] = useState(false);
  const [dioMeta, setDioMeta] = useState<{ dioVersionId?: string; dioStatus?: string; lastAnalyzedAt?: string; dioRunCount?: number; dioAnalysisVersion?: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const [jobUpdatedAt, setJobUpdatedAt] = useState<string | null>(null);
  const [jobCreatedAt, setJobCreatedAt] = useState<string | null>(null);
  const [jobStartedAt, setJobStartedAt] = useState<string | null>(null);
  const [jobReason, setJobReason] = useState<string | null>(null);
  const [jobProgressSnapshot, setJobProgressSnapshot] = useState<JobProgressEventV1 | null>(null);
  const [jobType, setJobType] = useState<string | null>(null);
  const [jobQueuedSeconds, setJobQueuedSeconds] = useState<number>(0);
  const [dealJobs, setDealJobs] = useState<DealJobRowV2[]>([]);
  const [dealJobsError, setDealJobsError] = useState<string | null>(null);
  type FullProcessStepKey = 'reextract_documents' | 'extract_visuals' | 'analyze_deal';
  type FullProcessStepStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'succeeded_with_warnings' | 'failed' | 'cancelled';
  type FullProcessStepUi = {
    key: FullProcessStepKey;
    label: string;
    status: FullProcessStepStatus;
    job_id?: string | null;
    progress_pct?: number | null;
    message?: string | null;
    updated_at?: string | null;
  };
  type FullProcessUiState = {
    started_at: string;
    current_step: FullProcessStepKey;
    steps: Record<FullProcessStepKey, FullProcessStepUi>;
    ok?: boolean;
    error?: string | null;
  };

  const [fullProcessUi, setFullProcessUi] = useState<FullProcessUiState | null>(null);
  const [fullProcessExtractJobId, setFullProcessExtractJobId] = useState<string | null>(null);
  const [fullProcessExtractCreatedAt, setFullProcessExtractCreatedAt] = useState<string | null>(null);
  const [fullProcessExtractFinishedAt, setFullProcessExtractFinishedAt] = useState<string | null>(null);
  const [expandedJobMessageKeys, setExpandedJobMessageKeys] = useState<Record<string, boolean>>({});
  const [sseReady, setSseReady] = useState(false);
  const [evidence, setEvidence] = useState<Array<{ evidence_id: string; deal_id: string; document_id?: string; visual_asset_id?: string; source: string; kind: string; text: string; confidence?: number; created_at?: string }>>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const scoreBreakdownAnchorRef = useRef<HTMLDivElement | null>(null);
  const [lastEvidenceRefresh, setLastEvidenceRefresh] = useState<string | null>(null);
  const [documentTitles, setDocumentTitles] = useState<Record<string, string>>({});
  const [dealFromApi, setDealFromApi] = useState<any>(null);
  const [reportFromApi, setReportFromApi] = useState<DealReport | null>(null);
  const [reportMissing, setReportMissing] = useState<boolean>(false);
  const [analystReloadKey, setAnalystReloadKey] = useState(0);
  const [analystFocusNodeId, setAnalystFocusNodeId] = useState<string | null>(null);
  const [documentsReloadKey, setDocumentsReloadKey] = useState(0);
  const [selectedScoreSectionKey, setSelectedScoreSectionKey] = useState<ScoreSectionKey | null>(null);
  const [highlightedEvidenceIds, setHighlightedEvidenceIds] = useState<string[]>([]);
  const [resolvedEvidence, setResolvedEvidence] = useState<Record<string, EvidenceResolveResult>>({});
  const [selectedScoreSectionMismatch, setSelectedScoreSectionMismatch] = useState<boolean>(false);
  const [scoreTraceModeOverride, setScoreTraceModeOverride] = useState<'all' | 'trace' | null>(null);

  const [autoProfileLoading, setAutoProfileLoading] = useState(false);
  const [autoProfileResult, setAutoProfileResult] = useState<AutoProfileResponse | null>(null);
  const [profileEdits, setProfileEdits] = useState<ProposedDealProfile>({
    company_name: null,
    deal_name: null,
    investment_type: null,
    round: null,
    industry: null,
  });
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const lastEventIdRef = useRef<string | undefined>(undefined);
  const handledTerminalJobKeysRef = useRef<Set<string>>(new Set());

  const NO_EXTRACTED_DOCS_ANALYZE_ERROR = 'No extracted documents available for analysis';

  const parseJobSortTs = (row: { updated_at?: string | null; created_at?: string | null }): number => {
    const ts = row.updated_at || row.created_at;
    if (!ts) return 0;
    const n = Date.parse(ts);
    return Number.isFinite(n) ? n : 0;
  };

  const parseIsoMs = (ts?: string | null): number | null => {
    if (!ts) return null;
    const n = Date.parse(ts);
    return Number.isFinite(n) ? n : null;
  };

  const getFullProcessRunWindowMs = (): { startMs: number; endMs: number } | null => {
    const startMs = parseIsoMs(fullProcessExtractCreatedAt);
    if (startMs == null) return null;

    const finishedMs = parseIsoMs(fullProcessExtractFinishedAt);
    const endBaseMs = finishedMs ?? Date.now();
    return { startMs, endMs: endBaseMs + 5 * 60_000 };
  };

  const isFullProcessActive = useMemo(() => {
    // `ok` is set only when the full process completes (true) or errors (false).
    return !!fullProcessUi && typeof fullProcessUi.ok === 'undefined';
  }, [fullProcessUi]);

  const splitVerboseMessage = (raw: string): { summary: string; details: string | null } => {
    const msg = String(raw ?? '');
    if (!msg) return { summary: '', details: null };

    const idxCounters = msg.indexOf('counters=');
    if (idxCounters >= 0) {
      const summary = msg.slice(0, idxCounters).trim();
      const details = msg.slice(idxCounters).trim();
      return { summary: summary || 'Details available', details: details || null };
    }

    const hasJsonLike = msg.includes('{') && msg.includes('}');
    if (hasJsonLike && msg.length > 120) {
      const idx = msg.indexOf('{');
      const summary = idx > 0 ? msg.slice(0, idx).trim() : 'Details available';
      const details = msg.slice(idx >= 0 ? idx : 0).trim();
      return { summary: summary || 'Details available', details: details || null };
    }

    return { summary: msg, details: null };
  };

  const renderSafeJobMessage = (key: string, message: string | null | undefined, opts?: { testId?: string }) => {
    if (!message) return null;
    const { summary, details } = splitVerboseMessage(message);
    const expanded = !!expandedJobMessageKeys[key];

    return (
      <div className="min-w-0">
        <div
          data-testid={opts?.testId}
          className={`text-xs break-words whitespace-pre-wrap overflow-hidden line-clamp-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
        >
          {summary}
        </div>
        {details ? (
          <div className="mt-1">
            <button
              type="button"
              className={`text-[11px] underline ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
              onClick={() =>
                setExpandedJobMessageKeys((prev) => ({
                  ...prev,
                  [key]: !prev[key],
                }))
              }
            >
              {expanded ? 'Hide details' : 'View details'}
            </button>
            {expanded ? (
              <pre
                className={`mt-2 max-h-48 overflow-auto text-xs break-words whitespace-pre-wrap rounded-lg border px-3 py-2 ${
                  darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-800'
                }`}
              >
                {details}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const isSucceededJobStatus = (status: unknown): boolean => {
    const s = String(status ?? '').toLowerCase();
    return s === 'succeeded' || s === 'succeeded_with_warnings';
  };

  const isFailedJobStatus = (status: unknown): boolean => {
    return String(status ?? '').toLowerCase() === 'failed';
  };

  const isRunningOrRetryingJobStatus = (status: unknown): boolean => {
    const s = String(status ?? '').toLowerCase();
    return s === 'running' || s === 'retrying' || s === 'queued';
  };

  const shouldTreatRunAnalyzeFailureAsPending = (opts: {
    extractFinishedAt: string | null;
    nowMs?: number;
  }): boolean => {
    // If extraction is still running/finalizing OR it finished very recently, allow a grace window
    // so a fast-failing analyze attempt doesn't flash a red failure before a retry succeeds.
    const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
    const finishedMs = parseIsoMs(opts.extractFinishedAt);
    if (finishedMs == null) return true;
    return nowMs - finishedMs <= 60_000;
  };

  const isSupersedableAnalyzeFailure = (row: { status?: unknown; message?: unknown; error?: unknown } | null | undefined): boolean => {
    if (!row) return false;
    if (!isFailedJobStatus(row.status)) return false;
    const msg = String(row.message ?? row.error ?? '').toLowerCase();
    return msg.includes(NO_EXTRACTED_DOCS_ANALYZE_ERROR.toLowerCase());
  };

  const selectBestAnalyzeJob = (rows: DealJobRowV2[], pinnedAnalyzeJobId?: string | null): DealJobRowV2 | null => {
    const analyzeJobs = rows.filter((r) => (r.type ?? '') === 'analyze_deal');
    if (analyzeJobs.length === 0) return null;

    const sorted = [...analyzeJobs].sort((a, b) => parseJobSortTs(b) - parseJobSortTs(a));
    const newestSucceeded = sorted.find((r) => isSucceededJobStatus(r.status)) ?? null;
    const newestAny = sorted[0] ?? null;

    const pinned = pinnedAnalyzeJobId ? sorted.find((r) => r.job_id === pinnedAnalyzeJobId) ?? null : null;
    if (pinned && isSupersedableAnalyzeFailure(pinned) && newestSucceeded && parseJobSortTs(newestSucceeded) > parseJobSortTs(pinned)) {
      return newestSucceeded;
    }

    if (newestSucceeded) return newestSucceeded;
    return newestAny;
  };

  const selectAnalyzeJobInWindow = (rows: DealJobRowV2[], window: { startMs: number; endMs: number }): DealJobRowV2 | null => {
    const candidates = rows.filter((r) => {
      if ((r.type ?? '') !== 'analyze_deal') return false;
      const createdMs = parseIsoMs(r.created_at ?? null);
      if (createdMs == null) return false;
      return createdMs >= window.startMs && createdMs <= window.endMs;
    });
    if (candidates.length === 0) return null;

    const sorted = [...candidates].sort((a, b) => parseJobSortTs(b) - parseJobSortTs(a));

    // Precedence: newest succeeded > newest running/retrying/queued > newest (usually failed).
    const newestSucceeded = sorted.find((r) => isSucceededJobStatus(r.status)) ?? null;
    if (newestSucceeded) return newestSucceeded;
    const newestActive = sorted.find((r) => isRunningOrRetryingJobStatus(r.status)) ?? null;
    return newestActive ?? (sorted[0] ?? null);
  };

  const dealJobsById = useMemo(() => {
    const map = new Map<string, DealJobRowV2>();
    for (const row of dealJobs) map.set(row.job_id, row);
    return map;
  }, [dealJobs]);

  const pinnedJobRow = useMemo(() => {
    if (!jobId) return null;
    return dealJobsById.get(jobId) ?? null;
  }, [dealJobsById, jobId]);

  const fullProcessRunExtractJobId = fullProcessExtractJobId ?? fullProcessUi?.steps?.extract_visuals?.job_id ?? null;

  const derivedAnalyzeForRun = useMemo(() => {
    if (!fullProcessRunExtractJobId) return { job: null as DealJobRowV2 | null, treatFailedAsPending: false };
    const window = getFullProcessRunWindowMs();
    if (!window) return { job: null as DealJobRowV2 | null, treatFailedAsPending: false };

    const job = selectAnalyzeJobInWindow(dealJobs, window);
    if (!job) return { job: null as DealJobRowV2 | null, treatFailedAsPending: false };

    const treatFailedAsPending =
      (job.type ?? '') === 'analyze_deal' &&
      isFailedJobStatus(job.status) &&
      // Only suppress the known fast-fail during the run.
      isSupersedableAnalyzeFailure(job) &&
      // Treat as pending while Full process is active, or shortly after extraction finishes.
      (isFullProcessActive || shouldTreatRunAnalyzeFailureAsPending({ extractFinishedAt: fullProcessExtractFinishedAt ?? null }));

    return { job, treatFailedAsPending };
  }, [dealJobs, fullProcessExtractCreatedAt, fullProcessExtractFinishedAt, fullProcessRunExtractJobId, isFullProcessActive, jobUpdatedAt]);

  const pinnedIsAnalyze = jobType === 'analyze_deal' || (pinnedJobRow?.type ?? null) === 'analyze_deal';

  const selectedAnalyzeJobForPinned = useMemo(() => {
    if (!pinnedIsAnalyze) return null;
    // During Full process, only override pinned failed analyzes when a succeeded analyze exists within the run window.
    if (fullProcessRunExtractJobId) {
      const pinned = pinnedJobRow;
      if (pinned && isFailedJobStatus(pinned.status) && derivedAnalyzeForRun.job && isSucceededJobStatus(derivedAnalyzeForRun.job.status)) {
        if (parseJobSortTs(derivedAnalyzeForRun.job) > parseJobSortTs(pinned)) {
          return derivedAnalyzeForRun.job;
        }
      }
      return selectBestAnalyzeJob(dealJobs, jobId);
    }
    return selectBestAnalyzeJob(dealJobs, jobId);
  }, [dealJobs, derivedAnalyzeForRun.job, fullProcessRunExtractJobId, jobId, pinnedIsAnalyze, pinnedJobRow]);

  const activeJobId = pinnedIsAnalyze ? (selectedAnalyzeJobForPinned?.job_id ?? jobId) : jobId;

  useEffect(() => {
    if (!pinnedIsAnalyze) return;
    if (!jobId) return;
    if (selectedAnalyzeJobForPinned?.job_id && selectedAnalyzeJobForPinned.job_id !== jobId) {
      setJobId(selectedAnalyzeJobForPinned.job_id);
    }
  }, [jobId, pinnedIsAnalyze, selectedAnalyzeJobForPinned?.job_id]);

  const waitForAnalyzeInRunWindow = async (
    dealIdToUse: string,
    runWindow: { startMs: number; endMs: number },
    opts?: { timeoutMs?: number; pollMs?: number; onPoll?: () => void }
  ): Promise<DealJobRowV2 | null> => {
    const timeoutMs = typeof opts?.timeoutMs === 'number' ? opts.timeoutMs : 10 * 60_000;
    const pollMs = typeof opts?.pollMs === 'number' ? opts.pollMs : 2000;

    const started = Date.now();
    while (true) {
      try {
        opts?.onPoll?.();
      } catch {
        // ignore
      }

      const rows = await apiGetDealJobs(dealIdToUse, { limit: 200 });
        const derived = selectAnalyzeJobInWindow(Array.isArray(rows) ? rows : [], runWindow);
      if (derived) return derived;

      if (Date.now() - started > timeoutMs) return null;
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, pollMs));
    }
  };

  const shownToastKeysRef = useRef<Set<string>>(new Set());
  const delayedAnalyzeFailureToastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dealJobsRef = useRef<DealJobRowV2[]>([]);
  const fullProcessRunWindowRef = useRef<{ startMs: number; endMs: number } | null>(null);

  useEffect(() => {
    dealJobsRef.current = dealJobs;
  }, [dealJobs]);

  useEffect(() => {
    if (!fullProcessRunExtractJobId) {
      fullProcessRunWindowRef.current = null;
      return;
    }
    fullProcessRunWindowRef.current = getFullProcessRunWindowMs();
  }, [fullProcessExtractCreatedAt, fullProcessExtractFinishedAt, fullProcessRunExtractJobId, jobUpdatedAt]);

  useEffect(() => {
    return () => {
      for (const timer of delayedAnalyzeFailureToastTimersRef.current.values()) {
        globalThis.clearTimeout(timer);
      }
      delayedAnalyzeFailureToastTimersRef.current.clear();
    };
  }, []);

  const hasSucceededAnalyzeSoonAfterFailure = (opts: {
    rows: DealJobRowV2[];
    window: { startMs: number; endMs: number };
    failedCreatedMs: number;
    withinMs: number;
  }): boolean => {
    const cutoffMs = opts.failedCreatedMs + opts.withinMs;
    for (const row of opts.rows) {
      if ((row.type ?? '') !== 'analyze_deal') continue;
      if (!isSucceededJobStatus(row.status)) continue;
      const createdMs = parseIsoMs(row.created_at ?? null);
      if (createdMs == null) continue;
      if (createdMs < opts.window.startMs || createdMs > opts.window.endMs) continue;
      if (createdMs > opts.failedCreatedMs && createdMs <= cutoffMs) return true;
    }
    return false;
  };

  const scheduleAnalyzeFailureToastIfNoQuickSuccess = (opts: {
    toastKey: string;
    toastMessage: string;
    failedCreatedAt: string | null | undefined;
  }): boolean => {
    if (!isFullProcessActive) return false;
    const runWindow = fullProcessRunWindowRef.current;
    if (!runWindow) return false;

    const failedCreatedMs = parseIsoMs(opts.failedCreatedAt ?? null);
    if (failedCreatedMs == null) return false;
    if (failedCreatedMs < runWindow.startMs || failedCreatedMs > runWindow.endMs) return false;

    // If we already see a succeeding analyze shortly after, suppress immediately.
    if (hasSucceededAnalyzeSoonAfterFailure({ rows: dealJobsRef.current, window: runWindow, failedCreatedMs, withinMs: 30_000 })) {
      return true;
    }

    if (delayedAnalyzeFailureToastTimersRef.current.has(opts.toastKey)) {
      return true;
    }

    const timer = globalThis.setTimeout(async () => {
      delayedAnalyzeFailureToastTimersRef.current.delete(opts.toastKey);
      try {
        if (!dealId) return;
        const rows = await apiGetDealJobs(dealId, { limit: 200 });
        const arr = Array.isArray(rows) ? (rows as DealJobRowV2[]) : [];
        const latestWindow = fullProcessRunWindowRef.current ?? runWindow;
        const ok = hasSucceededAnalyzeSoonAfterFailure({ rows: arr, window: latestWindow, failedCreatedMs, withinMs: 30_000 });
        if (ok) return;

        addToastOnce(opts.toastKey, 'error', 'Analysis completed', opts.toastMessage);
      } catch {
        // If we can't verify a succeeding analyze, fall back to surfacing the failure.
        addToastOnce(opts.toastKey, 'error', 'Analysis completed', opts.toastMessage);
      }
    }, 30_000);

    delayedAnalyzeFailureToastTimersRef.current.set(opts.toastKey, timer);
    return true;
  };
  const lastProgressKeyRef = useRef<string | null>(null);
  const reportMissingRef = useRef<boolean>(false);
  const lastReportAttemptAtRef = useRef<number>(0);

  const [debugApiEntries, setDebugApiEntries] = useState<DebugApiEntry[]>(() => (debugApiIsEnabled() ? debugApiGetEntries() : []));

  useEffect(() => {
    if (!debugApiIsEnabled()) return;
    setDebugApiEntries(debugApiGetEntries());
    return debugApiSubscribe(() => {
      setDebugApiEntries(debugApiGetEntries());
    });
  }, []);

  const normalizeProgressSnapshot = (progress: unknown, jobMeta?: Partial<JobUpdatedEvent>): JobProgressEventV1 | null => {
    if (!progress || typeof progress !== 'object') return null;
    const p = progress as any;
    const stage = typeof p.stage === 'string' ? p.stage : null;
    const percent = typeof p.percent === 'number'
      ? p.percent
      : typeof (jobMeta as any)?.progress_pct === 'number'
        ? (jobMeta as any).progress_pct
        : undefined;
    const at = typeof p.at === 'string' ? p.at : (jobMeta as any)?.updated_at ?? null;
    const jobMetaDocumentId = (jobMeta as any)?.document_id;

    if (!stage && percent == null) return null;

    return {
      ...(p as Record<string, unknown>),
      job_id: typeof p.job_id === 'string' && p.job_id ? p.job_id : jobMeta?.job_id ?? jobId ?? '',
      deal_id: typeof p.deal_id === 'string' && p.deal_id ? p.deal_id : jobMeta?.deal_id ?? dealId ?? undefined,
      document_id: typeof p.document_id === 'string' ? p.document_id : jobMetaDocumentId ?? undefined,
      type: typeof p.type === 'string' ? p.type : jobMeta?.type ?? undefined,
      status: typeof p.status === 'string' ? p.status : jobMeta?.status,
      stage: stage ?? 'running',
      percent,
      completed: typeof p.completed === 'number' ? p.completed : undefined,
      total: typeof p.total === 'number' ? p.total : undefined,
      message: typeof p.message === 'string' ? p.message : (jobMeta as any)?.message ?? undefined,
      reason: typeof p.reason === 'string' ? p.reason : undefined,
      meta: p.meta ?? undefined,
      at: at ?? undefined,
    } as JobProgressEventV1;
  };

  const applyProgressSnapshot = (progress: unknown, jobMeta?: Partial<JobUpdatedEvent>): boolean => {
    const normalized = normalizeProgressSnapshot(progress, jobMeta);
    if (!normalized) return false;
    const key = `${normalized.job_id ?? ''}|${normalized.stage ?? 'n/a'}|${normalized.percent ?? 'na'}|${normalized.at ?? normalized.status ?? ''}`;
    if (lastProgressKeyRef.current === key) return true;
    lastProgressKeyRef.current = key;
    setJobProgressSnapshot(normalized);
    setJobProgress(typeof normalized.percent === 'number' ? normalized.percent : null);
    if (normalized.message) setJobMessage(normalized.message);
    if (normalized.at) setJobUpdatedAt(normalized.at);
    return true;
  };

  const loadReport = async (opts?: { force?: boolean }) => {
    if (!dealId) {
      setReportFromApi(null);
      return;
    }
    const now = Date.now();
    if (!opts?.force && reportMissingRef.current) return;
    if (!opts?.force && now - lastReportAttemptAtRef.current < 8000) return;
    lastReportAttemptAtRef.current = now;
    try {
      const report = await apiGetDealReport(dealId);
      reportMissingRef.current = false;
      setReportMissing(!report);
      setReportFromApi(report);
      if (typeof report?.overallScore === 'number' && Number.isFinite(report.overallScore)) {
        setInvestorScore(Math.round(report.overallScore));
      }
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 404) {
        reportMissingRef.current = true; // suppress noisy retries until a job succeeds
        setReportMissing(true);
      }
      setReportFromApi(null);
    }
  };
  // Fetch the actual deal from API
  useEffect(() => {
    if (!dealId) {
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

    loadReport({ force: true });

    return () => {
      active = false;
    };
  }, [dealId]);

  useEffect(() => {
    setSelectedScoreSectionKey(null);
    setHighlightedEvidenceIds([]);
    setResolvedEvidence({});
    setSelectedScoreSectionMismatch(false);
    setScoreTraceModeOverride(null);
  }, [dealId]);

  useEffect(() => {
    lastProgressKeyRef.current = null;
    setJobProgressSnapshot(null);
    setJobProgress(null);
    setJobMessage(null);
  }, [jobId]);

  useEffect(() => {
    const highlightedIds = (highlightedEvidenceIds ?? []).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const visibleEvidenceIds = (evidence ?? []).map((e) => e?.evidence_id).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const ids = Array.from(new Set([...highlightedIds, ...visibleEvidenceIds])).slice(0, 100);
    if (ids.length === 0) {
      setResolvedEvidence({});
      return;
    }
    let active = true;
    apiResolveEvidence(ids)
      .then((res) => {
        if (!active) return;
        const next: Record<string, EvidenceResolveResult> = {};
        for (const r of res?.results ?? []) {
          if (r && typeof r.id === 'string' && r.id.trim().length > 0) next[r.id] = r;
        }
        setResolvedEvidence(next);
      })
      .catch(() => {
        if (!active) return;
        setResolvedEvidence({});
      });
    return () => {
      active = false;
    };
  }, [highlightedEvidenceIds, evidence]);

  const getConfidenceLabel = (v: unknown): 'High' | 'Med' | 'Low' => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    if (n >= 0.8) return 'High';
    if (n >= 0.5) return 'Med';
    return 'Low';
  };

  const handleAnalyzeAndAutofill = async () => {
    if (!dealId) return;
    setAutoProfileLoading(true);
    try {
      const res = await apiAutoProfileDeal(dealId);
      setAutoProfileResult(res);
      setShowProfileEditor(true);

      // Never overwrite user edits: only fill empty fields.
      setProfileEdits((prev) => {
        const next: ProposedDealProfile = { ...prev };
        const proposed = res?.proposed_profile;
        if (proposed) {
          (['company_name', 'deal_name', 'investment_type', 'round', 'industry'] as const).forEach((k) => {
            const current = prev[k];
            const incoming = proposed[k];
            if ((current === null || String(current).trim() === '') && incoming) {
              next[k] = incoming;
            }
          });
        }
        return next;
      });
    } catch (err) {
      addToast('error', 'Auto-profile failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAutoProfileLoading(false);
    }
  };

  const handleConfirmProfile = async () => {
    if (!dealId) return;
    try {
      const updated = await apiConfirmDealProfile(dealId, profileEdits);
      setDealFromApi(updated);
      setShowProfileEditor(false);
      addToast('success', 'Profile confirmed', 'Deal fields updated.');
    } catch (err) {
      addToast('error', 'Confirm failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const isProbablyOcrJunk = (value: unknown): boolean => {
    if (typeof value !== 'string') return true;
    const s = value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return true;
    if (/[\uFFFD�]/.test(s)) return true;
    if (/[@#%*=^~`|\\]{2,}/.test(s)) return true;
    if (/([!?.,:;])\1{2,}/.test(s)) return true;
    const noSpace = s.replace(/\s+/g, '');
    const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
    const symbols = (noSpace.match(/[^A-Za-z0-9]/g) ?? []).length;
    if (noSpace.length >= 20) {
      const letterRatio = letters / noSpace.length;
      const symbolRatio = symbols / noSpace.length;
      if (letterRatio < 0.35) return true;
      if (symbolRatio > 0.55) return true;
    }
    return false;
  };

  // Map dealId to deal information (in a real app, this would be from an API/database)
  const dealInfo = dealFromApi ? {
    name: dealFromApi.name || 'Unknown Deal',
    type: dealData?.type || 'series-a',
    stage: dealFromApi.stage || 'intake',
    fundingTarget: dealDataExt?.fundingTarget || 'TBD',
    score:
      (typeof dealFromApi.score === 'number' && Number.isFinite(dealFromApi.score))
        ? dealFromApi.score
        : investorScore,
    updatedTime: dealFromApi.updated_at ? new Date(dealFromApi.updated_at).toLocaleDateString() : 'Recently',
    createdDate: dealFromApi.created_at ? new Date(dealFromApi.created_at).toLocaleDateString() : 'Unknown',
    description:
      (typeof (dealFromApi as any)?.ui?.executiveSummary?.summary === 'string' &&
        (dealFromApi as any).ui.executiveSummary.summary.trim().length > 0
        ? (!isProbablyOcrJunk((dealFromApi as any).ui.executiveSummary.summary)
          ? (dealFromApi as any).ui.executiveSummary.summary
          : '')
        : undefined) ||
      dealData?.description ||
      '',
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

  const overviewV2 = ((dealFromApi as any)?.ui?.overviewV2 ?? (dealFromApi as any)?.ui?.dealOverviewV2) as any;
  const updateReportV1 = (dealFromApi as any)?.ui?.updateReportV1 as any;
	const businessArchetypeV1 = (dealFromApi as any)?.ui?.businessArchetypeV1 as any;
  const executiveSummaryV2 = (dealFromApi as any)?.ui?.executiveSummaryV2 as any;
  const executiveSummaryV1 = (dealFromApi as any)?.ui?.executiveSummary as any;
	const dealSummaryV2 = (dealFromApi as any)?.ui?.dealSummaryV2 as any;
  const fundabilityV1 = (dealFromApi as any)?.fundability_v1 as any;

  // Canonical Phase 1 signals source
  const phase1Signals = ((dealFromApi as any)?.phase1?.executive_summary_v2?.signals
    ?? (dealFromApi as any)?.executive_summary_v2?.signals
    ?? null) as any;
  const hasPhase1Signals = Boolean(
    phase1Signals &&
    typeof phase1Signals === 'object' &&
    (typeof (phase1Signals as any)?.score === 'number' || typeof (phase1Signals as any)?.recommendation === 'string')
  );

  const phase1ScoreEvidence = (dealFromApi as any)?.phase1_score_evidence ?? (dealFromApi as any)?.phase1?.score_evidence ?? null;
  const scoreBreakdownV1 = ((dealFromApi as any)?.phase1?.executive_summary_v2 as any)?.score_breakdown_v1
    ?? (dealFromApi as any)?.executive_summary_v2?.score_breakdown_v1;
  const scoreBreakdownSections = Array.isArray(scoreBreakdownV1?.sections) ? scoreBreakdownV1.sections : [];
  const scoreTraceAudit = ((dealFromApi as any)?.phase1?.executive_summary_v2 as any)?.score_trace_audit_v1
    ?? (dealFromApi as any)?.executive_summary_v2?.score_trace_audit_v1
    ?? null;

  const buildScoreEvidenceFromBreakdown = (
    sections: typeof scoreBreakdownSections
  ): ScoreEvidencePayload | null => {
    if (!Array.isArray(sections) || sections.length === 0) return null;

    const toLabel = (key: ScoreSectionKey): string => {
      switch (key) {
        case 'product':
          return 'Product';
        case 'market':
          return 'Market';
        case 'icp':
          return 'ICP';
        case 'business_model':
          return 'Business model';
        case 'traction':
          return 'Traction';
        case 'risks':
          return 'Risks';
        case 'team':
          return 'Team';
        default:
          return key;
      }
    };

    let claimCount = 0;
    let evidenceCount = 0;

    const normalizedSections = sections
      .map((section, idx) => {
        const key = (section?.key ?? (section as any)?.section_key) as ScoreSectionKey | undefined;
        if (!key) return null;

        const preferredIds = Array.isArray(section?.evidence_ids_linked)
          ? section.evidence_ids_linked
          : Array.isArray((section as any)?.evidence_ids)
            ? (section as any).evidence_ids
            : [];
        const fallbackIds = Array.isArray(section?.evidence_ids_sample) ? section.evidence_ids_sample : [];
        const ids = preferredIds.length > 0 ? preferredIds : fallbackIds;

        const uniqueIds: string[] = [];
        const seenIds = new Set<string>();
        for (const id of ids) {
          if (typeof id !== 'string') continue;
          const trimmed = id.trim();
          if (!trimmed || seenIds.has(trimmed)) continue;
          seenIds.add(trimmed);
          uniqueIds.push(trimmed);
        }

        const evidenceItems = uniqueIds.map((id, evIdx) => {
          evidenceCount += 1;
          return {
            id,
            label: `Evidence ${evIdx + 1}`,
            kind: 'trace',
            source: 'score_breakdown_v1',
          };
        });

        const supportStatus = (section as any)?.support_status;
        const support: 'evidence' | 'inferred' | 'missing' = (() => {
          if (supportStatus === 'missing') return 'missing';
          if (supportStatus === 'weak') return evidenceItems.length > 0 ? 'inferred' : 'missing';
          if (supportStatus === 'supported') return evidenceItems.length > 0 ? 'evidence' : 'missing';
          return evidenceItems.length > 0 ? 'evidence' : 'missing';
        })();

        const missingReason = (() => {
          const reason = typeof (section as any)?.support_reason === 'string'
            ? (section as any).support_reason.trim()
            : '';
          if (reason.length > 0) return reason;
          const fromList = Array.isArray((section as any)?.missing_reasons)
            ? (section as any).missing_reasons.find((r: unknown) => typeof r === 'string' && r.trim().length > 0)
            : null;
          return fromList ? (fromList as string).trim() : undefined;
        })();

        const claimId = `${key}-trace-${idx + 1}`;
        const claimText = `${toLabel(key)} trace evidence`;
        claimCount += 1;

        return {
          key: key as any,
          support,
          missingReason,
          claims: [
            {
              id: claimId,
              text: claimText,
              evidence: evidenceItems,
            },
          ],
        };
      })
      .filter(Boolean) as ScoreEvidencePayload['sections'];

    if (normalizedSections.length === 0) return null;

    return {
      sections: normalizedSections,
      totals: {
        claims: claimCount,
        evidence: evidenceCount,
      },
    };
  };

  const derivedScoreEvidenceFromBreakdown = buildScoreEvidenceFromBreakdown(scoreBreakdownSections);
  const phase1ScoreEvidenceForPanel = (() => {
    const sections = Array.isArray((phase1ScoreEvidence as any)?.sections) ? (phase1ScoreEvidence as any).sections : [];
    if (sections.length > 0) return phase1ScoreEvidence;
    return derivedScoreEvidenceFromBreakdown;
  })();

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('Evidence tab score evidence source', {
      providedSections: Array.isArray((phase1ScoreEvidence as any)?.sections)
        ? (phase1ScoreEvidence as any).sections.length
        : null,
      breakdownSections: scoreBreakdownSections.length,
      derivedSections: derivedScoreEvidenceFromBreakdown?.sections?.length ?? 0,
      source: phase1ScoreEvidenceForPanel === phase1ScoreEvidence
        ? 'phase1_score_evidence'
        : derivedScoreEvidenceFromBreakdown
          ? 'score_breakdown_v1'
          : 'none',
    });
  }

  const scoreToWorkspaceDecision = (score: number): 'PASS' | 'CONSIDER' | 'FUND' => {
    // Keep this aligned with backend report recommendation thresholds.
    if (score >= 70) return 'FUND';
    if (score >= 55) return 'CONSIDER';
    return 'PASS';
  };

  const recommendationRaw = typeof phase1Signals?.recommendation === 'string' ? phase1Signals.recommendation : null;
  const normalizedRecommendation = recommendationRaw ? recommendationRaw.toLowerCase().trim() : null;
  const phase1Score = typeof phase1Signals?.score === 'number' && Number.isFinite(phase1Signals.score)
    ? Math.round(phase1Signals.score)
    : null;
  const phase1ConfidenceRaw = typeof phase1Signals?.confidence === 'string' ? phase1Signals.confidence : null;
  const phase1ConfidenceLabel = phase1ConfidenceRaw
    ? `${phase1ConfidenceRaw.charAt(0).toUpperCase()}${phase1ConfidenceRaw.slice(1)} confidence`
    : null;
  const blockersCount = typeof phase1Signals?.blockers_count === 'number'
    ? phase1Signals.blockers_count
    : null;

  const fundamentalsScore0_100: number | null = (() => {
    if (typeof dealFromApi?.score === 'number' && Number.isFinite(dealFromApi.score)) return Math.round(dealFromApi.score);
    if (typeof investorScore === 'number' && Number.isFinite(investorScore)) return Math.round(investorScore);
    return null;
  })();
  const dioStatus = (dealFromApi as any)?.dioStatus ?? undefined;

  const fundabilityScore0_100 = extractFundabilityScore0_100(dealFromApi as any);
  const displayScoreSourceV1: 'fundamentals' | 'fundability_v1' =
    scoreSource === 'fundability_v1' && fundabilityScore0_100 != null ? 'fundability_v1' : 'fundamentals';

  const decisionLabelSource: 'phase1_signals' | 'score_thresholds' = hasPhase1Signals ? 'phase1_signals' : 'score_thresholds';

  const decisionLabel = hasPhase1Signals
    ? (normalizedRecommendation
      ? (normalizedRecommendation.includes('pass') || normalizedRecommendation.includes('reject')
        ? 'PASS'
        : normalizedRecommendation.includes('go') || normalizedRecommendation.includes('invest') || normalizedRecommendation.includes('proceed')
          ? 'FUND'
          : 'CONSIDER')
      : (phase1Score != null ? scoreToWorkspaceDecision(phase1Score) : '—'))
    : (fundamentalsScore0_100 != null ? scoreToWorkspaceDecision(fundamentalsScore0_100) : '—');

  const sectionConfidence =
    (executiveSummaryV2 && typeof executiveSummaryV2 === 'object' ? (executiveSummaryV2 as any)?.confidence?.sections : null)
    ?? (executiveSummaryV1 && typeof executiveSummaryV1 === 'object' ? (executiveSummaryV1 as any)?.confidence?.sections : null);
  const toBand = (value: unknown): 'high' | 'med' | 'low' | 'unknown' => {
    if (typeof value !== 'string') return 'unknown';
    const s = value.toLowerCase().trim();
    if (s.startsWith('h')) return 'high';
    if (s.startsWith('m')) return 'med';
    if (s.startsWith('l')) return 'low';
    return 'unknown';
  };
  const getBandForCategory = (category: string): 'high' | 'med' | 'low' | 'unknown' => {
    const sec = sectionConfidence && typeof sectionConfidence === 'object' ? (sectionConfidence as any) : null;
    if (!sec) return 'unknown';
    switch (category) {
      case 'Product':
        return toBand(sec.product_solution ?? sec.product);
      case 'Market/ICP':
        return toBand(sec.market_icp ?? sec.market);
      case 'Traction':
        return toBand(sec.traction);
      case 'Team':
        return toBand(sec.team);
      case 'Terms':
        return toBand(sec.raise_terms ?? sec.terms);
      case 'Risks':
        return toBand(sec.risks);
      default:
        return toBand(sec.deal_type ?? sec.business_model ?? sec.financials ?? sec.gtm);
    }
  };
  const categories: Array<{ key: string; label: string }> = [
    { key: 'Product', label: 'Product' },
    { key: 'Market/ICP', label: 'Market/ICP' },
    { key: 'Traction', label: 'Traction' },
    { key: 'Team', label: 'Team' },
    { key: 'Terms', label: 'Terms' },
    { key: 'Risks', label: 'Risks' },
    { key: 'Other', label: 'Other' },
  ];
  const bandToClasses = (band: 'high' | 'med' | 'low' | 'unknown') => {
    if (band === 'high') return 'bg-emerald-500/20';
    if (band === 'med') return 'bg-amber-500/20';
    if (band === 'low') return 'bg-red-500/20';
    return darkMode ? 'bg-white/10' : 'bg-gray-200/60';
  };

  const normalizeScoreSectionKey = (value: unknown): ScoreSectionKey | null => {
    const valid: ScoreSectionKey[] = ['market', 'product', 'business_model', 'traction', 'risks', 'team', 'icp'];
    return valid.includes(value as ScoreSectionKey) ? (value as ScoreSectionKey) : null;
  };

  const handleScoreBreakdownClick = (section: any, fallbackKey?: string | null) => {
    const mismatch = Boolean(section?.mismatch);
    const rawKey = typeof section?.key === 'string'
      ? section.key
      : typeof section?.section_key === 'string'
        ? section.section_key
        : typeof fallbackKey === 'string'
          ? fallbackKey
          : null;
    const key = normalizeScoreSectionKey(rawKey);
    if (!key) {
      setSelectedScoreSectionKey(null);
      setHighlightedEvidenceIds([]);
      setSelectedScoreSectionMismatch(false);
      setActiveTab('evidence');
      setShowScoreBreakdown(true);
      return;
    }
    const primaryIds = Array.isArray(section?.evidence_ids_linked)
      ? section.evidence_ids_linked
      : Array.isArray(section?.evidence_ids)
        ? section.evidence_ids
        : Array.isArray(section?.evidence_ids_sample)
          ? section.evidence_ids_sample
          : [];
    const filteredIds = primaryIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0);
    const ids: string[] = Array.from(new Set<string>(filteredIds));
    setSelectedScoreSectionKey(key);
    setHighlightedEvidenceIds(ids);
    setSelectedScoreSectionMismatch(mismatch);
    setScoreTraceModeOverride(null);
    setActiveTab('evidence');
    setShowScoreBreakdown(true);
  };

  const handleScoreTraceDebugTrace = (section: any, fallbackKey?: string | null) => {
    const mismatch = Boolean(section?.mismatch);
    const rawKey = typeof section?.section_key === 'string'
      ? section.section_key
      : typeof section?.key === 'string'
        ? section.key
        : typeof fallbackKey === 'string'
          ? fallbackKey
          : null;
    const key = normalizeScoreSectionKey(rawKey);
    const primaryIds = Array.isArray(section?.evidence_ids_linked)
      ? section.evidence_ids_linked
      : Array.isArray(section?.evidence_ids)
        ? section.evidence_ids
        : Array.isArray(section?.evidence_ids_sample)
          ? section.evidence_ids_sample
          : [];
    const ids: string[] = Array.from(new Set<string>(primaryIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0))).slice(0, 25);
    setSelectedScoreSectionKey(key);
    setHighlightedEvidenceIds(ids);
    setSelectedScoreSectionMismatch(mismatch);
    setScoreTraceModeOverride('trace');
    setActiveTab('evidence');
    setShowScoreBreakdown(true);
  };
  const decisionAccent = decisionLabel === 'FUND'
    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
    : decisionLabel === 'CONSIDER'
      ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
      : decisionLabel === 'PASS'
        ? 'bg-red-500/10 border-red-500/40 text-red-200'
        : (darkMode ? 'bg-white/5 border-white/10 text-gray-300' : 'bg-white/60 border-gray-200 text-gray-700');

  const missingFromV2 = Array.isArray((dealFromApi as any)?.phase1?.executive_summary_v2?.missing)
    ? (dealFromApi as any).phase1.executive_summary_v2.missing
    : Array.isArray((dealFromApi as any)?.executive_summary_v2?.missing)
      ? (dealFromApi as any).executive_summary_v2.missing
      : [];
  const missingFromSignals = Array.isArray(phase1Signals?.coverage_missing_sections) ? phase1Signals.coverage_missing_sections : [];
  const missingFromV1 = Array.isArray(executiveSummaryV1?.unknowns) ? executiveSummaryV1.unknowns : [];
  const missingChips = [...missingFromV2, ...missingFromSignals, ...missingFromV1]
    .filter((x) => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim())
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(0, 10);

  const decisionHighlightsSource = Array.isArray((dealFromApi as any)?.phase1?.executive_summary_v2?.highlights)
    ? (dealFromApi as any).phase1.executive_summary_v2.highlights
    : Array.isArray((dealFromApi as any)?.executive_summary_v2?.highlights)
      ? (dealFromApi as any).executive_summary_v2.highlights
      : [];

  const decisionHighlights = decisionHighlightsSource
    .filter((h: any) => typeof h === 'string')
    .map((h: string) => h.trim())
    .filter((h: string) => h.length > 0)
    .filter((h: string) => !/^Recommendation:/i.test(h))
    .slice(0, 3);

  const decisionMissing = missingChips.slice(0, 4);

  // Decision tile (investor-facing): keep copy formal and avoid internal process terms.
  // The Decision tile is intentionally scoped to a single score source (fundamentals) to avoid confusing users.
  const decisionTileScore0_100: number | null = fundamentalsScore0_100;
  const decisionTileLabel: 'PASS' | 'CONSIDER' | 'FUND' | '—' =
    decisionTileScore0_100 != null ? scoreToWorkspaceDecision(decisionTileScore0_100) : '—';
  const decisionTileAccent = decisionTileLabel === 'FUND'
    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
    : decisionTileLabel === 'CONSIDER'
      ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
      : decisionTileLabel === 'PASS'
        ? 'bg-red-500/10 border-red-500/40 text-red-200'
        : (darkMode ? 'bg-white/5 border-white/10 text-gray-300' : 'bg-white/60 border-gray-200 text-gray-700');

  const normalizeDecisionHighlight = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    if (!s) return null;
    // Strip common label prefixes to read naturally in a sentence.
    const stripped = s
      .replace(/^Product:\s*/i, '')
      .replace(/^ICP:\s*/i, '')
      .replace(/^Market:\s*/i, '')
      .replace(/^Raise\/terms:\s*/i, '')
      .replace(/^Business model:\s*/i, '')
      .replace(/^Traction:\s*/i, '')
      .replace(/^Risks:\s*/i, '');
    const out = stripped.trim();
    if (!out) return null;
    // Keep short, sentence-friendly fragments.
    return out.length > 120 ? `${out.slice(0, 117).trim()}…` : out;
  };

  const formatOpenItemLabel = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;

    const key = raw.toLowerCase().trim();
    const mapped: Record<string, string> = {
      'risk_assessment': 'risk assessment',
      'risks': 'risk assessment',
      'risk': 'risk assessment',
      'roadmap': '12-month execution roadmap',
      '12_month_roadmap': '12-month execution roadmap',
      'twelve_month_roadmap': '12-month execution roadmap',
      'operating_plan': '12-month operating plan',
      'financials': 'financial performance and runway',
      'runway': 'runway and burn profile',
      'burn': 'burn and cash usage',
      'unit_economics': 'unit economics',
      'team': 'team depth and execution capacity',
      'market': 'market sizing and ICP definition',
      'product': 'product differentiation and roadmap',
      'traction': 'traction and retention metrics',
    };

    const direct = mapped[key];
    if (direct) return direct;

    // Fallback: humanize snake_case and similar keys.
    const human = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return human.length > 80 ? `${human.slice(0, 77).trim()}…` : human;
  };

  const decisionTileStrengths = [
    normalizeDecisionHighlight(decisionHighlights[0]),
    normalizeDecisionHighlight(decisionHighlights[1]),
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);

  const decisionTileOpenItemsAll = missingChips.map(formatOpenItemLabel).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const decisionTileOpenItems = decisionTileOpenItemsAll.slice(0, 2);
  const decisionTileOpenItemsCount = decisionTileOpenItemsAll.length;

  const decisionTileConfidenceBand: 'high' | 'med' | 'low' | 'unknown' = (() => {
    const fromOverall = toBand(phase1ConfidenceRaw);
    if (fromOverall !== 'unknown') return fromOverall;
    const bands = [
      getBandForCategory('Product'),
      getBandForCategory('Market/ICP'),
      getBandForCategory('Team'),
      getBandForCategory('Risks'),
    ].filter((b): b is 'high' | 'med' | 'low' => b !== 'unknown');
    if (bands.length === 0) return 'unknown';
    if (bands.includes('low')) return 'low';
    if (bands.includes('med')) return 'med';
    return 'high';
  })();

  const decisionTileConfidenceLabelShort = (() => {
    if (decisionTileConfidenceBand === 'high') return 'High';
    if (decisionTileConfidenceBand === 'med') return 'Med';
    if (decisionTileConfidenceBand === 'low') return 'Low';
    return 'Pending';
  })();

  const bandToBadgeClasses = (band: 'high' | 'med' | 'low' | 'unknown') => {
    if (band === 'high') return darkMode ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (band === 'med') return darkMode ? 'bg-amber-500/10 text-amber-200 border-amber-500/20' : 'bg-amber-50 text-amber-700 border-amber-200';
    if (band === 'low') return darkMode ? 'bg-red-500/10 text-red-200 border-red-500/20' : 'bg-red-50 text-red-700 border-red-200';
    return darkMode ? 'bg-white/5 text-gray-200 border-white/10' : 'bg-gray-50 text-gray-700 border-gray-200';
  };

  const decisionTileRationale = (() => {
    if (decisionTileLabel === '—' || decisionTileScore0_100 == null) {
      return 'Recommendation pending. Score will appear once sufficient information is available.';
    }

    const strengthA = decisionTileStrengths[0] ?? 'a credible product narrative';
    const strengthB = decisionTileStrengths[1] ?? 'an experienced team';
    const openA = decisionTileOpenItems[0] ?? 'key diligence inputs';
    const openB = decisionTileOpenItems[1] ?? 'a forward execution plan';

    return `Recommendation: ${decisionTileLabel} (${decisionTileScore0_100}/100). The materials support ${strengthA} and ${strengthB}; however, conviction is constrained by ${openA} and ${openB}.`;
  })();

  type DecisionRadarDatum = {
    key: 'market' | 'team' | 'documents' | 'financial_health' | 'risk_assessment';
    label: string;
    weightPct: number;
    score: number;
    scoreRaw: number | null;
    weightedContribution: number | null;
    status: string | null;
    reason: string | null;
  };

  const decisionScoreExplanation = (reportFromApi as any)?.metadata?.score_explanation as any;

  const bandToIndicatorScore0_100 = (band: 'high' | 'med' | 'low' | 'unknown'): number => {
    if (band === 'high') return 80;
    if (band === 'med') return 60;
    if (band === 'low') return 40;
    return 50;
  };

  const decisionRadarData: DecisionRadarDatum[] | null = (() => {
    if (!decisionScoreExplanation || typeof decisionScoreExplanation !== 'object') return null;
    const weightsObj = decisionScoreExplanation?.aggregation?.weights && typeof decisionScoreExplanation.aggregation.weights === 'object'
      ? decisionScoreExplanation.aggregation.weights
      : null;
    const compsObj = decisionScoreExplanation?.components && typeof decisionScoreExplanation.components === 'object'
      ? decisionScoreExplanation.components
      : null;
    if (!compsObj) return null;

    const decisionKeys: Array<'financial_health' | 'risk_assessment'> = ['financial_health', 'risk_assessment'];
    const rows: Array<{ key: 'financial_health' | 'risk_assessment'; weightRaw: number; scoreEff: number | null; status: string | null; reason: string | null }> = [];

    for (const key of decisionKeys) {
      const comp = compsObj[key];
      const used = typeof comp?.used_score === 'number' && Number.isFinite(comp.used_score) ? comp.used_score : null;
      const penalty = typeof comp?.penalty === 'number' && Number.isFinite(comp.penalty) ? comp.penalty : 0;
      const eff = used == null ? null : Math.max(0, Math.min(100, used - penalty));
      const weight = weightsObj && typeof weightsObj[key] === 'number' && Number.isFinite(weightsObj[key]) ? weightsObj[key] : 1;
      const status = typeof comp?.status === 'string' ? comp.status : null;
      const reason = typeof comp?.reason === 'string' && comp.reason.trim().length > 0 ? comp.reason.trim() : null;
      rows.push({ key, weightRaw: weight, scoreEff: eff, status, reason });
    }

    const totalW = rows.reduce((s, r) => s + (Number.isFinite(r.weightRaw) ? r.weightRaw : 0), 0);
    const rawPct = rows.map((r) => ({ key: r.key, pct: totalW > 0 ? (r.weightRaw / totalW) * 100 : 50 }));
    const roundedPct = rawPct.map((r) => ({ key: r.key, pct: Math.round(r.pct) }));
    const sumPct = roundedPct.reduce((s, r) => s + r.pct, 0);
    const diff = 100 - sumPct;
    if (diff !== 0 && roundedPct.length > 0) {
      roundedPct[0] = { ...roundedPct[0], pct: roundedPct[0].pct + diff };
    }

    const pctByKey = new Map(roundedPct.map((r) => [r.key, r.pct]));

    const fundamentalsLabel = (k: 'financial_health' | 'risk_assessment'): string => {
      if (k === 'financial_health') return 'Financial health';
      return 'Risk profile';
    };

    const fundamentalsRows: DecisionRadarDatum[] = rows.map((r) => {
      const weightPct = pctByKey.get(r.key) ?? 0;
      const scoreRaw = r.scoreEff;
      const score = scoreRaw == null ? 0 : Math.round(scoreRaw);
      const weightedContribution = scoreRaw == null ? null : Math.round((scoreRaw * weightPct) / 100);
      return {
        key: r.key,
        label: `${fundamentalsLabel(r.key)} (${weightPct}%)`,
        weightPct,
        score,
        scoreRaw: scoreRaw == null ? null : Math.round(scoreRaw),
        weightedContribution,
        status: r.status,
        reason: r.reason,
      };
    });

    // Investor-facing indicator axes (0% weight): informative, but not part of the fundamentals score today.
    const marketBand = getBandForCategory('Market/ICP');
    const teamBand = getBandForCategory('Team');
    const marketIndicator = bandToIndicatorScore0_100(marketBand);
    const teamIndicator = bandToIndicatorScore0_100(teamBand);
    const docsIndicatorRaw = typeof reportFromApi?.completeness === 'number' && Number.isFinite(reportFromApi.completeness)
      ? Math.round(Math.max(0, Math.min(100, reportFromApi.completeness)))
      : 50;

    const indicatorRows: DecisionRadarDatum[] = [
      {
        key: 'market',
        label: `Market (${0}%)`,
        weightPct: 0,
        score: marketIndicator,
        scoreRaw: marketIndicator,
        weightedContribution: 0,
        status: marketBand === 'unknown' ? 'insufficient_data' : 'indicator',
        reason: marketBand === 'unknown' ? 'Coverage signal unavailable; neutral indicator shown.' : 'Indicator derived from coverage confidence.'
      },
      {
        key: 'team',
        label: `Team (${0}%)`,
        weightPct: 0,
        score: teamIndicator,
        scoreRaw: teamIndicator,
        weightedContribution: 0,
        status: teamBand === 'unknown' ? 'insufficient_data' : 'indicator',
        reason: teamBand === 'unknown' ? 'Coverage signal unavailable; neutral indicator shown.' : 'Indicator derived from coverage confidence.'
      },
      {
        key: 'documents',
        label: `Documentation readiness (${0}%)`,
        weightPct: 0,
        score: docsIndicatorRaw,
        scoreRaw: docsIndicatorRaw,
        weightedContribution: 0,
        status: typeof reportFromApi?.completeness === 'number' ? 'indicator' : 'insufficient_data',
        reason: typeof reportFromApi?.completeness === 'number' ? 'Indicator derived from analysis completeness.' : 'Completeness signal unavailable; neutral indicator shown.'
      },
    ];

    return [...indicatorRows, ...fundamentalsRows];
  })();

  const decisionRadarReady = Array.isArray(decisionRadarData) && decisionRadarData.length >= 5;

  const toFiniteNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const toRatioPct = (value: unknown): number | null => {
    const num = toFiniteNumber(value);
    if (num === null) return null;
    return Math.round(num * 100);
  };

  type PhaseBRunNormalized = {
    key: string;
    timestamp: string | null;
    timestampDisplay: string | null;
    version: number | null;
    metrics: {
      visualsCount: number | null;
      evidenceCount: number | null;
      evidencePerVisual: number | null;
      pctVisualsWithOcr: number | null;
      pctVisualsWithStructured: number | null;
      pctSegmentsWithVisuals: number | null;
    };
  };

  const phaseBLatestRunRaw = (dealFromApi as any)?.phase_b?.latest_run ?? (dealFromApi as any)?.phase1?.phase_b_latest_run ?? null;
  const phaseBHistoryRaw = (dealFromApi as any)?.phase_b?.history ?? (dealFromApi as any)?.phase1?.phase_b_history ?? null;
  const phaseBHistory = Array.isArray(phaseBHistoryRaw)
    ? phaseBHistoryRaw.filter((run) => run && typeof run === 'object')
    : [];

  const phaseBRunsOrdered = (() => {
    const runs: Array<{ run: any; timestamp: string | null; tsMs: number; version: number | null; key: string }>
      = [];
    const seen = new Set<string>();
    const makeKey = (run: any) => {
      const computedAt = typeof (run as any)?.phase_b_features?.computed_at === 'string' ? (run as any).phase_b_features.computed_at : null;
      const createdAt = typeof (run as any)?.created_at === 'string' ? (run as any).created_at : null;
      const version = toFiniteNumber((run as any)?.version);
      return typeof (run as any)?.id === 'string'
        ? (run as any).id
        : `${computedAt || createdAt || 'no-ts'}-${version ?? 'no-version'}`;
    };
    const addRun = (run: any) => {
      if (!run || typeof run !== 'object') return;
      const key = makeKey(run);
      if (seen.has(key)) return;
      seen.add(key);
      const features = (run as any)?.phase_b_features ?? null;
      const computedAt = typeof features?.computed_at === 'string' ? features.computed_at : null;
      const createdAt = typeof (run as any)?.created_at === 'string' ? (run as any).created_at : null;
      const timestamp = computedAt || createdAt || null;
      const tsMsRaw = timestamp ? Date.parse(timestamp) : NaN;
      const tsMs = Number.isFinite(tsMsRaw) ? tsMsRaw : -Infinity;
      runs.push({
        run,
        timestamp,
        tsMs,
        version: toFiniteNumber((run as any)?.version),
        key,
      });
    };
    addRun(phaseBLatestRunRaw);
    phaseBHistory.forEach(addRun);
    return runs.sort((a, b) => {
      if (a.tsMs !== b.tsMs) return b.tsMs - a.tsMs;
      const av = a.version ?? -Infinity;
      const bv = b.version ?? -Infinity;
      if (av !== bv) return bv - av;
      return a.key.localeCompare(b.key);
    });
  })();

  const phaseBLatestRun = phaseBRunsOrdered[0]?.run ?? null;
  const priorPhaseBRun = phaseBRunsOrdered[1]?.run ?? null;
  const phaseBFeatures = phaseBLatestRun && typeof phaseBLatestRun === 'object' ? (phaseBLatestRun as any).phase_b_features : null;
  const priorPhaseBFeatures = priorPhaseBRun && typeof priorPhaseBRun === 'object' ? (priorPhaseBRun as any).phase_b_features : null;
  const phaseBVersion = toFiniteNumber((phaseBLatestRun as any)?.version);
  const phaseBComputedAt = typeof (phaseBFeatures as any)?.computed_at === 'string' ? (phaseBFeatures as any).computed_at : null;
  const phaseBCreatedAt = typeof (phaseBLatestRun as any)?.created_at === 'string' ? (phaseBLatestRun as any).created_at : null;
  const phaseBRunTimestamp = (phaseBRunsOrdered[0]?.timestamp ?? phaseBComputedAt ?? phaseBCreatedAt) ?? null;
  const phaseBRunTimestampDisplay = (() => {
    if (!phaseBRunTimestamp) return null;
    const parsed = new Date(phaseBRunTimestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
  })();

  const phaseBCoverage = phaseBFeatures && typeof (phaseBFeatures as any).coverage === 'object' ? (phaseBFeatures as any).coverage : null;
  const phaseBStructure = phaseBFeatures && typeof (phaseBFeatures as any).structure === 'object' ? (phaseBFeatures as any).structure : null;
  const phaseBContentDensity = phaseBFeatures && typeof (phaseBFeatures as any).content_density === 'object' ? (phaseBFeatures as any).content_density : null;

  const phaseBDocCount = toFiniteNumber(phaseBCoverage?.documents_count) ?? null;
  const phaseBPageCount = toFiniteNumber(phaseBCoverage?.segments_count) ?? null;
  const phaseBVisualsCount = toFiniteNumber(phaseBCoverage?.visuals_count) ?? null;
  const phaseBEvidenceCount = toFiniteNumber(phaseBCoverage?.evidence_count) ?? null;
  const phaseBEvidencePerVisual = toFiniteNumber(phaseBCoverage?.evidence_per_visual) ?? null;

  const phaseBSourceCoverageRatio = toFiniteNumber(phaseBStructure?.pct_documents_with_segments);
  const phaseBStructureParts = [
    toFiniteNumber(phaseBStructure?.pct_segments_with_visuals),
    toFiniteNumber(phaseBStructure?.pct_documents_with_segments),
    toFiniteNumber(phaseBStructure?.pct_documents_with_visuals),
  ].filter((v): v is number => typeof v === 'number');
  const phaseBSectionStructureScore = phaseBStructureParts.length
    ? Math.round((phaseBStructureParts.reduce((a, b) => a + b, 0) / phaseBStructureParts.length) * 100)
    : null;

  const phaseBContentDensityFlag = (() => {
    const flag = typeof (phaseBContentDensity as any)?.content_density_flag === 'string' ? (phaseBContentDensity as any).content_density_flag : null;
    if (flag && typeof flag === 'string') return flag;
    const fallback = toFiniteNumber((phaseBContentDensity as any)?.content_density_flag);
    if (fallback != null) return fallback >= 0.2 ? 'rich' : 'thin';
    return null;
  })();

  const phaseBSourceCoveragePct = phaseBSourceCoverageRatio != null ? Math.round(phaseBSourceCoverageRatio * 100) : null;

  const phaseBFlags = (phaseBFeatures as any)?.flags ?? {};
  const phaseBActiveFlags = Object.keys(phaseBFlags).filter((k) => phaseBFlags[k]).slice(0, 6);

  const phaseBCoverageGaps = Array.isArray((phaseBFeatures as any)?.coverage_gaps)
    ? (phaseBFeatures as any).coverage_gaps.filter((g: unknown) => typeof g === 'string' && g.trim().length > 0).slice(0, 8)
    : [];

  const {
    findings: phaseBFindings,
    actions: phaseBActions,
    badges: phaseBBadges,
  } = derivePhaseBInsights({ latest: phaseBFeatures, prior: priorPhaseBFeatures });

  const phaseBFindingClass = (severity: 'low' | 'med' | 'high') => {
    if (severity === 'high') {
      return darkMode
        ? 'bg-red-500/10 border-red-500/40 text-red-200'
        : 'bg-red-50 border-red-200 text-red-700';
    }
    if (severity === 'med') {
      return darkMode
        ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
        : 'bg-amber-50 border-amber-200 text-amber-800';
    }
    return darkMode
      ? 'bg-blue-500/10 border-blue-500/40 text-blue-200'
      : 'bg-blue-50 border-blue-200 text-blue-800';
  };

  const normalizePhaseBRun = (run: any): PhaseBRunNormalized | null => {
    if (!run || typeof run !== 'object') return null;
    const version = toFiniteNumber((run as any)?.version);
    const features = (run as any)?.phase_b_features && typeof (run as any).phase_b_features === 'object' ? (run as any).phase_b_features : null;
    const coverage = features && typeof (features as any).coverage === 'object' ? (features as any).coverage : null;
    const structure = features && typeof (features as any).structure === 'object' ? (features as any).structure : null;
    const contentDensity = features && typeof (features as any).content_density === 'object' ? (features as any).content_density : null;
    const computedAt = typeof (features as any)?.computed_at === 'string' ? (features as any).computed_at : null;
    const createdAt = typeof (run as any)?.created_at === 'string' ? (run as any).created_at : null;
    const timestamp = computedAt || createdAt || null;
    const timestampDisplay = (() => {
      if (!timestamp) return null;
      const parsed = new Date(timestamp);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
    })();
    const fallbackKey = `${timestamp ?? 'no-ts'}-${version ?? 'no-version'}`;
    return {
      key: typeof (run as any)?.id === 'string' ? (run as any).id : fallbackKey,
      timestamp,
      timestampDisplay,
      version,
      metrics: {
        visualsCount: toFiniteNumber((coverage as any)?.visuals_count),
        evidenceCount: toFiniteNumber((coverage as any)?.evidence_count),
        evidencePerVisual: toFiniteNumber((coverage as any)?.evidence_per_visual),
        pctVisualsWithOcr: toRatioPct((contentDensity as any)?.pct_visuals_with_ocr),
        pctVisualsWithStructured: toRatioPct((contentDensity as any)?.pct_visuals_with_structured),
        pctSegmentsWithVisuals: toRatioPct((structure as any)?.pct_segments_with_visuals),
      },
    };
  };

  const phaseBRunHistory: PhaseBRunNormalized[] = (() => {
    const runs: PhaseBRunNormalized[] = [];
    const seen = new Set<string>();
    const addRun = (run: PhaseBRunNormalized | null) => {
      if (!run) return;
      if (seen.has(run.key)) return;
      seen.add(run.key);
      runs.push(run);
    };
    phaseBRunsOrdered.map((entry) => normalizePhaseBRun(entry.run)).forEach((run) => addRun(run));
    return runs.slice(0, 3);
  })();

  const copyScoreTraceDebug = async () => {
    if (!import.meta.env.DEV) return;
    const payload = (executiveSummaryV2 as any)?.score_breakdown_v1 ?? (scoreBreakdownSections.length > 0 ? { sections: scoreBreakdownSections } : null);
    if (!payload) {
      addToast('info', 'No score trace', 'Run analysis to populate score breakdown');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      addToast('error', 'Copy unavailable', 'Clipboard API not supported');
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      addToast('info', 'Dev data copied', 'Score trace JSON copied');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error copying debug payload';
      addToast('error', 'Copy failed', message);
    }
  };

  const formatDelta = (
    current: number | null,
    previous: number | null,
    opts?: { isPercent?: boolean; decimals?: number }
  ): string | null => {
    if (current === null || previous === null) return null;
    const diff = current - previous;
    if (Math.abs(diff) < 0.0001) return '0';
    const decimals = opts?.decimals ?? (opts?.isPercent ? 0 : 1);
    const rounded = opts?.isPercent ? Math.round(diff) : Number(diff.toFixed(decimals));
    const prefix = diff > 0 ? '+' : '';
    return `${prefix}${rounded}${opts?.isPercent ? '%' : ''}`;
  };

  // Use dealInfo if available, otherwise fall back to dealData
  const displayName = dealInfo?.name || dealData?.name || 'Unnamed Deal';
  const displayType = dealInfo?.type || dealData?.type || 'series-a';
  const displayScore: number | null = displayScoreSourceV1 === 'fundability_v1'
    ? (fundabilityScore0_100 != null ? Math.round(fundabilityScore0_100) : null)
    : fundamentalsScore0_100;
  const displayScoreLabel = displayScoreSourceV1 === 'fundability_v1' ? 'Fundability score' : 'Fundamentals score';

  const safeText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const s = value.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (isProbablyOcrJunk(s)) return '';
    return s;
  };

  const collectMetricText = (): string => {
    const out: string[] = [];

    // Primary structured signals
    out.push(safeText(overviewV2?.raise));
    out.push(safeText(overviewV2?.business_model));
    out.push(safeText(overviewV2?.deal_type));
    out.push(safeText(overviewV2?.product_solution));
    out.push(safeText(overviewV2?.market_icp));

    if (Array.isArray(overviewV2?.traction_signals)) {
      for (const t of overviewV2.traction_signals) out.push(safeText(t));
    }

    // Executive Summary V2
    if (Array.isArray(executiveSummaryV2?.highlights)) {
      for (const h of executiveSummaryV2.highlights) out.push(safeText(h));
    }
    if (Array.isArray(executiveSummaryV2?.paragraphs)) {
      for (const p of executiveSummaryV2.paragraphs) out.push(safeText(p));
    }

    // Deal summary
    if (typeof dealSummaryV2?.summary === 'string') {
      out.push(safeText(dealSummaryV2.summary));
    } else if (dealSummaryV2?.summary && typeof dealSummaryV2.summary === 'object') {
      out.push(safeText((dealSummaryV2.summary as any)?.one_liner));
      if (Array.isArray((dealSummaryV2.summary as any)?.paragraphs)) {
        for (const p of (dealSummaryV2.summary as any).paragraphs) out.push(safeText(p));
      }
    }

    // Executive Summary V1 (normalized)
    out.push(safeText(executiveSummaryV1?.summary));
    out.push(safeText(executiveSummaryV1?.one_liner));

    return out.filter(Boolean).join('\n');
  };

  const metricText = collectMetricText();
  const archetypeValue = typeof businessArchetypeV1?.value === 'string' ? businessArchetypeV1.value.toLowerCase() : '';
  const looksRealEstate =
    archetypeValue.includes('real_estate') ||
    /\breal\s+estate\b/i.test(String(overviewV2?.business_model ?? '')) ||
    /\b(real_estate|preferred\s+equity|offering\s+memorandum|cap\s*rate|noi|ltv|dscr)\b/i.test(metricText);

  const pickMatch = (re: RegExp): RegExpMatchArray | null => {
    try {
      return metricText.match(re);
    } catch {
      return null;
    }
  };

  const pickValue = (re: RegExp, format: (m: RegExpMatchArray) => string): string => {
    const m = pickMatch(re);
    if (!m) return '—';
    const v = format(m).trim();
    return v.length > 0 ? v : '—';
  };

  const pickMoney = (): string => {
    const direct = safeText(overviewV2?.raise);
    if (direct) return direct;
    // Look for $ amounts (supports $11.7M, $46.7MM, $1,200,000)
    return pickValue(/\$\s*([\d,]+(?:\.\d+)?)\s*(m|mm|million|b|bn|billion)?/i, (m) => {
      const num = m[1];
      const suf = (m[2] ?? '').toLowerCase();
      const suffix = suf ? suf.replace(/^mm$/, 'M').replace(/^m$/, 'M').replace(/^million$/, 'M').replace(/^bn$/, 'B').replace(/^billion$/, 'B').toUpperCase() : '';
      return `$${num}${suffix}`;
    });
  };

  type MetricCard = { label: string; value: string; change: string };
  const keyMetricsCards: MetricCard[] = looksRealEstate
    ? [
        { label: 'Raise / Terms', value: pickMoney(), change: 'Capital sought / structure' },
        { label: 'Target IRR', value: pickValue(/\b(?:target\s+)?irr\b[^\d]{0,24}(\d{1,2}(?:\.\d+)?)\s*%/i, (m) => `${m[1]}%`), change: 'Target return' },
        { label: 'MOIC', value: pickValue(/\b(?:moic|multiple)\b[^\d]{0,24}(\d+(?:\.\d+)?)\s*x/i, (m) => `${m[1]}x`), change: 'Equity multiple' },
        { label: 'LTV', value: pickValue(/\bltv\b[^\d]{0,24}(\d{1,3}(?:\.\d+)?)\s*%/i, (m) => `${m[1]}%`), change: 'Leverage' },
        { label: 'DSCR', value: pickValue(/\bdscr\b[^\d]{0,24}(\d+(?:\.\d+)?)(?:\s*x)?/i, (m) => `${m[1]}x`), change: 'Debt coverage' },
        { label: 'Cap Rate', value: pickValue(/\bcap\s*rate\b[^\d]{0,24}(\d{1,2}(?:\.\d+)?)\s*%/i, (m) => `${m[1]}%`), change: 'Yield' },
        { label: 'NOI', value: pickValue(/\bnoi\b[^\d\$]{0,24}\$?([\d,]+(?:\.\d+)?)/i, (m) => `$${m[1]}`), change: 'Net operating income' },
        { label: 'Term', value: pickValue(/\bterm\b[^\d]{0,24}(\d{1,3})\s*(months|month|mos|years|year|yrs)\b/i, (m) => `${m[1]} ${m[2]}`), change: 'Duration' },
      ]
    : [
        { label: 'Raise', value: pickMoney(), change: 'Capital sought' },
        {
          label: 'Revenue / ARR',
          value: pickValue(/\b(revenue|arr|mrr)\b[\s:,-]{0,12}(\$?\s*[\d,]+(?:\.\d+)?\s*(?:k|m|mm|million|b|bn|billion)?)\b/i, (m) => m[2].replace(/\s+/g, ' ').trim()),
          change: 'Traction signal',
        },
        {
          label: 'Growth',
          value: pickValue(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:mom|m\/m|yoy|y\/y|qoq|q\/q)/i, (m) => `${m[1]}%`),
          change: 'MoM / YoY',
        },
        {
          label: 'Customers',
          value: pickValue(/\b(\d[\d,]*)\s*(customers|users|teams|clients)\b/i, (m) => `${m[1]} ${m[2]}`),
          change: 'Usage / adoption',
        },
        { label: 'Business Model', value: safeText(overviewV2?.business_model) || safeText(executiveSummaryV1?.business_model) || '—', change: 'Model' },
        { label: 'Deal Type', value: safeText(overviewV2?.deal_type) || safeText(executiveSummaryV1?.deal_type) || '—', change: 'Classification' },
        { label: displayScoreLabel, value: displayScore != null ? `${Math.round(displayScore)}/100` : '—', change: 'Overall (0–100)' },
        { label: 'Confidence', value: phase1ConfidenceRaw ? phase1ConfidenceRaw.toUpperCase() : '—', change: 'Overall' },
      ];

  useEffect(() => {
    if (!debugApiIsEnabled()) return;
    if (!dealId || !dealFromApi) return;

    const topLevelKeys = (value: unknown): string[] => {
      if (value == null) return [];
      if (Array.isArray(value)) return ['[array]'];
      if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).slice(0, 50);
      return [`[${typeof value}]`];
    };

    console.info('[DDAI]', {
      type: 'ddai.dealworkspace.v2_presence',
      dealId,
      executiveSummaryV2_present: executiveSummaryV2 != null,
      executiveSummaryV2_paragraphs: Array.isArray(executiveSummaryV2?.paragraphs) ? executiveSummaryV2.paragraphs.length : 0,
      executiveSummaryV2_highlights: Array.isArray(executiveSummaryV2?.highlights) ? executiveSummaryV2.highlights.length : 0,
      overviewV2_present: overviewV2 != null,
      overviewV2_keys: topLevelKeys(overviewV2),
		  dealSummaryV2_present: dealSummaryV2 != null,
		  dealSummaryV2_keys: topLevelKeys(dealSummaryV2),
      updateReportV1_present: updateReportV1 != null,
      updateReportV1_keys: topLevelKeys(updateReportV1),
    });
  }, [dealId, dealFromApi, executiveSummaryV2, overviewV2, dealSummaryV2, updateReportV1]);


  // Log data sources for debugging
  useEffect(() => {
    if (typeof dealInfo?.score === 'number') {
      debugLogger.logAPIData('DealWorkspace', 'displayScore', displayScore, 'From dealInfo.score (API data)');
    } else {
      debugLogger.logFallbackData('DealWorkspace', 'displayScore', displayScore, `No API score available, using fallback investorScore (${investorScore})`);
    }
  }, [displayScore, investorScore]);

  const loadEvidence = async () => {
    if (!dealId) return;
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
    if (!dealId) return;
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
    if (!dealId) return;
    loadEvidence();
    loadDocumentTitles();
  }, [dealId]);

  useEffect(() => {
    if (!activeJobId || jobStatus !== 'queued') {
      setJobQueuedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setJobQueuedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(id);
    };
  }, [activeJobId, jobStatus]);

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    let pollTimer: number | undefined;
    let consecutiveErrors = 0;

    const jobsLogEnabled = (() => {
      if (!import.meta.env.DEV) return false;
      if (typeof window === 'undefined') return false;
      try {
        return new URLSearchParams(window.location.search).get('jobs_log') === '1';
      } catch {
        return false;
      }
    })();

    const jobsLog = (...args: any[]) => {
      if (!jobsLogEnabled) return;
      // eslint-disable-next-line no-console
      console.info('[jobs]', ...args);
    };

    const clearPollTimer = () => {
      if (pollTimer != null) {
        window.clearTimeout(pollTimer);
        pollTimer = undefined;
      }
    };

    const schedulePoll = (ms: number) => {
      clearPollTimer();
      pollTimer = window.setTimeout(() => {
        void poll();
      }, ms);
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        jobsLog('poll:getJob:start', { jobId: activeJobId, sseReady });
        const job = await apiGetJob(activeJobId);
        if (cancelled) return;
        consecutiveErrors = 0;

        jobsLog('poll:getJob:result', {
          job_id: job.job_id,
          type: job.type,
          status: job.status,
          progress_pct: job.progress_pct,
          updated_at: job.updated_at,
        });

        setJobType((job as any)?.type ?? null);
        const normalizedStatus = normalizeJobStatus(job.status as string | null);
        setJobStatus(normalizedStatus);
        const progressApplied = (job as any)?.status_detail?.progress
          ? applyProgressSnapshot((job as any).status_detail.progress, job)
          : false;
        if (!progressApplied) {
          setJobProgress(typeof job.progress_pct === 'number' ? job.progress_pct : null);
          setJobMessage(job.message || null);
          setJobUpdatedAt(job.updated_at || null);
        } else if (job.updated_at) {
          setJobUpdatedAt(job.updated_at);
        }
        setJobCreatedAt((job as any)?.created_at || null);
        setJobStartedAt((job as any)?.started_at || null);

        // Full process UX: if we're currently tracking the extract_visuals job, automatically follow
        // the run-scoped analyze_deal job as soon as it exists (avoid staying pinned on extract or a fast-fail).
        if (isFullProcessActive && (job as any)?.type === 'extract_visuals') {
          const runWindow = getFullProcessRunWindowMs();
          if (runWindow) {
            const best = selectAnalyzeJobInWindow(dealJobsRef.current, runWindow);
            if (best && best.job_id && best.job_id !== job.job_id) {
              setJobId(best.job_id);
              return;
            }
          }
        }

        const reason = (job as any)?.result?.reason || (job as any)?.status_detail?.reason || (job as any)?.reason || null;
        setJobReason(typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : null);
        if (normalizedStatus === 'queued' || normalizedStatus === 'running' || normalizedStatus === 'retrying') {
          // SSE is best-effort; keep polling as a safety net.
          // When SSE is connected, back off to reduce load.
          schedulePoll(sseReady ? 10000 : 2000);
        } else {
          clearPollTimer();
          setAnalyzing(false);

          // If an analyze_deal job fails but a newer succeeded analyze exists for the current Full process run,
          // follow that job instead of pinning the UI to the stale failure.
          if (job.type === 'analyze_deal' && normalizedStatus === 'failed') {
            if (fullProcessRunExtractJobId) {
              const window = getFullProcessRunWindowMs();
              const bestForRun = window ? selectAnalyzeJobInWindow(dealJobs, window) : null;
              if (
                bestForRun &&
                bestForRun.job_id !== job.job_id &&
                isSucceededJobStatus(bestForRun.status) &&
                parseJobSortTs(bestForRun) > parseJobSortTs({ created_at: (job as any)?.created_at, updated_at: (job as any)?.updated_at })
              ) {
                setJobId(bestForRun.job_id);
                return;
              }
            }

            // Legacy/compat: if a known analyze failure has been superseded by a newer succeeded analyze job,
            // don't show the failure toast; follow the succeeded job instead.
            if (isSupersedableAnalyzeFailure({ status: normalizedStatus, message: job.message })) {
              const best = selectBestAnalyzeJob(dealJobs, job.job_id);
              if (
                best &&
                best.job_id !== job.job_id &&
                isSucceededJobStatus(best.status) &&
                parseJobSortTs(best) > parseJobSortTs({ created_at: (job as any)?.created_at, updated_at: (job as any)?.updated_at })
              ) {
                setJobId(best.job_id);
                return;
              }
            }
          }

          const analysisToastKey = `analysis-complete:${activeJobId}:${normalizedStatus}`;
          const analysisToastMessage = job.message || normalizedStatus || 'completed';
          const delayAnalyzeFailureToast =
            job.type === 'analyze_deal' &&
            normalizedStatus === 'failed' &&
            isSupersedableAnalyzeFailure({ status: normalizedStatus, message: job.message }) &&
            scheduleAnalyzeFailureToastIfNoQuickSuccess({
              toastKey: analysisToastKey,
              toastMessage: analysisToastMessage,
              failedCreatedAt: (job as any)?.created_at ?? null,
            });

          if (!delayAnalyzeFailureToast) {
            addToastOnce(
              analysisToastKey,
              normalizedStatus === 'succeeded' ? 'success' : normalizedStatus === 'succeeded_with_warnings' ? 'warning' : 'error',
              'Analysis completed',
              analysisToastMessage
            );
          }
          if ((normalizedStatus === 'succeeded' || normalizedStatus === 'succeeded_with_warnings') && dealId) {
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
            if (job.type === 'analyze_deal') {
              reportMissingRef.current = false;
              loadReport({ force: true });
            }
            loadEvidence();
            if (job.type === 'extract_visuals') {
              setAnalystReloadKey((v) => v + 1);
              setDocumentsReloadKey((v) => v + 1);
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        consecutiveErrors += 1;
        clearPollTimer();
        setAnalyzing(false);
        const message = err instanceof Error ? err.message : 'Unknown error';
        setJobStatus('failed');
        setJobMessage(message);
        setJobUpdatedAt(new Date().toISOString());
        addToastOnce(`job-poll-failed:${activeJobId}`, 'error', 'Job polling failed', message);
        // Stop further polling to avoid noisy loops; user can re-run the job to restart tracking.
        cancelled = true;
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearPollTimer();
    };
  }, [activeJobId, sseReady]);

  useEffect(() => {
    if (!dealId) {
      setDealJobs([]);
      setDealJobsError(null);
      return;
    }

    let cancelled = false;
    let pollTimer: number | undefined;

    const clearTimer = () => {
      if (pollTimer != null) {
        window.clearTimeout(pollTimer);
        pollTimer = undefined;
      }
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const rows = await apiGetDealJobs(dealId, { limit: 200 });
        if (cancelled) return;
        const normalizedRows = Array.isArray(rows) ? rows : [];
        setDealJobs(normalizedRows);
        setDealJobsError(null);

        // Full process UX: keep following the run-scoped analyze job even if the pinned extract_visuals job
        // has already reached a terminal status (and job polling/SSE quiets down).
        if (isFullProcessActive) {
          const runWindow = fullProcessRunWindowRef.current;
          const trackingThisRunExtract =
            !!fullProcessRunExtractJobId &&
            !!activeJobId &&
            (activeJobId === fullProcessRunExtractJobId || jobType === 'extract_visuals');

          if (runWindow && trackingThisRunExtract) {
            const best = selectAnalyzeJobInWindow(normalizedRows, runWindow);
            if (best?.job_id && best.job_id !== activeJobId) {
              const treatFailedAsPending =
                (best.type ?? '') === 'analyze_deal' &&
                isFailedJobStatus(best.status) &&
                isSupersedableAnalyzeFailure(best) &&
                (isFullProcessActive || shouldTreatRunAnalyzeFailureAsPending({ extractFinishedAt: fullProcessExtractFinishedAt ?? null }));

              if (!treatFailedAsPending) {
                setJobId(best.job_id);
              }
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load jobs';
        setDealJobsError(msg);
      } finally {
        if (cancelled) return;
        const isActive = isFullProcessActive || jobStatus === 'queued' || jobStatus === 'running' || jobStatus === 'retrying';
        pollTimer = window.setTimeout(poll, isActive ? 2500 : 15000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [activeJobId, dealId, fullProcessExtractFinishedAt, fullProcessRunExtractJobId, isFullProcessActive, jobStatus, jobType]);

  useEffect(() => {
    if (!dealId || typeof EventSource === 'undefined') {
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
        if (job.type !== 'fetch_evidence' && activeJobId && job.job_id !== activeJobId) return;
        setSseReady(true);
        if (job.updated_at) {
          lastEventIdRef.current = job.updated_at;
        }
        const normalizedStatus = normalizeJobStatus(job.status as string | null);
        setJobStatus(normalizedStatus);
        setJobType(job.type ?? null);
        const progressPayload = (job as any)?.progress ?? (job as any)?.status_detail?.progress ?? null;
        const progressApplied = progressPayload ? applyProgressSnapshot(progressPayload, job) : false;
        if (!progressApplied) {
          setJobProgress(typeof job.progress_pct === 'number' ? job.progress_pct : null);
          setJobMessage(job.message ?? null);
          setJobUpdatedAt(job.updated_at ?? null);
        } else if (job.updated_at) {
          setJobUpdatedAt(job.updated_at);
        }
        setJobCreatedAt((job as any)?.created_at ?? null);
        setJobStartedAt((job as any)?.started_at ?? null);

        // Full process UX: if we're currently tracking the extract_visuals job, automatically follow
        // the run-scoped analyze_deal job as soon as it exists.
        if (isFullProcessActive && job.type === 'extract_visuals') {
          const runWindow = getFullProcessRunWindowMs();
          if (runWindow) {
            const best = selectAnalyzeJobInWindow(dealJobsRef.current, runWindow);
            if (best && best.job_id && activeJobId && best.job_id !== activeJobId) {
              setJobId(best.job_id);
              return;
            }
          }
        }

        const reason = (job as any)?.result?.reason || (job as any)?.status_detail?.reason || (job as any)?.reason || null;
        setJobReason(typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : null);
        if (job.type === 'fetch_evidence' && (normalizedStatus === 'succeeded' || normalizedStatus === 'succeeded_with_warnings')) {
          const terminalKey = `job-terminal:${job.job_id}:${normalizedStatus}`;
          if (handledTerminalJobKeysRef.current.has(terminalKey)) return;
          handledTerminalJobKeysRef.current.add(terminalKey);
          loadEvidence();
          addToastOnce(terminalKey, normalizedStatus === 'succeeded_with_warnings' ? 'warning' : 'success', 'Evidence updated', job.message || 'Fetch completed');
          return;
        }
        if (["succeeded", "succeeded_with_warnings", "failed", "cancelled"].includes(normalizedStatus ?? '')) {
          const terminalKey = `job-terminal:${job.job_id}:${normalizedStatus}`;
          if (handledTerminalJobKeysRef.current.has(terminalKey)) return;
          handledTerminalJobKeysRef.current.add(terminalKey);
          setAnalyzing(false);

          const analysisToastKey = `analysis-complete:${job.job_id}:${normalizedStatus}`;
          const analysisToastMessage = job.message || (normalizedStatus ?? '');
          const delayAnalyzeFailureToast =
            job.type === 'analyze_deal' &&
            normalizedStatus === 'failed' &&
            isSupersedableAnalyzeFailure({ status: normalizedStatus, message: job.message }) &&
            scheduleAnalyzeFailureToastIfNoQuickSuccess({
              toastKey: analysisToastKey,
              toastMessage: analysisToastMessage,
              failedCreatedAt: (job as any)?.created_at ?? null,
            });

          if (!delayAnalyzeFailureToast) {
            addToastOnce(
              analysisToastKey,
              normalizedStatus === 'succeeded' ? 'success' : normalizedStatus === 'succeeded_with_warnings' ? 'warning' : 'error',
              'Analysis completed',
              analysisToastMessage
            );
          }
          if (normalizedStatus === 'succeeded' || normalizedStatus === 'succeeded_with_warnings') {
            if (job.type === 'analyze_deal') {
              reportMissingRef.current = false;
              loadReport({ force: true });
            }
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
            if (job.type === 'extract_visuals') {
              setAnalystReloadKey((v) => v + 1);
              setDocumentsReloadKey((v) => v + 1);
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
  }, [dealId, activeJobId]);

  const tabs: Tab[] = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="w-4 h-4" />, badge: 8 },
    { id: 'evidence', label: 'Evidence', icon: <Shield className="w-4 h-4" /> },
    { id: 'analyst', label: 'Analyst', icon: <Eye className="w-4 h-4" /> },
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

  const addToastOnce = (key: string, type: ToastType, title: string, message?: string) => {
    const keys = shownToastKeysRef.current;
    if (keys.has(key)) return;
    keys.add(key);
    // Avoid unbounded growth in long sessions.
    if (keys.size > 200) keys.clear();
    addToast(type, title, message);
  };

  const dealStageRaw = typeof (dealFromApi as any)?.stage === 'string' ? String((dealFromApi as any).stage) : null;
  const dealStageLabel = (() => {
    const s = dealStageRaw ?? '';
    const map: Record<string, string> = {
      intake: 'Intake',
      under_review: 'Under review',
      in_diligence: 'In diligence',
      ready_decision: 'Ready decision',
      pitched: 'Pitched',
    };
    return map[s] ?? (s ? s.replace(/_/g, ' ') : '—');
  })();

  const parseApiErrorMessage = (err: unknown): string => {
    if (err instanceof Error) {
      const raw = err.message ?? '';
      const trimmed = raw.trim();
      if (!trimmed) return 'Unknown error';
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          const msg = (parsed as any).message;
          const e = (parsed as any).error;
          if (typeof msg === 'string' && msg.trim().length > 0) return msg.trim();
          if (typeof e === 'string' && e.trim().length > 0) return e.trim();
        }
      } catch {
        // ignore
      }
      return trimmed;
    }
    return typeof err === 'string' ? err : 'Unknown error';
  };

  const refreshDealFromApi = async () => {
    if (!dealId) return;
    const deal = await apiGetDeal(dealId);
    setDealFromApi(deal);
  };

  const handleAutoProgressStage = async () => {
    if (!dealId) return;
    if (stageActionLoading) return;
    setStageActionLoading(true);
    try {
      const res = await apiAutoProgressDeal(dealId);
      if (res.progressed && res.newStage) {
        addToast('success', 'Stage progressed', res.message || `Moved to ${res.newStage}`);
        await refreshDealFromApi();
      } else {
        addToast('info', 'Stage not progressed', res.message || 'Deal does not meet conditions for stage progression');
        await refreshDealFromApi();
      }
    } catch (err) {
      addToast('error', 'Auto progress failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setStageActionLoading(false);
    }
  };

  const handleMarkPitched = async () => {
    if (!dealId) return;
    if (stageActionLoading) return;
    setStageActionLoading(true);
    try {
      const updated = await apiUpdateDeal(dealId, { stage: 'pitched' });
      setDealFromApi(updated);
      addToast('success', 'Stage updated', 'Deal marked as pitched.');
    } catch (err: any) {
      addToast('error', 'Stage update failed', parseApiErrorMessage(err));
    } finally {
      setStageActionLoading(false);
    }
  };

  const handleMarkDecisionReady = async () => {
    if (!dealId) return;
    if (stageActionLoading) return;
    setStageActionLoading(true);
    try {
      const updated = await apiUpdateDeal(dealId, { stage: 'ready_decision' });
      setDealFromApi(updated);
      addToast('success', 'Stage updated', 'Deal marked as ready decision.');
    } catch (err: any) {
      addToast('error', 'Stage update blocked', parseApiErrorMessage(err));
    } finally {
      setStageActionLoading(false);
    }
  };

  const jobDisplay = deriveJobDisplay({
    status: jobStatus,
    updatedAt: jobUpdatedAt,
    createdAt: jobCreatedAt,
    startedAt: jobStartedAt,
    heartbeatAt: jobProgressSnapshot?.at ?? null,
    reason: jobReason,
    message: jobMessage,
    queuedSeconds: jobQueuedSeconds,
  });

  const queuedWarningThresholdSec = import.meta.env.DEV ? 20 : 60;

  const runningSeverity: JobSeverity = (() => {
    if (!jobStatus) return 'muted';
    if (['running', 'retrying', 'blocked'].includes(jobStatus)) return jobDisplay.severity;
    if (jobStatus === 'cancelled') return 'warning';
    if (jobStatus === 'succeeded') return 'success';
    if (jobStatus === 'succeeded_with_warnings') return 'warning';
    if (jobStatus === 'failed') return 'danger';
    return 'muted';
  })();

  const fullProcessStepSeverity = (status: string | null | undefined): JobSeverity => {
    const s = String(status ?? '').toLowerCase();
    if (s === 'succeeded') return 'success';
    if (s === 'succeeded_with_warnings') return 'warning';
    if (s === 'failed') return 'danger';
    if (s === 'cancelled') return 'warning';
    if (s === 'running' || s === 'retrying') return 'info';
    if (s === 'queued' || s === 'pending') return 'muted';
    return 'muted';
  };

  const fullProcessStepLabel = (status: string | null | undefined): string => {
    const s = String(status ?? '').toLowerCase();
    if (s === 'pending') return 'Pending';
    if (s === 'queued') return 'Queued';
    if (s === 'running' || s === 'retrying') return 'Running';
    if (s === 'succeeded') return 'Done';
    if (s === 'succeeded_with_warnings') return 'Done (warn)';
    if (s === 'failed') return 'Failed';
    if (s === 'cancelled') return 'Cancelled';
    return s ? s.replace(/_/g, ' ') : '—';
  };

  const stageLabelMap: Record<string, string> = {
    queued: 'Queued',
    running: 'Processing',
    fetch_original_bytes: 'Fetching file',
    persist_document: 'Persisting document',
    extract_text: 'Extracting text',
    render_pages: 'Rendering pages',
    collect_image_uris: 'Collecting page images',
    extract_visual_assets: 'Extracting visuals',
    ocr: 'Running OCR',
    classify_visuals: 'Classifying visuals',
    persist_visual_assets: 'Saving visual assets',
    persist_visual_extractions: 'Saving visual extractions',
    finalize: 'Finalizing',
    blocked: 'Blocked',
    error: 'Error',
  };

  const jobSeverityFromStatus = (status: string | null | undefined): JobSeverity => {
    const s = String(status ?? '').toLowerCase();
    if (s === 'succeeded') return 'success';
    if (s === 'succeeded_with_warnings') return 'warning';
    if (s === 'failed') return 'danger';
    if (s === 'cancelled') return 'warning';
    if (s === 'running' || s === 'retrying') return 'info';
    if (s === 'queued') return 'muted';
    return 'muted';
  };

  const computePct = (current?: number, total?: number, pct?: number): number | null => {
    if (typeof current === 'number' && typeof total === 'number' && total > 0) {
      return Math.round(Math.min(Math.max((current / total) * 100, 0), 100));
    }
    if (typeof pct === 'number' && Number.isFinite(pct)) return Math.round(Math.min(Math.max(pct, 0), 100));
    return null;
  };

  const formatJobTitle = (job: DealJobRowV2): string => {
    const raw = job.queue || job.type || 'job';
    return String(raw).replace(/_/g, ' ');
  };

  const formatJobStage = (job: DealJobRowV2): string => {
    if (!job.stage) return '—';
    return stageLabelMap[job.stage] ?? String(job.stage).replace(/_/g, ' ');
  };

  const formatJobTimestamp = (job: DealJobRowV2): string | null => {
    const ts = job.updated_at ?? job.created_at;
    const t = ts ? Date.parse(ts) : NaN;
    if (!Number.isFinite(t)) return null;
    const now = Date.now();
    const deltaSec = Math.floor((now - t) / 1000);
    if (deltaSec < 0) return new Date(t).toLocaleTimeString();
    if (deltaSec < 60) return `${deltaSec}s ago`;
    if (deltaSec < 60 * 60) return `${Math.floor(deltaSec / 60)}m ago`;
    return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isRunningStatus = (status: string | null | undefined): boolean => {
    const s = String(status ?? '').toLowerCase();
    return s === 'running' || s === 'retrying';
  };

  const childrenByParentJobId = (() => {
    const map = new Map<string, DealJobRowV2[]>();
    for (const j of dealJobs ?? []) {
      if (!j?.parent_job_id) continue;
      const arr = map.get(j.parent_job_id) ?? [];
      arr.push(j);
      map.set(j.parent_job_id, arr);
    }
    for (const [k, v] of map) {
      v.sort((a, b) => String(a.job_id).localeCompare(String(b.job_id)));
      map.set(k, v);
    }
    return map;
  })();

  const recentParentJobs = (() => {
    const parents = (dealJobs ?? []).filter((j) => !j?.parent_job_id);
    parents.sort((a, b) => {
      const aT = Date.parse(a.updated_at ?? a.created_at ?? '') || 0;
      const bT = Date.parse(b.updated_at ?? b.created_at ?? '') || 0;
      return bT - aT;
    });
    return parents.slice(0, 5);
  })();

  const stageSequences: Record<string, string[]> = {
    ingest_documents: ['fetch_original_bytes', 'persist_document', 'extract_text', 'render_pages', 'finalize'],
    extract_visuals: ['collect_image_uris', 'render_pages', 'extract_visual_assets', 'persist_visual_assets', 'persist_visual_extractions', 'finalize'],
  };

  const stageChips: Array<{ id: string; label: string; severity: JobSeverity }> = (() => {
    const activeStage = jobProgressSnapshot?.stage ?? null;
    const seq = stageSequences[jobType ?? ''] ? [...stageSequences[jobType ?? '']] : ['queued', 'running', 'finalize'];
    if (activeStage && !seq.includes(activeStage)) seq.push(activeStage);
    if (!activeStage && !seq.includes(jobStatus ?? '')) seq.push(jobStatus ?? '');

    const currentIdx = activeStage ? seq.indexOf(activeStage) : -1;
    return seq.map((stage) => {
      const isActive = activeStage === stage;
      const index = seq.indexOf(stage);
      let severity: JobSeverity = 'muted';
      if (isActive) {
        severity = stage === 'blocked' ? 'warning' : stage === 'error' ? 'danger' : 'info';
      } else if (currentIdx !== -1 && index !== -1 && index < currentIdx) {
        severity = 'success';
      } else if (!activeStage) {
        severity = runningSeverity;
      }

      const label = stageLabelMap[stage] ?? (stage ? stage.replace(/_/g, ' ') : '');
      return {
        id: stage || 'stage',
        label: label || 'Processing',
        severity,
      };
    });
  })();

  const progressPercent = typeof jobProgressSnapshot?.percent === 'number' ? jobProgressSnapshot.percent : jobProgress;
  const progressMessage = jobProgressSnapshot?.message ?? jobMessage;
  const progressStageLabel = jobProgressSnapshot?.stage ? (stageLabelMap[jobProgressSnapshot.stage] ?? jobProgressSnapshot.stage) : null;
  const progressTimestamp = jobProgressSnapshot?.at ?? jobUpdatedAt;

  const currentlyProcessingLine = (() => {
    const snapshotMsg = typeof jobProgressSnapshot?.message === 'string' ? jobProgressSnapshot.message.trim() : '';
    if (snapshotMsg) return snapshotMsg;
    const jobMsg = typeof jobMessage === 'string' ? jobMessage.trim() : '';
    if (jobMsg) return jobMsg;
    return progressStageLabel ?? (jobStatus ? jobDisplay.label : null);
  })();

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  const runAIAnalysis = async () => {
    if (!dealId) return;
    setAnalyzing(true);
    setJobProgress(null);
    setJobMessage(null);
    setJobUpdatedAt(null);
    setJobCreatedAt(null);
    setJobStartedAt(null);
    setJobReason(null);
    reportMissingRef.current = false;
    lastReportAttemptAtRef.current = 0;
    addToast('info', 'Deal Analysis Started', 'Queued analysis job...');
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

  const waitForJobTerminal = async (
    jobIdToWait: string,
    opts?: {
      timeoutMs?: number;
      pollMs?: number;
      onPoll?: (job: Awaited<ReturnType<typeof apiGetJob>>, normalizedStatus: string | null) => void;
    }
  ) => {
    const timeoutMs = typeof opts?.timeoutMs === 'number' ? opts.timeoutMs : 25 * 60_000;
    const pollMs = typeof opts?.pollMs === 'number' ? opts.pollMs : 2000;

    const started = Date.now();
    while (true) {
      const job = await apiGetJob(jobIdToWait);
      const normalizedStatus = normalizeJobStatus(job.status as string | null);
      try {
        opts?.onPoll?.(job, normalizedStatus);
      } catch {
        // ignore
      }
      if (normalizedStatus && ['succeeded', 'succeeded_with_warnings', 'failed', 'cancelled'].includes(normalizedStatus)) {
        return { job, normalizedStatus };
      }

      if (Date.now() - started > timeoutMs) {
        return {
          job,
          normalizedStatus: 'failed' as const,
          timedOut: true,
        };
      }

      await new Promise<void>((resolve) => window.setTimeout(resolve, pollMs));
    }
  };

  const runFullProcess = async () => {
    if (!dealId) return;

    setFullProcessExtractJobId(null);
    setFullProcessExtractCreatedAt(null);
    setFullProcessExtractFinishedAt(null);
    setAnalyzing(true);
    setJobProgress(null);
    setJobMessage(null);
    setJobUpdatedAt(null);
    setJobCreatedAt(null);
    setJobStartedAt(null);
    setJobReason(null);
    reportMissingRef.current = false;
    lastReportAttemptAtRef.current = 0;

    addToast('info', 'Full process started', 'Re-extract documents → extract visuals → analyze (auto after finalize)');

    const initFullProcess = (): FullProcessUiState => ({
      started_at: new Date().toISOString(),
      current_step: 'reextract_documents',
      steps: {
        reextract_documents: { key: 'reextract_documents', label: 'Re-extract documents', status: 'pending', job_id: null, progress_pct: null, message: null, updated_at: null },
        extract_visuals: { key: 'extract_visuals', label: 'Extract visuals', status: 'pending', job_id: null, progress_pct: null, message: null, updated_at: null },
        analyze_deal: { key: 'analyze_deal', label: 'Analyze deal', status: 'pending', job_id: null, progress_pct: null, message: null, updated_at: null },
      },
      ok: undefined,
      error: null,
    });

    const updateFullStep = (step: FullProcessStepKey, patch: Partial<FullProcessStepUi>) => {
      setFullProcessUi((prev) => {
        const base = prev ?? initFullProcess();
        return {
          ...base,
          current_step: base.current_step ?? step,
          steps: {
            ...base.steps,
            [step]: {
              ...base.steps[step],
              ...patch,
            },
          },
        };
      });
    };

    setFullProcessUi(initFullProcess());

    try {
      // Step 1: reextract_documents
      setJobType('reextract_documents');
      setFullProcessUi((prev) => ({ ...(prev ?? initFullProcess()), current_step: 'reextract_documents' }));
      const reextractRes = await apiPostReextractDocuments(dealId, { include_warnings: true, force: true });
      setJobId(reextractRes.job_id);
      setJobStatus((reextractRes as any).status ?? 'queued');
      addToast('info', 'Re-extract documents queued', `Job ${reextractRes.job_id}`);

      updateFullStep('reextract_documents', { status: 'queued', job_id: reextractRes.job_id, updated_at: new Date().toISOString() });

      const reextractDone = await waitForJobTerminal(reextractRes.job_id, {
        onPoll: (job, normalizedStatus) => {
          const pct = (job as any)?.status_detail?.progress?.percent;
          const msg = (job as any)?.status_detail?.progress?.message ?? job.message;
          const st = (normalizedStatus ?? job.status ?? 'running') as any;
          updateFullStep('reextract_documents', {
            status: st,
            progress_pct: typeof pct === 'number' ? pct : typeof job.progress_pct === 'number' ? job.progress_pct : null,
            message: typeof msg === 'string' ? msg : null,
            updated_at: job.updated_at ?? null,
          });
        },
      });
      if (reextractDone.timedOut) {
        addToast('error', 'Re-extract documents timed out', 'Stopping full process');
        updateFullStep('reextract_documents', { status: 'failed', message: 'Timed out' });
        setFullProcessUi((prev) => (prev ? { ...prev, ok: false, error: 'Re-extract documents timed out' } : prev));
        setAnalyzing(false);
        return;
      }
      if (reextractDone.normalizedStatus !== 'succeeded' && reextractDone.normalizedStatus !== 'succeeded_with_warnings') {
        addToast('error', 'Re-extract documents failed', reextractDone.job.message || reextractDone.normalizedStatus);
        updateFullStep('reextract_documents', { status: reextractDone.normalizedStatus as any, message: reextractDone.job.message ?? null });
        setFullProcessUi((prev) => (prev ? { ...prev, ok: false, error: 'Re-extract documents failed' } : prev));
        setAnalyzing(false);
        return;
      }

      // Ensure Documents tab refreshes after re-extraction.
      setDocumentsReloadKey((v) => v + 1);

      // Step 2: extract_visuals
      setJobType('extract_visuals');
      setFullProcessUi((prev) => (prev ? { ...prev, current_step: 'extract_visuals' } : prev));
      const extractRes = await apiPostExtractVisuals(dealId);
      const extractQueuedAt = new Date().toISOString();
      setFullProcessExtractJobId(extractRes.job_id);
      setFullProcessExtractCreatedAt(extractQueuedAt);
      setJobId(extractRes.job_id);
      setJobStatus(extractRes.status);
      addToast('info', 'Extract visuals queued', `Job ${extractRes.job_id}`);

      updateFullStep('extract_visuals', { status: 'queued', job_id: extractRes.job_id, updated_at: extractQueuedAt });

      // Analyze is not enqueued by the UI; it will be enqueued automatically by backend/worker finalize hook.
      updateFullStep('analyze_deal', {
        status: 'pending',
        job_id: null,
        progress_pct: null,
        message: 'Analyze will start automatically after visual extraction completes',
        updated_at: new Date().toISOString(),
      });

      const extractDone = await waitForJobTerminal(extractRes.job_id, {
        onPoll: (job, normalizedStatus) => {
          const createdAt = (job as any)?.created_at ?? null;
          const finishedAt = (job as any)?.finished_at ?? null;
          if (typeof createdAt === 'string' && createdAt) setFullProcessExtractCreatedAt(createdAt);
          if (typeof finishedAt === 'string' && finishedAt) setFullProcessExtractFinishedAt(finishedAt);

          const pct = (job as any)?.status_detail?.progress?.percent;
          const msg = (job as any)?.status_detail?.progress?.message ?? job.message;
          const st = (normalizedStatus ?? job.status ?? 'running') as any;
          updateFullStep('extract_visuals', {
            status: st,
            progress_pct: typeof pct === 'number' ? pct : typeof job.progress_pct === 'number' ? job.progress_pct : null,
            message: typeof msg === 'string' ? msg : null,
            updated_at: job.updated_at ?? null,
          });
        },
      });
      if (extractDone.timedOut) {
        addToast('error', 'Extract visuals timed out', 'Stopping full process');
        updateFullStep('extract_visuals', { status: 'failed', message: 'Timed out' });
        setFullProcessUi((prev) => (prev ? { ...prev, ok: false, error: 'Extract visuals timed out' } : prev));
        setAnalyzing(false);
        return;
      }
      if (extractDone.normalizedStatus !== 'succeeded' && extractDone.normalizedStatus !== 'succeeded_with_warnings') {
        addToast('error', 'Extract visuals failed', extractDone.job.message || extractDone.normalizedStatus);
        updateFullStep('extract_visuals', { status: extractDone.normalizedStatus as any, message: extractDone.job.message ?? null });
        setFullProcessUi((prev) => (prev ? { ...prev, ok: false, error: 'Extract visuals failed' } : prev));
        setAnalyzing(false);
        return;
      }

      // Capture run window bounds (extract created_at → (finished_at or now) + 5m)
      const extractCreatedAt = (extractDone.job as any)?.created_at ?? fullProcessExtractCreatedAt ?? extractQueuedAt;
      const extractFinishedAt = (extractDone.job as any)?.finished_at ?? (extractDone.job as any)?.updated_at ?? new Date().toISOString();
      if (typeof extractCreatedAt === 'string' && extractCreatedAt) setFullProcessExtractCreatedAt(extractCreatedAt);
      if (typeof extractFinishedAt === 'string' && extractFinishedAt) setFullProcessExtractFinishedAt(extractFinishedAt);

      const runStartMs = parseIsoMs(extractCreatedAt) ?? Date.now();
      const runEndBaseMs = parseIsoMs(extractFinishedAt) ?? Date.now();
      const runWindow = { startMs: runStartMs, endMs: runEndBaseMs + 5 * 60_000 };

      // Critical: force Analyst tab remount so it refetches lineage + visual assets.
      setAnalystReloadKey((v) => v + 1);
      setDocumentsReloadKey((v) => v + 1);

      // Step 3: analyze_deal (auto)
      // Do NOT enqueue analyze_deal from the UI. The backend/worker should enqueue it after extraction finalizes.
      setFullProcessUi((prev) => (prev ? { ...prev, current_step: 'analyze_deal' } : prev));
      updateFullStep('analyze_deal', {
        status: 'pending',
        job_id: null,
        progress_pct: null,
        message: 'Preparing analysis…',
        updated_at: new Date().toISOString(),
      });

      // Keep polling for an analyze job within the run window. A fast-failing analyze attempt can occur
      // before the worker has all extracted docs; treat early failures as pending for a short grace period.
      const analyzeLoopStartedMs = Date.now();
      const analyzeTimeoutMs = 10 * 60_000;
      const analyzePollMs = 2000;

      let analyzeTerminal: { job: any; normalizedStatus: string; timedOut?: boolean } | null = null;
      while (true) {
        if (Date.now() - analyzeLoopStartedMs > analyzeTimeoutMs) {
          analyzeTerminal = { job: null, normalizedStatus: 'failed', timedOut: true };
          break;
        }

        const rows = await apiGetDealJobs(dealId, { limit: 200 });
        const best = selectAnalyzeJobInWindow(Array.isArray(rows) ? rows : [], runWindow);

        if (!best) {
          updateFullStep('analyze_deal', {
            status: 'pending',
            job_id: null,
            progress_pct: null,
            message: 'Preparing analysis…',
            updated_at: new Date().toISOString(),
          });
          await new Promise<void>((resolve) => window.setTimeout(resolve, analyzePollMs));
          continue;
        }

        const bestStatus = normalizeJobStatus(best.status as any);

        // Succeeded in-window: we're done.
        if (bestStatus === 'succeeded' || bestStatus === 'succeeded_with_warnings') {
          setJobId(best.job_id);
          updateFullStep('analyze_deal', {
            status: bestStatus as any,
            job_id: best.job_id,
            progress_pct: typeof best.progress_pct === 'number' ? best.progress_pct : null,
            message: (best.message ?? best.error ?? null) as any,
            updated_at: best.updated_at ?? new Date().toISOString(),
          });
          analyzeTerminal = { job: best, normalizedStatus: bestStatus };
          break;
        }

        // Running/retrying/queued in-window: follow it to terminal with progress updates.
        if (bestStatus === 'queued' || bestStatus === 'running' || bestStatus === 'retrying') {
          setJobId(best.job_id);
          updateFullStep('analyze_deal', {
            status: bestStatus as any,
            job_id: best.job_id,
            progress_pct: typeof best.progress_pct === 'number' ? best.progress_pct : null,
            message: (best.message ?? best.error ?? null) as any,
            updated_at: best.updated_at ?? new Date().toISOString(),
          });

          const done = await waitForJobTerminal(best.job_id, {
            onPoll: (job, normalizedStatus) => {
              const pct = (job as any)?.status_detail?.progress?.percent;
              const msg = (job as any)?.status_detail?.progress?.message ?? job.message;
              const st = (normalizedStatus ?? job.status ?? 'running') as any;
              updateFullStep('analyze_deal', {
                status: st,
                progress_pct: typeof pct === 'number' ? pct : typeof job.progress_pct === 'number' ? job.progress_pct : null,
                message: typeof msg === 'string' ? msg : null,
                updated_at: job.updated_at ?? null,
              });
            },
          });

          if (done.timedOut) {
            analyzeTerminal = { job: done.job, normalizedStatus: done.normalizedStatus, timedOut: true };
            break;
          }

          if (done.normalizedStatus === 'succeeded' || done.normalizedStatus === 'succeeded_with_warnings') {
            analyzeTerminal = { job: done.job, normalizedStatus: done.normalizedStatus };
            break;
          }

          // Failed/cancelled: only suppress the known fast-fail during the run (or shortly after extraction finishes).
          if (
            isSupersedableAnalyzeFailure({ status: done.normalizedStatus, message: done.job?.message, error: (done.job as any)?.error }) &&
            (isFullProcessActive || shouldTreatRunAnalyzeFailureAsPending({ extractFinishedAt: fullProcessExtractFinishedAt ?? null }))
          ) {
            updateFullStep('analyze_deal', {
              status: 'pending',
              job_id: null,
              progress_pct: null,
              message: 'Preparing analysis…',
              updated_at: new Date().toISOString(),
            });
            await new Promise<void>((resolve) => window.setTimeout(resolve, analyzePollMs));
            continue;
          }

          analyzeTerminal = { job: done.job, normalizedStatus: done.normalizedStatus };
          break;
        }

        // Only failed exists (or a failed is currently best): only suppress the known fast-fail during the run.
        if (
          bestStatus === 'failed' &&
          isSupersedableAnalyzeFailure({ status: bestStatus, message: (best as any)?.message, error: (best as any)?.error }) &&
          (isFullProcessActive || shouldTreatRunAnalyzeFailureAsPending({ extractFinishedAt: fullProcessExtractFinishedAt ?? null }))
        ) {
          updateFullStep('analyze_deal', {
            status: 'pending',
            job_id: null,
            progress_pct: null,
            message: 'Preparing analysis…',
            updated_at: new Date().toISOString(),
          });
          await new Promise<void>((resolve) => window.setTimeout(resolve, analyzePollMs));
          continue;
        }

        // Anything else: treat as terminal.
        analyzeTerminal = { job: best, normalizedStatus: bestStatus ?? (best.status as any) };
        break;
      }

      if (!analyzeTerminal || analyzeTerminal.timedOut) {
        addToast('error', 'Analyze did not start', 'Timed out waiting for backend to enqueue analyze job');
        updateFullStep('analyze_deal', { status: 'failed', message: 'Timed out waiting for analyze to start' });
        setFullProcessUi((prev) => (prev ? { ...prev, ok: false, error: 'Analyze did not start' } : prev));
        setAnalyzing(false);
        return;
      }

      if (analyzeTerminal.normalizedStatus !== 'succeeded' && analyzeTerminal.normalizedStatus !== 'succeeded_with_warnings') {
        addToast('error', 'Analyze deal failed', analyzeTerminal.job?.message || analyzeTerminal.normalizedStatus);
        updateFullStep('analyze_deal', { status: analyzeTerminal.normalizedStatus as any, message: analyzeTerminal.job?.message ?? null });
        setFullProcessUi((prev) => (prev ? { ...prev, ok: false, error: 'Analyze deal failed' } : prev));
        setAnalyzing(false);
        return;
      }

      // Post-analysis refresh
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

      reportMissingRef.current = false;
      loadReport({ force: true });
      loadEvidence();

      addToast('success', 'Full process completed', 'Documents, visuals, and analysis refreshed');
      setFullProcessUi((prev) => (prev ? { ...prev, ok: true, error: null } : prev));
    } catch (err) {
      addToast('error', 'Full process failed to start', err instanceof Error ? err.message : 'Unknown error');
      setFullProcessUi((prev) => (prev ? { ...prev, ok: false, error: err instanceof Error ? err.message : 'Unknown error' } : prev));
    } finally {
      setAnalyzing(false);
    }
  };

  const runExtractVisuals = async () => {
    if (!dealId) return;
    setAnalyzing(true);
    setJobProgress(null);
    setJobMessage(null);
    setJobUpdatedAt(null);
    setJobCreatedAt(null);
    setJobStartedAt(null);
    setJobReason(null);
    reportMissingRef.current = false;
    lastReportAttemptAtRef.current = 0;
    addToast('info', 'Visual extraction started', 'Queued visual extraction job...');
    try {
      const res = await apiPostExtractVisuals(dealId);
      setJobId(res.job_id);
      setJobStatus(res.status);
      addToast('info', 'Job queued', `Job ${res.job_id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addToast('error', 'Visual extraction failed to start', message);
      setAnalyzing(false);
      return;
    }
  };

  const handleFetchEvidence = async () => {
    if (!dealId) return;
    try {
      const res = await apiFetchEvidence(dealId);
      addToast('info', 'Evidence fetch queued', `Job ${res.job_id}`);
    } catch (err) {
      addToast('error', 'Evidence fetch failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  type JobSeverity = 'success' | 'info' | 'warning' | 'danger' | 'muted';

  function severityBadgeClass(severity: JobSeverity) {
    switch (severity) {
      case 'success':
        return 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200';
      case 'info':
        return 'bg-blue-500/10 border-blue-500/40 text-blue-200';
      case 'warning':
        return 'bg-amber-500/10 border-amber-500/40 text-amber-200';
      case 'danger':
        return 'bg-red-500/10 border-red-500/40 text-red-200';
      case 'muted':
      default:
        return darkMode
          ? 'bg-white/5 border-white/10 text-gray-300'
          : 'bg-white/60 border-gray-200 text-gray-700';
    }
  }

  function severityTextClass(severity: JobSeverity) {
    switch (severity) {
      case 'success':
        return darkMode ? 'text-emerald-200' : 'text-emerald-700';
      case 'info':
        return darkMode ? 'text-blue-200' : 'text-blue-700';
      case 'warning':
        return darkMode ? 'text-amber-200' : 'text-amber-700';
      case 'danger':
        return darkMode ? 'text-red-200' : 'text-red-700';
      case 'muted':
      default:
        return darkMode ? 'text-gray-400' : 'text-gray-600';
    }
  }

  function parseIso(value: string | null | undefined): number | null {
    if (!value || typeof value !== 'string') return null;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }

  function normalizeJobStatus(rawStatus: string | null | undefined): string | null {
    if (!rawStatus) return null;
    const normalized = rawStatus.trim().toLowerCase();
    const aliasMap: Record<string, string> = {
      success: 'succeeded',
    };
    const mapped = aliasMap[normalized] ?? normalized;
    const known = new Set([
      'queued',
      'running',
      'retrying',
      'succeeded',
      'succeeded_with_warnings',
      'failed',
      'cancelled',
      'blocked',
    ]);
    return known.has(mapped) ? mapped : mapped;
  }

  function deriveJobDisplay(meta: {
    status: string | null;
    updatedAt?: string | null;
    createdAt?: string | null;
    startedAt?: string | null;
    heartbeatAt?: string | null;
    reason?: string | null;
    message?: string | null;
    queuedSeconds?: number;
  }) {
    const status = (meta.status ?? '').toLowerCase();
    if (!status) {
      return { label: 'Idle', severity: 'muted' as JobSeverity, sublabel: null, status: null };
    }
    const queuedThresholdSec = import.meta.env.DEV ? 20 : 60;
    const runningThresholdSec = import.meta.env.DEV ? 30 : 90;

    const nowMs = Date.now();
    const heartbeatMs = parseIso(meta.heartbeatAt);
    const updatedMs = parseIso(meta.updatedAt);
    const startedMs = parseIso(meta.startedAt);
    const createdMs = parseIso(meta.createdAt);
    const ageSeconds = (refMs: number | null) => (refMs == null ? null : Math.max(0, Math.floor((nowMs - refMs) / 1000)));

    // Prefer worker heartbeat timestamp when available.
    const activityAge = ageSeconds(heartbeatMs ?? updatedMs);
    const createdAge = ageSeconds(createdMs);
    const startedAge = ageSeconds(startedMs);
    const bestQueuedAge = activityAge ?? createdAge ?? startedAge ?? (typeof meta.queuedSeconds === 'number' ? meta.queuedSeconds : null);

    let severity: JobSeverity = 'info';
    let label = 'Idle';
    let sublabel: string | null = null;

    const reason = typeof meta.reason === 'string' && meta.reason.trim().length > 0 ? meta.reason.trim() : null;
    const message = typeof meta.message === 'string' && meta.message.trim().length > 0 ? meta.message.trim() : null;

    const setLabelAndSeverity = (nextLabel: string, nextSeverity: JobSeverity) => {
      label = nextLabel;
      severity = nextSeverity;
    };

    switch (status) {
      case 'succeeded':
        setLabelAndSeverity('Completed', 'success');
        sublabel = message || null;
        break;
      case 'succeeded_with_warnings':
        setLabelAndSeverity('Succeeded (warnings)', 'warning');
        sublabel = reason || message || null;
        break;
      case 'failed':
        setLabelAndSeverity('Failed', 'danger');
        sublabel = reason || message || null;
        break;
      case 'blocked':
        setLabelAndSeverity('Blocked', 'warning');
        sublabel = reason || message || 'Waiting for prerequisite';
        break;
      case 'cancelled':
        setLabelAndSeverity('Cancelled', 'warning');
        sublabel = reason || message || null;
        break;
      case 'running':
      case 'retrying':
        setLabelAndSeverity('Processing', 'info');
        sublabel = message || null;
        break;
      case 'queued':
      default:
        setLabelAndSeverity('Queued', 'info');
        sublabel = reason || message || 'Waiting for worker';
        break;
    }

    if (['queued', 'running', 'retrying'].includes(status)) {
      if (status === 'queued' && bestQueuedAge != null && bestQueuedAge >= queuedThresholdSec) {
        setLabelAndSeverity('Queued (stalled)', 'warning');
        sublabel = reason || message || `No worker update for ${bestQueuedAge}s`;
      }

      if (['running', 'retrying'].includes(status) && activityAge != null && activityAge >= runningThresholdSec) {
        setLabelAndSeverity('Running (stalled)', 'warning');
        sublabel = reason || message || `No progress update for ${activityAge}s`;
      }
    }

    if (reason && severity === 'info' && status !== 'succeeded' && status !== 'succeeded_with_warnings') {
      severity = 'warning';
      sublabel = reason;
    }

    return { label, severity, sublabel, status: status || null };
  }


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
                  Created {dealInfo?.createdDate || 'Unknown'}
                </span>
                <span className={`${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>•</span>
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  Data not available
                </span>
              </div>

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
                {dealStageRaw && (
                  <span className={`px-2 py-1 rounded-full border ${darkMode ? 'border-white/10 text-gray-200' : 'border-gray-200 text-gray-700'}`}>
                    Stage: {dealStageLabel}
                  </span>
                )}
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
            </div>
            
            {/* Streamlined Action Buttons - 3 Main + More Menu */}
            <div className="flex items-center gap-2 relative">
              {/* AI Assistant Button - New Feature! */}
              <Button 
                variant="primary" 
                darkMode={darkMode}
                icon={<MessageSquare className="w-4 h-4" />}
                onClick={() => dioMeta?.dioVersionId ? setShowAIAssistant(true) : addToast('info', 'AI Assistant needs DIO', 'Run analysis to generate DIO first')}
                disabled={!dioMeta?.dioVersionId}
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
                          disabled={!dealId || stageActionLoading}
                          onClick={async () => {
                            setShowMoreActions(false);
                            await handleAutoProgressStage();
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                            darkMode
                              ? 'hover:bg-white/10 text-gray-300'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <ArrowUpRight className="w-4 h-4" />
                          {stageActionLoading ? 'Working…' : 'Auto progress stage'}
                        </button>

                        <button
                          disabled={!dealId || stageActionLoading}
                          onClick={async () => {
                            setShowMoreActions(false);
                            await handleMarkDecisionReady();
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                            darkMode
                              ? 'hover:bg-white/10 text-gray-300'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <CheckCircle className="w-4 h-4" />
                          {stageActionLoading ? 'Working…' : 'Mark decision-ready'}
                        </button>

                        <button
                          disabled={!dealId || stageActionLoading}
                          onClick={async () => {
                            setShowMoreActions(false);
                            await handleMarkPitched();
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                            darkMode
                              ? 'hover:bg-white/10 text-gray-300'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <Presentation className="w-4 h-4" />
                          {stageActionLoading ? 'Working…' : 'Mark as pitched'}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* Decision Tile */}
            <div className={`backdrop-blur-xl border rounded-xl p-6 w-full h-full ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'}`}> 
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-xs uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Decision</div>
                  <div className={`mt-2 text-3xl sm:text-4xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{decisionTileLabel}</div>
                  <div className={`mt-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {decisionTileScore0_100 != null ? `Score: ${decisionTileScore0_100}/100` : '—'}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-1 rounded-full border text-xs ${bandToBadgeClasses(decisionTileOpenItemsCount > 0 ? 'med' : 'high')}`}>
                      Open items: {decisionTileOpenItemsCount}
                    </span>
                    <span className={`px-2 py-1 rounded-full border text-xs ${bandToBadgeClasses(decisionTileConfidenceBand)}`}>
                      Confidence: {decisionTileConfidenceLabelShort}
                    </span>
                  </div>

                  <p className={`mt-3 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {decisionTileRationale}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full border text-xs font-medium ${decisionTileAccent}`}>
                  Deal snapshot
                </span>
              </div>
            </div>

            {/* Decision Breakdown (Radar) */}
            <div className={`backdrop-blur-xl border rounded-xl p-6 w-full h-full ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'}`}> 
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-xs uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Decision breakdown</div>
                  <div className={`mt-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Fundamentals components and indicator signals (hover for details).
                  </div>
                </div>
              </div>

              {decisionRadarReady ? (
                <div className="mt-4">
                  <ResponsiveContainer width="100%" height={260}>
                    <RadarChart data={decisionRadarData ?? []}>
                      <PolarGrid stroke={darkMode ? '#ffffff20' : '#00000020'} />
                      <PolarAngleAxis
                        dataKey="label"
                        stroke={darkMode ? '#ffffff60' : '#00000060'}
                        tick={{ fill: darkMode ? '#ffffff80' : '#00000080' }}
                      />
                      <PolarRadiusAxis angle={90} domain={[0, 100]} stroke={darkMode ? '#ffffff40' : '#00000040'} />
                      <Radar
                        name="Decision"
                        dataKey="score"
                        stroke={darkMode ? '#60a5fa' : '#2563eb'}
                        fill={darkMode ? '#60a5fa' : '#2563eb'}
                        fillOpacity={0.18}
                        strokeWidth={2}
                      />
                      <RechartsTooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const row = (payload[0] as any)?.payload as DecisionRadarDatum | undefined;
                          if (!row) return null;
                          const scoreText = row.scoreRaw == null ? 'N/A' : `${row.scoreRaw}/100`;
                          const contribText =
                            row.weightPct === 0
                              ? '— (indicator only)'
                              : row.weightedContribution == null
                                ? 'N/A'
                                : `${row.weightedContribution}/100`;
                          return (
                            <div
                              style={{
                                backgroundColor: darkMode ? '#27272a' : '#ffffff',
                                border: `1px solid ${darkMode ? '#ffffff20' : '#e5e7eb'}`,
                                borderRadius: '8px',
                                padding: '10px 12px',
                                color: darkMode ? '#ffffff' : '#000000',
                                maxWidth: 260,
                              }}
                            >
                              <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}>{row.label}</div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>Score: {scoreText}</div>
                              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>Weight: {row.weightPct}%</div>
                              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>Contribution: {contribText}</div>
                              {row.status ? (
                                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>Status: {row.status}</div>
                              ) : null}
                              {row.reason ? (
                                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6, lineHeight: 1.35 }}>{row.reason}</div>
                              ) : null}
                            </div>
                          );
                        }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>

                  <div className={`mt-2 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Only non-zero weights contribute to the displayed score.
                  </div>
                </div>
              ) : (
                <div className="mt-4">
                  <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Run analysis to populate the decision breakdown.
                  </div>
                </div>
              )}
            </div>

            {/* Score Driver Tile */}
            <div
              className={`col-span-full backdrop-blur-xl border rounded-xl p-6 w-full ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-xs uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Coverage & readiness</div>
                  <div className={`mt-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {executiveSummaryV2 || executiveSummaryV1 ? 'Coverage by category and open items' : 'Run analysis to populate coverage and readiness.'}
                  </div>
                </div>
              </div>

              {isAnalyst && scoreBreakdownSections.length > 0 ? (() => {
                const sections = scoreBreakdownSections as any[];
                let linkedTotal = 0;
                let linkedNodeBacked = 0;
                for (const s of sections) {
                  const linked = Array.isArray(s?.evidence_ids_linked) ? s.evidence_ids_linked.filter((x: any) => typeof x === 'string' && x.trim().length > 0) : [];
                  if (linked.length === 0) continue;
                  linkedTotal += linked.length;
                  const nodeCount = typeof s?.node_evidence_count_linked === 'number' ? Math.max(0, Math.min(linked.length, Math.floor(s.node_evidence_count_linked))) : 0;
                  linkedNodeBacked += nodeCount;
                }
                if (linkedTotal <= 0) return null;
                const pct = Math.round((linkedNodeBacked / linkedTotal) * 100);
                const status = pct >= 80 ? 'OK' : pct >= 50 ? 'WARN' : 'BLOCK';
                const tone = status === 'OK'
                  ? (darkMode ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800')
                  : status === 'WARN'
                    ? (darkMode ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800')
                    : (darkMode ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-800');

                return (
                  <div className={`mt-4 rounded-lg border px-3 py-2 flex items-start gap-2 ${tone}`}>
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div className="text-xs leading-relaxed">
                      <div className="font-medium">Node-backed scoring: {status} ({pct}% of linked score evidence is node-locatable)</div>
                      <div className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                        Path A requires scored claims to trace back to extracted nodes; link remaining score evidence to visual nodes to make decisions defensible.
                      </div>
                    </div>
                  </div>
                );
              })() : null}

              {(executiveSummaryV2 || executiveSummaryV1) ? (
                <>
                  <div className={`mt-4 rounded-lg border overflow-hidden ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="overflow-x-auto">
                      <div
                        className="grid h-3"
                        style={{
                          gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))`,
                          minWidth: `${categories.length * 110}px`,
                        }}
                      >
                        {categories.map((c, idx) => {
                          const band = getBandForCategory(c.key);
                          return (
                            <div
                              key={c.key}
                              className={`h-full w-full ${bandToClasses(band)} ${idx > 0 ? (darkMode ? 'border-l border-white/10' : 'border-l border-gray-200') : ''}`}
                              title={`${c.label}: ${band}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <div
                      className="grid gap-x-2 gap-y-1"
                      style={{
                        gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))`,
                        minWidth: `${categories.length * 110}px`,
                      }}
                    >
                      {categories.map((c) => {
                        const band = getBandForCategory(c.key);
                        const bandLabel = band === 'low' ? 'Low' : band === 'med' ? 'Med' : band === 'high' ? 'High' : String(band);
                        return (
                          <div
                            key={`${c.key}-legend`}
                            className={`${isAnalyst ? 'cursor-pointer' : ''} flex flex-col items-center justify-center gap-0.5 select-none`}
                            title={`${c.label}: ${bandLabel}`}
                            onClick={() => {
                              if (!isAnalyst) return;
                              setShowScoreBreakdown(true);
                              setTimeout(() => {
                                scoreBreakdownAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }, 0);
                            }}
                            role={isAnalyst ? 'button' : undefined}
                            tabIndex={isAnalyst ? 0 : undefined}
                            onKeyDown={(e) => {
                              if (!isAnalyst) return;
                              if (e.key !== 'Enter' && e.key !== ' ') return;
                              e.preventDefault();
                              setShowScoreBreakdown(true);
                              setTimeout(() => {
                                scoreBreakdownAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }, 0);
                            }}
                          >
                            <div className="flex items-center justify-center gap-2">
                              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${bandToClasses(band)}`} />
                              <span className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{c.label}</span>
                            </div>
                            {isAnalyst && (
                              <div className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{bandLabel}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {scoreBreakdownSections.length > 0 && (() => {
                    const counts = { supported: 0, weak: 0, missing: 0 };
                    for (const section of scoreBreakdownSections as any[]) {
                      const status = typeof section?.support_status === 'string' ? section.support_status : 'weak';
                      if (status === 'supported') counts.supported += 1;
                      else if (status === 'missing') counts.missing += 1;
                      else counts.weak += 1;
                    }
                    return (
                      <div className={`mt-3 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Supported: {counts.supported} · Weak: {counts.weak} · Missing: {counts.missing}
                        {isAnalyst ? ' · Click a category to jump to breakdown' : ''}
                      </div>
                    );
                  })()}

                  <div className="mt-4">
                    <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Open items (detail)</div>
                    {missingChips.length > 0 ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {(isAnalyst ? missingChips : (showAllMissingChips ? missingChips : missingChips.slice(0, 3))).map((chip) => {
                            const labelMap: Record<string, string> = {
                              product_solution: 'Product solution',
                              market_icp: 'Market / ICP',
                              key_risks_detected: 'Key risks',
                              coverage_missing_sections: 'Missing sections',
                              raise: 'Raise',
                              business_model: 'Business model',
                              traction: 'Traction',
                              team: 'Team',
                              terms: 'Terms',
                            };
                            const human = labelMap[chip]
                              ?? chip
                                .replace(/_/g, ' ')
                                .replace(/\b\w/g, (m: string) => m.toUpperCase());
                            return (
                              <span
                                key={chip}
                                title={chip}
                                className={`px-2 py-1 rounded-full border text-xs ${darkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
                              >
                                {human}
                              </span>
                            );
                          })}
                        </div>
                        {!isAnalyst && missingChips.length > 3 && (
                          <button
                            type="button"
                            onClick={() => setShowAllMissingChips((prev) => !prev)}
                            className={`mt-2 text-xs font-medium ${darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'}`}
                          >
                            {showAllMissingChips ? 'Show less' : `+${missingChips.length - 3} more`}
                          </button>
                        )}
                      </>
                    ) : (
                        <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No open items flagged.</div>
                    )}
                  </div>

                  {isAnalyst && scoreBreakdownSections.length > 0 && (
                    <>
                      <div className="mt-6" ref={scoreBreakdownAnchorRef}>
                        <div className="flex items-center justify-between gap-3">
                          <div className={`text-xs uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Score breakdown
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowScoreBreakdown((prev) => !prev)}
                            className={`flex items-center gap-1 text-xs font-medium ${darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'}`}
                          >
                            {showScoreBreakdown ? 'Hide' : 'Show'}
                            {showScoreBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>

                        {showScoreBreakdown && (
                          <div className={`mt-3 rounded-lg border ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
                            <ul className={`divide-y ${darkMode ? 'divide-white/10' : 'divide-gray-200'}`}>
                              {scoreBreakdownSections.map((section: any, idx: number) => {
                                const sectionKey = typeof section?.key === 'string'
                                  ? section.key
                                  : typeof section?.section_key === 'string'
                                    ? section.section_key
                                    : null;
                                const displayKey = sectionKey ?? `section-${idx}`;
                                const status = (section?.support_status as string) ?? 'weak';
                                const evidenceCount = typeof section?.evidence_count === 'number' ? section.evidence_count : 0;
                                const evidenceCountTotal = typeof section?.evidence_count_total === 'number' ? section.evidence_count_total : evidenceCount;
                                const evidenceCountLinked = typeof section?.evidence_count_linked === 'number'
                                  ? section.evidence_count_linked
                                  : Array.isArray(section?.evidence_ids)
                                    ? section.evidence_ids.length
                                    : evidenceCount;
                                const supportReason = typeof section?.support_reason === 'string' ? section.support_reason : null;
                                const truncatedSupportReason = supportReason
                                  ? (supportReason.length > 140 ? `${supportReason.slice(0, 137)}...` : supportReason)
                                  : null;
                                const coveragePct = evidenceCountTotal > 0
                                  ? Math.round(
                                      Math.min(
                                        1,
                                        typeof section?.coverage_pct === 'number'
                                          ? section.coverage_pct / 100
                                          : typeof section?.trace_coverage_pct === 'number'
                                            ? section.trace_coverage_pct
                                            : evidenceCountLinked / evidenceCountTotal
                                      ) * 100
                                    )
                                  : null;
                                const missingReasons = Array.isArray(section?.missing_reasons) ? section.missing_reasons : [];
                                const hint = typeof section?.hint === 'string' ? section.hint : null;
                                const labelMap: Record<string, string> = {
                                  market: 'Market',
                                  product: 'Product',
                                  business_model: 'Business model',
                                  traction: 'Traction',
                                  risks: 'Risks',
                                  team: 'Team',
                                };
                                const badgeClass = (() => {
                                  if (status === 'supported') return darkMode ? 'bg-emerald-500/10 text-emerald-200 border-emerald-400/40' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                                  if (status === 'weak') return darkMode ? 'bg-amber-500/10 text-amber-200 border-amber-400/40' : 'bg-amber-50 text-amber-800 border-amber-200';
                                  return darkMode ? 'bg-red-500/10 text-red-200 border-red-400/40' : 'bg-red-50 text-red-700 border-red-200';
                                })();
                                return (
                                  <li
                                    key={`score-breakdown-${displayKey}`}
                                    className={`px-3 py-3 cursor-pointer ${darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}
                                    onClick={() => handleScoreBreakdownClick(section, sectionKey)}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                            <div className="flex items-center gap-2">
                                              <div className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                                {labelMap[displayKey] ?? displayKey}
                                              </div>
                                              {truncatedSupportReason && (
                                                <span
                                                  className={`text-[10px] px-2 py-0.5 rounded-full border ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}
                                                  title={truncatedSupportReason}
                                                >
                                                  Why
                                                </span>
                                              )}
                                            </div>
                                        <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                          Trace coverage: {evidenceCountLinked}/{evidenceCountTotal ?? '—'}{coveragePct != null ? ` (${coveragePct}%)` : ''}
                                        </div>
                                        {missingReasons.length > 0 && (
                                          <div className={`text-xs mt-1 ${darkMode ? 'text-red-200' : 'text-red-700'}`}>
                                            Missing: {missingReasons.join(' · ')}
                                          </div>
                                        )}
                                        {hint && (
                                          <div className={`text-xs mt-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            {hint}
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {section?.mismatch && (
                                          <span className={`px-2 py-1 rounded-full border text-[10px] font-medium ${darkMode ? 'border-amber-400/60 text-amber-200' : 'border-amber-300 text-amber-700'}`}>
                                            Mismatch
                                          </span>
                                        )}
                                        <span className={`px-2 py-1 rounded-full border text-[11px] font-medium ${badgeClass}`}>
                                          {status === 'supported' ? 'Supported' : status === 'weak' ? 'Weak' : 'Missing'}
                                        </span>
                                      </div>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>

                      {import.meta.env.DEV && isAnalyst && (
                        <div className={`mt-4 rounded-lg border ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
                          <div className="flex items-center justify-between gap-3 p-3">
                            <div>
                              <div className={`text-[11px] uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                Dev only · Score trace debug
                              </div>
                              <div className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                Sections: {scoreBreakdownSections.length}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                variant="secondary"
                                darkMode={darkMode}
                                size="sm"
                                icon={<Clipboard className="w-4 h-4" />}
                                onClick={copyScoreTraceDebug}
                              >
                                Copy JSON
                              </Button>
                              <Button
                                variant="secondary"
                                darkMode={darkMode}
                                size="sm"
                                icon={showScoreTraceDebug ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                onClick={() => setShowScoreTraceDebug((prev) => !prev)}
                              >
                                {showScoreTraceDebug ? 'Hide debug' : 'Show debug'}
                              </Button>
                            </div>
                          </div>
                          {showScoreTraceDebug && (
                            <div className={`border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
                              <div className={`grid grid-cols-[1.2fr_1fr_0.9fr_1fr_0.9fr_1.6fr_0.8fr] gap-2 px-3 py-2 text-[11px] font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                <div>Section</div>
                                <div>Status</div>
                                <div>Mismatch</div>
                                <div>Linked / Total</div>
                                <div>Coverage</div>
                                <div>Missing reasons</div>
                                <div>Actions</div>
                              </div>
                              <div className={darkMode ? 'divide-white/10 divide-y' : 'divide-gray-200 divide-y'}>
                                {scoreBreakdownSections.map((section: any, idx: number) => {
                                  const sectionKey = typeof section?.section_key === 'string'
                                    ? section.section_key
                                    : typeof section?.key === 'string'
                                      ? section.key
                                      : `section-${idx}`;
                                  const statusRaw = typeof section?.support_status === 'string' ? section.support_status : 'unknown';
                                  const status = ['supported', 'weak', 'missing', 'unknown'].includes(statusRaw) ? statusRaw : 'unknown';
                                  const mismatch = Boolean(section?.mismatch);
                                  const linked = typeof section?.evidence_count_linked === 'number'
                                    ? section.evidence_count_linked
                                    : Array.isArray(section?.evidence_ids_linked)
                                      ? section.evidence_ids_linked.length
                                      : Array.isArray(section?.evidence_ids)
                                        ? section.evidence_ids.length
                                        : Array.isArray(section?.evidence_ids_sample)
                                          ? section.evidence_ids_sample.length
                                          : 0;
                                  const totalRaw = typeof section?.evidence_count_total === 'number'
                                    ? section.evidence_count_total
                                    : typeof section?.evidence_count === 'number'
                                      ? section.evidence_count
                                      : linked;
                                  const total = Number.isFinite(totalRaw) ? Math.max(0, totalRaw) : 0;
                                  const coveragePctRaw = typeof section?.coverage_pct === 'number'
                                    ? section.coverage_pct
                                    : typeof section?.trace_coverage_pct === 'number'
                                      ? section.trace_coverage_pct * 100
                                      : total > 0
                                        ? (linked / total) * 100
                                        : 0;
                                  const coveragePct = Math.min(100, Math.max(0, Math.round(coveragePctRaw)));
                                  const missingReasons = Array.isArray(section?.missing_link_reasons)
                                    ? section.missing_link_reasons
                                    : Array.isArray(section?.missing_reasons)
                                      ? section.missing_reasons
                                      : [];
                                  const missingDisplay = missingReasons
                                    .filter((r: unknown): r is string => typeof r === 'string' && r.trim().length > 0)
                                    .map((r: string) => r.trim())
                                    .filter((r: string, i: number, arr: string[]) => arr.indexOf(r) === i)
                                    .slice(0, 3)
                                    .join(' · ');
                                  const truncatedMissing = missingDisplay.length > 120 ? `${missingDisplay.slice(0, 117)}...` : missingDisplay;
                                  const idsPreview = (section?.evidence_ids_linked ?? section?.evidence_ids ?? section?.evidence_ids_sample ?? [])
                                    .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
                                    .slice(0, 3)
                                    .join(', ');
                                  const idsLabel = idsPreview || '—';
                                  const badgeClass = (() => {
                                    if (status === 'supported') return darkMode ? 'bg-emerald-500/10 text-emerald-200 border-emerald-400/40' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                                    if (status === 'weak') return darkMode ? 'bg-amber-500/10 text-amber-200 border-amber-400/40' : 'bg-amber-50 text-amber-800 border-amber-200';
                                    if (status === 'missing') return darkMode ? 'bg-red-500/10 text-red-200 border-red-400/40' : 'bg-red-50 text-red-700 border-red-200';
                                    return darkMode ? 'bg-gray-500/10 text-gray-200 border-gray-400/40' : 'bg-gray-50 text-gray-700 border-gray-200';
                                  })();

                                  return (
                                    <div
                                      key={`score-trace-debug-${sectionKey}-${idx}`}
                                      className={`grid grid-cols-[1.2fr_1fr_0.9fr_1fr_0.9fr_1.6fr_0.8fr] gap-2 px-3 py-2 text-xs ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}
                                    >
                                      <div className="flex flex-col gap-1 min-w-0">
                                        <div className="font-semibold truncate">{sectionKey}</div>
                                        <div className={`text-[11px] truncate ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                          IDs: {idsLabel}
                                        </div>
                                      </div>
                                      <div className="flex items-center">
                                        <span className={`px-2 py-1 rounded-full border text-[11px] font-medium ${badgeClass}`}>
                                          {status === 'supported' ? 'Supported' : status === 'weak' ? 'Weak' : status === 'missing' ? 'Missing' : 'Unknown'}
                                        </span>
                                      </div>
                                      <div className="flex items-center">
                                        {mismatch ? (
                                          <span className={`px-2 py-1 rounded-full border text-[11px] font-medium ${darkMode ? 'border-amber-400/60 text-amber-200' : 'border-amber-300 text-amber-700'}`}>
                                            Mismatch
                                          </span>
                                        ) : (
                                          <span className={`text-[11px] ${darkMode ? 'text-emerald-200' : 'text-emerald-700'}`}>Aligned</span>
                                        )}
                                      </div>
                                      <div className="flex flex-col text-sm">
                                        <span className="font-semibold">{linked}/{total}</span>
                                        <span className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>linked / counted</span>
                                      </div>
                                      <div className="text-sm font-semibold">{coveragePct}%</div>
                                      <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                        {truncatedMissing || '—'}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          darkMode={darkMode}
                                          onClick={() => handleScoreTraceDebugTrace(section, sectionKey)}
                                        >
                                          Trace
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className={`mt-4 p-4 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  Run analysis to populate score drivers.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="w-full max-w-full">
          <div
            data-testid="job-center"
            className={`w-full max-w-full min-w-0 backdrop-blur-xl border rounded-2xl p-4 sm:p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between gap-3 min-w-0">
              <div className="min-w-0">
                <div className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Job Center</div>
                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Track analyze jobs and backend progress. Polling runs while a job is active.
                </p>
                {reportMissing && (
                  <p className="text-xs text-amber-600 mt-1">Report not generated yet. Run analysis to create it.</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`px-3 py-1 rounded-full border text-xs font-medium ${severityBadgeClass(jobDisplay.severity)}`}>
                  {jobStatus ? jobDisplay.label : 'Idle'}
                </span>
                {jobDisplay.sublabel && (
                  <span className={`text-[11px] leading-tight ${severityTextClass(jobDisplay.severity)}`}>
                    {jobDisplay.sublabel}
                  </span>
                )}
              </div>
            </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 w-full max-w-full">
                <div className={`p-3 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/70 border-gray-200'}`}>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Active job</div>
                  <div className={`text-sm font-mono break-all overflow-hidden ${darkMode ? 'text-white' : 'text-gray-900'}`}>
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

              <div className={`mt-4 p-3 rounded-lg border w-full max-w-full min-w-0 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/70 border-gray-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Status detail</div>
                  {progressTimestamp && (
                    <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      Updated {new Date(progressTimestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
                <div className={`text-xs font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {progressStageLabel ?? (jobStatus ? jobDisplay.label : 'No active job')}
                </div>
                {typeof progressPercent === 'number' ? (
                  <div className="space-y-2">
                    <div className={`h-2 rounded-full overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                      <div
                        className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all"
                        style={{ width: `${Math.min(Math.max(progressPercent, 0), 100)}%` }}
                      />
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {progressPercent}% complete
                    </div>
                    {currentlyProcessingLine && (
                      <div className="min-w-0">
                        <div className={`text-xs break-words whitespace-pre-wrap overflow-hidden line-clamp-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Currently processing: {currentlyProcessingLine}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="min-w-0">
                    {currentlyProcessingLine ? (
                      <div className={`text-xs break-words whitespace-pre-wrap overflow-hidden line-clamp-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Currently processing: {currentlyProcessingLine}
                      </div>
                    ) : (
                      renderSafeJobMessage('job-center-status-message', progressMessage || jobDisplay.sublabel || 'Waiting for worker update...', {
                        testId: 'job-center-status-message',
                      })
                    )}
                  </div>
                )}
                {jobStatus === 'queued' && jobQueuedSeconds >= queuedWarningThresholdSec && (
                  <div
                    className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                      darkMode
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    Still queued after {jobQueuedSeconds}s. If this persists, the worker may not be running or may be pointed at a different Redis/DB.
                  </div>
                )}
              </div>

              <div className={`mt-4 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/70 border-gray-200'}`}>
                {dealJobsError ? (
                  <div className={`p-3 text-xs ${darkMode ? 'text-red-300' : 'text-red-700'}`}>{dealJobsError}</div>
                ) : (
                  <Accordion
                    darkMode={darkMode}
                    defaultOpenItems={[]}
                    className="px-3"
                    items={[
                      {
                        id: 'recent_jobs',
                        title: 'Recent jobs',
                        badge: (() => {
                          const totalParents = (dealJobs ?? []).filter((j) => !j?.parent_job_id).length;
                          const shown = recentParentJobs.length;
                          const running = recentParentJobs.filter((j) => isRunningStatus(j.status)).length;
                          const failed = recentParentJobs.filter((j) => String(j.status ?? '').toLowerCase() === 'failed').length;
                          const done = recentParentJobs.filter((j) => String(j.status ?? '').toLowerCase() === 'succeeded').length;
                          const base = totalParents > 0 ? `${shown}/${totalParents}` : String(shown);
                          if (shown === 0) return base;
                          return `${base}${running ? ` • ${running}R` : ''}${failed ? ` • ${failed}F` : ''}${done ? ` • ${done}D` : ''}`;
                        })(),
                        content: recentParentJobs.length === 0 ? (
                          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>No jobs yet.</div>
                        ) : (
                          <div className={`divide-y ${darkMode ? 'divide-white/10' : 'divide-gray-200'}`}>
                            {recentParentJobs.map((row) => {
                              const children = childrenByParentJobId.get(row.job_id) ?? [];
                              const hasChildren = children.length > 0;

                              const agg = (() => {
                                if (!hasChildren) {
                                  return {
                                    status: row.status,
                                    current: row.progress_current,
                                    total: row.progress_total,
                                    pct: row.progress_pct,
                                  };
                                }

                                const totals = children
                                  .map((c) => ({
                                    current: typeof c.progress_current === 'number' ? c.progress_current : null,
                                    total: typeof c.progress_total === 'number' ? c.progress_total : null,
                                    pct: typeof c.progress_pct === 'number' ? c.progress_pct : null,
                                    status: c.status,
                                  }))
                                  .filter(Boolean);

                                const currentSum = totals.reduce((acc, t) => acc + (typeof t.current === 'number' ? t.current : 0), 0);
                                const totalSum = totals.reduce((acc, t) => acc + (typeof t.total === 'number' ? t.total : 0), 0);

                                const status = (() => {
                                  const st = totals.map((t) => String(t.status ?? '').toLowerCase());
                                  if (st.some((s) => s === 'failed')) return 'failed';
                                  if (st.every((s) => s === 'succeeded' || s === 'succeeded_with_warnings')) {
                                    return st.some((s) => s === 'succeeded_with_warnings') ? 'succeeded_with_warnings' : 'succeeded';
                                  }
                                  if (st.some((s) => s === 'running' || s === 'retrying')) return 'running';
                                  if (st.some((s) => s === 'queued')) return 'queued';
                                  return row.status;
                                })();

                                return {
                                  status,
                                  current: totalSum > 0 ? currentSum : undefined,
                                  total: totalSum > 0 ? totalSum : undefined,
                                  pct: totalSum > 0 ? undefined : row.progress_pct,
                                };
                              })();

                              const title = formatJobTitle(row);
                              const stage = formatJobStage(row);
                              const pct = computePct(agg.current, agg.total, agg.pct);
                              const sev = jobSeverityFromStatus(agg.status);
                              const ts = formatJobTimestamp(row);
                              const detail = row.error || row.message;
                              const running = isRunningStatus(agg.status);

                              return (
                                <div key={row.job_id} className="py-2.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className={`text-xs font-medium truncate ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{title}</div>
                                      <div className={`text-[11px] truncate ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                        {stage}
                                        {hasChildren ? ` • ${children.length} chunk(s)` : ''}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {ts ? (
                                        <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{ts}</div>
                                      ) : null}
                                      <span className={`px-2 py-0.5 rounded-full border text-[11px] ${severityBadgeClass(sev)}`}>
                                        {agg.status && String(agg.status).toLowerCase() === 'succeeded' ? 'Done' : agg.status && String(agg.status).toLowerCase() === 'failed' ? 'Failed' : running ? 'Running' : fullProcessStepLabel(agg.status)}
                                      </span>
                                      {running && pct != null ? (
                                        <div className={`text-[11px] font-mono ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{pct}%</div>
                                      ) : null}
                                    </div>
                                  </div>

                                  {running && pct != null ? (
                                    <div className="mt-2">
                                      <div className={`h-2 rounded-full overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                                        <div
                                          className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all"
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </div>
                                  ) : null}

                                  {detail ? (
                                    <div className="mt-1">
                                      {renderSafeJobMessage(`recent-job:${row.job_id}`, String(detail))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ),
                      },
                    ]}
                  />
                )}
              </div>

              {fullProcessUi && (
                <div className={`mt-4 p-3 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/70 border-gray-200'}`}>
                  {(() => {
                    const extractJobIdForRun = fullProcessRunExtractJobId;
                    const window = extractJobIdForRun ? getFullProcessRunWindowMs() : null;
                    const derivedAnalyze = window ? derivedAnalyzeForRun.job : null;
                    const treatAnalyzeAsPending = !!derivedAnalyze && derivedAnalyzeForRun.treatFailedAsPending;
                    const extractStep = fullProcessUi.steps.extract_visuals;
                    const extractStatus = String(extractStep?.status ?? '').toLowerCase();
                    const extractionInProgress = extractStatus === 'queued' || extractStatus === 'running' || extractStatus === 'retrying';
                    const derivedOk =
                      fullProcessUi.ok === false && treatAnalyzeAsPending
                        ? undefined
                        : fullProcessUi.ok === false && derivedAnalyze && isSucceededJobStatus(derivedAnalyze.status)
                          ? true
                          : fullProcessUi.ok;
                    const derivedError = derivedOk === true || treatAnalyzeAsPending ? null : fullProcessUi.error;

                    return (
                      <>
                  <div className="flex items-center justify-between gap-3">
                    <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Full process</div>
                    <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      {derivedOk === true ? 'Completed' : derivedOk === false ? 'Failed' : 'Running'}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(['reextract_documents', 'extract_visuals', 'analyze_deal'] as const).map((k) => {
                      const baseStep = fullProcessUi.steps[k];
                      const step =
                        k === 'analyze_deal' && derivedAnalyze
                          ? treatAnalyzeAsPending
                            ? {
                                ...baseStep,
                                status: 'pending' as any,
                                job_id: null,
                                progress_pct: null,
                                message: 'Preparing analysis…',
                                updated_at: derivedAnalyze.updated_at ?? baseStep.updated_at ?? null,
                              }
                            : {
                                ...baseStep,
                                status: String(derivedAnalyze.status ?? baseStep.status) as any,
                                job_id: derivedAnalyze.job_id,
                                progress_pct:
                                  typeof derivedAnalyze.progress_pct === 'number'
                                    ? derivedAnalyze.progress_pct
                                    : typeof baseStep.progress_pct === 'number'
                                      ? baseStep.progress_pct
                                      : null,
                                message: (derivedAnalyze.message ?? derivedAnalyze.error ?? baseStep.message ?? null) as any,
                                updated_at: derivedAnalyze.updated_at ?? baseStep.updated_at ?? null,
                              }
                          : k === 'analyze_deal' && !derivedAnalyze && extractionInProgress
                            ? {
                                ...baseStep,
                                status: 'pending' as any,
                                job_id: baseStep.job_id ?? null,
                                progress_pct: null,
                                message: 'Waiting for extraction to finalize…',
                              }
                          : baseStep;
                      const sev = fullProcessStepSeverity(step?.status);
                      const pct = typeof step?.progress_pct === 'number' ? step.progress_pct : null;
                      return (
                        <div
                          key={k}
                          data-testid={`full-process-step-${k}`}
                          className={`rounded-lg border px-3 py-2 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className={`text-xs font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{step?.label ?? k}</div>
                            <span className={`px-2 py-0.5 rounded-full border text-[11px] ${severityBadgeClass(sev)}`}>
                              {fullProcessStepLabel(step?.status)}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                            <div className={`text-[11px] font-mono ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              {step?.job_id ? `job ${step.job_id}` : 'job —'}
                            </div>
                            {pct != null ? (
                              <div className={`text-[11px] ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{Math.round(pct)}%</div>
                            ) : null}
                          </div>
                          {step?.message ? (
                            <div className="mt-1">
                              {renderSafeJobMessage(`full-process:${k}`, String(step.message))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {derivedError ? (
                    <div className={`mt-3 text-xs ${darkMode ? 'text-red-300' : 'text-red-700'}`}>{derivedError}</div>
                  ) : null}
                      </>
                    );
                  })()}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                {stageChips.map((stage) => (
                  <span
                    key={stage.id}
                    className={`px-3 py-1 rounded-full border text-xs ${severityBadgeClass(stage.severity)}`}
                  >
                    {stage.label}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-4">
                <Button
                  variant="secondary"
                  darkMode={darkMode}
                  icon={<Zap className="w-4 h-4" />}
                  onClick={runFullProcess}
                  loading={analyzing}
                >
                  {analyzing ? 'Working...' : 'Run full process'}
                </Button>
                {jobStatus && (
                  <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Auto-polling while a job is active (2–10s). Status updates when the job finishes.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Section */}

        {debugApiIsEnabled() && (
          <details
            className={`backdrop-blur-xl border rounded-2xl overflow-hidden ${
              darkMode
                ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
                : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
            }`}
          >
            <summary className={`px-4 py-3 cursor-pointer select-none text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              Debug → API Map <span className={`${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>({debugApiEntries.length} recent)</span>
            </summary>
            <div className={`px-4 pb-4 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {debugApiEntries.length === 0 ? (
                <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>No calls/events captured yet.</div>
              ) : (
                <div className="space-y-2">
                  {debugApiEntries.map((e, idx) => {
                    const time = new Date(e.ts).toLocaleTimeString();
                    if (e.kind === 'api') {
                      return (
                        <div
                          key={`${e.kind}-${e.ts}-${idx}`}
                          className={`rounded-lg border px-3 py-2 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <div className="font-mono">
                              {time} · {e.method} {e.path}
                            </div>
                            <div>
                              <span className="font-mono">{e.status}</span> · <span className="font-mono">{e.duration_ms}ms</span>
                              {e.dealId ? <span> · deal={e.dealId}</span> : null}
                            </div>
                          </div>
                          <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} mt-1`}>keys: {e.keys.join(', ') || '—'}{e.error ? ` · error: ${e.error}` : ''}</div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`${e.kind}-${e.ts}-${idx}`}
                        className={`rounded-lg border px-3 py-2 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <div className="font-mono">
                            {time} · SSE {e.event}
                          </div>
                          <div>
                            {e.dealId ? <span>deal={e.dealId}</span> : null}
                          </div>
                        </div>
                        <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} mt-1`}>
                          {e.keys ? `keys: ${e.keys.join(', ') || '—'}` : 'keys: —'}
                          {e.error ? ` · error: ${e.error}` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
        )}

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
                {dealId && (
                  <div className={`p-5 rounded-2xl border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                          Upload-first: Auto-profile
                        </div>
                        <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Review and edit before confirming. No canonical fields are written until you confirm.
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          darkMode={darkMode}
                          loading={autoProfileLoading}
                          onClick={handleAnalyzeAndAutofill}
                        >
                          Analyze & Autofill
                        </Button>
                        {showProfileEditor && (
                          <Button
                            variant="outline"
                            size="sm"
                            darkMode={darkMode}
                            onClick={() => setShowProfileEditor(false)}
                          >
                            Skip for now
                          </Button>
                        )}
                      </div>
                    </div>

                    {showProfileEditor && (
                      <div className="mt-4 space-y-3">
                        {(
                          [
                            { key: 'company_name', label: 'Company name' },
                            { key: 'deal_name', label: 'Deal name' },
                            { key: 'investment_type', label: 'Investment type' },
                            { key: 'round', label: 'Round' },
                            { key: 'industry', label: 'Industry' },
                          ] as const
                        ).map(({ key, label }) => {
                          const conf = autoProfileResult?.confidence?.[key];
                          const confLabel = getConfidenceLabel(conf);
                          const isLow = (typeof conf === 'number' ? conf : 0) < 0.5;
                          const proposed = autoProfileResult?.proposed_profile?.[key] ?? null;
                          const value = profileEdits[key] ?? '';
                          return (
                            <div key={key} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{label}</div>
                                <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                  Confidence: {confLabel}
                                </div>
                              </div>
                              <Input
                                darkMode={darkMode}
                                value={String(value)}
                                placeholder={isLow && !proposed ? "Couldn't infer confidently." : ''}
                                onChange={(e) =>
                                  setProfileEdits((prev) => ({
                                    ...prev,
                                    [key]: e.target.value.trim() ? e.target.value : null,
                                  }))
                                }
                              />
                            </div>
                          );
                        })}

                        {Array.isArray(autoProfileResult?.warnings) && autoProfileResult!.warnings.length > 0 && (
                          <div className={`text-xs rounded-md px-3 py-2 border ${darkMode ? 'border-white/10 text-gray-400 bg-black/10' : 'border-gray-200 text-gray-600 bg-gray-50'}`}>
                            {autoProfileResult!.warnings.join(' • ')}
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2 pt-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            darkMode={darkMode}
                            onClick={() => setShowProfileEditor(false)}
                          >
                            Skip for now
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            darkMode={darkMode}
                            onClick={handleConfirmProfile}
                          >
                            Confirm & Create Deal
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className={`text-sm mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Decision & Scoring
                      </h3>
                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                        Decision uses Phase 1 signals when available. Fundamentals score is v2 (presentation diagnostics excluded).
                      </div>
                    </div>
                    {fundabilityScore0_100 != null && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant={scoreSource === 'fundability_v1' ? 'outline' : 'secondary'}
                          size="sm"
                          darkMode={darkMode}
                          onClick={() => setScoreSource('legacy')}
                        >
                          Fundamentals
                        </Button>
                        <Button
                          variant={scoreSource === 'fundability_v1' ? 'secondary' : 'outline'}
                          size="sm"
                          darkMode={darkMode}
                          onClick={() => setScoreSource('fundability_v1')}
                        >
                          Fundability
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className={`rounded-xl border p-4 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Fundamentals score (v2)</div>
                      <div className={`mt-1 text-2xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {fundamentalsScore0_100 != null ? `${fundamentalsScore0_100}/100` : '—'}
                      </div>
                      <div className={`mt-1 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                        Source: Deal.score
                      </div>
                    </div>

                    <div className={`rounded-xl border p-4 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Decision</div>
                      <div className={`mt-1 text-2xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {decisionLabel}
                      </div>
                      <div className={`mt-1 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                        {decisionLabelSource === 'phase1_signals'
                          ? `Phase 1: ${phase1Score != null ? `${phase1Score}/100` : '—'}${phase1ConfidenceLabel ? ` · ${phase1ConfidenceLabel}` : ''}`
                          : 'No Phase 1 signals; derived from fundamentals score thresholds.'}
                      </div>
                    </div>

                    <div className={`rounded-xl border p-4 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Displayed score</div>
                      <div className={`mt-1 text-2xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {displayScore != null ? `${Math.round(displayScore)}/100` : '—'}
                      </div>
                      <div className={`mt-1 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                        {displayScoreLabel}
                      </div>
                    </div>
                  </div>
                </div>

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
                  {fundabilityV1 && typeof fundabilityV1 === 'object' && (
                    <>
                      <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Fundability (Analysis Foundation)
                      </h3>
                      <div className={`p-4 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                              Outcome: {(fundabilityV1?.fundability_decision_v1?.outcome ?? fundabilityV1?.fundability_assessment_v1?.outcome ?? '—') as any}
                            </div>
                            <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                              Phase: {(fundabilityV1?.phase_inference_v1?.company_phase ?? '—') as any}
                              {typeof fundabilityV1?.spec_version === 'string' && fundabilityV1.spec_version.trim() ? ` · Spec ${fundabilityV1.spec_version}` : ''}
                            </div>
                          </div>
                          <div className={`text-right ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            <div className="text-xs">Fundability score</div>
                            <div className="text-2xl font-semibold">
                              {typeof fundabilityV1?.fundability_assessment_v1?.fundability_score_0_100 === 'number'
                                ? Math.round(fundabilityV1.fundability_assessment_v1.fundability_score_0_100)
                                : '—'}
                            </div>
                          </div>
                        </div>

                        {Array.isArray(fundabilityV1?.fundability_assessment_v1?.reasons) && fundabilityV1.fundability_assessment_v1.reasons.length > 0 && (
                          <div className="mt-3">
                            <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Reasons</div>
                            <ul className={`list-disc pl-5 space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              {fundabilityV1.fundability_assessment_v1.reasons
                                .filter((r: any) => typeof r === 'string' && r.trim().length > 0)
                                .slice(0, 6)
                                .map((r: string, i: number) => (
                                  <li key={i}>{r}</li>
                                ))}
                            </ul>
                          </div>
                        )}

                        {Array.isArray(fundabilityV1?.fundability_decision_v1?.missing_required_signals) && fundabilityV1.fundability_decision_v1.missing_required_signals.length > 0 && (
                          <div className="mt-3">
                            <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Missing required signals</div>
                            <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              {fundabilityV1.fundability_decision_v1.missing_required_signals.slice(0, 6).join(' • ')}
                            </div>
                          </div>
                        )}

                        {Array.isArray(fundabilityV1?.fundability_decision_v1?.next_requests) && fundabilityV1.fundability_decision_v1.next_requests.length > 0 && (
                          <div className="mt-3">
                            <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Next requests</div>
                            <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              {fundabilityV1.fundability_decision_v1.next_requests.slice(0, 6).join(' • ')}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Executive Summary
                  </h3>
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
                    {Array.isArray(executiveSummaryV2?.paragraphs) && executiveSummaryV2.paragraphs.some((p: any) => typeof p === 'string' && p.trim().length > 0) ? (
                      <div className="space-y-3">
                        {executiveSummaryV2.paragraphs
                          .filter((p: any) => typeof p === 'string' && p.trim().length > 0)
                          .slice(0, 2)
                          .map((p: string, i: number) => (
                            <p key={i} className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              {p}
                            </p>
                          ))}

                        {Array.isArray(executiveSummaryV2?.highlights) && executiveSummaryV2.highlights.length > 0 ? (
                          <ul className={`list-disc pl-5 space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {executiveSummaryV2.highlights
                              .filter((h: any) => typeof h === 'string' && h.trim().length > 0)
                              .slice(0, 6)
                              .map((h: string, i: number) => (
                                <li key={i}>{h}</li>
                              ))}
                          </ul>
                        ) : null}

                        {Array.isArray(executiveSummaryV2?.missing) && executiveSummaryV2.missing.length > 0 ? (
                          <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                            Missing: {executiveSummaryV2.missing.filter((m: any) => typeof m === 'string' && m.trim().length > 0).slice(0, 12).join(', ')}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      typeof executiveSummaryV1?.summary === 'string' && executiveSummaryV1.summary.trim().length > 0 && !isProbablyOcrJunk(executiveSummaryV1.summary) ? (
                        <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {executiveSummaryV1.summary}
                        </p>
                      ) : (
                        <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Not available
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div>
                  <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Deal Overview (V2)
                  </h3>
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
                    {overviewV2 && typeof overviewV2 === 'object' ? (
                      <div className="space-y-2">
              {businessArchetypeV1 && typeof businessArchetypeV1 === 'object' && typeof businessArchetypeV1.value === 'string' && businessArchetypeV1.value.trim() ? (
                <div>
                  <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Business archetype</div>
                  <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    {businessArchetypeV1.value}
                    {typeof businessArchetypeV1.confidence === 'number' && Number.isFinite(businessArchetypeV1.confidence)
                      ? ` (${Math.round(businessArchetypeV1.confidence * 100)}%)`
                      : ''}
                  </div>
                </div>
              ) : null}
                        {typeof overviewV2.product_solution === 'string' && overviewV2.product_solution.trim() ? (
                          <div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Product</div>
                            <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{overviewV2.product_solution}</div>
                          </div>
                        ) : null}
                        {typeof overviewV2.market_icp === 'string' && overviewV2.market_icp.trim() ? (
                          <div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Market / ICP</div>
                            <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{overviewV2.market_icp}</div>
                          </div>
                        ) : null}
                        {typeof overviewV2.business_model === 'string' && overviewV2.business_model.trim() ? (
                          <div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Business model</div>
                            <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{overviewV2.business_model}</div>
                          </div>
                        ) : null}
                        {typeof overviewV2.raise === 'string' && overviewV2.raise.trim() ? (
                          <div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Raise</div>
                            <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{overviewV2.raise}</div>
                          </div>
                        ) : null}
            {dealSummaryV2 && typeof dealSummaryV2 === 'object' && (
              (
                typeof (dealSummaryV2 as any).summary === 'string' &&
                (dealSummaryV2 as any).summary.trim().length > 0
              ) ||
              (
                (dealSummaryV2 as any).summary &&
                typeof (dealSummaryV2 as any).summary === 'object' &&
                typeof (dealSummaryV2 as any).summary.one_liner === 'string' &&
                (dealSummaryV2 as any).summary.one_liner.trim().length > 0 &&
                Array.isArray((dealSummaryV2 as any).summary.paragraphs) &&
                (dealSummaryV2 as any).summary.paragraphs.length === 3
              )
            ) ? (
              <div>
              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>AI deal summary</div>
              {typeof (dealSummaryV2 as any).summary === 'string' ? (
                <div className={`text-sm leading-relaxed ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{(dealSummaryV2 as any).summary}</div>
              ) : (
                <div className="space-y-3">
                  {typeof (dealSummaryV2 as any).summary.one_liner === 'string' && (dealSummaryV2 as any).summary.one_liner.trim() ? (
                    <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{(dealSummaryV2 as any).summary.one_liner}</div>
                  ) : null}
                  {Array.isArray((dealSummaryV2 as any).summary.paragraphs)
                    ? (dealSummaryV2 as any).summary.paragraphs
                      .filter((p: any) => typeof p === 'string' && p.trim().length > 0)
                      .map((p: string, idx: number) => (
                        <p key={`deal-summary-v2-p-${idx}`} className={`text-sm leading-relaxed ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{p}</p>
                      ))
                    : null}
                </div>
              )}
                {Array.isArray((dealSummaryV2 as any).strengths) && (dealSummaryV2 as any).strengths.length > 0 ? (
                  <ul className={`mt-2 list-disc pl-5 space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {(dealSummaryV2 as any).strengths
                      .filter((x: any) => typeof x === 'string' && x.trim().length > 0)
                      .slice(0, 4)
                      .map((x: string, i: number) => (
                        <li key={`strength-${i}`}>{x}</li>
                      ))}
                  </ul>
                ) : null}
                {Array.isArray((dealSummaryV2 as any).risks) && (dealSummaryV2 as any).risks.length > 0 ? (
                  <ul className={`mt-2 list-disc pl-5 space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {(dealSummaryV2 as any).risks
                      .filter((x: any) => typeof x === 'string' && x.trim().length > 0)
                      .slice(0, 3)
                      .map((x: string, i: number) => (
                        <li key={`risk-${i}`}>{x}</li>
                      ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
                        {(
                          !(typeof overviewV2.product_solution === 'string' && overviewV2.product_solution.trim()) &&
                          !(typeof overviewV2.market_icp === 'string' && overviewV2.market_icp.trim()) &&
                          !(typeof overviewV2.business_model === 'string' && overviewV2.business_model.trim()) &&
                          !(typeof overviewV2.raise === 'string' && overviewV2.raise.trim())
                        ) ? (
                          <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Not available</div>
                        ) : null}
                      </div>
                    ) : (
                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Not available</div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Phase B Diagnostics
                  </h3>
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
                    {phaseBLatestRun ? (
                      phaseBFeatures ? (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                Latest features-only run
                              </div>
                              <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                {phaseBRunTimestampDisplay ?? 'Timestamp unavailable'} · v{phaseBVersion != null ? phaseBVersion : '—'}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 justify-end">
                              {phaseBContentDensityFlag && (
                                <span className={`px-2 py-1 rounded-full text-[11px] border ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`}>
                                  Content density: {phaseBContentDensityFlag}
                                </span>
                              )}
                              {phaseBSectionStructureScore != null && (
                                <span className={`px-2 py-1 rounded-full text-[11px] border ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`}>
                                  Structure: {phaseBSectionStructureScore}/100
                                </span>
                              )}
                            </div>
                          </div>

                          {phaseBBadges.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {phaseBBadges.map((badge) => (
                                <span
                                  key={badge}
                                  className={`px-2 py-1 rounded-full text-[11px] border ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`}
                                >
                                  {badge}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                            <div className={`${darkMode ? 'bg-white/5' : 'bg-white'} rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'} p-3`}>
                              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Docs</div>
                              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>{phaseBDocCount ?? '—'}</div>
                              <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>documents detected</div>
                            </div>
                            <div className={`${darkMode ? 'bg-white/5' : 'bg-white'} rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'} p-3`}>
                              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Pages / segments</div>
                              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>{phaseBPageCount ?? '—'}</div>
                              <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>for coverage</div>
                            </div>
                            <div className={`${darkMode ? 'bg-white/5' : 'bg-white'} rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'} p-3`}>
                              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Source coverage</div>
                              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                {phaseBSourceCoveragePct != null ? `${phaseBSourceCoveragePct}%` : '—'}
                              </div>
                              <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                docs with segments
                              </div>
                            </div>
                            <div className={`${darkMode ? 'bg-white/5' : 'bg-white'} rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'} p-3`}>
                              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Evidence density</div>
                              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                {phaseBEvidencePerVisual != null ? phaseBEvidencePerVisual.toFixed(1) : '—'}
                              </div>
                              <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                evidence per visual
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {phaseBActiveFlags.length > 0 ? phaseBActiveFlags.map((flag) => (
                              <span
                                key={flag}
                                className={`px-2 py-1 rounded-full text-[11px] border ${darkMode ? 'bg-red-500/10 border-red-500/30 text-red-200' : 'bg-red-50 border-red-200 text-red-700'}`}
                              >
                                {flag}
                              </span>
                            )) : (
                              <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                No flags from latest run.
                              </span>
                            )}
                            {phaseBVisualsCount != null && (
                              <span className={`px-2 py-1 rounded-full text-[11px] border ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`}>
                                Visuals: {phaseBVisualsCount}
                              </span>
                            )}
                            {phaseBEvidenceCount != null && (
                              <span className={`px-2 py-1 rounded-full text-[11px] border ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`}>
                                Evidence: {phaseBEvidenceCount}
                              </span>
                            )}
                          </div>

                          <div className="mt-4">
                            <div className={`text-xs mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              Findings
                            </div>
                            {phaseBFindings.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {phaseBFindings.map((finding) => (
                                  <span
                                    key={finding.code}
                                    className={`px-2 py-1 rounded-full text-[11px] border ${phaseBFindingClass(finding.severity)}`}
                                    title={finding.detail || undefined}
                                  >
                                    {finding.title}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                No findings flagged by deterministic rules.
                              </div>
                            )}
                          </div>

                          {phaseBActions.length > 0 && (
                            <div className="mt-4">
                              <div className={`text-xs mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                Suggested actions
                              </div>
                              <div className="space-y-2">
                                {phaseBActions.map((action) => (
                                  <div
                                    key={action.code}
                                    className={`${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'} rounded-lg border p-3`}
                                  >
                                    <div className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                      {action.title}
                                    </div>
                                    <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                      {action.why}
                                    </div>
                                    <ul className={`text-xs mt-2 list-disc pl-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                      {action.steps.map((step, idx) => (
                                        <li key={`${action.code}-step-${idx}`}>{step}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                <div className="mt-5">
                  <div className={`text-xs mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    Run history (last 3) · deltas vs prior run
                  </div>
                  {phaseBRunHistory.length > 0 ? (
                    <div className="space-y-2">
                      {phaseBRunHistory.map((run, idx) => {
                        const prev = phaseBRunHistory[idx + 1] ?? null;
                        const metrics = run.metrics;
                        const deltas = {
                          visuals: formatDelta(metrics.visualsCount, prev?.metrics.visualsCount, { decimals: 0 }),
                          evidence: formatDelta(metrics.evidenceCount, prev?.metrics.evidenceCount, { decimals: 0 }),
                          evidencePerVisual: formatDelta(metrics.evidencePerVisual, prev?.metrics.evidencePerVisual, { decimals: 1 }),
                          ocr: formatDelta(metrics.pctVisualsWithOcr, prev?.metrics.pctVisualsWithOcr, { isPercent: true }),
                          structured: formatDelta(metrics.pctVisualsWithStructured, prev?.metrics.pctVisualsWithStructured, { isPercent: true }),
                          segmentsWithVisuals: formatDelta(metrics.pctSegmentsWithVisuals, prev?.metrics.pctSegmentsWithVisuals, { isPercent: true }),
                        };
                        const deltaColor = (delta: string | null) => {
                          if (!delta || delta === '0') return darkMode ? 'text-gray-500' : 'text-gray-600';
                          return delta.startsWith('-') ? (darkMode ? 'text-red-300' : 'text-red-600') : (darkMode ? 'text-emerald-300' : 'text-emerald-700');
                        };
                        const renderMetric = (
                          label: string,
                          value: string,
                          delta: string | null,
                          alt: string
                        ) => (
                          <div className={`${darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'} rounded-md border p-2`}>
                            <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{label}</div>
                            <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>{value}</div>
                            <div className={`text-[11px] ${deltaColor(delta)}`}>
                              {prev ? (delta ? `Δ ${delta}` : 'Δ —') : alt}
                            </div>
                          </div>
                        );
                        return (
                          <div key={`phase-b-run-${run.key}`} className={`${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'} rounded-lg border p-3`}>
                            <div className="flex items-start justify-between gap-2 text-xs">
                              <div className={darkMode ? 'text-gray-300' : 'text-gray-800'}>
                                {run.timestampDisplay ?? 'Timestamp unavailable'}
                              </div>
                              <div className={darkMode ? 'text-gray-400' : 'text-gray-600'}>v{run.version ?? '—'}</div>
                            </div>
                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                              {renderMetric('Visuals', metrics.visualsCount != null ? String(metrics.visualsCount) : '—', deltas.visuals, 'Baseline')}
                              {renderMetric('Evidence', metrics.evidenceCount != null ? String(metrics.evidenceCount) : '—', deltas.evidence, 'Baseline')}
                              {renderMetric('Evidence/visual', metrics.evidencePerVisual != null ? metrics.evidencePerVisual.toFixed(1) : '—', deltas.evidencePerVisual, 'Baseline')}
                              {renderMetric('Visuals with OCR', metrics.pctVisualsWithOcr != null ? `${metrics.pctVisualsWithOcr}%` : '—', deltas.ocr, 'Baseline')}
                              {renderMetric('Visuals with structure', metrics.pctVisualsWithStructured != null ? `${metrics.pctVisualsWithStructured}%` : '—', deltas.structured, 'Baseline')}
                              {renderMetric('Segments with visuals', metrics.pctSegmentsWithVisuals != null ? `${metrics.pctSegmentsWithVisuals}%` : '—', deltas.segmentsWithVisuals, 'Baseline')}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Run history unavailable. Trigger another Phase B run to compare drift.
                    </div>
                  )}
                </div>

                          <div className="mt-4">
                            <div className={`text-xs mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              Coverage gaps / notes
                            </div>
                            {phaseBCoverageGaps.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {phaseBCoverageGaps.map((gap: string) => (
                                  <span
                                    key={gap}
                                    className={`px-2 py-1 rounded-full border text-xs ${darkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
                                  >
                                    {gap}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                No gaps flagged. Run Phase B in backend to refresh if inputs change.
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Phase B run found{phaseBVersion != null ? ` (v${phaseBVersion})` : ''}, but diagnostics were not stored. Re-run Phase B in backend to regenerate features.
                        </div>
                      )
                    ) : (
                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        No Phase B diagnostics yet. Run Phase B in backend.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Update Report
                  </h3>
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
                    {updateReportV1 && typeof updateReportV1 === 'object' ? (
                      <>
                        {typeof updateReportV1.summary === 'string' && updateReportV1.summary.trim() ? (
                          <div className={`text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{updateReportV1.summary}</div>
                        ) : null}
                        {Array.isArray((updateReportV1 as any).changed_fields) && (updateReportV1 as any).changed_fields.length > 0 ? (
                          <div className="space-y-1">
                            {(updateReportV1 as any).changed_fields.slice(0, 12).map((f: any, idx: number) => (
                              <div key={idx} className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{String(f)}</div>
                            ))}
                          </div>
                        ) : Array.isArray((updateReportV1 as any).changes) && (updateReportV1 as any).changes.length > 0 ? (
                          <div className="space-y-1">
                            {(updateReportV1 as any).changes.slice(0, 12).map((c: any, idx: number) => (
                              <div key={idx} className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {String(c?.field ?? c?.path ?? 'field')} · {String(c?.change_type ?? c?.type ?? 'updated')}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Not available</div>
                        )}
                      </>
                    ) : (
                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Not available</div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Key Metrics
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {keyMetricsCards.map((metric, i) => (
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
              <DocumentsTab dealId={dealId || 'demo'} darkMode={darkMode} reloadKey={documentsReloadKey} />
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
                onLocateVisualEvidenceNode={(visualAssetId) => {
                  const safeId = String(visualAssetId ?? '').trim();
                  if (!safeId) return;
                  setAnalystFocusNodeId(`evidence:${safeId}`);
                  setActiveTab('analyst');
                }}
                reportSections={Array.isArray(reportFromApi?.sections) ? reportFromApi!.sections!.map((s) => ({ title: s.title, evidence_ids: s.evidence_ids })) : []}
                documentTitles={documentTitles}
                scoreEvidence={phase1ScoreEvidenceForPanel}
                selectedScoreSectionKey={selectedScoreSectionKey}
                scoreBreakdownSections={scoreBreakdownSections}
                highlightedEvidenceIds={highlightedEvidenceIds}
                selectedScoreSectionMismatch={selectedScoreSectionMismatch}
                resolvedEvidence={resolvedEvidence}
                externalTraceMode={scoreTraceModeOverride}
                scoreTraceAudit={scoreTraceAudit}
              />
            )}

            {/* Analyst Mode Tab */}
            {activeTab === 'analyst' && (
              <DealAnalystTab
                key={analystReloadKey}
                dealId={dealId || 'demo'}
                darkMode={darkMode}
                focusNodeId={analystFocusNodeId}
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
					onRunAnalysis={runAIAnalysis}
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