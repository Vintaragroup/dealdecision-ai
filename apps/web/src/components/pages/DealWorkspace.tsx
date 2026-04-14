import { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, AccordionItem } from '../ui/accordion';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { ToastContainer, ToastType, useToastQueue } from '../ui/Toast';
import { DocumentsTab } from '../documents/DocumentsTab';
import { DealFormData } from '../Modal_Legacy/NewDealModal';
import { AnimatedCounter } from '../AnimatedCounter';
import { ExportReportModal } from '../ExportReportModal';
import { TemplateExportModal } from '../TemplateExportModal';
import { AnalysisTab } from '../workspace/AnalysisTab_v1';
import { DataTab } from '../workspace/DataTab';
import { DealAnalystTab } from '../deals/tabs/DealAnalystTab';
import { InvestorInsightsTab } from '../workspace/investor-insights/InvestorInsightsTab';
import { FinancialAuditTab } from '../workspace/financial-audit/FinancialAuditTab';
import { InvestmentQuestionsPanel } from '../workspace/InvestmentQuestionsPanel';
import { adaptReportToInsightsData } from '../../types/investor-insights';
import { ShareModal } from '../collaboration/ShareModal';
import { CommentsPanel } from '../collaboration/CommentsPanel';
import { AIDealAssistant } from '../workspace/AIDealAssistant';
import { DealWorkspaceHeader } from '../workspace/DealWorkspaceTopSection';
import { DealOverviewTab } from '../workspace/DealWorkspace_overviewTab_v3';
import { DealDeepDiveTab } from '../workspace/DealDeepDiveTab';
import { WorkspaceRedesignedShell } from '../workspace/WorkspaceRedesignedShell';
import { selectWorkspaceRedesignedShellProps } from '../../lib/selectors/selectWorkspaceRedesignedShellProps';
import { DealWorkspaceV4 } from '../workspace/DealWorkspaceV4';
import { FinancialCoveragePanel } from '../workspace/FinancialCoveragePanel';
import UploadDocModal from '../upload_doc_modal';
import { selectDealWorkspaceHeader } from '../../lib/selectDealWorkspaceHeader';
import { resolveCanonicalScore, type ResolvedScore } from '../../lib/resolveCanonicalScore';
import { resolveWorkspaceVerdict, type WorkspaceVerdict } from '../../lib/resolveWorkspaceVerdict';
import { selectAuthoritativeBusinessModelV1 } from '../../lib/selectors/selectAuthoritativeBusinessModelV1';
import { selectAuthoritativeProductSummaryV1 } from '../../lib/selectors/selectAuthoritativeProductSummaryV1';
import { selectAuthoritativeMarketSummaryV1 } from '../../lib/selectors/selectAuthoritativeMarketSummaryV1';
import { selectAuthoritativeFinancialCoverageV1 } from '../../lib/selectors/selectAuthoritativeFinancialCoverageV1';
import { selectAuthoritativeFinancialIntegrityV1 } from '../../lib/selectors/selectAuthoritativeFinancialIntegrityV1';
import { selectAuthoritativeFinancialBreakdownV1, selectAuthoritativeUnderwritingReadinessV1 } from '../../lib/selectors/selectAuthoritativeFinancialBreakdownV1';
import { selectAuthoritativeBurnV1 } from '../../lib/selectors/selectAuthoritativeBurnV1';
import { selectAuthoritativeRunwayV1 } from '../../lib/selectors/selectAuthoritativeRunwayV1';
import { selectDealWorkspaceOverviewModel } from '../../lib/selectors/selectDealWorkspaceOverviewModel';
import { selectDeterministicOverviewSlotsV1 } from '../../lib/selectors/selectDeterministicOverviewSlotsV1';
import { EvidencePanel, type ScoreSectionKey, type ScoreEvidencePayload } from '../evidence/EvidencePanel';
import { apiAutoProfileDeal, apiConfirmDealProfile, apiGetDeal, apiUpdateDeal, apiAutoProgressDeal, apiPostAnalyze, apiPostAnalyzeWithStatus, apiGetDealReadiness, apiPostExtractVisuals, apiPostReextractDocuments, apiGetJob, apiGetDealJobs, apiFetchEvidence, apiGetEvidence, apiGetDealReport, apiGetDealAnalysisDiagnostics, apiGetDealDeepDive, apiGetDocuments, apiResolveEvidence, subscribeToEvents, makeClientRequestId, type AutoProfileResponse, type DealReport, type DealReportEnvelope, type DealDeepDiveResponse, type EvidenceResolveResult, type JobUpdatedEvent, type ProposedDealProfile, type DealJobRowV2, type PageUnderstandingReadiness, type DealAnalysisDiagnosticsSnapshot } from '../../lib/apiClient';
import { useGovernedLlmOverview } from '../../hooks/useGovernedLlmOverview';
import { useInvestorInsights } from '../../hooks/useInvestorInsights';
import { useOrchestratorReport } from '../../hooks/useOrchestratorReport';
import type { JobProgressEventV1 } from '@dealdecision/contracts';
import { getPolicyFamily, getPolicyScoreSectionLabel, resolveSelectedPolicyIdFromAny } from '../../lib/policyUtils';
import { debugLogger } from '../../lib/debugLogger';
import { debugApiGetEntries, debugApiIsEnabled, debugApiSubscribe, type DebugApiEntry } from '../../lib/debugApi';
import { derivePhaseBInsights } from '../../lib/phaseb-findings';
import { buildOverlayViewModel } from '../../lib/overlay/overlayViewModel';
import { buildWorkspaceMirrorOverviewVM } from '../../lib/workspaceMirrorPr2ViewModel';
import { deterministicIsDisplayable } from '../../lib/deterministicDisplayPolicy';
import { applyPolicyAwareAdvisoryAsks, getRealEstateDealStructureFallback, selectBestRealEstateSemanticField } from '../../lib/realEstatePolicyRefinement';
import { CanonicalIdentityRenameBanner } from '../deal/CanonicalIdentityRenameBanner';
import { deriveGatingState, shouldSuppressNeedsReview } from '../../lib/badgePolicy';
import { useAsyncStaleGuard } from '../../lib/hooks/useAsyncStaleGuard';
import { useUserRole } from '../../contexts/UserRoleContext';
import { useScoreSource } from '../../contexts/ScoreSourceContext';
import { extractFundabilityScore0_100 } from '../../lib/dealScore';
import { filterMismatchedScoreItems, stripScoreFractions, stripScoreFractionsFromItems } from '../../lib/sanitizeScorePhrases';
import { buildWorkspaceViewModel } from '../workspace/builders/buildWorkspaceViewModel';
import type { WorkspaceViewModelInputs } from '../workspace/builders/buildWorkspaceViewModel';
import { WorkspaceDebugPanel } from '../workspace/WorkspaceDebugPanel';
import { Stage5IntelPanel } from '../workspace/Stage5IntelPanel';
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
  Loader2,
  Sparkles,
  Upload,
  Download,
  Share2,
  CheckCircle,
  XCircle,
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
  Edit,
  Terminal,
  Layers,
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
  // VC Scoring V2 — fetched at workspace level so the top header can show the VC posture.
  // AnalysisTab maintains its own independent call for the deeper analysis panel.
  const { data: headerOrchData } = useOrchestratorReport(dealId);
  const dealDataExt = dealData as DealFormDataExtras | null | undefined;

  const workspaceDebugEnabled = useMemo(() => {
    try {
      if (typeof window === 'undefined') return false;
      const qs = new URLSearchParams(window.location.search);
      if (qs.get('debug') === '1') return true;
      const raw = window.localStorage.getItem('ddai:debugDealWorkspace');
      return raw === '1' || raw === 'true';
    } catch {
      return false;
    }
  }, []);

  // reportBandScore: cached score_band_v2.overall_score from the analytical pipeline report.
  // Set in loadReport() via resolveCanonicalScore. NOT related to limited_scoring_v1 (Investor Insights).
  const [reportBandScore, setReportBandScore] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const { push: _pushToast } = useToastQueue();
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
  const [jobPollConnection, setJobPollConnection] = useState<{
    status: 'connected' | 'disconnected';
    consecutiveFailures: number;
    lastError: string | null;
  }>({ status: 'connected', consecutiveFailures: 0, lastError: null });
  const [jobPollNonce, setJobPollNonce] = useState(0);
  const [dealJobs, setDealJobs] = useState<DealJobRowV2[]>([]);
  const [dealJobsError, setDealJobsError] = useState<string | null>(null);
  type FullProcessStepKey = 'reextract_documents' | 'extract_visuals' | 'analyze_deal';
  type FullProcessStepStatus = 'pending' | 'queued' | 'running' | 'blocked' | 'succeeded' | 'succeeded_with_warnings' | 'failed' | 'cancelled';
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
  const [fullProcessLocked, setFullProcessLocked] = useState(false);
  const [evidence, setEvidence] = useState<Array<{ evidence_id: string; deal_id: string; document_id?: string; visual_asset_id?: string; source: string; kind: string; text: string; confidence?: number; created_at?: string }>>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const scoreBreakdownAnchorRef = useRef<HTMLDivElement | null>(null);
  const [lastEvidenceRefresh, setLastEvidenceRefresh] = useState<string | null>(null);
  const [documentTitles, setDocumentTitles] = useState<Record<string, string>>({});
  const [dealFromApi, setDealFromApi] = useState<any>(null);
  const [reportFromApi, setReportFromApi] = useState<DealReport | null>(null);
  const [reportMissing, setReportMissing] = useState<boolean>(false);
  const [reportEnvelope, setReportEnvelope] = useState<DealReportEnvelope | null>(null);
	const [analysisDiagnostics, setAnalysisDiagnostics] = useState<DealAnalysisDiagnosticsSnapshot | null>(null);
	const [analysisDiagnosticsStatus, setAnalysisDiagnosticsStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
	const [analysisDiagnosticsError, setAnalysisDiagnosticsError] = useState<string | null>(null);
  const [deepDiveResponse, setDeepDiveResponse] = useState<DealDeepDiveResponse | null>(null);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [deepDiveError, setDeepDiveError] = useState<string | null>(null);
  const deepDiveLoadedDealIdRef = useRef<string | null>(null);
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
  const fullProcessInFlightRef = useRef(false);
  const fullProcessRequestIdRef = useRef<string | null>(null);
  const lastDiagnosticsAttemptAtRef = useRef<number>(0);

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
              className={`text-xs underline ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
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

  type StageBadgeStatus = 'not_started' | 'running' | 'failed' | 'complete';

  const getLatestStageStatus = (
    rows: DealJobRowV2[] | null | undefined,
    jobType: string,
    opts?: { cutoffStageType?: string }
  ): { status: StageBadgeStatus; job: DealJobRowV2 | null } => {
    const arr = Array.isArray(rows) ? rows : [];

    let cutoffMs: number | null = null;
    const cutoffType = opts?.cutoffStageType;
    if (cutoffType) {
      const latestCutoff = arr
        .filter((r) => (r.type ?? '') === cutoffType)
        .sort((a, b) => parseJobSortTs(b) - parseJobSortTs(a))[0];
      const cutoffCandidateMs = parseIsoMs(latestCutoff?.created_at ?? null);
      cutoffMs = cutoffCandidateMs ?? null;
    }

    const candidates = arr.filter((r) => {
      if ((r.type ?? '') !== jobType) return false;
      if (cutoffMs == null) return true;
      const createdMs = parseIsoMs(r.created_at ?? null) ?? parseJobSortTs(r);
      return createdMs >= cutoffMs;
    });

    if (candidates.length === 0) {
      return { status: 'not_started', job: null };
    }

    const latest = [...candidates].sort((a, b) => parseJobSortTs(b) - parseJobSortTs(a))[0] ?? null;
    const status = latest
      ? isSucceededJobStatus(latest.status)
        ? 'complete'
        : isFailedJobStatus(latest.status)
          ? 'failed'
          : isRunningOrRetryingJobStatus(latest.status)
            ? 'running'
            : 'running'
      : 'not_started';

    return { status, job: latest };
  };

  // Full-process UX uses the extract_visuals job as the anchor for the run window.
  // (Alias kept for historical naming; `fullProcessExtractJobId` is the actual state.)
  const fullProcessRunExtractJobId = fullProcessExtractJobId;

  const pinnedJobRow = useMemo(() => {
    if (!jobId) return null;
    const rows = Array.isArray(dealJobs) ? dealJobs : [];
    return rows.find((r) => r.job_id === jobId) ?? null;
  }, [dealJobs, jobId]);

  const pinnedIsAnalyze = Boolean(pinnedJobRow && (pinnedJobRow.type ?? '') === 'analyze_deal');

  const derivedAnalyzeForRun = useMemo(() => {
    const extractJobIdForRun = fullProcessRunExtractJobId;
    const window = extractJobIdForRun ? getFullProcessRunWindowMs() : null;
    if (!window) {
      return { job: null as DealJobRowV2 | null, treatFailedAsPending: false };
    }

    const rows = Array.isArray(dealJobs) ? dealJobs : [];
    const best = selectAnalyzeJobInWindow(rows, window);
    const treatFailedAsPending =
      !!best &&
      (best.type ?? '') === 'analyze_deal' &&
      isFailedJobStatus(best.status) &&
      isSupersedableAnalyzeFailure(best) &&
      (isFullProcessActive || shouldTreatRunAnalyzeFailureAsPending({ extractFinishedAt: fullProcessExtractFinishedAt ?? null }));

    return { job: best, treatFailedAsPending };
  }, [dealJobs, fullProcessExtractCreatedAt, fullProcessExtractFinishedAt, fullProcessRunExtractJobId, isFullProcessActive]);

  const selectedAnalyzeJobForPinned = useMemo(() => {
    if (!pinnedIsAnalyze) return null;

    // If we're in the middle of a full-process run, follow the best analyze job in that run window.
    if (isFullProcessActive && fullProcessRunExtractJobId && derivedAnalyzeForRun.job) {
      return derivedAnalyzeForRun.job;
    }

    // Otherwise keep the pinned analyze job (if present), or fall back to the newest analyze job.
    if (pinnedJobRow) return pinnedJobRow;
    return selectBestAnalyzeJob(Array.isArray(dealJobs) ? dealJobs : [], jobId);
  }, [dealJobs, derivedAnalyzeForRun.job, fullProcessRunExtractJobId, isFullProcessActive, jobId, pinnedIsAnalyze, pinnedJobRow]);

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

  const delayedAnalyzeFailureToastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dealJobsRef = useRef<DealJobRowV2[]>([]);
  const fullProcessRunWindowRef = useRef<{ startMs: number; endMs: number } | null>(null);

  // Refs for volatile poll-interval state — updated every render so the deal-jobs
  // polling effect can read the latest values without restarting the interval on
  // every SSE-driven state change (jobStatus, jobType, isFullProcessActive, etc.).
  const dealJobsPollStateRef = useRef({
    isFullProcessActive: false,
    jobStatus: null as string | null,
    jobType: null as string | null,
    fullProcessExtractFinishedAt: null as string | null,
    fullProcessRunExtractJobId: null as string | null,
  });
  dealJobsPollStateRef.current = {
    isFullProcessActive,
    jobStatus,
    jobType,
    fullProcessExtractFinishedAt: fullProcessExtractFinishedAt ?? null,
    fullProcessRunExtractJobId: fullProcessRunExtractJobId ?? null,
  };

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
  /** Ratchet: tracks the highest analysis_version we have ever successfully requested or received.
   * desiredVersion will never go below this value, preventing v3→v1 regressions on SSE / error-fallback re-fetches. */
  const latestKnownVersionRef = useRef<number | null>(null);

  const [debugApiEntries, setDebugApiEntries] = useState<DebugApiEntry[]>(() => (debugApiIsEnabled() ? debugApiGetEntries() : []));

  const governedOverview = useGovernedLlmOverview(dealId);
  const investorInsights = useInvestorInsights(dealId ?? undefined);
  const [overlayPostAnalyzeState, setOverlayPostAnalyzeState] = useState<'idle' | 'polling' | 'timeout'>('idle');
  const overlayPostAnalyzeTimerRef = useRef<number | null>(null);
  const overlayPostAnalyzeStartedAtRef = useRef<number>(0);
  const overlayPostAnalyzeAttemptsRef = useRef<number>(0);
  // Dedup guard: track the last analyze job_id for which overlay polling was started.
  // Prevents repeated SSE delivery (or re-subscription) from spawning multiple polling cycles.
  const lastAnalyzedJobIdForOverlayRef = useRef<string | null>(null);
  const [showDeterministicAuthoritative, setShowDeterministicAuthoritative] = useState<boolean>(false);
  const deterministicToggleTouchedRef = useRef<boolean>(false);
  const [showGovernedOverlayPanel, setShowGovernedOverlayPanel] = useState<boolean>(true);
  const governedViewInitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!debugApiIsEnabled()) return;
    setDebugApiEntries(debugApiGetEntries());
    return debugApiSubscribe(() => {
      setDebugApiEntries(debugApiGetEntries());
    });
  }, []);

  useEffect(() => {
    // Reset view defaults per deal.
    governedViewInitRef.current = null;
    setShowDeterministicAuthoritative(false);
    setShowGovernedOverlayPanel(true);
    deterministicToggleTouchedRef.current = false;
  }, [dealId]);

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

  const { isStale, markKey } = useAsyncStaleGuard<string | null>(dealId ?? null);
  useEffect(() => {
    markKey(dealId ?? null);
  }, [dealId, markKey]);

  const loadReport = async (opts?: { force?: boolean; version?: number | null }) => {
    if (!dealId) {
      setReportFromApi(null);
      setReportEnvelope(null);
      return;
    }
    const keyAtStart = dealId;
    const now = Date.now();
    if (!opts?.force && now - lastReportAttemptAtRef.current < 8000) return;
    lastReportAttemptAtRef.current = now;

    const desiredVersion = (() => {
      const floor = latestKnownVersionRef.current;
      const v = opts?.version;
      if (typeof v === 'number' && Number.isFinite(v) && v >= 1) {
        const explicit = Math.trunc(v);
        // Never silently regress below the highest version we have positively observed.
        // A future user-version-picker would bypass this via a separate userSelectedVersionRef.
        return floor != null && floor > explicit ? floor : explicit;
      }
      const metaV = dioMeta?.dioAnalysisVersion;
      const fromMeta = typeof metaV === 'number' && Number.isFinite(metaV) && metaV >= 1 ? Math.trunc(metaV) : null;
      if (fromMeta !== null && floor !== null) return Math.max(fromMeta, floor);
      return fromMeta ?? floor ?? null;
    })();
    // Ratchet: record the requested version before the fetch so concurrent no-version calls
    // also benefit from the floor on their next invocation.
    if (desiredVersion != null && (latestKnownVersionRef.current == null || desiredVersion > latestKnownVersionRef.current)) {
      latestKnownVersionRef.current = desiredVersion;
    }
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[DDAI][loadReport:start]', {
        dealId,
        desiredVersion,
        latestKnownVersion: latestKnownVersionRef.current,
        dioMetaVersion: dioMeta?.dioAnalysisVersion ?? null,
      });
    }
    try {
      const envelope = await apiGetDealReport(dealId, { version: desiredVersion });
      if (isStale(keyAtStart)) return;
      setReportEnvelope(envelope);

      // Ratchet: update latestKnownVersionRef from the server-confirmed version.
      const _envelopeVersion = typeof (envelope as any)?.version === 'number' && Number.isFinite((envelope as any).version)
        ? Math.trunc((envelope as any).version as number)
        : null;
      if (_envelopeVersion != null && _envelopeVersion >= 1 &&
          (latestKnownVersionRef.current == null || _envelopeVersion > latestKnownVersionRef.current)) {
        latestKnownVersionRef.current = _envelopeVersion;
      }
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[DDAI][loadReport:received]', {
          dealId,
          fetchedVersion: _envelopeVersion,
          desiredVersion,
          latestKnownVersion: latestKnownVersionRef.current,
        });
      }

      const ready = Boolean((envelope as any)?.ready);
      const report = ready
        ? ((envelope as any)?.report && typeof (envelope as any).report === 'object' ? (envelope as any).report : (envelope as any))
        : null;

      // Treat { ready:false } as normal intermediate state.
      // Keep polling behavior driven by job state (not /report errors).
      reportMissingRef.current = !ready;
      if (isStale(keyAtStart)) return;
      setReportMissing(!ready);
      if (isStale(keyAtStart)) return;
      setReportFromApi((report && typeof report === 'object') ? (report as DealReport) : null);

      // Use the canonical resolver so reportBandScore (and thus fundamentalsScore0_100 /
      // decisionTileScore0_100) reflects the calibrated band score, not just overallScore.
      // Priority: score_band_v2.overall_score → overallScore → (no update).
      if (ready) {
        const { score: _canonicalForInvestor } = resolveCanonicalScore(report);
        if (_canonicalForInvestor != null) {
          if (isStale(keyAtStart)) return;
          setReportBandScore(_canonicalForInvestor);
        } else if (typeof (report as any)?.overallScore === 'number' && Number.isFinite((report as any).overallScore)) {
          if (isStale(keyAtStart)) return;
          setReportBandScore(Math.round((report as any).overallScore));
        }
      }
    } catch (err: any) {
      if (isStale(keyAtStart)) return;
      // Network / auth / server errors: keep report null but don't treat as "missing report".
      setReportFromApi(null);
    }
  };

  const loadDiagnostics = async (opts?: { force?: boolean }) => {
    if (!dealId) {
      setAnalysisDiagnostics(null);
      setAnalysisDiagnosticsStatus('idle');
      setAnalysisDiagnosticsError(null);
      return;
    }
    const keyAtStart = dealId;
    const now = Date.now();
    if (!opts?.force && now - lastDiagnosticsAttemptAtRef.current < 8000) return;
    lastDiagnosticsAttemptAtRef.current = now;

    if (isStale(keyAtStart)) return;
    setAnalysisDiagnosticsStatus('loading');
    if (isStale(keyAtStart)) return;
    setAnalysisDiagnosticsError(null);
    try {
      const res = await apiGetDealAnalysisDiagnostics(dealId);
      if (isStale(keyAtStart)) return;
      const diag = res && typeof res === 'object' ? (res as any).diagnostics : null;
      if (isStale(keyAtStart)) return;
      setAnalysisDiagnostics(diag && typeof diag === 'object' ? (diag as DealAnalysisDiagnosticsSnapshot) : null);
      if (isStale(keyAtStart)) return;
      setAnalysisDiagnosticsStatus('ready');
    } catch (err) {
      if (isStale(keyAtStart)) return;
      setAnalysisDiagnostics(null);
      if (isStale(keyAtStart)) return;
      setAnalysisDiagnosticsStatus('ready');
      if (isStale(keyAtStart)) return;
      setAnalysisDiagnosticsError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    }
  };

  const hasGovernedOverview = !!(governedOverview.overview && typeof governedOverview.overview === 'object');
  const governedQualityFlags = governedOverview.quality_flags ?? {};
  const governedOverlayDegraded = Boolean(
    governedQualityFlags.provider_error ||
    governedQualityFlags.model_output_not_json ||
    governedQualityFlags.guard_degraded
  );

  const workspaceMirrorVM = useMemo(() => {
    if (!hasGovernedOverview) return buildWorkspaceMirrorOverviewVM(null);
    return buildWorkspaceMirrorOverviewVM(governedOverview.overview);
  }, [hasGovernedOverview, governedOverview.overview]);

  const hasGovernedOverviewRef = useRef<boolean>(hasGovernedOverview);
  useEffect(() => {
    hasGovernedOverviewRef.current = hasGovernedOverview;
  }, [hasGovernedOverview]);

  const governedOverlaySignatureRef = useRef<{ created_at: string | null; input_hash: string | null }>({
    created_at: governedOverview.created_at ?? null,
    input_hash: governedOverview.input_hash ?? null,
  });
  useEffect(() => {
    governedOverlaySignatureRef.current = {
      created_at: governedOverview.created_at ?? null,
      input_hash: governedOverview.input_hash ?? null,
    };
  }, [governedOverview.created_at, governedOverview.input_hash]);

  const clearOverlayPostAnalyzeTimer = () => {
    if (overlayPostAnalyzeTimerRef.current != null) {
      window.clearTimeout(overlayPostAnalyzeTimerRef.current);
      overlayPostAnalyzeTimerRef.current = null;
    }
  };

  useEffect(() => {
    // Cleanup on unmount.
    return () => {
      clearOverlayPostAnalyzeTimer();
    };
  }, []);

  useEffect(() => {
    // Reset bounded polling when switching deals.
    clearOverlayPostAnalyzeTimer();
    overlayPostAnalyzeStartedAtRef.current = 0;
    overlayPostAnalyzeAttemptsRef.current = 0;
    lastAnalyzedJobIdForOverlayRef.current = null;
    setOverlayPostAnalyzeState('idle');
  }, [dealId]);

  const startOverlayPostAnalyzePolling = () => {
    if (!dealId) return;
    clearOverlayPostAnalyzeTimer();
    overlayPostAnalyzeStartedAtRef.current = Date.now();
    overlayPostAnalyzeAttemptsRef.current = 0;
    setOverlayPostAnalyzeState('polling');

    // Capture a baseline signature so we can stop once the overlay refreshes.
    // Important: the overlay may already exist, but the *new* overlay might not have
    // been persisted yet when the analyze job flips to succeeded.
    const baselineSig = {
      created_at: governedOverlaySignatureRef.current.created_at,
      input_hash: governedOverlaySignatureRef.current.input_hash,
    };

    // If overlay was missing at first load, the panel may be collapsed by default.
    // During the post-analysis window, prefer showing the overlay as soon as it becomes available.
    setShowGovernedOverlayPanel(true);

    const maxMs = 45_000;
    const maxAttempts = 8;

    const backoffMs = (attempt: number): number => {
      if (attempt <= 1) return 2000;
      if (attempt === 2) return 5000;
      if (attempt === 3) return 10000;
      return 15000;
    };

    const poll = async () => {
      try {
        await governedOverview.refresh({ force: true });
      } catch {
        // ignore; state will reflect missing/error
      }

      const curSig = governedOverlaySignatureRef.current;
      const overlayPresent = hasGovernedOverviewRef.current;
      const signatureChanged =
        (baselineSig.created_at == null && curSig.created_at != null) ||
        (baselineSig.input_hash == null && curSig.input_hash != null) ||
        (baselineSig.created_at != null && curSig.created_at != null && curSig.created_at !== baselineSig.created_at) ||
        (baselineSig.input_hash != null && curSig.input_hash != null && curSig.input_hash !== baselineSig.input_hash);

      // Stop polling once we can prove the persisted overlay changed.
      if (overlayPresent && signatureChanged) {
        clearOverlayPostAnalyzeTimer();
        setOverlayPostAnalyzeState('idle');
        return;
      }

      const elapsed = Date.now() - overlayPostAnalyzeStartedAtRef.current;
      const attempts = overlayPostAnalyzeAttemptsRef.current;
      if (elapsed > maxMs || attempts >= maxAttempts) {
        clearOverlayPostAnalyzeTimer();
        setOverlayPostAnalyzeState('timeout');
        return;
      }

      overlayPostAnalyzeAttemptsRef.current = attempts + 1;
      overlayPostAnalyzeTimerRef.current = window.setTimeout(() => {
        void poll();
      }, backoffMs(attempts + 1));
    };

    void poll();
  };

  const governedOverlayStatusUi: 'idle' | 'loading' | 'ready' | 'error' =
    governedOverview.status === 'loading'
      ? 'loading'
      : governedOverview.status === 'error'
        ? 'error'
        : governedOverview.status === 'idle'
          ? 'idle'
          : 'ready';

  const governedInterpretationText = (() => {
    const text = (governedOverview.overview as any)?.summary_text;
    return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
  })();

  const governedInterpretationClaims = useMemo(() => {
    const xs = (governedOverview.overview as any)?.claims;
    return Array.isArray(xs) ? xs : [];
  }, [governedOverview.overview]);

  const governedInterpretationDisclosures = useMemo(() => {
    const xs = (governedOverview.overview as any)?.disclosures;
    return Array.isArray(xs) ? xs : [];
  }, [governedOverview.overview]);

  const extractGovernedErrorCode = (meta: any): string | null => {
    if (!meta || typeof meta !== 'object') return null;
    const maybe =
      meta?.llm_overview_v1_error?.code ??
      meta?.llm_narration_v1_error?.code ??
      meta?.llm_overview_v1_error ??
      meta?.llm_narration_v1_error ??
      null;
    if (typeof maybe === 'string' && maybe.trim().length > 0) return maybe.trim();
    if (maybe && typeof maybe === 'object' && typeof (maybe as any).code === 'string') return String((maybe as any).code);
    return null;
  };

  useEffect(() => {
    if (!dealId) return;
    if (governedViewInitRef.current === dealId) return;
    if (governedOverview.status === 'idle' || governedOverview.status === 'loading') return;

    const missing = !hasGovernedOverview;
    const degraded = governedOverlayDegraded;
    const shouldDefaultDeterministic = missing || degraded || governedOverview.status === 'error';

    setShowDeterministicAuthoritative(shouldDefaultDeterministic);
    // If the overlay is degraded, keep it available but collapsed by default.
    setShowGovernedOverlayPanel(!missing && !degraded);
    governedViewInitRef.current = dealId;
  }, [dealId, governedOverview.status, hasGovernedOverview, governedOverlayDegraded]);

  const prevHasGovernedOverviewRef = useRef<boolean>(hasGovernedOverview);
  useEffect(() => {
    const prev = prevHasGovernedOverviewRef.current;
    prevHasGovernedOverviewRef.current = hasGovernedOverview;

    if (!dealId) return;
    if (deterministicToggleTouchedRef.current) return;

    // Overlay-first UX: if overlay becomes available after initial render,
    // auto-close deterministic (unless the user explicitly opened it).
    if (!prev && hasGovernedOverview && !governedOverlayDegraded && governedOverview.status !== 'error') {
      setShowDeterministicAuthoritative(false);
    }
  }, [dealId, hasGovernedOverview, governedOverlayDegraded, governedOverview.status]);

  useEffect(() => {
    // If the overlay becomes available (and is not degraded), ensure the panel is visible.
    // In non-degraded mode, users have no explicit "hide" control.
    if (!dealId) return;
    if (!hasGovernedOverview) return;
    if (governedOverlayDegraded) return;
    setShowGovernedOverlayPanel(true);
  }, [dealId, hasGovernedOverview, governedOverlayDegraded]);

  const reportReady = Boolean((reportEnvelope as any)?.ready);
  const reportVersion = (() => {
    const v = (reportEnvelope as any)?.version;
    return typeof v === 'number' && Number.isFinite(v) ? v : (dioMeta?.dioAnalysisVersion ?? null);
  })();

  const lastReportReadyRef = useRef<boolean | null>(null);
  const lastReportVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (!dealId) return;

    const prevReady = lastReportReadyRef.current;
    const prevVersion = lastReportVersionRef.current;
    const nextReady = reportReady;
    const nextVersion = typeof reportVersion === 'number' ? reportVersion : null;

    if (prevReady === false && nextReady === true) {
      console.info('[DDAI][report]', { event: 'ready_transition', dealId, version: nextVersion });
    }
    if (prevVersion != null && nextVersion != null && prevVersion !== nextVersion) {
      console.info('[DDAI][report]', { event: 'version_change', dealId, from: prevVersion, to: nextVersion });
    }

    lastReportReadyRef.current = nextReady;
    lastReportVersionRef.current = nextVersion;
  }, [dealId, reportReady, reportVersion]);

  const reportArtifact = (reportEnvelope as any)?.artifact as any;
  const reportEvidenceIds = useMemo(() => {
    const sections = (reportFromApi as any)?.sections;
    if (!Array.isArray(sections)) return [] as string[];
    const ids = sections
      .flatMap((s: any) => (Array.isArray(s?.evidence_ids) ? s.evidence_ids : []))
      .filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v: string) => v.trim());
    return Array.from(new Set(ids)).slice(0, 50);
  }, [reportFromApi]);

  const reportCycleNumber = useMemo(() => {
    const meta = (reportFromApi as any)?.metadata;
    if (!meta || typeof meta !== 'object') return null;
    const raw = (meta as any)?.cycle_number ?? (meta as any)?.cycleNumber ?? (meta as any)?.cycle;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [reportFromApi]);

  const lastAnalyzeJob = useMemo(() => {
    const rows = Array.isArray(dealJobs) ? dealJobs : [];
    return selectBestAnalyzeJob(rows, pinnedIsAnalyze ? jobId : null);
  }, [dealJobs, jobId, pinnedIsAnalyze]);
  // Fetch the actual deal from API
  useEffect(() => {
    if (!dealId) {
      setDealFromApi(null);
      setReportFromApi(null);
      return;
    }

    // Avoid showing stale report-derived tiles when switching deals.
    setReportFromApi(null);
    setReportEnvelope(null);
    setReportMissing(false);
    reportMissingRef.current = false;
    lastReportAttemptAtRef.current = 0;

    let active = true;
    apiGetDeal(dealId)
      .then((deal) => {
        if (!active) return;
        setDealFromApi(deal);
        debugLogger.logAPIData('DealWorkspace', 'dealFromApi', deal, `Fetched via apiGetDeal(${dealId})`);
        const nextMeta = {
          dioVersionId: (deal as any).dioVersionId,
          dioStatus: (deal as any).dioStatus,
          lastAnalyzedAt: (deal as any).lastAnalyzedAt,
          dioRunCount: (deal as any).dioRunCount,
          dioAnalysisVersion: (deal as any).dioAnalysisVersion,
        };
        setDioMeta(nextMeta);

        // Always bind the compiled report to the same DIO version shown in the header.
        const v = nextMeta.dioAnalysisVersion;
        loadReport({ force: true, version: typeof v === 'number' ? v : null }).catch(() => {});
      })
      .catch((err) => {
        if (!active) return;
        debugLogger.logMockData('DealWorkspace', 'dealFromApi', null, `API call failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        addToast('error', 'Failed to load deal', err instanceof Error ? err.message : 'Unknown error');

        // Fall back to the highest known version (or unversioned if unknown) to prevent v3→v1 regression.
        loadReport({ force: true, version: latestKnownVersionRef.current ?? null }).catch(() => {});
      });

		loadDiagnostics({ force: true });

    return () => {
      active = false;
    };
  }, [dealId]);

  useEffect(() => {
    if (!dealId) return;
    if (!reportReady) return;
    loadDiagnostics();
  }, [dealId, reportReady]);

  useEffect(() => {
    setSelectedScoreSectionKey(null);
    setHighlightedEvidenceIds([]);
    setResolvedEvidence({});
    setSelectedScoreSectionMismatch(false);
    setScoreTraceModeOverride(null);
    lastResolveEvidenceKeyRef.current = null;
  }, [dealId]);

  const lastResolveEvidenceKeyRef = useRef<string | null>(null);

  const displayFactsEvidenceIds = useMemo(() => {
    if (workspaceMirrorVM.missing) return [] as string[];
    const ids: string[] = [];
    const pushAll = (xs: unknown) => {
      if (!Array.isArray(xs)) return;
      for (const v of xs) {
        if (typeof v !== 'string') continue;
        const s = v.trim();
        if (!s) continue;
        ids.push(s);
      }
    };
    pushAll((workspaceMirrorVM.facts.product_solution as any)?.evidence_ids);
    pushAll((workspaceMirrorVM.facts.market_icp as any)?.evidence_ids);
    pushAll((workspaceMirrorVM.facts.business_model as any)?.evidence_ids);
    pushAll((workspaceMirrorVM.facts.raise as any)?.evidence_ids);
    return Array.from(new Set(ids)).slice(0, 100);
  }, [workspaceMirrorVM]);

  useEffect(() => {
    lastProgressKeyRef.current = null;
    setJobProgressSnapshot(null);
    setJobProgress(null);
    setJobMessage(null);
  }, [jobId]);

  useEffect(() => {
    const highlightedIds = (highlightedEvidenceIds ?? []).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const visibleEvidenceIds = (evidence ?? []).map((e) => e?.evidence_id).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const ids = Array.from(
      new Set(
        [...highlightedIds, ...visibleEvidenceIds, ...(displayFactsEvidenceIds ?? []), ...(reportEvidenceIds ?? [])]
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      )
    )
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 100);
    if (ids.length === 0) {
      setResolvedEvidence({});
      lastResolveEvidenceKeyRef.current = null;
      return;
    }

    const key = ids.join(',');
    if (lastResolveEvidenceKeyRef.current === key) return;
    lastResolveEvidenceKeyRef.current = key;

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
  }, [highlightedEvidenceIds, evidence, displayFactsEvidenceIds, reportEvidenceIds]);

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
        : reportBandScore,
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
  const selectedPolicyResolution = useMemo(() => {
    const fromDeal = resolveSelectedPolicyIdFromAny(dealFromApi as any);
    if (fromDeal.policyId) return { ...fromDeal, payload: 'deal' as const };
    const fromReport = resolveSelectedPolicyIdFromAny(reportFromApi as any);
    if (fromReport.policyId) return { ...fromReport, payload: 'report' as const };
    const fromEnvelope = resolveSelectedPolicyIdFromAny(reportEnvelope as any);
    if (fromEnvelope.policyId) return { ...fromEnvelope, payload: 'report_envelope' as const };
    return { ...fromEnvelope, payload: 'none' as const };
  }, [dealFromApi, reportFromApi, reportEnvelope]);
  const selectedPolicyId = selectedPolicyResolution.policyId;

  useEffect(() => {
    if (selectedPolicyResolution.source === 'not_found') {
      debugLogger.logFallbackData(
        'DealWorkspace',
        'selectedPolicyId',
        null,
        'No deterministic selected policy field found in deal/report/report_envelope payloads'
      );
      return;
    }
    if (selectedPolicyResolution.usedFallback) {
      debugLogger.logFallbackData(
        'DealWorkspace',
        'selectedPolicyId',
        selectedPolicyResolution.policyId,
        `Resolved via fallback source ${selectedPolicyResolution.source} from ${selectedPolicyResolution.payload}`
      );
      return;
    }
    debugLogger.logComputedData(
      'DealWorkspace',
      'selectedPolicyId',
      selectedPolicyResolution.policyId,
      `Resolved from ${selectedPolicyResolution.source} in ${selectedPolicyResolution.payload}`
    );
  }, [
    selectedPolicyResolution.policyId,
    selectedPolicyResolution.source,
    selectedPolicyResolution.payload,
    selectedPolicyResolution.usedFallback,
  ]);
  const policyFamily = useMemo(() => getPolicyFamily(selectedPolicyId), [selectedPolicyId]);
  const isStartupPolicySchema = policyFamily === 'startup' || policyFamily === 'other';

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
          return getPolicyScoreSectionLabel(selectedPolicyId, 'business_model');
        case 'traction':
          return getPolicyScoreSectionLabel(selectedPolicyId, 'traction');
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
    if (typeof reportBandScore === 'number' && Number.isFinite(reportBandScore)) return Math.round(reportBandScore);
    return null;
  })();
  const dioStatus = (dealFromApi as any)?.dioStatus ?? undefined;

  const fundabilityScore0_100 = extractFundabilityScore0_100(dealFromApi as any);
  const displayScoreSourceV1: 'fundamentals' | 'fundability_v1' =
    scoreSource === 'fundability_v1' && fundabilityScore0_100 != null ? 'fundability_v1' : 'fundamentals';

  // [VERDICT-CONTRACT] Single canonical workspace verdict — resolveWorkspaceVerdict
  // encapsulates the full priority chain so DealWorkspace has one decision path.
  // orchReport: headerOrchData already fetched at workspace level for the header tiles.
  // Passing it here wires canonical_decision (step 0) into the verdict resolver.
  const _workspaceVerdict = resolveWorkspaceVerdict({
    orchReport: headerOrchData ?? null,
    report: reportFromApi,
    score: fundamentalsScore0_100,
    phase1Signals: hasPhase1Signals
      ? { recommendation: recommendationRaw, score: phase1Score }
      : null,
  });
  const decisionLabel = _workspaceVerdict.verdict;

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
      : (decisionLabel === 'PASS' || decisionLabel === 'HARD_PASS')
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
  // [VERDICT-CONTRACT] decisionTileLabel is now derived from the same canonical resolver as
  // the workspace verdict — no separate threshold logic. Null score → '—' sentinel.
  const decisionTileScore0_100: number | null = fundamentalsScore0_100;
  const decisionTileLabel: WorkspaceVerdict | '—' =
    decisionTileScore0_100 != null ? _workspaceVerdict.verdict : '—';
  const decisionTileAccent = decisionTileLabel === 'FUND'
    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
    : decisionTileLabel === 'CONSIDER'
      ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
      : (decisionTileLabel === 'PASS' || decisionTileLabel === 'HARD_PASS')
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

  const decisionTileStrengthsFallback = [
    // legacy highlights remain available below as a fallback,
    // but the IC-memo overview prefers extracted structured facts + diagnostics.
    normalizeDecisionHighlight(decisionHighlights[0]),
    normalizeDecisionHighlight(decisionHighlights[1]),
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);

  const decisionScoreExplanation = (reportFromApi as any)?.metadata?.score_explanation as any;
  const deterministicScoreInputsV1 = (reportFromApi as any)?.metadata?.deterministic_score_inputs_v1 as any;
  // Conviction is compiler-owned and persisted in /report payload. Frontend must never recompute it.
  const convictionV1 = (() => {
    const direct = (reportFromApi as any)?.conviction_v1;
    if (direct && typeof direct === 'object') return direct;
    const nested = (reportEnvelope as any)?.report?.conviction_v1;
    if (nested && typeof nested === 'object') return nested;
    return null;
  })();

  const convictionPct = (v: unknown): string => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
    if (n == null) return '—';
    return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
  };

  const convictionScore = (v: unknown): string => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
    if (n == null) return '—';
    return `${Math.round(Math.max(0, Math.min(100, n)))}`;
  };

  const convictionDelta = (v: unknown): string => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
    if (n == null) return '—';
    return `${n > 0 ? '+' : ''}${Math.round(n)}`;
  };

  const bandToBadgeClasses = (band: 'high' | 'med' | 'low' | 'unknown') => {
    if (band === 'high') return darkMode ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (band === 'med') return darkMode ? 'bg-amber-500/10 text-amber-200 border-amber-500/20' : 'bg-amber-50 text-amber-700 border-amber-200';
    if (band === 'low') return darkMode ? 'bg-red-500/10 text-red-200 border-red-500/20' : 'bg-red-50 text-red-700 border-red-200';
    return darkMode ? 'bg-white/5 text-gray-200 border-white/10' : 'bg-gray-50 text-gray-700 border-gray-200';
  };

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

  // decisionScoreExplanation is defined above (used for IC memo + radar).

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

  const safeText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const s = value.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (isProbablyOcrJunk(s)) return '';
    return s;
  };

  // Like safeText, but preserves newlines so callers can keep paragraph breaks.
  // We still normalize CRLF and trim, and we run the OCR junk check on a
  // whitespace-collapsed version of the text.
  const safeTextPreserveNewlines = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const normalized = value.replace(/\r\n/g, '\n').trim();
    if (!normalized) return '';
    const collapsedForOcr = normalized.replace(/\s+/g, ' ').trim();
    if (!collapsedForOcr) return '';
    if (isProbablyOcrJunk(collapsedForOcr)) return '';
    return normalized;
  };

  // Company identity: structured summary first, then evidence-backed canonical identity, else placeholder.
  const canonicalIdentity = investorInsights.report?.render_package?.canonical_identity;
  const overlayCompanyName = safeText(canonicalIdentity?.canonical_company_name) || safeText(canonicalIdentity?.entered_name);
  const structuredCompanyName = safeText((reportFromApi as any)?.structured_summary?.company_name);
  const displayName = structuredCompanyName || overlayCompanyName || 'Unnamed Deal';
  const displayType = dealInfo?.type || dealData?.type || 'series-a';
  const displayScore: number | null = displayScoreSourceV1 === 'fundability_v1'
    ? (fundabilityScore0_100 != null ? Math.round(fundabilityScore0_100) : null)
    : fundamentalsScore0_100;
  const displayScoreLabel = displayScoreSourceV1 === 'fundability_v1' ? 'Fundability score' : 'Fundamentals score';

  const formatMoneyAmountOnly = (amount: number): string => {
    const v = typeof amount === 'number' && Number.isFinite(amount) ? amount : NaN;
    if (!Number.isFinite(v)) return '—';
    if (v >= 1e9) {
      const x = v / 1e9;
      const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
      return `$${s}B`;
    }
    if (v >= 1e6) {
      const x = v / 1e6;
      const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
      return `$${s}M`;
    }
    if (v >= 1e3) {
      const x = v / 1e3;
      const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
      return `$${s}K`;
    }
    return `$${Math.round(v).toLocaleString()}`;
  };

  const reportCanonicalRaise = useMemo(() => {
    const structuredRaise = (reportFromApi as any)?.structured_summary?.raise;
    const amountRaw = structuredRaise?.value_json?.amount?.amount;
    const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : null;
    if (amount == null) return { value: null as string | null, roundLabel: null as string | null };
    const roundLabel = safeText(structuredRaise?.round_label) || null;
    return { value: formatMoneyAmountOnly(amount), roundLabel };
  }, [reportFromApi]);

  // Deterministic structured summary deal summary (v1)
  // Canonical paths per spec:
  // - report.structured_summary.deal_summary_v1.one_liner
  // - report.structured_summary.deal_summary_v1.long_summary
  const structuredSummaryRoot = (
    ((reportFromApi as any)?.structured_summary && typeof (reportFromApi as any).structured_summary === 'object')
      ? (reportFromApi as any).structured_summary
      : (((reportEnvelope as any)?.report?.structured_summary && typeof (reportEnvelope as any).report.structured_summary === 'object')
          ? (reportEnvelope as any).report.structured_summary
          : null)
  );
  const structuredDealSummaryV1 = (structuredSummaryRoot && typeof structuredSummaryRoot === 'object')
    ? (structuredSummaryRoot as any).deal_summary_v1
    : null;
  // [SEPARATION] TopSection short summary = deterministic one_liner ONLY (never governed overlay hero_summary).
  // Reject sentinel placeholders that pass safeText() but are meaningless (e.g. LLM fallback strings).
  const _TOPSECTION_SENTINEL_PLACEHOLDERS = new Set(['unknown', 'n/a', 'not available', 'none', 'n/a.', 'unknown.']);
  const _filterSentinel = (s: string): string =>
    _TOPSECTION_SENTINEL_PLACEHOLDERS.has(s.toLowerCase().trim()) ? '' : s;

  // [SCORE-MECHANIC-FILTER] Phrases that expose INTERNAL scoring boilerplate — must never appear in
  // TopSection strengths/weaknesses. Intentionally narrow: only strips true engine noise, NOT
  // legitimate UX copy like "Provide benchmarkable KPIs" or "Insufficient unit economics data".
  const _SCORE_MECHANIC_RE = /pacing score|score computed|narrative pacing|score.*mechanic|analyzer scored|analyzer score used|neutral baseline/i;
  const structuredDealSummaryOneLiner =
    _filterSentinel(safeText((structuredDealSummaryV1 as any)?.one_liner)) ||
    _filterSentinel(safeText((structuredDealSummaryV1 as any)?.one_liner?.text));

  // [TOPSECTION-V1] Score-driver deterministic summary — answers "Why is the score X?"
  // This is the authority surface for TopSection.dealSummaryShort.
  // Design contract: TopSection = score-driver summary; Overview tab = company summary (governed).
  // NOTE: topSectionScoreDriverOneLiner (final, with client-side fallback) is defined AFTER
  // canonicalScoreView below so it can reference the canonical score for the fallback message.
  const topsectionV1 = (structuredSummaryRoot as any)?.topsection_v1 ?? null;
  const _topSectionScoreDriverOneLinerRaw = _filterSentinel(
    safeText(topsectionV1?.score_driver_one_liner),
  );
  const structuredDealSummaryLong = safeTextPreserveNewlines((structuredDealSummaryV1 as any)?.long_summary)
    || safeTextPreserveNewlines((structuredDealSummaryV1 as any)?.long_summary?.text);

  // Overview-tab wiring helpers (derived only from existing dealFromApi/dealData state; no new API calls)
  const overviewDealOneLiner = (() => {
    const v2Summary = (dealSummaryV2 as any)?.summary;
    if (v2Summary && typeof v2Summary === 'object') {
      const one = safeText((v2Summary as any)?.one_liner);
      if (one) return one;
    }

    if (typeof v2Summary === 'string') {
      const s = safeText(v2Summary);
      if (s) return s;
    }

    const v1One = safeText((executiveSummaryV1 as any)?.one_liner);
    if (v1One) return v1One;

    if (Array.isArray((executiveSummaryV2 as any)?.highlights)) {
      const first = (executiveSummaryV2 as any).highlights.find((h: any) => typeof h === 'string' && h.trim().length > 0);
      const s = safeText(first);
      if (s) return s;
    }

    if (v2Summary && typeof v2Summary === 'object') {
      const paras = Array.isArray((v2Summary as any)?.paragraphs) ? (v2Summary as any).paragraphs : [];
      const firstPara = safeText(paras.find((p: any) => typeof p === 'string' && p.trim().length > 0));
      if (firstPara) return firstPara;
    }

    if (Array.isArray((executiveSummaryV2 as any)?.paragraphs)) {
      const p = (executiveSummaryV2 as any).paragraphs.find((x: any) => typeof x === 'string' && x.trim().length > 0);
      const s = safeText(p);
      if (s) return s;
    }

    const v1 = safeText((executiveSummaryV1 as any)?.summary);
    if (v1) return v1;

    return 'Run analysis to generate a deal summary.';
  })();

  const overviewProduct =
    safeText(overviewV2?.product_solution) ||
    safeText((executiveSummaryV2 as any)?.product_solution) ||
    safeText((executiveSummaryV1 as any)?.product_solution) ||
    '—';

  const overviewMarketIcp =
    safeText(overviewV2?.market_icp) ||
    safeText((executiveSummaryV2 as any)?.market_icp) ||
    safeText((executiveSummaryV1 as any)?.market_icp) ||
    '—';

  const authoritativeBusinessModel = useMemo(() => {
    const phase1Raw = (dealFromApi as any)?.phase1;
    const phase1 = phase1Raw && typeof phase1Raw === 'object'
      ? phase1Raw
      : {
          deal_overview_v2: overviewV2 ?? null,
          executive_summary_v1: executiveSummaryV1 ?? null,
        };
    return selectAuthoritativeBusinessModelV1({ report: (reportFromApi as any) ?? null, phase1 });
  }, [dealFromApi, reportFromApi, overviewV2, executiveSummaryV1]);

  const overviewBusinessModel = authoritativeBusinessModel.value || '—';

  const overviewRaiseTerms =
    safeText(overviewV2?.raise) ||
    safeText((executiveSummaryV2 as any)?.raise) ||
    safeText((executiveSummaryV1 as any)?.raise) ||
    '—';

  const overviewDealSummaryParagraphs: string[] = (() => {
    const out: string[] = [];
    const v2Summary = (dealSummaryV2 as any)?.summary;
    if (v2Summary && typeof v2Summary === 'object') {
      const paras = Array.isArray((v2Summary as any)?.paragraphs) ? (v2Summary as any).paragraphs : [];
      for (const p of paras) {
        const s = safeText(p);
        if (s) out.push(s);
      }
    }

    if (out.length === 0 && Array.isArray((executiveSummaryV2 as any)?.paragraphs)) {
      for (const p of (executiveSummaryV2 as any).paragraphs) {
        const s = safeText(p);
        if (s) out.push(s);
      }
    }

    if (out.length === 0) {
      const v1 = safeText((executiveSummaryV1 as any)?.summary);
      if (v1) out.push(v1);
    }

    return out.slice(0, 6);
  })();

  // Deterministic deal_summary_v1 from /report (KPI-locked synthesis).
  // UI rule: use canonical only when *.ready=true; otherwise show deterministic degraded placeholder.
  const canonicalDealSummaryV1 = reportReady
    ? (
        (reportFromApi as any)?.deal_summary_v1 ??
        (reportFromApi as any)?.report?.deal_summary_v1 ??
        (reportFromApi as any)?.deal_summary ??
        (reportFromApi as any)?.report?.deal_summary ??
        null
      )
    : null;
  const canonicalDealSummaryReady = canonicalDealSummaryV1 && typeof canonicalDealSummaryV1 === 'object' && (canonicalDealSummaryV1 as any).ready === true;

  const authoritativeProductSummaryV1 = useMemo(() => {
    return selectAuthoritativeProductSummaryV1((reportFromApi as any) ?? null);
  }, [reportFromApi]);

  const authoritativeMarketSummaryV1 = useMemo(() => {
    return selectAuthoritativeMarketSummaryV1((reportFromApi as any) ?? null);
  }, [reportFromApi]);

  const authoritativeFinancialCoverageV1 = useMemo(() => {
    // financial_coverage_v1 is deterministic-only and lives on /report.
    return selectAuthoritativeFinancialCoverageV1((reportFromApi as any) ?? (reportEnvelope as any) ?? null);
  }, [reportFromApi, reportEnvelope]);

  const authoritativeFinancialIntegrityV1 = useMemo(() => {
    // financial_integrity_v1 lives on the compiled /report payload.
    return selectAuthoritativeFinancialIntegrityV1((reportFromApi as any) ?? null);
  }, [reportFromApi]);

  const authoritativeFinancialBreakdownV1 = useMemo(() => {
    return selectAuthoritativeFinancialBreakdownV1((reportFromApi as any) ?? null);
  }, [reportFromApi]);

  const authoritativeUnderwritingReadinessV1 = useMemo(() => {
    return selectAuthoritativeUnderwritingReadinessV1((reportFromApi as any) ?? null);
  }, [reportFromApi]);

  // Live staleness flag: true when financial_facts_v1 rows are newer than the compiled report snapshot.
  // Sourced from the envelope top-level (not from report), since it is computed fresh on every /report request.
  const financialSnapshotStale = useMemo(() => {
    return (reportEnvelope as any)?.financial_snapshot_stale === true;
  }, [reportEnvelope]);

  const authoritativeProductTextV1 = authoritativeProductSummaryV1.value ?? '';
  const authoritativeMarketTextV1 = authoritativeMarketSummaryV1.value ?? '';

  // PR22: deterministic Overview-tab fallback slots (from investor-insights render_package).
  // Used as a last-resort fallback when authoritative governed/structured-summary values are absent.
  const deterministicOverviewSlots = useMemo(() => {
    return selectDeterministicOverviewSlotsV1(investorInsights.report ?? null);
  }, [investorInsights.report]);

  const canonicalTiers = canonicalDealSummaryReady && (canonicalDealSummaryV1 as any)?.tiers && typeof (canonicalDealSummaryV1 as any).tiers === 'object'
    ? (canonicalDealSummaryV1 as any).tiers
    : null;

  const canonicalTierHero = canonicalDealSummaryReady ? safeText((canonicalTiers as any)?.hero) : '';
  const canonicalTierOverview = canonicalDealSummaryReady ? safeText((canonicalTiers as any)?.overview) : '';
  const canonicalTierDeep = canonicalDealSummaryReady ? safeText((canonicalTiers as any)?.deep) : '';

  const canonicalDealOneLiner = canonicalDealSummaryReady ? safeText((canonicalDealSummaryV1 as any)?.one_liner?.text) : '';
  const canonicalProduct = canonicalDealSummaryReady ? safeText((canonicalDealSummaryV1 as any)?.product?.text) : '';
  const canonicalMarket = canonicalDealSummaryReady
    ? (
        safeText((canonicalDealSummaryV1 as any)?.market_target?.text) ||
        safeText((canonicalDealSummaryV1 as any)?.market?.text) ||
        safeText((canonicalDealSummaryV1 as any)?.market_context?.text)
      )
    : '';
  const canonicalParagraphs: string[] = canonicalDealSummaryReady && Array.isArray((canonicalDealSummaryV1 as any)?.paragraphs)
    ? (canonicalDealSummaryV1 as any).paragraphs.map((p: any) => safeText(p?.text)).filter((s: string) => s.length > 0).slice(0, 6)
    : [];

  const canonicalCitations = canonicalDealSummaryReady
    ? {
        one_liner: Array.isArray((canonicalDealSummaryV1 as any)?.one_liner?.sources) ? (canonicalDealSummaryV1 as any).one_liner.sources : [],
        product: Array.isArray((canonicalDealSummaryV1 as any)?.product?.sources) ? (canonicalDealSummaryV1 as any).product.sources : [],
        market: Array.isArray((canonicalDealSummaryV1 as any)?.market?.sources) ? (canonicalDealSummaryV1 as any).market.sources : [],
        paragraphs: Array.isArray((canonicalDealSummaryV1 as any)?.paragraphs)
          ? (canonicalDealSummaryV1 as any).paragraphs
              .flatMap((p: any) => (Array.isArray(p?.sources) ? p.sources : []))
              .slice(0, 12)
          : [],
      }
    : null;

  const buildIcMemoOverviewV1 = (): {
    snapshot: string;
    supportsProceeding: string[];
    diligenceItems: string[];
    scoreRationale: string;
    advisoryRefinement: {
      source: 'original' | 'real_estate_refined';
      replacementApplied: boolean;
      suppressedStartupAsks: string[];
      injectedRealEstateAsks: string[];
    };
  } => {
    const safeNonEmpty = (v: unknown): string | null => {
      if (typeof v !== 'string') return null;
      const s = v.trim();
      if (!s || s === '—') return null;
      return s;
    };
    const uniq = (xs: Array<string | null | undefined>): string[] => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const x of xs) {
        const s = typeof x === 'string' ? x.trim() : '';
        if (!s) continue;
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
      }
      return out;
    };
    const isGenericReason = (reason: string): boolean => {
      const r = reason.trim().toLowerCase();
      if (!r) return true;
      if (r.includes('neutral baseline')) return true;
      if (r.includes('missing analyzer')) return true;
      if (r.includes('insufficient')) return true;
      if (r.includes('failed')) return true;
      if (r === 'analyzer score used') return true;
      if (r === 'neutral baseline used') return true;
      // Block internal score-mechanic phrases that should never surface in TopSection strengths.
      if (/pacing score|score computed|narrative pacing|computed.*score|score.*mechanic|analyzer.*scored/i.test(reason)) return true;
      return false;
    };

    const normalizeSemantic = (value: string): string =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const hasRealEstateLeakTerms = (value: string): boolean =>
      /\b(yield|cap\s*rate|noi|ltc|dscr|budget-based)\b/i.test(value);

    const localHasMalformedNumericPlaceholder = (value: string): boolean => {
      const s = value.trim();
      if (!s) return true;
      if (/^\$\s*[,.-]*\s*$/i.test(s)) return true;
      if (/^\$\s*[,.-]+\s*[kmbn]*$/i.test(s)) return true;
      return false;
    };

    // [CONTRACT: DataFlow_contract.md §2.2] deal_type MUST come only from report.metadata.score_explanation.context.deal_type.
    const dealTypeRaw = safeText(decisionScoreExplanation?.context?.deal_type) || '';
    const dealTypeNorm = dealTypeRaw.toLowerCase();
    const isStartupDealType = dealTypeNorm === 'startup_raise';
    const isRealEstateDealType = dealTypeNorm === 'real_estate_preferred_equity' || dealTypeNorm === 'real_estate' || policyFamily === 'real_estate';

    type LocalCandidate = { sourcePath: string; value: string };
    const pickLocal = (candidates: LocalCandidate[]): { value: string; sourcePath: string } => {
      for (const c of candidates) {
        const v = safeText(c.value);
        if (!v) continue;
        if (c.sourcePath.includes('raise') && localHasMalformedNumericPlaceholder(v)) continue;
        return { value: v, sourcePath: c.sourcePath };
      }
      return { value: '', sourcePath: 'missing' };
    };

    const dfv1Local = (governedOverview as any)?.overview?.overview_json?.display_facts_v1 ?? null;
    const phase1Local = (governedOverview as any)?.overview?.overview_json?.phase1 ?? null;

    // Hard source binding for hero summary semantics.
    const productPick = pickLocal([
      { sourcePath: 'overview_json.display_facts_v1.product_solution.text', value: safeText(dfv1Local?.product_solution?.text) },
      { sourcePath: 'overview_json.display_facts_v1.product.text', value: safeText(dfv1Local?.product?.text) },
      { sourcePath: 'overview_json.phase1.deal_overview_v2.product_solution', value: safeText(overviewV2?.product_solution) },
      { sourcePath: 'overview_json.phase1.deal_summary_v2.product.text', value: safeText((phase1Local?.deal_summary_v2 as any)?.product?.text) || safeText((dealSummaryV2 as any)?.product?.text) },
    ]);
    const marketPick = pickLocal([
      { sourcePath: 'overview_json.display_facts_v1.market_icp.text', value: safeText(dfv1Local?.market_icp?.text) },
      { sourcePath: 'overview_json.display_facts_v1.market.text', value: safeText(dfv1Local?.market?.text) },
      { sourcePath: 'overview_json.display_facts_v1.submarket.text', value: safeText(dfv1Local?.submarket?.text) },
      { sourcePath: 'overview_json.phase1.deal_overview_v2.market_icp', value: safeText(overviewV2?.market_icp) },
      { sourcePath: 'overview_json.phase1.deal_summary_v2.market.text', value: safeText((phase1Local?.deal_summary_v2 as any)?.market?.text) || safeText((dealSummaryV2 as any)?.market?.text) },
    ]);
    const businessModelPick = pickLocal([
      { sourcePath: 'overview_json.display_facts_v1.business_model.text', value: safeText(dfv1Local?.business_model?.text) },
      { sourcePath: 'overview_json.display_facts_v1.deal_structure.text', value: safeText(dfv1Local?.deal_structure?.text) },
      { sourcePath: 'overview_json.phase1.deal_overview_v2.business_model', value: safeText(overviewV2?.business_model) },
      { sourcePath: 'overview_json.phase1.deal_summary_v2.business_model', value: safeText((phase1Local?.deal_summary_v2 as any)?.business_model) || safeText((dealSummaryV2 as any)?.business_model) },
      { sourcePath: 'policy_resolved.overviewBusinessModel', value: safeText(overviewBusinessModel) },
    ]);
    const raisePick = pickLocal([
      { sourcePath: 'overview_json.display_facts_v1.raise_terms.text', value: safeText(dfv1Local?.raise_terms?.text) },
      { sourcePath: 'overview_json.display_facts_v1.raise.text', value: safeText(dfv1Local?.raise?.text) },
      { sourcePath: 'policy_resolved.reportCanonicalRaise', value: safeText(reportCanonicalRaise.value) },
      { sourcePath: 'overview_json.phase1.deal_overview_v2.raise', value: safeText(overviewV2?.raise) },
      { sourcePath: 'overview_json.phase1.deal_summary_v2.raise', value: safeText((phase1Local?.deal_summary_v2 as any)?.raise) || safeText((dealSummaryV2 as any)?.raise) },
      { sourcePath: 'policy_resolved.overviewRaiseTerms', value: safeText(overviewRaiseTerms) },
    ]);

    let productSolutionHero = productPick.value;
    let marketIcpHero = marketPick.value;

    if (isStartupDealType) {
      if (productSolutionHero && hasRealEstateLeakTerms(productSolutionHero)) productSolutionHero = '';
      if (marketIcpHero && hasRealEstateLeakTerms(marketIcpHero)) marketIcpHero = '';
    }

    if (productSolutionHero && marketIcpHero && normalizeSemantic(productSolutionHero) === normalizeSemantic(marketIcpHero)) {
      marketIcpHero = '';
    }

    const product = safeNonEmpty(productSolutionHero);
    const market = safeNonEmpty(marketIcpHero);

    const businessModel = safeNonEmpty(businessModelPick.value || overviewBusinessModel);
    const raise = safeNonEmpty(raisePick.value || reportCanonicalRaise.value || overviewRaiseTerms);

    const kpis: any[] = deterministicScoreInputsV1 && Array.isArray(deterministicScoreInputsV1.kpis)
      ? deterministicScoreInputsV1.kpis
      : [];

    const kpiByKey = new Map<string, any>(kpis
      .filter((k) => k && typeof k === 'object' && typeof k.key === 'string')
      .map((k) => [k.key, k]));

    const kpiLine = (key: 'revenue' | 'customers' | 'growth'): string | null => {
      const k = kpiByKey.get(key);
      if (!k) return null;
      const valueRaw = safeNonEmpty(k.value_raw);
      const conf = typeof k.confidence === 'number' && Number.isFinite(k.confidence) ? k.confidence : 0;
      const sources = Array.isArray(k.sources) ? k.sources : [];
      if (!valueRaw) return null;
      if (!(conf >= 0.55) || sources.length === 0) return null;
      if (key === 'revenue') return `Revenue KPI extracted: ${valueRaw}.`;
      if (key === 'customers') return `Customer KPI extracted: ${valueRaw}.`;
      return `Growth KPI extracted: ${valueRaw}.`;
    };

    const snapshotSentences: string[] = [];
    if (isRealEstateDealType) {
      if (product) snapshotSentences.push(`Asset / facility: ${product}.`);
      if (market) snapshotSentences.push(`Submarket / demand: ${market}.`);
    } else {
      if (product && market) snapshotSentences.push(`Company sells ${product} and targets ${market}.`);
      else if (product) snapshotSentences.push(`Company sells ${product}.`);
      else if (market) snapshotSentences.push(`Target market / ICP: ${market}.`);
    }

    if (businessModel) snapshotSentences.push(`Business model: ${businessModel}.`);
    if (raise) snapshotSentences.push(`Raise / terms: ${raise}.`);

    // Add factual financial snippets only when they’re actually extracted + sourced.
    const kpiSentences = uniq([
      kpiLine('revenue'),
      kpiLine('growth'),
      kpiLine('customers'),
    ]);
    snapshotSentences.push(...kpiSentences);

    const snapshot = snapshotSentences
      .filter((s) => s.length > 0)
      .slice(0, 4)
      .join(' ');

    // What supports proceeding: evidence-backed bullets only.
    const supports: string[] = [];
    if (isRealEstateDealType) {
      if (product) supports.push(`Asset / facility is explicitly described: ${product}.`);
      if (market) supports.push(`Submarket / demand is explicitly described: ${market}.`);
    } else {
      if (product) supports.push(`Product is explicitly described: ${product}.`);
      if (market) supports.push(`Target market / ICP is explicitly described: ${market}.`);
    }
    if (businessModel) supports.push(`Business model is stated: ${businessModel}.`);
    if (raise) supports.push(`Raise / terms are stated: ${raise}.`);

    // Prefer diagnostics-backed “strength reasons” when they’re non-generic.
    const compsObj = decisionScoreExplanation?.components && typeof decisionScoreExplanation.components === 'object'
      ? decisionScoreExplanation.components
      : null;
    const pushReason = (key: string) => {
      const r = safeNonEmpty(compsObj?.[key]?.reason);
      if (!r || isGenericReason(r)) return;
      supports.push(r);
    };
    if (compsObj) {
      pushReason('financial_health');
      pushReason('risk_assessment');
    }

    // Key risks / diligence items: combine coverage gaps + diagnostics + deterministic-score inputs.
    const diligence: string[] = [];
    const understanding = decisionScoreExplanation?.understanding_v1;
    const understandingItems: string[] = Array.isArray(understanding?.diligence_open_items)
      ? understanding.diligence_open_items
          .map((i: any) => safeNonEmpty(i?.text))
          .filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    diligence.push(...understandingItems);

    // Coverage chips are already deterministic “missing inputs” signals.
    diligence.push(
      ...missingChips
        .map(formatOpenItemLabel)
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0),
    );

    // Deterministic-score inputs: deck drift and override ratio become explicit diligence items.
    const drift = safeNonEmpty(deterministicScoreInputsV1?.deck?.drift_assessment);
    if (drift && drift !== 'aligned' && drift !== 'mostly_aligned') {
      diligence.push(`Deck/story drift flagged as '${drift}': confirm core investor questions are explicitly covered (problem, solution, market, traction, team, financials).`);
    }
    const overrideRatio = typeof deterministicScoreInputsV1?.segments?.override_ratio === 'number' && Number.isFinite(deterministicScoreInputsV1.segments.override_ratio)
      ? deterministicScoreInputsV1.segments.override_ratio
      : null;
    if (overrideRatio != null && overrideRatio >= 0.2) {
      diligence.push(`Extraction required many segment overrides (${Math.round(overrideRatio * 100)}%): confirm key numbers directly from primary financial tables.`);
    }

    // KPI confidence-driven diligence.
    const kpiNeedsConfirm = (key: 'revenue' | 'customers' | 'growth', label: string) => {
      const k = kpiByKey.get(key);
      const conf = typeof k?.confidence === 'number' && Number.isFinite(k.confidence) ? k.confidence : 0;
      const valueRaw = safeNonEmpty(k?.value_raw);
      const hasSources = Array.isArray(k?.sources) && k.sources.length > 0;
      if (!valueRaw || !hasSources || conf < 0.55) {
        diligence.push(`Confirm ${label} from multi-year financial tables (and document basis: cash vs accrual).`);
      }
    };
    kpiNeedsConfirm('revenue', 'revenue');
    kpiNeedsConfirm('growth', 'growth');

    const adjustment = typeof decisionScoreExplanation?.totals?.adjustment_factor === 'number' && Number.isFinite(decisionScoreExplanation.totals.adjustment_factor)
      ? decisionScoreExplanation.totals.adjustment_factor
      : null;
    const pinned = Boolean(decisionScoreExplanation?.totals?.unadjusted_pinned);
    if (pinned) {
      const missing = Array.isArray(decisionScoreExplanation?.totals?.unadjusted_missing_inputs)
        ? decisionScoreExplanation.totals.unadjusted_missing_inputs
        : [];
      if (missing.length > 0) {
        diligence.push(`Score pinned to baseline (50) until missing inputs are filled: ${missing.slice(0, 6).join('; ')}.`);
      }
    } else if (adjustment != null && adjustment < 0.4) {
      diligence.push('Evidence coverage is limited, so the score is blended toward neutral; add benchmarkable KPIs and runway inputs to increase conviction.');
    }

    const warningStrings: string[] = Array.isArray(decisionScoreExplanation?.totals?.warnings)
      ? decisionScoreExplanation.totals.warnings
          .map((w: any) => safeNonEmpty(w))
          .filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    for (const w of warningStrings.slice(0, 6)) {
      diligence.push(`Diagnostic warning: ${w}.`);
    }

    const score0_100 = decisionTileScore0_100;
    const scoreBand = score0_100 == null ? 'unknown' : score0_100 >= 70 ? 'positive' : score0_100 <= 40 ? 'negative' : 'neutral';
    const scoreRationale = (() => {
      if (decisionTileLabel === '—' || score0_100 == null) {
        return 'Recommendation pending: score will appear once sufficient information is available.';
      }

      const totals = decisionScoreExplanation?.totals;
      const coverageRatio = typeof totals?.coverage_ratio === 'number' && Number.isFinite(totals.coverage_ratio) ? totals.coverage_ratio : null;
      const dueDiligenceFactor = typeof totals?.due_diligence_factor === 'number' && Number.isFinite(totals.due_diligence_factor) ? totals.due_diligence_factor : null;

      const driverReasons = (() => {
        if (!compsObj) return [] as string[];
        return uniq([
          safeNonEmpty(compsObj?.financial_health?.reason),
          safeNonEmpty(compsObj?.risk_assessment?.reason),
        ]).filter((r) => !isGenericReason(r));
      })();
      const driverSentence = driverReasons.length > 0
        ? `Key drivers: ${driverReasons.slice(0, 2).join(' ')}.`
        : null;

      if (pinned) {
        return uniq([
          `Score rationale: ${decisionTileLabel} (${score0_100}/100). The system held the score at the neutral baseline (50) because score-bearing evidence was not usable; fill the open items to move off baseline.`,
          driverSentence,
        ]).join(' ');
      }
      if (scoreBand === 'neutral') {
        const parts = [`Score rationale: ${decisionTileLabel} (${score0_100}/100).`];
        parts.push('The score is near-neutral because evidence/verification coverage is limited and the system blends toward baseline rather than over-weighting sparse signals.');
        if (coverageRatio != null) parts.push(`Coverage ratio=${coverageRatio.toFixed(2)}.`);
        if (dueDiligenceFactor != null) parts.push(`Due diligence readiness=${dueDiligenceFactor.toFixed(2)}.`);
        if (driverSentence) parts.push(driverSentence);
        return parts.join(' ');
      }

      return uniq([
        `Score rationale: ${decisionTileLabel} (${score0_100}/100). The score reflects the available extracted fundamentals and risk signals; review the diligence items for what would change conviction.`,
        driverSentence,
      ]).join(' ');
    })();

    const refinedDiligence = applyPolicyAwareAdvisoryAsks({
      policyFamily,
      asks: uniq(diligence).slice(0, 12),
    });

    return {
      snapshot: snapshot || 'Company snapshot is pending: structured facts were not extracted from the materials.',
      supportsProceeding: uniq(supports).slice(0, 6),
      diligenceItems: refinedDiligence.asks,
      scoreRationale,
      advisoryRefinement: {
        source: refinedDiligence.source,
        replacementApplied: refinedDiligence.replacementApplied,
        suppressedStartupAsks: refinedDiligence.suppressedStartupAsks,
        injectedRealEstateAsks: refinedDiligence.injectedRealEstateAsks,
      },
    };
  };

  const icMemo = buildIcMemoOverviewV1();

  const decisionTileOpenItemsAll = icMemo.diligenceItems.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const decisionTileOpenItems = decisionTileOpenItemsAll.slice(0, 2);
  const decisionTileOpenItemsCount = decisionTileOpenItemsAll.length;

  const decisionTileStrengths = icMemo.supportsProceeding.length > 0
    ? icMemo.supportsProceeding
    : decisionTileStrengthsFallback;

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

  const decisionTileRationale = (() => {
    if (decisionTileLabel === '—' || decisionTileScore0_100 == null) {
      return 'Recommendation pending. Score will appear once sufficient information is available.';
    }

    // IC memo style: Company Snapshot + Score rationale (single paragraph).
    // All claims must map to extracted structured facts or deterministic missing inputs.
    const snap = icMemo.snapshot;
    const rationale = icMemo.scoreRationale;
    return `${snap} ${rationale}`;
  })();

  const EvidenceCoverageSection = (sectionProps: {
    documentsReviewedCount: number;
    productBand: 'high' | 'med' | 'low' | 'unknown';
    marketBand: 'high' | 'med' | 'low' | 'unknown';
    teamBand: 'high' | 'med' | 'low' | 'unknown';
    risksBand: 'high' | 'med' | 'low' | 'unknown';
    isRunning: boolean;
    lastAnalyzedAt: string | null;
  }) => {
    const bandLabel = (band: 'high' | 'med' | 'low' | 'unknown'): string => {
      if (band === 'high') return 'High';
      if (band === 'med') return 'Medium';
      if (band === 'low') return 'Low';
      return 'Unknown';
    };

    const statusLabel = sectionProps.isRunning ? 'Running' : 'Completed';
    const statusTone = sectionProps.isRunning
      ? (darkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800')
      : (darkMode ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-emerald-50 border-emerald-200 text-emerald-800');
    const lastAnalyzedDisplay = sectionProps.lastAnalyzedAt
      ? (() => {
          const n = Date.parse(sectionProps.lastAnalyzedAt);
          return Number.isFinite(n) ? new Date(n).toLocaleString() : sectionProps.lastAnalyzedAt;
        })()
      : 'Not yet run';

    return (
      <div
        className={`backdrop-blur-xl border rounded-xl p-6 w-full ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`text-xs uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Evidence & Coverage</div>
            <div className={`mt-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Confidence in supporting materials</div>
          </div>
          <span className={`px-2 py-1 rounded-full border text-xs font-medium ${statusTone}`}>{statusLabel}</span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className={`${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'} rounded-lg border p-3`}>
            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Documents reviewed</div>
            <div className={`mt-1 text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{sectionProps.documentsReviewedCount}</div>
          </div>

          {([
            { label: 'Product', band: sectionProps.productBand },
            { label: 'Market / ICP', band: sectionProps.marketBand },
            { label: 'Team', band: sectionProps.teamBand },
            { label: 'Risks', band: sectionProps.risksBand },
          ] as const).map((item) => (
            <div key={item.label} className={`${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'} rounded-lg border p-3`}>
              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{item.label} coverage</div>
              <div className="mt-2">
                <span className={`inline-block px-2 py-1 rounded-full border text-xs font-medium ${bandToBadgeClasses(item.band)}`}>{bandLabel(item.band)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={`mt-4 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Last analyzed: {lastAnalyzedDisplay}
        </div>
      </div>
    );
  };

  const collectMetricText = (): string => {
    const out: string[] = [];

    // Primary structured signals
    out.push(safeText(overviewV2?.raise));
    out.push(safeText(authoritativeBusinessModel.value));
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

  const stripRecommendationLines = (raw: string): string => {
    const source = typeof raw === 'string' ? raw : '';
    if (!source) return '';

    const stripByDelimiter = (value: string, delimiter: '\n' | '\\n'): string => {
      if (!value.includes(delimiter)) return value;
      const parts = value
        .split(delimiter)
        .filter((line) => !/^\s*Recommendation\s*:/i.test(line));
      return parts.join(delimiter);
    };

    // Handle both real newlines and literal "\\n" sequences.
    const normalized = source.replace(/\r\n/g, '\n');
    const stripped = stripByDelimiter(stripByDelimiter(normalized, '\n'), '\\n');
    return stripped.trim();
  };

  const metricText = collectMetricText();
  const archetypeValue = typeof businessArchetypeV1?.value === 'string' ? businessArchetypeV1.value.toLowerCase() : '';
  const looksRealEstate =
    policyFamily === 'real_estate' ||
    archetypeValue.includes('real_estate') ||
    /\breal\s+estate\b/i.test(String(authoritativeBusinessModel.value ?? '')) ||
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

  const hasNumericToken = (v: string): boolean => /\d/.test(v);
  const isMalformedCurrency = (v: string): boolean => /^\$\s*[,.-]*\s*$/i.test(v);

  const pickValueChecked = (
    re: RegExp,
    format: (m: RegExpMatchArray) => string,
    isValid: (value: string) => boolean,
  ): string => {
    const v = pickValue(re, format);
    if (v === '—') return v;
    return isValid(v) ? v : '—';
  };

  const pickMoneyLike = (input: string): string | null => {
    const matches = input.match(/\$\s*[\d,]+(?:\.\d+)?\s*(?:k|m|mm|million|b|bn|billion)?/gi) ?? [];
    const cleaned = matches
      .map((m) => m.replace(/\s+/g, ' ').trim())
      .filter((m) => hasNumericToken(m) && !isMalformedCurrency(m));
    if (cleaned.length === 0) return null;
    return cleaned.slice(0, 2).join(' + ');
  };

  const pickMoney = (): string => {
    if (reportReady) {
      // Canonical: amount-only from report.structured_summary.raise.value_json.amount.amount.
      const fromReport = safeText(reportCanonicalRaise.value);
      if (fromReport) {
        const compact = pickMoneyLike(fromReport);
        if (compact) return compact;
        if (hasNumericToken(fromReport) && !isMalformedCurrency(fromReport)) return fromReport;
      }
    }
    const direct = safeText(overviewV2?.raise);
    if (direct) {
      const compact = pickMoneyLike(direct);
      if (compact) return compact;
      if (hasNumericToken(direct) && !isMalformedCurrency(direct)) return direct;
    }
    // Look for $ amounts (supports $11.7M, $46.7MM, $1,200,000)
    return pickValueChecked(/\$\s*([\d,]+(?:\.\d+)?)\s*(m|mm|million|b|bn|billion)?/i, (m) => {
      const num = m[1];
      const suf = (m[2] ?? '').toLowerCase();
      const suffix = suf ? suf.replace(/^mm$/, 'M').replace(/^m$/, 'M').replace(/^million$/, 'M').replace(/^bn$/, 'B').replace(/^billion$/, 'B').toUpperCase() : '';
      return `$${num}${suffix}`;
    }, (v) => hasNumericToken(v) && !isMalformedCurrency(v));
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
        { label: 'Business Model', value: authoritativeBusinessModel.value || '—', change: authoritativeBusinessModel.is_arbitrated ? 'Arbitrated (evidence-backed)' : 'Model' },
        { label: 'Deal Type', value: safeText(overviewV2?.deal_type) || safeText(executiveSummaryV1?.deal_type) || '—', change: 'Classification' },
        { label: displayScoreLabel, value: displayScore != null ? `${Math.round(displayScore)}/100` : '—', change: 'Overall (0–100)' },
        { label: 'Confidence', value: phase1ConfidenceRaw ? phase1ConfidenceRaw.toUpperCase() : '—', change: 'Overall' },
      ];

  const topSectionDealSummary = (() => {
    const v2Summary = (dealSummaryV2 as any)?.summary;
    if (typeof v2Summary === 'string') {
      const s = safeText(v2Summary);
      if (s) return s;
    }
    if (v2Summary && typeof v2Summary === 'object') {
      const one = safeText((v2Summary as any)?.one_liner);
      const paras = Array.isArray((v2Summary as any)?.paragraphs) ? (v2Summary as any).paragraphs : [];
      const firstPara = safeText(paras.find((p: any) => typeof p === 'string' && p.trim().length > 0));
      const merged = [one, firstPara].filter(Boolean).join(' ');
      if (merged) return merged;
    }

    if (Array.isArray(executiveSummaryV2?.paragraphs)) {
      const p = executiveSummaryV2.paragraphs.find((x: any) => typeof x === 'string' && x.trim().length > 0);
      const s = safeText(p);
      if (s) return s;
    }

    const v1 = safeText(executiveSummaryV1?.summary);
    if (v1) return v1;

    return 'Run analysis to generate a deal summary.';
  })();

  const understandingV1 = decisionScoreExplanation?.understanding_v1;
  const extractUnderstandingTexts = (items: unknown): string[] => {
    if (!Array.isArray(items)) return [];
    const out: string[] = [];
    for (const it of items) {
      const s =
        typeof it === 'string'
          ? safeText(it)
          : it && typeof it === 'object'
            ? safeText((it as any).text)
            : null;
      if (!s) continue;
      out.push(s);
    }
    return out;
  };

  // [SCORE-EXPLANATION-V1] Clean intermediate contract for TopSection copy.
  // Derived exclusively from guardrail snapshot (score_band_v2) + scoring engine analytics
  // (score_explanation.understanding_v1 + totals). No LLM, no DB write.
  // null when no report is applied or band score is unavailable.
  const scoreExplanationV1 = (() => {
    if (!reportReady) return null;
    const reportMeta = (reportFromApi as any)?.metadata;
    const envelopeMeta = (reportEnvelope as any)?.metadata;
    // Band from report metadata; fall back to envelope-level band (set independently by API).
    const bandMeta = (reportMeta?.score_band_v2 && typeof reportMeta.score_band_v2 === 'object')
      ? reportMeta.score_band_v2
      : (envelopeMeta?.score_band_v2 && typeof envelopeMeta.score_band_v2 === 'object')
        ? envelopeMeta.score_band_v2
        : null;
    const overallScore: number | null = (() => {
      const v = bandMeta?.overall_score;
      return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
    })();
    if (overallScore == null) return null;

    const se = decisionScoreExplanation; // = reportFromApi.metadata.score_explanation
    const u1 = understandingV1; // = se?.understanding_v1
    const band: string | null = safeText(bandMeta?.label || bandMeta?.key) || null;
    const coverageRatio: number | null = (() => {
      const v = se?.totals?.coverage_ratio;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    })();

    // Snapshot summary: understanding_v1.summary.text (or string form) — lightweight narrative
    // explaining WHY the score landed where it did. Sanitize score fractions only; keep meaning.
    const snapshotSummary: string | null = (() => {
      const raw = u1?.summary;
      const txt = typeof raw === 'object' && raw !== null
        ? safeText((raw as any).text)
        : safeText(raw as any);
      if (!txt) return null;
      const cleaned = stripScoreFractions(txt);
      return cleaned.length >= 10 ? cleaned : null;
    })();

    // Strengths from understanding_v1.strengths — strip score fractions (not entire items).
    const primaryStrengths = stripScoreFractionsFromItems(
      extractUnderstandingTexts(u1?.strengths).filter((x) => !_SCORE_MECHANIC_RE.test(x)),
    ).slice(0, 4);

    // Diligence open items — split into weaknesses (gap flags, short / noun-phrase style)
    // vs action recommendations (imperative verb-led suggestions, typically longer).
    // Heuristic: starts with a common imperative verb → action; otherwise → weakness.
    const _ACTION_VERB_RE = /^(provide|share|confirm|show|demonstrate|add|include|disclose|address|clarify|present|submit|explain|describe|quantify|detail|outline|document|define|identify|specify|validate|verify|run|get|build|prepare|develop|establish|conduct|illustrate|model)/i;
    const allDiligenceItems = stripScoreFractionsFromItems(
      extractUnderstandingTexts(u1?.diligence_open_items),
    );
    const primaryConstraints = allDiligenceItems
      .filter((x) => !_SCORE_MECHANIC_RE.test(x) && !_ACTION_VERB_RE.test(x))
      .slice(0, 5);
    const longDiligenceActions = allDiligenceItems
      .filter((x) => !_SCORE_MECHANIC_RE.test(x) && _ACTION_VERB_RE.test(x))
      .slice(0, 4);

    // Execution dependencies → action recommendations (merged with long diligence items).
    const execActions = stripScoreFractionsFromItems(
      extractUnderstandingTexts(u1?.execution_dependencies).filter((x) => !_SCORE_MECHANIC_RE.test(x)),
    ).slice(0, 4);
    const actionRecommendations = [...longDiligenceActions, ...execActions].slice(0, 6);

    return {
      overall_score: overallScore,
      band,
      coverage_ratio: coverageRatio,
      snapshot_summary: snapshotSummary,
      primary_strengths: primaryStrengths,
      primary_constraints: primaryConstraints,
      action_recommendations: actionRecommendations,
    } as const;
  })();

  // [SCORE-CONTRACT] TopSection copy fields — sourced exclusively from scoreExplanationV1.
  // All NN/100 fractions are stripped at source; mismatched ones are double-guarded at JSX
  // call site via filterMismatchedScoreItems. No multi-tier fallbacks.
  const topSectionStrengths: string[] = scoreExplanationV1?.primary_strengths ?? [];
  const topSectionWeaknesses: string[] = scoreExplanationV1?.primary_constraints ?? [];
  // Actions = verb-led diligence items + execution dependencies from scoreExplanationV1.
  const topSectionActionRefinement = applyPolicyAwareAdvisoryAsks({
    policyFamily,
    asks: scoreExplanationV1?.action_recommendations ?? [],
  });
  const topSectionActionsToImprove: string[] = topSectionActionRefinement.asks;

  const topSectionConfidence: 'High' | 'Medium' | 'Low' = decisionTileConfidenceBand === 'high'
    ? 'High'
    : decisionTileConfidenceBand === 'med'
      ? 'Medium'
      : 'Low';

  const topSectionRaise = pickMoney();
  const topSectionRevenue = looksRealEstate
    ? pickValueChecked(/\b(?:noi|year\s*[-\s]?1\s*(?:noi|rent))\b[^\d\$]{0,24}\$?([\d,]+(?:\.\d+)?)/i, (m) => `$${m[1]}`, (v) => hasNumericToken(v) && !isMalformedCurrency(v))
    : pickValue(/\b(revenue|arr|mrr)\b[\s:,-]{0,12}(\$?\s*[\d,]+(?:\.\d+)?\s*(?:k|m|mm|million|b|bn|billion)?)\b/i, (m) => m[2].replace(/\s+/g, ' ').trim());
  const topSectionGrowth = looksRealEstate
    ? pickValue(/\b(?:target\s+)?irr\b[^\d]{0,24}(\d{1,2}(?:\.\d+)?)\s*%/i, (m) => `${m[1]}%`)
    : pickValue(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:mom|m\/m|yoy|y\/y|qoq|q\/q)/i, (m) => `${m[1]}%`);
  const topSectionCustomers = looksRealEstate
    ? pickValue(/\bterm\b[^\d]{0,24}(\d{1,3})\s*(months|month|mos|years|year|yrs)\b/i, (m) => `${m[1]} ${m[2]}`)
    : pickValue(/\b(\d[\d,]*)\s*(customers|users|teams|clients)\b/i, (m) => `${m[1]} ${m[2]}`);
  const topSectionBusinessModel = authoritativeBusinessModel.value || '—';
  // [CONTRACT: DataFlow_contract.md §2.2] deal_type MUST come only from report.metadata.score_explanation.context.deal_type.
  // Forbidden: overviewV2.deal_type, executiveSummaryV1.deal_type (phase1 inferred sources).
  const topSectionDealType = safeText(decisionScoreExplanation?.context?.deal_type) || '—';

  const reportView = useMemo(() => {
    const fallbackScore = (() => {
      if (typeof displayScore === 'number' && Number.isFinite(displayScore)) return Math.round(displayScore);
      const fromDealInfo = (dealInfo as any)?.score;
      if (typeof fromDealInfo === 'number' && Number.isFinite(fromDealInfo)) return Math.round(fromDealInfo);
      if (typeof reportBandScore === 'number' && Number.isFinite(reportBandScore)) return Math.round(reportBandScore);
      return 0;
    })();

    const ctx = decisionScoreExplanation && typeof decisionScoreExplanation === 'object' ? decisionScoreExplanation?.context : null;
    const ctxStageRaw = typeof ctx?.stage === 'string' ? ctx.stage.trim() : '';
    // [CONTRACT: DataFlow_contract.md §2.3] stage MUST come only from report.metadata.score_explanation.context.stage.
    // Forbidden: dealFromApi.stage (pipeline/CRM stage — a different concept, not the funding stage).
    // If missing → return 'unknown' per contract §2.3.
    const stageRaw = ctxStageRaw || null;

    const stageLabel = (() => {
      if (!stageRaw) return 'unknown';
      const map: Record<string, string> = {
        intake: 'Intake',
        under_review: 'Under review',
        in_diligence: 'In diligence',
        ready_decision: 'Ready decision',
        pitched: 'Pitched',
      };
      return map[stageRaw] ?? stageRaw.replace(/_/g, ' ');
    })();

    // [CANONICAL-SCORE] Two-pass band score logic:
    //   Pass 1: resolve from inner reportFromApi.metadata (present when deck_archetype block succeeded).
    //   Pass 2: if band score not found, try the envelope-level metadata.score_band_v2 which the API
    //           writes independently via payload.metadata = nextMetadata (survives deck_archetype failures).
    // This prevents the gauge from falling back to report.overallScore when the band IS available
    // but was only attached to the envelope-level metadata and not the inner report object.
    const { score: _innerReportScore, source: _innerReportSource } = resolveCanonicalScore(reportReady ? reportFromApi : null);
    const _envelopeBandScore: number | null = (() => {
      // Short-circuit: inner report already had the band score — no need to consult envelope.
      if (_innerReportSource === 'score_band_v2.overall_score') return null;
      if (!reportReady) return null;
      const envelopeMeta = (reportEnvelope as any)?.metadata;
      if (!envelopeMeta || typeof envelopeMeta !== 'object') return null;
      const band = envelopeMeta.score_band_v2;
      if (!band || typeof band !== 'object') return null;
      const v = (band as Record<string, unknown>).overall_score;
      return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
    })();
    // Merge: envelope band score wins if inner report lacked it; otherwise inner report wins.
    const reportScore: number | null = _envelopeBandScore ?? _innerReportScore;
    const _reportScoreSource: ResolvedScore['source'] = _envelopeBandScore != null
      ? 'score_band_v2.overall_score'
      : _innerReportSource;

    const sections = Array.isArray((reportFromApi as any)?.sections) ? (reportFromApi as any).sections : [];
    const structuredSummary = (reportFromApi as any)?.structured_summary;
    // KPI normalization must occur server-side only to prevent drift.
    const kpis = structuredSummary && typeof structuredSummary === 'object' ? (structuredSummary as any).kpis : null;

    const reportMeta = ((reportFromApi as any)?.metadata && typeof (reportFromApi as any).metadata === 'object')
      ? (reportFromApi as any).metadata
      : null;
    const decisionLabel = safeText((reportMeta as any)?.decision_v1?.label);

    const executiveSummaryFromReport = (() => {
      const byId = sections.find((s: any) => typeof s?.id === 'string' && ['executive-summary', 'executive_summary', 'executiveSummary'].includes(s.id));
      const byTitle = sections.find((s: any) => typeof s?.title === 'string' && /executive\s+summary/i.test(s.title));
      const content = safeText((byId ?? byTitle)?.content);
      if (!content) return null;
      // Executive summary is narrative; never let it drive canonical recommendation.
      return stripRecommendationLines(content) || null;
    })();

    const legacySummary = executiveSummaryFromReport ?? topSectionDealSummary;
    const canonicalTopSummary = canonicalDealSummaryReady ? (canonicalTierHero || canonicalDealOneLiner) : '';
    const showCanonicalTopSummary = Boolean(canonicalTopSummary);

    const businessModelFromReport = authoritativeBusinessModel.value || safeText(ctx?.business_model);
    const businessModelLabelFromReport = authoritativeBusinessModel.label;
    const dealTypeFromReport = safeText(ctx?.deal_type);
    const raiseFromReport = safeText(reportCanonicalRaise.value);

    const revenueFromReport = (() => {
      const v = kpis?.revenue?.value;
      if (!v || typeof v !== 'object') return null;
      const raw = safeText((v as any).raw);
      if (raw) return raw;
      const amount = (v as any).amount;
      const currency = safeText((v as any).currency);
      const period = safeText((v as any).period);
      if (typeof amount === 'number' && Number.isFinite(amount)) {
        const prefix = currency === 'USD' ? '$' : '';
        const formatted = `${prefix}${Math.round(amount).toLocaleString()}`;
        return period ? `${formatted} ${period}` : formatted;
      }
      return null;
    })();

    const customersFromReport = (() => {
      const v = kpis?.customers?.value;
      if (!v || typeof v !== 'object') return null;
      const raw = safeText((v as any).raw);
      if (raw) return raw;
      const count = (v as any).count;
      const kind = safeText((v as any).kind) || 'customers';
      if (typeof count === 'number' && Number.isFinite(count)) {
        return `${Math.round(count).toLocaleString()} ${kind}`;
      }
      return null;
    })();

    const recommendation =
      decisionLabel ||
      safeText((reportFromApi as any)?.recommendation) ||
      safeText(reportArtifact?.recommendation) ||
      null;

    // [TOPSECTION-BINDING] When the report is applied (reportReady + reportFromApi present),
    // the gauge score must come exclusively from the canonical resolver (score_band_v2 or overallScore).
    // Never fall through to fallbackScore (which traces to dealFromApi.score) — that would cause
    // the gauge to show the DB-calibrated deal score instead of the report-derived score.
    const reportApplied = reportReady && !!reportFromApi;
    const gaugeScore = reportApplied
      ? (reportScore ?? 0) // canonical-only; 0 = "no band/overallScore" edge case
      : (reportScore ?? fallbackScore); // pre-report: best estimate is fine

    return {
      applied: reportApplied,
      score: gaugeScore,
      scoreSource: _reportScoreSource,
      recommendation,
      stageRaw,
      stageLabel,
      dealSummary: showCanonicalTopSummary ? canonicalTopSummary : legacySummary,
      dealSummaryTitle: showCanonicalTopSummary ? 'Deal Snapshot' : 'Executive Summary',
      dealSummarySource: showCanonicalTopSummary ? 'canonical' : 'legacy',
      businessModel: businessModelFromReport || topSectionBusinessModel,
      businessModelLabel: businessModelLabelFromReport,
      // [CONTRACT: DataFlow_contract.md §2.2] deal_type: canonical source only; no phase1 fallback.
      dealType: dealTypeFromReport || topSectionDealType,
      // [CONTRACT: DataFlow_contract.md §2.1] raise: structured_summary.raise only; topSectionRaise (text-mining) removed.
      raise: raiseFromReport || null,
      // [CONTRACT: DataFlow_contract.md §2.7] revenue: structured_summary.kpis.revenue.value only; no text-mining fallback.
      revenue: revenueFromReport || null,
      // [CONTRACT: DataFlow_contract.md §2.6] customers: structured_summary.kpis.customers.value only; no text-mining fallback.
      customers: customersFromReport || null,
      source: reportReady ? 'report' : 'fallback',
    } as const;
  }, [
    dealId,
    reportReady,
    reportFromApi,
    reportEnvelope,
    reportArtifact,
    decisionScoreExplanation,
    displayScore,
    reportBandScore,
    dealInfo,
    dealFromApi,
    canonicalDealSummaryReady,
    canonicalDealOneLiner,
    canonicalTierHero,
    topSectionDealSummary,
    topSectionBusinessModel,
    topSectionDealType,
    topSectionRaise,
    topSectionRevenue,
    topSectionCustomers,
    authoritativeBusinessModel,
    reportCanonicalRaise,
  ]);

  // Canonical score label: when the report is loaded (score = report.overallScore),
  // label it "Overall Score". Only use the sub-engine label ("Fundamentals" / "Fundability")
  // as a fallback when showing a pre-report estimate.
  const canonicalScoreLabel: string = reportView.applied ? 'Deal Score' : displayScoreLabel;

  // canonicalScoreView: single score truth shared by ALL score-bearing UI surfaces
  // (TopSection gauge AND Overview tab). score0_100 is null when report is not yet applied
  // so we never show a stale DB number in the Overview tile.
  // Memoized so referential stability prevents score-contract useEffects from re-running
  // on every render cycle when reportView has not actually changed.
  const canonicalScoreView = useMemo(() => ({
    score0_100: reportView.applied ? reportView.score : null,
    scoreSource: reportView.scoreSource,
    reportApplied: reportView.applied,
  }), [reportView]);

  // [SCORE-SANITIZER] Canonical reference for stripping mismatched NN/100 phrases from copy.
  // Only active when a report is applied (we have a real canonical score to compare against).
  // null = no sanitization (pre-report state).
  const canonicalScoreForSanitizer: number | null = canonicalScoreView.reportApplied
    ? canonicalScoreView.score0_100
    : null;

  // [SIGNAL-CONTRACT] Lifted from the render IIFE so buildWorkspaceViewModel can consume
  // them for concerns/icReadiness/signalData without duplication.
  const filteredStrengths = filterMismatchedScoreItems(topSectionStrengths, canonicalScoreForSanitizer);
  const filteredWeaknesses = filterMismatchedScoreItems(topSectionWeaknesses, canonicalScoreForSanitizer);

  // [SCORE-CONTRACT] Final one-liner for TopSection Deal Snapshot.
  // Priority order (first non-empty wins):
  //   1. score_driver_one_liner from structured_summary (topsection_v1 builder, deterministic).
  //   2. understanding_v1.summary — explains WHY the score landed; strip score fractions.
  //   3. Synthesize from band + top strength + top constraint.
  //   4. Empty string — component renders a neutral placeholder; never "Score of N".
  const topSectionScoreDriverOneLiner = _topSectionScoreDriverOneLinerRaw || (() => {
    if (scoreExplanationV1) {
      // Priority 2: understanding_v1.summary
      if (scoreExplanationV1.snapshot_summary) return scoreExplanationV1.snapshot_summary;
      // Priority 3: synthesize
      const { band, primary_strengths, primary_constraints, coverage_ratio } = scoreExplanationV1;
      const topStrength = primary_strengths[0] ?? null;
      const topConstraint = primary_constraints[0] ?? null;
      if (band && topStrength) {
        return topConstraint
          ? `${band}: ${topStrength} — Key constraint: ${topConstraint}`
          : `${band}: ${topStrength}`;
      }
      if (band && coverage_ratio != null) {
        return `${band} — scored from ${Math.round(coverage_ratio * 100)}% data coverage.`;
      }
      if (band) return `${band} — score details not yet computed for this run.`;
    }
    // Priority 4: placeholder; component handles empty one-liner gracefully.
    return '';
  })();

  // [SCORE-CONTRACT] Dev-only log: emits once per unique score_explanation_v1 state.
  // Logs the canonical score, the full explanation object, and the score source path.
  const lastScoreContractLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const key = [
      dealId ?? '',
      String(canonicalScoreView.score0_100 ?? 'null'),
      canonicalScoreView.scoreSource,
      scoreExplanationV1 ? 'v1' : 'null',
    ].join('|');
    if (lastScoreContractLogRef.current === key) return;
    lastScoreContractLogRef.current = key;
    console.log('[DDAI][score_contract]', {
      canonicalScore: canonicalScoreView.score0_100,
      sourcePathUsed: canonicalScoreView.scoreSource,
      reportApplied: canonicalScoreView.reportApplied,
      explanationObject: scoreExplanationV1,
    });
  }, [dealId, canonicalScoreView, scoreExplanationV1]);

  const lastReportBindingsLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!reportView.applied) return;
    const key = `${dealId ?? ''}|${reportVersion ?? 'na'}|${reportView.score}|${reportView.stageRaw ?? ''}|${reportView.dealType}`;
    if (lastReportBindingsLogRef.current === key) return;
    lastReportBindingsLogRef.current = key;
    console.log('[DDAI][report_bindings]', reportView);
  }, [dealId, reportVersion, reportView]);

  // [SCORE-SOURCES] Consolidated dev-only log: emits once per unique score-state snapshot.
  // Use this to diagnose mismatches between what each UI element shows and where it came from.
  const lastScoreSourcesLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const _reportMeta = (reportFromApi as any)?.metadata ?? null;
    const _bandScore = _reportMeta?.score_band_v2?.overall_score ?? null;
    const _envelopeLevelBandScore = (reportEnvelope as any)?.metadata?.score_band_v2?.overall_score ?? null;
    const _rawOverallScore = (reportFromApi as any)?.overallScore ?? null;
    // Two-pass canonical resolution: inner report first, envelope-level band as fallback.
    const { score: _innerCanonical, source: _innerSrc } = resolveCanonicalScore(reportFromApi);
    const _canonical = (_innerSrc !== 'score_band_v2.overall_score' && _envelopeLevelBandScore != null)
      ? _envelopeLevelBandScore
      : _innerCanonical;
    const _canonicalSrc: ResolvedScore['source'] = (_innerSrc !== 'score_band_v2.overall_score' && _envelopeLevelBandScore != null)
      ? 'score_band_v2.overall_score'
      : _innerSrc;
    const key = [
      dealId ?? '',
      String(reportVersion ?? 'na'),
      String(dioMeta?.dioAnalysisVersion ?? 'na'),
      String(_rawOverallScore ?? 'na'),
      String(_bandScore ?? 'na'),
      String(_canonical ?? 'na'),
      String(fundamentalsScore0_100 ?? 'na'),
      String(reportBandScore),
      String((dealFromApi as any)?.score ?? 'na'),
      String(displayScore ?? 'na'),
      String(reportView.score),
      String(decisionTileScore0_100 ?? 'na'),
    ].join('|');
    if (lastScoreSourcesLogRef.current === key) return;
    lastScoreSourcesLogRef.current = key;
    console.log('[DDAI][score_sources]', {
      dealId,
      // Report version info
      envelopeVersion: reportVersion,
      dioMetaVersion: dioMeta?.dioAnalysisVersion ?? null,
      reportReady,
      // Raw values from fetched objects
      raw: {
        'reportFromApi.overallScore': _rawOverallScore,
        'reportFromApi.metadata.score_band_v2.overall_score': _bandScore,
        'reportEnvelope.metadata.score_band_v2.overall_score': _envelopeLevelBandScore,
        'dealFromApi.score': (dealFromApi as any)?.score ?? null,
        reportBandScore,
      },
      // Canonical resolution
      resolved: {
        canonicalScore: _canonical,
        canonicalScoreSource: _canonicalSrc,
        fundamentalsScore0_100,
        displayScore,
        displayScoreLabel,
      },
      // What each UI element shows
      ui: {
        'TopSection gauge (reportView.score)': reportView.score,
        'TopSection scoreLabel': canonicalScoreLabel,
        'TopSection canonicalScoreSource': reportView.applied ? reportView.scoreSource : 'none',
        'Data-panel displayScore/100': displayScore != null ? `${Math.round(displayScore)}/100` : '—',
        'Overview canonical score0_100': canonicalScoreView.score0_100,
        'Overview reportApplied': canonicalScoreView.reportApplied,
        'Overview scoreSource': canonicalScoreView.scoreSource,
        'Decision tile label': decisionTileLabel,
      },
      // Hypothesis guide:
      // A) bandScore missing or equals overallScore → resolver correctly shows overallScore (no divergence)
      // B) bandScore exists and differs from overallScore → band score shown; overview and gauge agree
      hypothesisGuide: {
        bandScorePresent: _bandScore != null,
        bandDiffersFromOverall: _bandScore != null && _rawOverallScore != null && _bandScore !== _rawOverallScore,
        gaugeDiffersFromOverview: reportView.score !== canonicalScoreView.score0_100,
        gaugeSource: _canonicalSrc,
      },
    });
  }, [
    dealId, reportVersion, dioMeta, reportFromApi, reportEnvelope, reportReady,
    fundamentalsScore0_100, reportBandScore, dealFromApi, displayScore, displayScoreLabel,
    reportView, canonicalScoreLabel, canonicalScoreView, decisionTileLabel,
  ]);

  // [TOPSECTION-BINDING] Dev-only log emitted once per unique gauge-binding state.
  // Verifies at render time that the TopSection gauge is driven by the canonical resolver only,
  // never by dealFromApi.score when the report is applied.
  const lastTopSectionBindingLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const key = [
      dealId ?? '',
      String(reportView.applied),
      String(reportView.score),
      String(reportView.scoreSource),
      String((dealFromApi as any)?.score ?? 'na'),
    ].join('|');
    if (lastTopSectionBindingLogRef.current === key) return;
    lastTopSectionBindingLogRef.current = key;
    const dealScore = (dealFromApi as any)?.score ?? null;
    const leak = reportView.applied && dealScore != null && reportView.score === dealScore && reportView.scoreSource === 'none';
    console.log('[DDAI][topsection_score_binding]', {
      gaugeScore: reportView.score,
      gaugeScoreSource: reportView.scoreSource,
      reportApplied: reportView.applied,
      dealFromApiScore: dealScore,
      // If this is true, the gauge is incorrectly showing the DB deal score — file a bug.
      LEAK_DETECTED: leak,
    });
    if (leak) {
      console.warn('[DDAI][topsection_score_binding] LEAK: gauge is showing dealFromApi.score when report is applied. Expected canonical score from score_band_v2 or overallScore.');
    }
  }, [dealId, reportView, dealFromApi]);

  const reportStructuredKpis = useMemo(() => {
    // KPI normalization must occur server-side only to prevent drift.
    return (reportFromApi as any)?.structured_summary?.kpis ?? null;
  }, [reportFromApi]);

  const authoritativeBurnV1 = useMemo(() => {
    return selectAuthoritativeBurnV1((reportFromApi as any) ?? (reportEnvelope as any) ?? null);
  }, [reportFromApi, reportEnvelope]);

  const authoritativeRunwayV1 = useMemo(() => {
    return selectAuthoritativeRunwayV1((reportFromApi as any) ?? (reportEnvelope as any) ?? null);
  }, [reportFromApi, reportEnvelope]);

  const reportStructuredRaise = safeText(reportCanonicalRaise.value) || null;
  const reportStructuredBusinessModelLabel = authoritativeBusinessModel.label;

  const selectedHeader = useMemo(() => {
    const phase1: any = {
      raise: overviewV2?.raise_terms ?? (executiveSummaryV1 as any)?.raise,
      business_model_arbitration_v1: (dealFromApi as any)?.phase1?.business_model_arbitration_v1 ?? null,
      deal_overview_v2: overviewV2 ?? null,
      executive_summary_v1: executiveSummaryV1 ?? null,
      revenue: overviewV2?.revenue,
      growth: overviewV2?.growth,
      customers: overviewV2?.customers,
    };
    return selectDealWorkspaceHeader((reportFromApi as any) ?? null, phase1);
  }, [reportFromApi, overviewV2, executiveSummaryV1, dealFromApi]);

  const revenueCoveragePolicy = useMemo(() => {
    const cov: any = authoritativeFinancialCoverageV1.value && typeof authoritativeFinancialCoverageV1.value === 'object'
      ? (authoritativeFinancialCoverageV1.value as any).coverage
      : null;

    if (!cov || typeof cov !== 'object') {
      return {
        allow: true,
        forecastOnly: false,
        kpiTileLabel: 'Revenue / ARR',
        revenueLabelOverride: null as string | null,
        tooltipOverride: null as string | null,
      };
    }

    const historical = cov.historical_revenue_present === true;
    const forecast = cov.forecast_revenue_present === true;

    if (historical) {
      return {
        allow: true,
        forecastOnly: false,
        kpiTileLabel: 'Revenue / ARR',
        revenueLabelOverride: null,
        tooltipOverride: null,
      };
    }

    if (forecast) {
      return {
        allow: true,
        forecastOnly: true,
        kpiTileLabel: 'Forecast revenue',
        revenueLabelOverride: 'Forecast',
        tooltipOverride: 'Forecast revenue only (no historical revenue extracted).',
      };
    }

    return {
      allow: false,
      forecastOnly: false,
      kpiTileLabel: 'Revenue / ARR',
      revenueLabelOverride: null,
      tooltipOverride: 'Not extracted from evidence.',
    };
  }, [authoritativeFinancialCoverageV1.value]);

  const burnRunwayCoveragePolicy = useMemo(() => {
    const cov: any = authoritativeFinancialCoverageV1.value && typeof authoritativeFinancialCoverageV1.value === 'object'
      ? (authoritativeFinancialCoverageV1.value as any).coverage
      : null;

    const allowBurn = !!(cov && typeof cov === 'object' && cov.burn_rate_present === true);
    const allowRunway = !!(cov && typeof cov === 'object' && cov.runway_present === true);

    const evidence = (authoritativeFinancialCoverageV1.value as any)?.evidence;

    return {
      allowBurn,
      allowRunway,
      burnTooltip: allowBurn
        ? (safeText(evidence?.burn_rate_present?.snippet) || null)
        : 'Not extracted from evidence.',
      runwayTooltip: allowRunway
        ? (safeText(evidence?.runway_present?.snippet) || null)
        : 'Not extracted from evidence.',
    };
  }, [authoritativeFinancialCoverageV1.value]);

  const burnTileValue = burnRunwayCoveragePolicy.allowBurn ? (authoritativeBurnV1.value?.display ?? null) : null;
  const runwayTileValue = burnRunwayCoveragePolicy.allowRunway ? (authoritativeRunwayV1.value?.display ?? null) : null;

  const burnHasNumeric = burnRunwayCoveragePolicy.allowBurn ? authoritativeBurnV1.value != null : undefined;
  const runwayHasNumeric = burnRunwayCoveragePolicy.allowRunway ? authoritativeRunwayV1.value != null : undefined;

  const reportStructuredRevenueLabel = selectedHeader.ready
    ? (revenueCoveragePolicy.revenueLabelOverride ?? selectedHeader.revenue.label ?? null)
    : null;
  const reportStructuredCustomersLabel = selectedHeader.ready ? (selectedHeader.customers.label ?? null) : null;
  const reportStructuredGrowthLabel = selectedHeader.ready ? (selectedHeader.growth.label ?? null) : null;

  const reportStructuredRevenueTooltip = revenueCoveragePolicy.tooltipOverride
    ? revenueCoveragePolicy.tooltipOverride
    : safeText(reportStructuredKpis?.revenue?.sources?.[0]?.note_snippet);
  const reportStructuredCustomersTooltip = safeText(reportStructuredKpis?.customers?.sources?.[0]?.note_snippet);
  const reportStructuredGrowthTooltip = safeText(reportStructuredKpis?.growth?.sources?.[0]?.note_snippet);

  const reportStructuredGrowthValue = (() => {
    const growth = reportStructuredKpis?.growth as any;
    const raw = safeText(growth?.value?.raw);
    const pct = growth?.value?.percent;
    const label = safeText(growth?.label);
    if (typeof pct === 'number' && Number.isFinite(pct)) return `${pct}%`;
    if (label === 'Forecast' && raw) {
      const money = raw.match(/\$\s*[\d,.]+\s*[kKmMbB]?/);
      if (money?.[0]) return money[0].replace(/\s+/g, '');
    }
    return raw;
  })();

  const reportStructuredGrowthNote = (() => {
    const growth = reportStructuredKpis?.growth as any;
    const year = growth?.value?.year;
    if (typeof year === 'number' && Number.isFinite(year)) return String(year);
    return null;
  })();

  // PR22: deterministic slot fallbacks are injected before the '—' defaults so
  // they activate only when both authoritative and phase1 DIO values are absent.
  const _productBase = (canonicalDealSummaryReady && canonicalProduct ? canonicalProduct : null)
    ?? (overviewProduct !== '—' ? overviewProduct : null);
  const _marketBase = (canonicalDealSummaryReady && canonicalMarket ? canonicalMarket : null)
    ?? (overviewMarketIcp !== '—' ? overviewMarketIcp : null);
  const _businessModelBase = authoritativeBusinessModel.value
    || (reportView.applied ? (reportView.businessModel !== '—' ? reportView.businessModel : null) : null)
    || (overviewBusinessModel !== '—' ? overviewBusinessModel : null);

  const overviewProductCanonical =
    authoritativeProductTextV1
    || _productBase
    || deterministicOverviewSlots.product?.value
    || overviewProduct;
  const overviewMarketIcpCanonical =
    authoritativeMarketTextV1
    || _marketBase
    || deterministicOverviewSlots.market?.value
    || overviewMarketIcp;
  const overviewBusinessModelCanonical =
    _businessModelBase
    || deterministicOverviewSlots.business_model?.value
    || (reportView.applied ? reportView.businessModel : overviewBusinessModel);
  const overviewRaiseTermsCanonical = reportStructuredRaise || (reportView.applied ? reportView.raise : overviewRaiseTerms) || '';

  const displayFactsV1 = useMemo(() => {
    const dfv1 = (governedOverview as any)?.overview?.overview_json?.display_facts_v1;
    if (!dfv1 || typeof dfv1 !== 'object') return null;
    return dfv1 as any;
  }, [governedOverview]);

  const normalizeHeroText = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const hasMalformedNumericPlaceholder = (value: string): boolean => {
    const s = value.trim();
    if (!s) return true;
    if (/^\$\s*[,.-]*\s*$/i.test(s)) return true;
    if (/^\$\s*[,.-]+\s*[kmbn]*$/i.test(s)) return true;
    return false;
  };

  const isLowQualityHeroSummary = (value: string): boolean => {
    const s = String(value ?? '').trim();
    if (!s) return true;

    // Guard against OCR-heavy blobs leaking into investor-facing hero copy.
    const nonAlphaNumRatio = s.length > 0
      ? (s.match(/[^a-z0-9\s.,;:()\-/$%]/gi)?.length ?? 0) / s.length
      : 0;
    const hasReplacementGlyph = /[\uFFFD]/.test(s);
    const hasLongPunctuationRun = /[|]{3,}|[_]{3,}|[-]{5,}|[~]{3,}/.test(s);
    const looksLikeDeckScrape = /\b(investors@|stackfactor\.ai|slide|page\s+\d+)\b/i.test(s) && s.length > 220;

    if (hasReplacementGlyph) return true;
    if (hasLongPunctuationRun) return true;
    if (nonAlphaNumRatio > 0.2 && s.length > 160) return true;
    if (looksLikeDeckScrape) return true;
    return false;
  };
  const splitTierDeepToParagraphs = (raw: string): string[] => {
    const normalized = String(raw ?? '')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!normalized) return [];
    return normalized
      .split(/\n{2,}/g)
      .map((p) => safeText(p))
      .filter((p) => p.length > 0)
      .slice(0, 6);
  };

  const overviewDealOneLinerCanonical = (() => {
    if (canonicalDealSummaryReady) {
      // Overview tab prefers the more descriptive tier (overview) when present.
      if (canonicalTierOverview) return canonicalTierOverview;
      if (canonicalTierHero) return canonicalTierHero;
      // Fallback only if the tier is missing.
      if (canonicalDealOneLiner) return canonicalDealOneLiner;
    }
    return overviewDealOneLiner;
  })();

  const overviewDealSummaryParagraphsCanonical: string[] = (() => {
    if (canonicalDealSummaryReady) {
      const out: string[] = [];
      if (canonicalTierOverview) out.push(canonicalTierOverview);
      const fromTier = canonicalTierDeep ? splitTierDeepToParagraphs(canonicalTierDeep) : [];
      out.push(...fromTier);
      if (out.length > 0) return out.slice(0, 6);
      // Fallback only if the deep tier is missing.
      if (canonicalParagraphs.length > 0) return canonicalParagraphs;
    }
    return overviewDealSummaryParagraphs;
  })();

  const overlayVM = useMemo(() => {
    if (!hasGovernedOverview) return buildOverlayViewModel(null);
    return buildOverlayViewModel(governedOverview.overview);
  }, [hasGovernedOverview, governedOverview.overview]);

  const useOverlayForHero = hasGovernedOverview && !governedOverlayDegraded;

  type KpiKey = 'raise' | 'revenue' | 'growth' | 'customers' | 'business_model';
  const normalizeKpiValue = (value: unknown): string | null => {
    if (value == null) return null;
    const s = String(value).trim();
    if (!s || s === '—') return null;
    return s;
  };

  const parseNumericSignal = (raw: string): { kind: 'money' | 'percent' | 'count' | 'text'; num?: number; text: string } => {
    const text = raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    const pct = text.match(/(-?\d+(?:\.\d+)?)\s*%/);
    if (pct?.[1]) {
      const n = Number(pct[1]);
      if (Number.isFinite(n)) return { kind: 'percent', num: n, text };
    }

    // Money-like: $1.2m, 1,200,000, 3mm, 2.5bn, etc.
    const money = text.match(/\$?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(k|m|mm|b|bn|million|billion)?\b/);
    if (money?.[1]) {
      const base = Number(money[1].replace(/,/g, ''));
      if (Number.isFinite(base)) {
        const suf = (money[2] ?? '').toLowerCase();
        const mult = suf === 'k'
          ? 1e3
          : (suf === 'm' || suf === 'mm' || suf === 'million')
            ? 1e6
            : (suf === 'b' || suf === 'bn' || suf === 'billion')
              ? 1e9
              : 1;
        const num = base * mult;
        // Heuristic: treat large values as money; smaller numeric strings may be counts.
        return { kind: mult > 1 ? 'money' : 'count', num, text };
      }
    }

    const count = text.match(/\b(-?\d[\d,]*)\b/);
    if (count?.[1]) {
      const n = Number(count[1].replace(/,/g, ''));
      if (Number.isFinite(n)) return { kind: 'count', num: n, text };
    }

    const compact = text
      .replace(/[,\s\$]/g, '')
      .replace(/\u2013|\u2014/g, '-');
    return { kind: 'text', text: compact };
  };

  const isMeaningfulDiff = (a: string, b: string): boolean => {
    const sa = parseNumericSignal(a);
    const sb = parseNumericSignal(b);

    if (sa.kind === sb.kind && typeof sa.num === 'number' && typeof sb.num === 'number') {
      const denom = Math.max(1, Math.max(Math.abs(sa.num), Math.abs(sb.num)));
      const rel = Math.abs(sa.num - sb.num) / denom;
      // Treat <1% delta as same; allow small rounding noise.
      if (rel < 0.01) return false;
      // If values are tiny, require at least 1 unit difference.
      if (Math.abs(sa.num - sb.num) < 1) return false;
      return true;
    }

    // Text-ish fallback: ignore trivial punctuation/spacing.
    return sa.text !== sb.text;
  };

  const buildHeroFact = (opts: {
    key: KpiKey;
    det: string | null;
    overlay: string | null;
  }): { value: string | null; conflict: boolean; overlayValueIfConflicted: string | null } => {
    const det = normalizeKpiValue(opts.det);
    const overlay = normalizeKpiValue(opts.overlay);

    if (!det && overlay) return { value: overlay, conflict: false, overlayValueIfConflicted: null };
    if (det && !overlay) return { value: det, conflict: false, overlayValueIfConflicted: null };
    if (!det && !overlay) return { value: null, conflict: false, overlayValueIfConflicted: null };

    // Both exist.
    if (det && overlay && isMeaningfulDiff(det, overlay)) {
      return { value: det, conflict: true, overlayValueIfConflicted: overlay };
    }
    return { value: det, conflict: false, overlayValueIfConflicted: null };
  };

  const overlayOneLiner = overlayVM.hero_summary || governedInterpretationText || overviewDealOneLinerCanonical;
  const overlayParagraphs: string[] = overlayVM.deal_summary_paragraphs.length > 0
    ? overlayVM.deal_summary_paragraphs
    : overviewDealSummaryParagraphsCanonical;
  const overlayStrengths: string[] = overlayVM.strengths.length > 0 ? overlayVM.strengths : decisionTileStrengths;
  const overlayOpenItems: string[] = overlayVM.open_items.length > 0 ? overlayVM.open_items : decisionTileOpenItemsAll;

  const overlayProduct = overlayVM.facts.product || overviewProductCanonical;
  const overlayMarketIcp = overlayVM.facts.market_icp || overviewMarketIcpCanonical;
  const overlayBusinessModel = overlayVM.facts.business_model || overviewBusinessModelCanonical;
  const overlayRaiseTerms = overlayVM.facts.raise_terms || overviewRaiseTermsCanonical;

  const structuredTeamHighlights = (structuredSummaryRoot as any)?.team_highlights ?? null;
  const structuredUseOfFunds = (structuredSummaryRoot as any)?.use_of_funds_breakdown ?? null;
  const structuredProjectPipeline = (structuredSummaryRoot as any)?.project_pipeline ?? null;
  const structuredRevenueModel = (structuredSummaryRoot as any)?.revenue_model ?? null;

  const workspaceOverviewModel = useMemo(() => {
    const rcS6Input = structuredSummaryRoot
      ? {
          team_highlights: structuredTeamHighlights,
          use_of_funds_breakdown: structuredUseOfFunds,
          project_pipeline: structuredProjectPipeline,
          revenue_model: {
            structured: { value: structuredRevenueModel ?? null },
          },
        }
      : undefined;

    return selectDealWorkspaceOverviewModel({
      summaries: {
        short: {
          structured: { value: canonicalTierOverview || canonicalTierHero || canonicalDealOneLiner || null },
          deal_summary_v1: { value: canonicalDealOneLiner || null },
          overlay: { value: overlayVM.hero_summary || null },
          phase1: { value: overviewDealOneLiner || null },
        },
        long: {
          structured: { value: canonicalTierDeep || null, paragraphs: canonicalParagraphs },
          deal_summary_v1: { value: canonicalTierDeep || null, paragraphs: canonicalParagraphs },
          deterministicSlot: { value: overviewDealSummaryParagraphsCanonical.join('\n\n'), paragraphs: overviewDealSummaryParagraphsCanonical },
          overlay: { value: overlayParagraphs.join('\n\n'), paragraphs: overlayParagraphs },
          phase1: { value: overviewDealSummaryParagraphs.join('\n\n'), paragraphs: overviewDealSummaryParagraphs },
        },
      },
      keyFacts: {
        product: {
          structured: { value: authoritativeProductTextV1 || null },
          deal_summary_v1: { value: canonicalProduct || null },
          deterministicSlot: { value: deterministicOverviewSlots.product?.value ?? null },
          overlay: { value: overlayProduct || null },
          phase1: { value: overviewProduct || null },
        },
        market: {
          structured: { value: authoritativeMarketTextV1 || null },
          deal_summary_v1: { value: canonicalMarket || null },
          deterministicSlot: { value: deterministicOverviewSlots.market?.value ?? null },
          overlay: { value: overlayMarketIcp || null },
          phase1: { value: overviewMarketIcp || null },
        },
        business_model: {
          structured: { value: authoritativeBusinessModel.value || null },
          deal_summary_v1: { value: overviewBusinessModelCanonical || null },
          deterministicSlot: { value: deterministicOverviewSlots.business_model?.value ?? null },
          overlay: { value: overlayBusinessModel || null },
          phase1: { value: overviewBusinessModel || null },
        },
        raise_terms: {
          structured: { value: reportStructuredRaise || null },
          deal_summary_v1: { value: overviewRaiseTermsCanonical || null },
          overlay: { value: overlayRaiseTerms || null },
          phase1: { value: overviewRaiseTerms || null },
        },
      },
      rcS6: rcS6Input,
    });
  }, [
    authoritativeBusinessModel.value,
    authoritativeMarketTextV1,
    authoritativeProductTextV1,
    canonicalDealOneLiner,
    canonicalParagraphs,
    canonicalProduct,
    canonicalMarket,
    canonicalTierDeep,
    canonicalTierHero,
    canonicalTierOverview,
    deterministicOverviewSlots.product?.value,
    deterministicOverviewSlots.market?.value,
    deterministicOverviewSlots.business_model?.value,
    overviewDealOneLiner,
    overviewDealSummaryParagraphs,
    overviewDealSummaryParagraphsCanonical,
    overlayParagraphs,
    overlayProduct,
    overlayMarketIcp,
    overlayBusinessModel,
    overlayRaiseTerms,
    reportStructuredRaise,
    overviewRaiseTerms,
    overviewProduct,
    overviewMarketIcp,
    overviewBusinessModel,
    overlayVM.hero_summary,
    overlayVM.deal_summary_paragraphs,
    deterministicOverviewSlots,
    structuredSummaryRoot,
    structuredTeamHighlights,
    structuredUseOfFunds,
    structuredProjectPipeline,
    structuredRevenueModel,
  ]);

  const overviewInsightsData = useMemo(() => {
    if (!investorInsights.report) return null;
    return adaptReportToInsightsData(investorInsights.report, displayName);
  }, [investorInsights.report, displayName]);

  const kpiMissingTooltip = 'Not extracted from evidence';
  const overlayKpiTiles = useMemo(() => {
    // When /report is ready, keep the governed overlay KPIs consistent with report.structured_summary
    // (overlay KPI strings are treated as narrative-only, since they can drift).
    const raise = selectedHeader.ready
      ? (selectedHeader.raise.value ?? null)
      : (safeText(reportStructuredRaise) || safeText(overviewRaiseTermsCanonical) || null);

    const revenue = !revenueCoveragePolicy.allow
      ? null
      : selectedHeader.ready
        ? (selectedHeader.revenue.value ?? null)
        : (overlayVM.kpis.revenue?.value ?? null);

    const growth = selectedHeader.ready
      ? (selectedHeader.growth.value ?? null)
      : (overlayVM.kpis.growth?.value ?? null);

    const customers = selectedHeader.ready
      ? (selectedHeader.customers.value ?? null)
      : (overlayVM.kpis.customers?.value ?? null);
    return [
      { label: 'Raise', value: raise ?? '—', tooltipIfMissing: kpiMissingTooltip },
      { label: revenueCoveragePolicy.kpiTileLabel, value: revenue ?? '—', tooltipIfMissing: kpiMissingTooltip },
      { label: 'Growth', value: growth ?? '—', tooltipIfMissing: kpiMissingTooltip },
      { label: 'Customers', value: customers ?? '—', tooltipIfMissing: kpiMissingTooltip },
    ];
  }, [overlayVM, reportStructuredRaise, overviewRaiseTermsCanonical, selectedHeader, revenueCoveragePolicy.allow, revenueCoveragePolicy.kpiTileLabel]);

  const deterministicKpiTiles = useMemo(() => {
    const raise = safeText(reportStructuredRaise) || safeText(overviewRaiseTermsCanonical) || null;
    const revenue = !revenueCoveragePolicy.allow
      ? null
      : selectedHeader.ready
        ? (selectedHeader.revenue.value ?? null)
        : (safeText(reportView.revenue) || safeText(topSectionRevenue) || null);
    const growth = safeText(reportStructuredGrowthValue) || safeText(topSectionGrowth) || null;
    const customers = safeText(reportView.customers) || safeText(topSectionCustomers) || null;
    return [
      { label: 'Raise', value: raise ?? '—', tooltipIfMissing: kpiMissingTooltip },
      { label: revenueCoveragePolicy.kpiTileLabel, value: revenue ?? '—', tooltipIfMissing: kpiMissingTooltip },
      { label: 'Growth', value: growth ?? '—', tooltipIfMissing: kpiMissingTooltip },
      { label: 'Customers', value: customers ?? '—', tooltipIfMissing: kpiMissingTooltip },
    ];
  }, [reportStructuredRaise, overviewRaiseTermsCanonical, reportView.revenue, topSectionRevenue, reportStructuredGrowthValue, topSectionGrowth, reportView.customers, topSectionCustomers, selectedHeader.ready, selectedHeader.revenue.value, revenueCoveragePolicy.allow, revenueCoveragePolicy.kpiTileLabel]);

  type KeyFactProvenance = { source: 'deterministic' | 'governed' | 'missing'; needsReview?: boolean };
  const keyFactMissingText = 'Not extracted from evidence';
  const normalizeKeyFactText = (value: unknown): string | null => {
    const s = safeText(value);
    if (!s) return null;
    if (s === '—') return null;
    return s;
  };

  const governedKeyFacts = useMemo(() => {
    const ovMissing = workspaceMirrorVM.missing;
    const ovFacts = ovMissing ? null : (workspaceMirrorVM.facts as any);

    const reportGating = deriveGatingState({
      reportStatus: investorInsights.report?.status,
      evidenceGate:
        investorInsights.report?.status_summary?.evidence_gate ??
        investorInsights.report?.render_package?.evidence_gate,
    });
    const suppressNeedsReview = shouldSuppressNeedsReview(reportGating);

    const overviewKeyFacts = workspaceOverviewModel.keyFacts;
    const buildFactFromOverview = (
      field: typeof overviewKeyFacts.product,
      overlayNode: { quality?: string } | null,
    ) => {
      const normalized = safeText(field?.value ?? '');
      const hasValue = Boolean(normalized);
      const fromOverlay = field?.source === 'overlay';
      const provenanceSource: 'deterministic' | 'governed' | 'missing' = hasValue
        ? (fromOverlay ? 'governed' : 'deterministic')
        : 'missing';
      const needsReview = fromOverlay && overlayNode?.quality === 'fallback' && !suppressNeedsReview;
      return {
        value: hasValue ? normalized : keyFactMissingText,
        provenance: needsReview
          ? { source: provenanceSource, needsReview: true as const }
          : { source: provenanceSource },
        fromOverlay,
        trust: field?.trust ?? 'not_extracted',
        conflict: field?.conflict ?? null,
      };
    };

    const product = buildFactFromOverview(overviewKeyFacts.product, ovFacts ? ovFacts.product_solution ?? null : null);
    const market = buildFactFromOverview(overviewKeyFacts.market, ovFacts ? ovFacts.market_icp ?? null : null);
    const businessModel = buildFactFromOverview(overviewKeyFacts.business_model, ovFacts ? ovFacts.business_model ?? null : null);
    const raise = buildFactFromOverview(overviewKeyFacts.raise_terms, ovFacts ? ovFacts.raise ?? null : null);

    if (!looksRealEstate) {
      return { product, market, businessModel, raise, realEstateSemanticDiagnostics: null };
    }

    const assetFacilityCandidates = [
      { value: ovFacts?.product_solution?.value ?? null, source: 'governed_ui_copy.product_solution', lane: 'governed' },
      { value: overviewKeyFacts.product.value, source: 'overview.structured.product', lane: product.fromOverlay ? 'governed' : 'deterministic' },
      { value: authoritativeProductTextV1, source: 'report.structured_summary.product_summary_v1', lane: 'deterministic' },
      { value: canonicalProduct, source: 'report.deal_summary_v1.product.text', lane: 'deterministic' },
      { value: overviewProductCanonical, source: 'overview.product.canonical', lane: 'deterministic' },
      { value: product.value, source: 'governedKeyFacts.product', lane: product.provenance.source === 'governed' ? 'governed' : 'deterministic' },
    ] as const;

    const assetFacilitySelection = selectBestRealEstateSemanticField('asset_facility', [...assetFacilityCandidates]);

    const submarketDemandCandidates = [
      { value: ovFacts?.market_icp?.value ?? null, source: 'governed_ui_copy.market_icp', lane: 'governed' },
      { value: overviewKeyFacts.market.value, source: 'overview.structured.market', lane: market.fromOverlay ? 'governed' : 'deterministic' },
      { value: authoritativeMarketTextV1, source: 'report.structured_summary.market_summary_v1', lane: 'deterministic' },
      { value: canonicalMarket, source: 'report.deal_summary_v1.market_target.text', lane: 'deterministic' },
      { value: overviewMarketIcpCanonical, source: 'overview.market.canonical', lane: 'deterministic' },
      { value: market.value, source: 'governedKeyFacts.market', lane: market.provenance.source === 'governed' ? 'governed' : 'deterministic' },
    ] as const;

    const submarketDemandSelection = selectBestRealEstateSemanticField('submarket_demand', [...submarketDemandCandidates], {
      excludeValues: assetFacilitySelection.value ? [assetFacilitySelection.value] : [],
    });

    const dealStructureSelection = selectBestRealEstateSemanticField('deal_structure', [
      { value: ovFacts?.raise?.value ?? null, source: 'governed_ui_copy.raise', lane: 'governed' },
      { value: ovFacts?.business_model?.value ?? null, source: 'governed_ui_copy.business_model', lane: 'governed' },
      { value: overviewKeyFacts.business_model.value, source: 'overview.structured.business_model', lane: businessModel.fromOverlay ? 'governed' : 'deterministic' },
      { value: selectedHeader.business_model.value ?? null, source: 'report.header.business_model', lane: 'deterministic' },
      { value: selectedHeader.raise.value ?? null, source: 'report.header.raise', lane: 'deterministic' },
      { value: overviewRaiseTermsCanonical, source: 'overview.raise_terms.canonical', lane: 'deterministic' },
      { value: overviewBusinessModelCanonical, source: 'overview.business_model.canonical', lane: 'deterministic' },
      { value: reportView.businessModel, source: 'reportView.businessModel', lane: 'deterministic' },
      { value: businessModel.value, source: 'governedKeyFacts.businessModel', lane: businessModel.provenance.source === 'governed' ? 'governed' : 'deterministic' },
      { value: raise.value, source: 'governedKeyFacts.raise', lane: raise.provenance.source === 'governed' ? 'governed' : 'deterministic' },
    ]);

    const toProvenance = (lane: 'governed' | 'deterministic' | 'fallback' | 'missing'): 'governed' | 'deterministic' | 'missing' => {
      if (lane === 'governed') return 'governed';
      if (lane === 'missing') return 'missing';
      return 'deterministic';
    };

    const normalizeForCollision = (value: string | null | undefined): string =>
      String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const extractConciseRaise = (value: string | null | undefined): string | null => {
      const s = String(value ?? '').trim();
      if (!s) return null;
      const parts = s.match(/\$\s*[\d,]+(?:\.\d+)?\s*(?:k|m|mm|million|b|bn|billion)?/gi) ?? [];
      const compact = parts
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter((p) => /\d/.test(p));
      if (compact.length === 0) return null;
      return compact.slice(0, 2).join(' + ');
    };

    const productRefined = assetFacilitySelection.value
      ? {
          ...product,
          value: assetFacilitySelection.value,
          provenance: { source: toProvenance(assetFacilitySelection.lane) },
          fromOverlay: assetFacilitySelection.lane === 'governed',
        }
      : { ...product, value: keyFactMissingText, provenance: { source: 'missing' as const }, fromOverlay: false };

    const marketRefined = submarketDemandSelection.value
      ? {
          ...market,
          value: submarketDemandSelection.value,
          provenance: { source: toProvenance(submarketDemandSelection.lane) },
          fromOverlay: submarketDemandSelection.lane === 'governed',
        }
      : { ...market, value: keyFactMissingText, provenance: { source: 'missing' as const }, fromOverlay: false };

    const dealStructureFallback = getRealEstateDealStructureFallback([
      selectedHeader.business_model.value,
      selectedHeader.raise.value,
      overviewRaiseTermsCanonical,
      overviewBusinessModelCanonical,
      reportView.businessModel,
    ].filter((v): v is string => typeof v === 'string').join(' '));

    const businessModelRefined = {
      ...businessModel,
      value: dealStructureSelection.value || dealStructureFallback,
      provenance: { source: dealStructureSelection.value ? toProvenance(dealStructureSelection.lane) : 'deterministic' as const },
      fromOverlay: dealStructureSelection.lane === 'governed',
    };

    const raiseCandidatesForConcise = [
      selectedHeader.raise.value,
      reportCanonicalRaise.value,
      overviewKeyFacts.raise_terms.value,
      overviewRaiseTermsCanonical,
      raise.value,
    ];
    const conciseRaise = raiseCandidatesForConcise
      .map((v) => extractConciseRaise(v))
      .find((v): v is string => typeof v === 'string' && v.trim().length > 0);

    const raiseCollidesWithDealStructure = normalizeForCollision(raise.value) !== ''
      && normalizeForCollision(raise.value) === normalizeForCollision(businessModelRefined.value);

    const raiseRefined = raiseCollidesWithDealStructure
      ? {
          ...raise,
          value: conciseRaise && normalizeForCollision(conciseRaise) !== normalizeForCollision(businessModelRefined.value)
            ? conciseRaise
            : keyFactMissingText,
          provenance: {
            source: conciseRaise && normalizeForCollision(conciseRaise) !== normalizeForCollision(businessModelRefined.value)
              ? ('deterministic' as const)
              : ('missing' as const),
          },
          fromOverlay: false,
        }
      : raise;

    return {
      product: productRefined,
      market: marketRefined,
      businessModel: businessModelRefined,
      raise: raiseRefined,
      realEstateSemanticDiagnostics: {
        assetFacility: assetFacilitySelection,
        submarketDemand: submarketDemandSelection,
        dealStructure: dealStructureSelection,
        duplicateSuppression: {
          applied: Boolean(assetFacilitySelection.value),
          excludedFromSubmarket: assetFacilitySelection.value ? [assetFacilitySelection.value] : [],
        },
        raiseBusinessModelCollision: {
          suppressed: raiseCollidesWithDealStructure,
          conciseRaiseCandidate: conciseRaise,
        },
      },
    };
  }, [
    workspaceMirrorVM,
    workspaceOverviewModel,
    overviewProductCanonical,
    overviewMarketIcpCanonical,
    overviewBusinessModelCanonical,
    overviewRaiseTermsCanonical,
    authoritativeProductTextV1,
    authoritativeMarketTextV1,
    canonicalProduct,
    canonicalMarket,
    investorInsights.report,
    looksRealEstate,
    selectedHeader.business_model.value,
    selectedHeader.raise.value,
    reportView.businessModel,
    reportCanonicalRaise.value,
  ]);

  type HeroFieldRole = 'product' | 'market' | 'business_model' | 'raise';
  type HeroSourceTier =
    | 'display_facts_v1'
    | 'policy_resolved'
    | 'governed_ui_copy_v1'
    | 'deal_overview_v2'
    | 'deal_summary_v2'
    | 'summary_text'
    // [CONTRACT] Approved report-layer sources:
    | 'investment_analysis_overview_v2'
    | 'executive_summary_v1';

  type HeroFieldCandidate = {
    tier: HeroSourceTier;
    sourcePath: string;
    value: string;
  };

  type HeroFieldBinding = {
    role: HeroFieldRole;
    value: string | null;
    sourcePathUsed: string;
    sourceTierUsed: HeroSourceTier;
    fallbackUsed: boolean;
    hiddenDueToFormatting: boolean;
    hiddenDueToDedupe: boolean;
    rejectedSources: Array<{ sourcePath: string; reason: string; value: string }>;
    rawCandidates: HeroFieldCandidate[];
  };

  const chooseHeroFieldByPrecedence = (
    role: HeroFieldRole,
    candidates: HeroFieldCandidate[],
  ): HeroFieldBinding => {
    const cleaned = candidates
      .map((c) => ({ ...c, value: safeText(c.value) }))
      .filter((c) => c.value.length > 0);

    const rejected: Array<{ sourcePath: string; reason: string; value: string }> = [];
    for (const c of cleaned) {
      const malformed = role === 'raise' ? hasMalformedNumericPlaceholder(c.value) : false;
      if (malformed) {
        rejected.push({ sourcePath: c.sourcePath, reason: 'malformed_or_placeholder', value: c.value });
        continue;
      }
      return {
        role,
        value: c.value,
        sourcePathUsed: c.sourcePath,
        sourceTierUsed: c.tier,
        fallbackUsed: c.tier !== 'display_facts_v1' && c.tier !== 'policy_resolved',
        hiddenDueToFormatting: false,
        hiddenDueToDedupe: false,
        rejectedSources: rejected,
        rawCandidates: cleaned,
      };
    }

    return {
      role,
      value: null,
      sourcePathUsed: 'missing',
      sourceTierUsed: 'summary_text',
      fallbackUsed: false,
      hiddenDueToFormatting: cleaned.length > 0,
      hiddenDueToDedupe: false,
      rejectedSources: rejected,
      rawCandidates: cleaned,
    };
  };

  const heroFieldBindings = useMemo(() => {
    // Universal precedence for hero/header binding:
    // display_facts_v1 -> policy_resolved -> governed_ui_copy_v1 -> deal_overview_v2 -> deal_summary_v2 -> summary_text.
    const ovFacts = workspaceMirrorVM.missing ? null : (workspaceMirrorVM.facts as any);
    const phase1 = (governedOverview as any)?.overview?.overview_json?.phase1 ?? null;
    const phase1DealSummaryV2 = phase1?.deal_summary_v2 ?? null;

    const buildRoleCandidates = (role: HeroFieldRole): HeroFieldCandidate[] => {
      if (role === 'product') {
        return [
          { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.product_solution.text', value: safeText(displayFactsV1?.product_solution?.text) },
          { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.product.text', value: safeText(displayFactsV1?.product?.text) },
          { tier: 'policy_resolved', sourcePath: 'policy_resolved.product', value: safeText(governedKeyFacts.product.value) },
          { tier: 'governed_ui_copy_v1', sourcePath: 'overview_json.phase1.governed_ui_copy_v1.product_solution', value: safeText(ovFacts?.product_solution?.value) },
          { tier: 'deal_overview_v2', sourcePath: 'overview_json.phase1.deal_overview_v2.product_solution', value: safeText(overviewV2?.product_solution) },
          { tier: 'deal_summary_v2', sourcePath: 'overview_json.phase1.deal_summary_v2.product.text', value: safeText((phase1DealSummaryV2 as any)?.product?.text) || safeText((dealSummaryV2 as any)?.product?.text) },
        ];
      }
      if (role === 'market') {
        return [
          { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.market_icp.text', value: safeText(displayFactsV1?.market_icp?.text) },
          { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.market.text', value: safeText(displayFactsV1?.market?.text) },
          { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.submarket.text', value: safeText(displayFactsV1?.submarket?.text) },
          { tier: 'policy_resolved', sourcePath: 'policy_resolved.market', value: safeText(governedKeyFacts.market.value) },
          { tier: 'governed_ui_copy_v1', sourcePath: 'overview_json.phase1.governed_ui_copy_v1.market_icp', value: safeText(ovFacts?.market_icp?.value) },
          { tier: 'deal_overview_v2', sourcePath: 'overview_json.phase1.deal_overview_v2.market_icp', value: safeText(overviewV2?.market_icp) },
          { tier: 'deal_summary_v2', sourcePath: 'overview_json.phase1.deal_summary_v2.market.text', value: safeText((phase1DealSummaryV2 as any)?.market?.text) || safeText((dealSummaryV2 as any)?.market?.text) },
        ];
      }
      if (role === 'business_model') {
        return [
          { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.business_model.text', value: safeText(displayFactsV1?.business_model?.text) },
          { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.deal_structure.text', value: safeText(displayFactsV1?.deal_structure?.text) },
          { tier: 'policy_resolved', sourcePath: 'policy_resolved.business_model', value: safeText(governedKeyFacts.businessModel.value) },
          { tier: 'governed_ui_copy_v1', sourcePath: 'overview_json.phase1.governed_ui_copy_v1.business_model', value: safeText(ovFacts?.business_model?.value) },
          { tier: 'deal_overview_v2', sourcePath: 'overview_json.phase1.deal_overview_v2.business_model', value: safeText(overviewV2?.business_model) },
          { tier: 'deal_summary_v2', sourcePath: 'overview_json.phase1.deal_summary_v2.business_model', value: safeText((phase1DealSummaryV2 as any)?.business_model) || safeText((dealSummaryV2 as any)?.business_model) },
        ];
      }
      return [
        { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.raise_terms.text', value: safeText(displayFactsV1?.raise_terms?.text) },
        { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.raise.text', value: safeText(displayFactsV1?.raise?.text) },
        { tier: 'display_facts_v1', sourcePath: 'overview_json.display_facts_v1.terms.text', value: safeText(displayFactsV1?.terms?.text) },
        { tier: 'policy_resolved', sourcePath: 'policy_resolved.raise', value: safeText(governedKeyFacts.raise.value) },
        { tier: 'governed_ui_copy_v1', sourcePath: 'overview_json.phase1.governed_ui_copy_v1.raise_terms', value: safeText(ovFacts?.raise?.value) },
        { tier: 'deal_overview_v2', sourcePath: 'overview_json.phase1.deal_overview_v2.raise', value: safeText(overviewV2?.raise) },
        { tier: 'deal_summary_v2', sourcePath: 'overview_json.phase1.deal_summary_v2.raise', value: safeText((phase1DealSummaryV2 as any)?.raise) || safeText((dealSummaryV2 as any)?.raise) },
      ];
    };

    const product = chooseHeroFieldByPrecedence('product', buildRoleCandidates('product'));
    const market = chooseHeroFieldByPrecedence('market', buildRoleCandidates('market'));
    const businessModel = chooseHeroFieldByPrecedence('business_model', buildRoleCandidates('business_model'));
    const raise = chooseHeroFieldByPrecedence('raise', buildRoleCandidates('raise'));

    if (product.value && market.value && normalizeHeroText(product.value) === normalizeHeroText(market.value)) {
      market.hiddenDueToDedupe = true;
      market.rejectedSources.push({ sourcePath: market.sourcePathUsed, reason: 'duplicate_with_product', value: market.value });
      market.value = null;
      market.sourcePathUsed = 'suppressed.duplicate_with_product';
    }

    const policySummary = (() => {
      const p = safeText(product.value);
      const m = safeText(market.value);
      const bm = safeText(businessModel.value);
      if (looksRealEstate) {
        if (p && m) return `Asset / facility: ${p}. Submarket / demand: ${m}.`;
        if (p) return `Asset / facility: ${p}.`;
        if (m) return `Submarket / demand: ${m}.`;
      }
      if (p && m) return `Company sells ${p} and targets ${m}.`;
      if (p) return `Company sells ${p}.`;
      if (m) return `Target market / ICP: ${m}.`;
      if (bm) return `Business model: ${bm}.`;
      return '';
    })();

    // [CONTRACT: DataFlow_contract.md §2.4] Company Description sources (hard stop after first valid):
    //   1. report.investment_analysis_overview_v2.summary
    //   2. report.executive_summary_v1.summary
    // Forbidden: display_facts_v1.hero_summary, governed_ui_copy_v1.hero_summary,
    //   deal_overview_v2.summary_text, deal_summary_v2.summary.one_liner, overview.summary_text.
    const oneLiner = chooseHeroFieldByPrecedence('product', [
      { tier: 'investment_analysis_overview_v2', sourcePath: 'report.investment_analysis_overview_v2.summary', value: safeText((reportFromApi as any)?.investment_analysis_overview_v2?.summary) },
      { tier: 'executive_summary_v1', sourcePath: 'report.executive_summary_v1.summary', value: safeText((reportFromApi as any)?.executive_summary_v1?.summary) },
    ]);

    if (oneLiner.value && isLowQualityHeroSummary(oneLiner.value)) {
      oneLiner.rejectedSources.push({
        sourcePath: oneLiner.sourcePathUsed,
        reason: 'low_quality_or_ocr_like_summary',
        value: oneLiner.value,
      });
      oneLiner.value = null;
      oneLiner.sourcePathUsed = 'suppressed.low_quality_or_ocr_like_summary';
      oneLiner.hiddenDueToFormatting = true;
    }

    return { product, market, businessModel, raise, oneLiner };
  }, [workspaceMirrorVM, governedOverview, overviewV2, dealSummaryV2, governedKeyFacts, looksRealEstate, displayFactsV1]);

  const lastWorkspaceSourcesLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!workspaceDebugEnabled) return;
    if (!dealId) return;

    const overlaySig = `${governedOverview.created_at ?? 'na'}|${String(governedOverview.input_hash ?? '').slice(0, 12)}`;
    const reportSig = `${reportReady ? 'ready' : 'not_ready'}|${typeof reportVersion === 'number' ? reportVersion : 'na'}`;
    const key = `${dealId}|${reportSig}|${overlaySig}`;
    if (lastWorkspaceSourcesLogRef.current === key) return;
    lastWorkspaceSourcesLogRef.current = key;

    console.info('[DDAI][dealworkspace_sources]', {
      dealId,
      report: { ready: reportReady, version: reportVersion ?? null },
      overlay: { status: governedOverview.status, created_at: governedOverview.created_at ?? null },
      selectedHeader,
      overlayKpisRaw: overlayVM.kpis,
      governedKeyFacts,
    });
  }, [workspaceDebugEnabled, dealId, reportReady, reportVersion, governedOverview.status, governedOverview.created_at, governedOverview.input_hash, selectedHeader, overlayVM, governedKeyFacts]);

  const overviewProvenanceDebugEnabled = useMemo(() => {
    try {
      if (typeof window === 'undefined') return false;
      const qs = new URLSearchParams(window.location.search);
      if (qs.get('debug') === '1') return true;
      const env = String((import.meta as any)?.env?.VITE_DDAI_OVERVIEW_DEBUG ?? '').trim().toLowerCase();
      return env === '1' || env === 'true' || env === 'yes' || env === 'on';
    } catch {
      return false;
    }
  }, []);
  const overviewProvenanceDebugByFieldKey = useMemo(() => {
    if (!dealId) return {} as Record<string, string>;

    const overlayCreatedAt = governedOverview.created_at ?? null;
    const overlayHash = governedOverview.input_hash ?? null;
    const overlaySig = `overlay.created_at=${overlayCreatedAt ?? '—'} overlay.hash=${overlayHash ? overlayHash.slice(0, 12) : '—'}`;

    const reportGeneratedAt = (reportEnvelope as any)?.generatedAt ?? null;
    const reportVer = (reportEnvelope as any)?.version;
    const reportSig = `report.generatedAt=${reportGeneratedAt ?? '—'} report.version=${typeof reportVer === 'number' ? reportVer : '—'}`;

    const srcKeyFact = (prov: KeyFactProvenance, detSrc: string, governedSrc: string): string => {
      if (prov.source === 'governed') return `src=${governedSrc} ${overlaySig}`;
      if (prov.source === 'deterministic') return `src=${detSrc} ${reportSig}`;
      return `src=missing ${overlaySig} ${reportSig}`;
    };

    const listsFromGovernedUiCopy = !workspaceMirrorVM.missing && Boolean((workspaceMirrorVM as any)?.facts?.product_solution?.evidence_refs);

    return {
      'deal-one-liner': `src=display_facts_v1.hero_summary -> policy_resolved -> governed_ui_copy_v1.hero_summary -> deal_overview_v2 -> deal_summary_v2.summary.one_liner -> overview.summary_text ${overlaySig}`,
      'product-solution': srcKeyFact(
        governedKeyFacts.product.provenance,
        canonicalDealSummaryReady ? 'deal_summary_v2.product (canonical)' : 'deal_summary_v2.product (canonical/fallback)',
        'overview_json.phase1.governed_ui_copy_v1.product_solution'
      ),
      'market-icp': srcKeyFact(
        governedKeyFacts.market.provenance,
        canonicalDealSummaryReady ? 'deal_summary_v2.market (canonical)' : 'deal_summary_v2.market (canonical/fallback)',
        'overview_json.phase1.governed_ui_copy_v1.market_icp'
      ),
      'business-model': srcKeyFact(
        governedKeyFacts.businessModel.provenance,
        'deal_summary_v2.business_model (canonical/fallback)',
        'overview_json.phase1.governed_ui_copy_v1.business_model'
      ),
      'raise-terms': srcKeyFact(
        governedKeyFacts.raise.provenance,
        'deal_summary_v2.raise (canonical/fallback)',
        'overview_json.phase1.governed_ui_copy_v1.raise_terms'
      ),
      'strengths': `src=${listsFromGovernedUiCopy ? 'overview_json.phase1.governed_ui_copy_v1.strengths' : 'overview_json.phase1.deal_summary_v2.strengths'} ${overlaySig}`,
      'concerns': `src=${listsFromGovernedUiCopy ? 'overview_json.phase1.governed_ui_copy_v1.concerns' : 'overview_json.phase1.deal_summary_v2.risks'} ${overlaySig}`,
      'open-questions': `src=${listsFromGovernedUiCopy ? 'overview_json.phase1.governed_ui_copy_v1.open_questions' : 'overview_json.phase1.deal_summary_v2.open_questions'} ${overlaySig}`,
      'traction': `src=${listsFromGovernedUiCopy ? 'overview_json.phase1.governed_ui_copy_v1.traction' : 'overview_json.phase1.deal_overview_v2.traction_signals'} ${overlaySig}`,
    };
  }, [dealId, governedOverview.created_at, governedOverview.input_hash, reportEnvelope, canonicalDealSummaryReady, governedKeyFacts, workspaceMirrorVM]);

  const governedKeyFactEvidenceIds = useMemo(() => {
    if (workspaceMirrorVM.missing) {
      return {
        product: [] as string[],
        market: [] as string[],
        businessModel: [] as string[],
        raise: [] as string[],
      };
    }

    const facts = workspaceMirrorVM.facts as any;
    const toIds = (xs: unknown): string[] => {
      if (!Array.isArray(xs)) return [];
      return xs
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
        .slice(0, 25);
    };

    return {
      product: governedKeyFacts.product.fromOverlay ? toIds(facts?.product_solution?.evidence_ids) : [],
      market: governedKeyFacts.market.fromOverlay ? toIds(facts?.market_icp?.evidence_ids) : [],
      businessModel: governedKeyFacts.businessModel.fromOverlay ? toIds(facts?.business_model?.evidence_ids) : [],
      raise: governedKeyFacts.raise.fromOverlay ? toIds(facts?.raise?.evidence_ids) : [],
    };
  }, [workspaceMirrorVM, governedKeyFacts]);

  const governedKeyFactEvidenceRefs = useMemo(() => {
    if (workspaceMirrorVM.missing) {
      return {
        one_liner: undefined as any,
        product: undefined as any,
        market: undefined as any,
        businessModel: undefined as any,
        raise: undefined as any,
        strengths: undefined as any,
        concerns: undefined as any,
        open_questions: undefined as any,
        traction: undefined as any,
      };
    }

    const facts = workspaceMirrorVM.facts as any;
    const governedUiCopyAvailable = typeof facts?.product_solution?.evidence_refs !== 'undefined';
    if (!governedUiCopyAvailable) {
      return {
        one_liner: undefined as any,
        product: undefined as any,
        market: undefined as any,
        businessModel: undefined as any,
        raise: undefined as any,
        strengths: undefined as any,
        concerns: undefined as any,
        open_questions: undefined as any,
        traction: undefined as any,
      };
    }

    const refBlock = (workspaceMirrorVM as any).evidence_refs as any;

    const toRefsOrEmpty = (xs: unknown): any[] => {
      if (!Array.isArray(xs)) return [];
      return xs
        .filter((v) => v && typeof v === 'object' && typeof (v as any).source_document_id === 'string')
        .slice(0, 12);
    };

    const toRefsOrUndefined = (xs: unknown): any[] | undefined => {
      if (!Array.isArray(xs)) return undefined;
      return toRefsOrEmpty(xs);
    };

    return {
      one_liner: toRefsOrEmpty(refBlock?.deal_one_liner),
      product: governedKeyFacts.product.provenance.source === 'governed'
        ? toRefsOrUndefined(facts?.product_solution?.evidence_refs)
        : (authoritativeProductSummaryV1.sources.length > 0 ? authoritativeProductSummaryV1.sources : undefined),
      market: governedKeyFacts.market.provenance.source === 'governed'
        ? toRefsOrUndefined(facts?.market_icp?.evidence_refs)
        : (authoritativeMarketSummaryV1.sources.length > 0 ? authoritativeMarketSummaryV1.sources : undefined),
      businessModel: governedKeyFacts.businessModel.provenance.source === 'governed' ? toRefsOrUndefined(facts?.business_model?.evidence_refs) : undefined,
      raise: governedKeyFacts.raise.provenance.source === 'governed' ? toRefsOrUndefined(facts?.raise?.evidence_refs) : undefined,
      strengths: toRefsOrEmpty(refBlock?.strengths),
      concerns: toRefsOrEmpty(refBlock?.concerns),
      open_questions: toRefsOrEmpty(refBlock?.open_questions),
      traction: toRefsOrEmpty(refBlock?.traction),
    };
  }, [workspaceMirrorVM, governedKeyFacts, authoritativeProductSummaryV1.sources, authoritativeMarketSummaryV1.sources]);

  // [CONTRACT: DataFlow_contract.md §2.4] Company Description: only contract-approved sources.
  // canonicalTierOverview/canonicalTierHero are not contract-approved for this slot.
  const governedDealOneLinerDisplay = useMemo(() => {
    return safeText(heroFieldBindings.oneLiner.value) || 'Not extracted';
  }, [heroFieldBindings]);

  const dealSummarySourceLabel = canonicalDealSummaryReady ? 'Authoritative (deterministic)' : 'Legacy';

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
      debugLogger.logFallbackData('DealWorkspace', 'displayScore', displayScore, `No API score available, using fallback reportBandScore (${reportBandScore})`);
    }
  }, [displayScore, reportBandScore]);

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
    let controller: AbortController | null = null;

    // New job => reset connection indicator.
    setJobPollConnection({ status: 'connected', consecutiveFailures: 0, lastError: null });

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

    const abortInFlight = () => {
      if (!controller) return;
      try {
        controller.abort();
      } catch {
        // ignore
      }
      controller = null;
    };

    const backoffMsForFailures = (failures: number): number => {
      if (failures <= 1) return 2000;
      if (failures === 2) return 5000;
      if (failures === 3) return 10000;
      return 30000;
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
        abortInFlight();
        controller = new AbortController();
        const job = await apiGetJob(activeJobId, { signal: controller.signal });
        if (cancelled) return;
        consecutiveErrors = 0;

        setJobPollConnection({ status: 'connected', consecutiveFailures: 0, lastError: null });

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
        if (normalizedStatus === 'queued' || normalizedStatus === 'running' || normalizedStatus === 'retrying' || normalizedStatus === 'blocked') {
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
          // Sanitize job.message: filter out BullMQ internal error strings that
          // should never appear in the UI (e.g. "Custom Id cannot contain :").
          const rawJobMessage = job.message || normalizedStatus || 'completed';
          const analysisToastMessage = /custom id cannot contain/i.test(rawJobMessage)
            ? normalizedStatus || 'completed'
            : rawJobMessage;
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
            const toastSeverity =
              normalizedStatus === 'succeeded'
                ? 'success'
                : normalizedStatus === 'succeeded_with_warnings' || normalizedStatus === 'cancelled' || normalizedStatus === 'blocked'
                  ? 'warning'
                  : 'error';
            addToastOnce(
              analysisToastKey,
              toastSeverity,
              'Analysis completed',
              analysisToastMessage
            );
          }
            if ((normalizedStatus === 'succeeded' || normalizedStatus === 'succeeded_with_warnings') && dealId) {
            apiGetDeal(dealId)
              .then((deal) => {
                setDealFromApi(deal);
                const nextMeta = {
                  dioVersionId: (deal as any).dioVersionId,
                  dioStatus: (deal as any).dioStatus,
                  lastAnalyzedAt: (deal as any).lastAnalyzedAt,
                  dioRunCount: (deal as any).dioRunCount,
                  dioAnalysisVersion: (deal as any).dioAnalysisVersion,
                };
                setDioMeta(nextMeta);

                if (job.type === 'analyze_deal') {
                  reportMissingRef.current = false;
                  loadReport({ force: true, version: typeof nextMeta.dioAnalysisVersion === 'number' ? nextMeta.dioAnalysisVersion : null }).catch(() => {});
                }
              })
              .catch(() => {
                if (job.type === 'analyze_deal') {
                  reportMissingRef.current = false;
                  loadReport({ force: true, version: latestKnownVersionRef.current ?? null }).catch(() => {});
                }
              });
            if (job.type === 'analyze_deal') {

			  // After analysis completion, force-refresh the persisted governed overlay.
			  // If it's not present yet, bounded-poll for a short window.
			  const overlayKey = `overlay-post-analyze:${job.job_id}:${normalizedStatus}`;
			  if (!handledTerminalJobKeysRef.current.has(overlayKey)) {
			    handledTerminalJobKeysRef.current.add(overlayKey);
			    startOverlayPostAnalyzePolling();
			  }
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
        const aborted =
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && String(err.name).toLowerCase() === 'aborterror');
        if (aborted) return;

        consecutiveErrors += 1;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setJobPollConnection({ status: 'connected', consecutiveFailures: consecutiveErrors, lastError: message });

        // Keep the existing job status/message; just surface connection trouble and retry.
        if (consecutiveErrors === 1) {
          addToastOnce(`job-poll-flaky:${activeJobId}`, 'warning', 'Connection issue', 'Retrying job polling…');
        }

        if (consecutiveErrors >= 10) {
          clearPollTimer();
          setJobPollConnection({ status: 'disconnected', consecutiveFailures: consecutiveErrors, lastError: message });
          addToastOnce(`job-poll-disconnected:${activeJobId}`, 'error', 'Disconnected', 'Job polling failed repeatedly. Click Retry polling.');
          return;
        }

        const delay = backoffMsForFailures(consecutiveErrors);
        schedulePoll(Math.max(delay, sseReady ? 10000 : 0));
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearPollTimer();
      abortInFlight();
    };
  }, [activeJobId, jobPollNonce, sseReady]);

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
        // Read via ref so this logic uses the latest values without adding them to the
        // effect's dep array (which would cause the interval to restart on every SSE event).
        const {
          isFullProcessActive: fpActive,
          jobType: latestJobType,
          fullProcessExtractFinishedAt: fpExtractFinishedAt,
          fullProcessRunExtractJobId: fpRunExtractJobId,
        } = dealJobsPollStateRef.current;

        if (fpActive) {
          const runWindow = fullProcessRunWindowRef.current;
          const trackingThisRunExtract =
            !!fpRunExtractJobId &&
            !!activeJobId &&
            (activeJobId === fpRunExtractJobId || latestJobType === 'extract_visuals');

          if (runWindow && trackingThisRunExtract) {
            const best = selectAnalyzeJobInWindow(normalizedRows, runWindow);
            if (best?.job_id && best.job_id !== activeJobId) {
              const treatFailedAsPending =
                (best.type ?? '') === 'analyze_deal' &&
                isFailedJobStatus(best.status) &&
                isSupersedableAnalyzeFailure(best) &&
                (fpActive || shouldTreatRunAnalyzeFailureAsPending({ extractFinishedAt: fpExtractFinishedAt ?? null }));

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
        // Read latest volatile state from ref to pick the right interval without
        // restarting the whole effect every time jobStatus/isFullProcessActive changes.
        const { isFullProcessActive: fpActive, jobStatus: latestStatus } = dealJobsPollStateRef.current;
        const isActive = fpActive || latestStatus === 'queued' || latestStatus === 'running' || latestStatus === 'retrying';
        pollTimer = window.setTimeout(poll, isActive ? 2500 : 15000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimer();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId, dealId]);

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
            // Refresh report after analyze_deal only once the deal has been refreshed,
            // so the requested report version matches the header.
            loadEvidence();
            if (dealId) {
              apiGetDeal(dealId)
                .then((deal) => {
                  setDealFromApi(deal);
                  const nextMeta = {
                    dioVersionId: (deal as any).dioVersionId,
                    dioStatus: (deal as any).dioStatus,
                    lastAnalyzedAt: (deal as any).lastAnalyzedAt,
                    dioRunCount: (deal as any).dioRunCount,
                    dioAnalysisVersion: (deal as any).dioAnalysisVersion,
                  };
                  setDioMeta(nextMeta);
                  if (job.type === 'analyze_deal') {
                    reportMissingRef.current = false;
                    loadReport({ force: true, version: typeof nextMeta.dioAnalysisVersion === 'number' ? nextMeta.dioAnalysisVersion : null }).catch(() => {});
                  }
                })
                .catch(() => {});
            }
            if (job.type === 'analyze_deal') {
              // Dedup guard: only start overlay polling once per unique analyze job_id.
              // SSE events can be delivered multiple times (reconnect, duplicate dispatch);
              // each extra call would reset the polling timer and delay the overlay refresh.
              const analyzeJobId = job.job_id ?? null;
              if (analyzeJobId !== lastAnalyzedJobIdForOverlayRef.current) {
                lastAnalyzedJobIdForOverlayRef.current = analyzeJobId;
                // Start polling for the governed overlay so the workspace fields update after
                // a successful analysis without needing a page reload.
                startOverlayPostAnalyzePolling();
              }
              // Clear stale page-understanding readiness UI state — idempotent, safe to call
              // on every succeeded event since it only moves to idle (no polling side effects).
              setPageUnderstandingGate((prev) => ({
                ...prev,
                status: 'idle',
                readiness: null,
                error: null,
                minDpuCreatedAt: null,
              }));
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

  useEffect(() => {
    deepDiveLoadedDealIdRef.current = null;
    setDeepDiveResponse(null);
    setDeepDiveLoading(false);
    setDeepDiveError(null);
  }, [dealId]);

  useEffect(() => {
    if (!dealId) return;
    if (deepDiveLoadedDealIdRef.current === dealId && deepDiveResponse) return;

    let cancelled = false;
    setDeepDiveLoading(true);
    setDeepDiveError(null);

    void (async () => {
      try {
        const payload = await apiGetDealDeepDive(dealId);
        if (cancelled) return;
        setDeepDiveResponse(payload);
        deepDiveLoadedDealIdRef.current = dealId;
      } catch (err: any) {
        if (cancelled) return;
        const msg = typeof err?.message === 'string' && err.message.trim().length > 0
          ? err.message
          : 'Failed to load deep-dive analysis.';
        setDeepDiveError(msg);
      } finally {
        if (!cancelled) setDeepDiveLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dealId, deepDiveResponse]);

  // Primary tabs always visible in the nav bar.
  const primaryTabs = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'workspace', label: 'Workspace', icon: <Layers className="w-4 h-4" /> },
    { id: 'deal-deep-dive', label: 'Deal Deep Dive', icon: <FileText className="w-4 h-4" /> },
    { id: 'investor-insights', label: 'Investor Insights', icon: <Lightbulb className="w-4 h-4" /> },
    { id: 'financial-audit', label: 'Financial Audit', icon: <Clipboard className="w-4 h-4" /> },
    { id: 'analyst', label: 'Graph', icon: <Eye className="w-4 h-4" /> },
    { id: 'analysis', label: 'AI Analysis', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="w-4 h-4" /> },
  ];

  // Secondary tabs accessible via the More dropdown.
  const moreTabs = [
    { id: 'jobs', label: 'Jobs', icon: <Zap className="w-4 h-4" /> },
    { id: 'evidence', label: 'Evidence', icon: <Shield className="w-4 h-4" /> },
    { id: 'diligence', label: 'Due Diligence', icon: <Shield className="w-4 h-4" /> },
    { id: 'feedback', label: 'Investment Thesis', icon: <Target className="w-4 h-4" /> },
    { id: 'data', label: 'Data', icon: <Eye className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports Generated', icon: <FileCode className="w-4 h-4" /> },
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

  const addToast = (type: ToastType, title: string, message?: string, toastKey?: string) => {
    _pushToast({ type, title, message, key: toastKey });
  };

  const addToastOnce = (key: string, type: ToastType, title: string, message?: string) => {
    _pushToast({ type, title, message, key });
  };

  const dealStageRaw = reportView.stageRaw;
  const dealStageLabel = reportView.stageLabel ?? '—';

  // ── WorkspaceViewModel ────────────────────────────────────────────────────
  // Single transform layer: all view-layer inputs → typed ViewModel consumed
  // by DealWorkspaceHeader and DealOverviewTab. Eliminates hardcoded placeholders:
  //   concerns=0, icReadiness=72 default, tam='—', signals=[].
  const vmPipelineStatus: WorkspaceViewModelInputs['pipelineStatus'] = (() => {
    const s = (dealFromApi as any)?.stage ?? '';
    if (['closed_invested', 'closed_passed', 'closed_lost', 'archived'].includes(s)) return 'Closed';
    if (['on_hold', 'paused'].includes(s)) return 'On Hold';
    return 'Active';
  })();

  // [CONTRACT] Diligence phase uses the deal pipeline stage (dealFromApi.stage — CRM workflow),
  // NOT the funding stage (dealStageRaw). These are separate concepts.
  const vmDiligencePhase: WorkspaceViewModelInputs['diligencePhase'] = (() => {
    const s = typeof (dealFromApi as any)?.stage === 'string' ? String((dealFromApi as any).stage).trim() : '';
    if (s === 'intake') return 'Initial Screening';
    if (s === 'under_review') return 'Early Diligence';
    if (s === 'in_diligence') return 'Deep Diligence';
    if (s === 'ready_decision') return 'IC Prep';
    if (s === 'term_sheet') return 'Term Sheet';
    return 'Early Diligence';
  })();

  const vmVerdict: WorkspaceViewModelInputs['verdict'] =
    _workspaceVerdict.verdict === 'HARD_PASS' ? 'HARD_PASS'
    : _workspaceVerdict.verdict === 'FUND' ? 'INVEST'
    : _workspaceVerdict.verdict === 'CONSIDER' ? 'CONSIDER'
    : 'PASS';

  const vmEvidenceCoverage: WorkspaceViewModelInputs['evidenceCoverage'] =
    decisionTileConfidenceBand === 'high' ? 'Strong'
    : decisionTileConfidenceBand === 'med' ? 'Moderate'
    : 'Limited';

  const vm = useMemo(() => buildWorkspaceViewModel({
    overviewModel: workspaceOverviewModel,
    displayName,
    dealDescription: governedDealOneLinerDisplay || topSectionScoreDriverOneLiner || (dealInfo as any)?.description || '',
    dealStageLabel,
    dealStageRaw: dealStageRaw ?? '',
    industry: profileEdits.industry ?? '—',
    lastUpdated: dealInfo?.updatedTime ?? undefined,
    analyzing,
    reportViewScore: reportView.score,
    verdict: vmVerdict,
    blockers: blockersCount ?? 0,
    filteredStrengths,
    filteredWeaknesses,
    confidenceBand: decisionTileConfidenceBand,
    coverageRatio: scoreExplanationV1?.coverage_ratio ?? null,
    evidenceCoverage: vmEvidenceCoverage,
    selectedPolicyId,
    governedDealOneLiner: governedDealOneLinerDisplay,
    // [CONTRACT: DataFlow_contract.md §2.4] investmentSnapshotBody from investment_analysis_overview_v2.summary_medium.
    investmentSnapshotBody: safeText((reportFromApi as any)?.investment_analysis_overview_v2?.summary_medium),
    selectedHeaderReady: selectedHeader.ready,
    raiseValue: selectedHeader.ready ? (selectedHeader.raise.value ?? null) : null,
    raiseLabel: selectedHeader.ready ? (selectedHeader.raise.label ?? null) : null,
    // [CONTRACT: DataFlow_contract.md §2.5-2.8] Revenue/Growth/Customers: ONLY from structured_summary.kpis.
    // Forbidden: topSectionRevenue/topSectionGrowth/topSectionCustomers (regex text-mining fallbacks).
    revenueValue: selectedHeader.ready ? (selectedHeader.revenue.value ?? null) : null,
    revenueTileLabel: revenueCoveragePolicy.kpiTileLabel,
    revenueAllowed: revenueCoveragePolicy.allow,
    growthValue: selectedHeader.ready ? (selectedHeader.growth.value ?? null) : null,
    growthLabel: isStartupPolicySchema
      ? (selectedHeader.ready ? (selectedHeader.growth.label ?? null) : null)
      : (looksRealEstate ? 'Target IRR' : policyFamily === 'fund' ? 'Target return' : null),
    customersValue: selectedHeader.ready ? (selectedHeader.customers.value ?? null) : null,
    customersLabel: isStartupPolicySchema
      ? (selectedHeader.ready ? (selectedHeader.customers.label ?? null) : null)
      : (looksRealEstate ? 'Term' : policyFamily === 'fund' ? 'Vehicle term' : null),
    businessModelValue: (selectedHeader.ready ? selectedHeader.business_model.value : null)
      || (looksRealEstate ? governedKeyFacts.businessModel.value : null)
      || authoritativeBusinessModel.value
      || workspaceOverviewModel.keyFacts.business_model.value
      || null,
    businessModelLabel: selectedHeader.ready ? (selectedHeader.business_model.label ?? null) : null,
    runwayTileValue: runwayTileValue ?? null,
    burnTileValue: burnTileValue ?? null,
    reportStructuredGrowthValue: reportStructuredGrowthValue ?? null,
    // [CONTRACT: DataFlow_contract.md §2.5] TAM MUST come only from report.structured_summary.kpis.tam.value.
    // Forbidden: overviewV2.market_size, overviewV2.tam (phase1 inferred sources).
    tamValue: (() => {
      const tamKpi = reportStructuredKpis?.tam as any;
      if (!tamKpi) return null;
      const raw = safeText(tamKpi?.value?.raw);
      if (raw) return raw;
      const valStr = typeof tamKpi?.value === 'string' ? tamKpi.value.trim() : null;
      return valStr || null;
    })(),
    topSectionDealType: reportView.dealType || topSectionDealType,
    pipelineStatus: vmPipelineStatus,
    diligencePhase: vmDiligencePhase,
    insightsScore: canonicalScoreView.score0_100 ?? 0,
    insightsConfidence: topSectionConfidence,
  }), [
    displayName, dealInfo, topSectionScoreDriverOneLiner, governedDealOneLinerDisplay, dealStageLabel, dealStageRaw,
    profileEdits.industry, analyzing, reportView.score, vmVerdict, blockersCount,
    filteredStrengths, filteredWeaknesses, decisionTileConfidenceBand,
    scoreExplanationV1, vmEvidenceCoverage, governedDealOneLinerDisplay,
    governedKeyFacts, heroFieldBindings, selectedHeader, revenueCoveragePolicy, runwayTileValue,
    burnTileValue, reportStructuredGrowthValue, overviewV2, authoritativeBusinessModel,
    workspaceOverviewModel, topSectionDealType, reportView.dealType, vmPipelineStatus, vmDiligencePhase,
    selectedPolicyId, isStartupPolicySchema, topSectionRevenue, topSectionGrowth, topSectionCustomers, looksRealEstate, policyFamily,
    canonicalScoreView, topSectionConfidence, reportFromApi,
  ]);

  const lastPolicyOverviewLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const topFieldDiagnostics = looksRealEstate
      ? [
          {
            selectedPolicy: selectedPolicyId ?? null,
            field: 'Raise / Terms',
            sourcePathUsed: selectedHeader.ready && selectedHeader.raise.value
              ? 'report.header.raise.value'
              : governedKeyFacts.raise.provenance.source === 'governed'
                ? 'overview_json.phase1.governed_ui_copy_v1.raise'
                : 'governedKeyFacts.raise',
            rawValue: selectedHeader.raise.value ?? governedKeyFacts.raise.value ?? null,
            formattedValue: vm.overview.snapshotFacts.raise,
            hidden: vm.overview.snapshotFacts.raise === '—',
            hiddenReason: vm.overview.snapshotFacts.raise === '—' ? 'missing_or_collision_suppressed' : null,
            dedupeOrCollisionSuppressed: Boolean((governedKeyFacts as any)?.realEstateSemanticDiagnostics?.raiseBusinessModelCollision?.suppressed),
          },
          {
            selectedPolicy: selectedPolicyId ?? null,
            field: 'NOI',
            sourcePathUsed: 'topSectionRevenue -> WorkspaceViewModel.revenueValue',
            rawValue: topSectionRevenue,
            formattedValue: vm.overview.snapshotFacts.arr,
            hidden: vm.overview.snapshotFacts.arr === '—',
            hiddenReason: vm.overview.snapshotFacts.arr === '—' ? 'malformed_or_missing_numeric' : null,
            dedupeOrCollisionSuppressed: false,
          },
          {
            selectedPolicy: selectedPolicyId ?? null,
            field: 'Target IRR',
            sourcePathUsed: 'topSectionGrowth -> WorkspaceViewModel.growthValue',
            rawValue: topSectionGrowth,
            formattedValue: vm.overview.snapshotFacts.growth,
            hidden: vm.overview.snapshotFacts.growth === '—',
            hiddenReason: vm.overview.snapshotFacts.growth === '—' ? 'missing' : null,
            dedupeOrCollisionSuppressed: false,
          },
          {
            selectedPolicy: selectedPolicyId ?? null,
            field: 'Term',
            sourcePathUsed: 'topSectionCustomers -> WorkspaceViewModel.customersValue',
            rawValue: topSectionCustomers,
            formattedValue: vm.overview.snapshotFacts.customers,
            hidden: vm.overview.snapshotFacts.customers === '—',
            hiddenReason: vm.overview.snapshotFacts.customers === '—' ? 'missing' : null,
            dedupeOrCollisionSuppressed: false,
          },
          {
            selectedPolicy: selectedPolicyId ?? null,
            field: 'Submarket / Demand',
            sourcePathUsed: (governedKeyFacts as any)?.realEstateSemanticDiagnostics?.submarketDemand?.source ?? 'missing',
            rawValue: vm.overview.marketSummary,
            formattedValue: vm.overview.marketSummary,
            hidden: vm.overview.marketSummary === keyFactMissingText,
            hiddenReason: vm.overview.marketSummary === keyFactMissingText ? 'weak_or_missing_role_match' : null,
            dedupeOrCollisionSuppressed: Boolean((governedKeyFacts as any)?.realEstateSemanticDiagnostics?.duplicateSuppression?.applied),
          },
        ]
      : null;

    const key = [
      dealId ?? '',
      policyFamily,
      String(looksRealEstate),
      governedKeyFacts.product.provenance.source,
      governedKeyFacts.market.provenance.source,
      governedKeyFacts.businessModel.provenance.source,
      vm.overview.snapshotFacts.arr,
      vm.overview.snapshotFacts.growth,
      vm.overview.snapshotFacts.customers,
      heroFieldBindings.product.sourcePathUsed,
      heroFieldBindings.market.sourcePathUsed,
      heroFieldBindings.businessModel.sourcePathUsed,
      heroFieldBindings.raise.sourcePathUsed,
    ].join('|');
    if (lastPolicyOverviewLogRef.current === key) return;
    lastPolicyOverviewLogRef.current = key;

    console.info('[DDAI][policy_overview_binding]', {
      dealId,
      policyFamily,
      looksRealEstate,
      keyFacts: {
        product: governedKeyFacts.product,
        market: governedKeyFacts.market,
        businessModel: governedKeyFacts.businessModel,
        raise: governedKeyFacts.raise,
      },
      snapshotFactLabels: vm.overview.snapshotFactLabels,
      snapshotFacts: vm.overview.snapshotFacts,
      evidenceLabels: vm.overview.evidenceLabels,
      evidenceFacts: {
        product: vm.overview.productSummary,
        market: vm.overview.marketSummary,
        businessModel: vm.overview.businessModelSummary,
        raise: vm.overview.raiseTerms,
      },
      heroBindings: {
        selectedPolicyId: selectedPolicyId ?? null,
        product: heroFieldBindings.product,
        market: heroFieldBindings.market,
        businessModel: heroFieldBindings.businessModel,
        raise: heroFieldBindings.raise,
        oneLiner: heroFieldBindings.oneLiner,
      },
      semanticRanking: governedKeyFacts.realEstateSemanticDiagnostics ?? null,
      topFieldDiagnostics,
      heroSuppression: {
        productServesSuppressed: looksRealEstate,
      },
      advisoryRefinement: {
        diligenceSource: icMemo.advisoryRefinement.source,
        diligenceReplacementApplied: icMemo.advisoryRefinement.replacementApplied,
        diligenceSuppressedStartupAsks: icMemo.advisoryRefinement.suppressedStartupAsks.slice(0, 6),
        diligenceInjectedRealEstateAsks: icMemo.advisoryRefinement.injectedRealEstateAsks.slice(0, 6),
        topSectionSource: topSectionActionRefinement.source,
        topSectionSuppressedStartupAsks: topSectionActionRefinement.suppressedStartupAsks.slice(0, 6),
      },
    });
  }, [dealId, policyFamily, selectedPolicyId, looksRealEstate, governedKeyFacts, vm.overview, icMemo, topSectionActionRefinement, selectedHeader.ready, selectedHeader.raise.value, topSectionRevenue, topSectionGrowth, topSectionCustomers, heroFieldBindings]);

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
    if (s === 'running' || s === 'retrying' || s === 'blocked') return 'info';
    if (s === 'queued' || s === 'pending') return 'muted';
    return 'muted';
  };

  const fullProcessStepLabel = (status: string | null | undefined): string => {
    const s = String(status ?? '').toLowerCase();
    if (s === 'pending') return 'Pending';
    if (s === 'queued') return 'Queued';
    if (s === 'running' || s === 'retrying') return 'Running';
    if (s === 'blocked') return 'Waiting';
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

  const extractVisualsBadge = useMemo(() => {
    const derived = getLatestStageStatus(dealJobs, 'extract_visuals', { cutoffStageType: 'ingest_documents' });
    const label = derived.status === 'complete' ? 'Complete' : derived.status === 'running' ? 'Running' : derived.status === 'failed' ? 'Failed' : 'Not started';
    const severity: JobSeverity =
      derived.status === 'complete' ? 'success' : derived.status === 'running' ? 'info' : derived.status === 'failed' ? 'danger' : 'muted';
    return { ...derived, label, severity };
  }, [dealJobs]);

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

  const [pageUnderstandingGate, setPageUnderstandingGate] = useState<{
    status: 'idle' | 'preparing' | 'ready' | 'timeout' | 'error';
    version: string;
    readiness: PageUnderstandingReadiness | null;
    startedAtMs: number | null;
    lastPolledAtMs: number | null;
    error: string | null;
    minDpuCreatedAt: string | null;
  }>({ status: 'idle', version: 'page_understanding_v1', readiness: null, startedAtMs: null, lastPolledAtMs: null, error: null, minDpuCreatedAt: null });
  const [showPageUnderstandingDetails, setShowPageUnderstandingDetails] = useState(false);
  const readinessPollRef = useRef<{ token: number; timerId: number | null }>({ token: 0, timerId: null });

  useEffect(() => {
    return () => {
      try {
        if (readinessPollRef.current.timerId != null) window.clearTimeout(readinessPollRef.current.timerId);
      } catch {
        // ignore
      }
    };
  }, []);

  const runAnalysisWithReadinessGate = async (
    dealId: string,
    version = 'page_understanding_v1',
    opts?: { forceRefresh?: boolean }
  ) => {
    const dev = !!(import.meta as any)?.env?.DEV;
    const logDev = (msg: string, meta?: any) => {
      if (!dev) return;
      try {
        console.info('[DDAI][readiness]', msg, meta ?? '');
      } catch {
        // ignore
      }
    };

    let lastReady: boolean | null = null;
    let minDpuCreatedAtToken: string | null = null;
    // Tracks when we last sent a /analyze nudge to trigger server-side DPU_STALE self-heal.
    let lastNudgeAtMs: number | null = null;

    readinessPollRef.current.token += 1;
    const token = readinessPollRef.current.token;
    if (readinessPollRef.current.timerId != null) {
      try {
        window.clearTimeout(readinessPollRef.current.timerId);
      } catch {
        // ignore
      }
      readinessPollRef.current.timerId = null;
    }

    const startedAtMs = Date.now();
    setPageUnderstandingGate({ status: 'idle', version, readiness: null, startedAtMs, lastPolledAtMs: null, error: null, minDpuCreatedAt: null });

    const requestedForceRefresh = opts?.forceRefresh === true;

    const tryAnalyze = async (input?: { force_refresh?: boolean }): Promise<{ job_id: string; status: string } | null> => {
      const force_refresh = input?.force_refresh === true;
      logDev('analyze_attempt', { version, require_page_understanding: true, force_refresh });
      const res = await apiPostAnalyzeWithStatus(dealId, {
        require_page_understanding: true,
        page_understanding_version: version,
        ...(minDpuCreatedAtToken ? { min_dpu_created_at: minDpuCreatedAtToken } : {}),
        ...(force_refresh ? { force_refresh: true } : {}),
      });

      logDev('analyze_response', { ok: res.ok, status: res.status, json: res.json ?? null, text: res.text ?? null });

      if (res.ok && res.json && typeof (res.json as any).job_id === 'string') {
        return { job_id: String((res.json as any).job_id), status: String((res.json as any).status ?? 'queued') };
      }

      // Intermediate state: backend is preparing documents (202) or returns not-ready (409 legacy).
      const notReadyError = res.json && typeof (res.json as any).error === 'string' ? String((res.json as any).error) : null;
      if ((res.status === 202 || res.status === 409) && notReadyError === 'page_understanding_not_ready') {
        const readiness = (res.json as any).readiness as PageUnderstandingReadiness | undefined;
        const minDpuCreatedAt = (res.json && typeof (res.json as any).min_dpu_created_at === 'string')
          ? String((res.json as any).min_dpu_created_at)
          : null;
        minDpuCreatedAtToken = minDpuCreatedAt;
        const missingTotal = typeof readiness?.missing_pages_total === 'number' ? readiness.missing_pages_total : null;
        const blockedReason = res.json && typeof (res.json as any).blocked_reason === 'string' ? String((res.json as any).blocked_reason) : null;
        logDev('preflight_not_ready', { missing_pages_total: missingTotal, version, blocked_reason: blockedReason });
        addToast(
          'info',
          'Preparing documents…',
          blockedReason ? `${blockedReason}${typeof missingTotal === 'number' ? ` • Missing ${missingTotal} page(s)` : ''}` : typeof missingTotal === 'number' ? `Missing ${missingTotal} page(s)` : 'Waiting for page understanding',
          `deal-dpu-readiness:${dealId}`
        );
        setPageUnderstandingGate({
          status: 'preparing',
          version,
          readiness: readiness ?? null,
          startedAtMs,
          lastPolledAtMs: Date.now(),
          error: null,
          minDpuCreatedAt,
        });
        lastReady = typeof readiness?.ready === 'boolean' ? readiness.ready : null;
        return null;
      }

      // Treat 409 as a normal intermediate state when the backend indicates analysis is already running.
      // Prefer returning an existing job_id if provided.
      if (res.status === 409) {
        const existingJobId = res.json && typeof (res.json as any).job_id === 'string' ? String((res.json as any).job_id) : null;
        const existingStatus = res.json && typeof (res.json as any).status === 'string' ? String((res.json as any).status) : 'running';
        if (existingJobId) {
          addToast('info', 'Analysis already running', `Tracking job ${existingJobId}`, `deal-analysis-409:${dealId}`);
          return { job_id: existingJobId, status: existingStatus };
        }

        try {
          const rows = await apiGetDealJobs(dealId, { limit: 200 });
          const arr = Array.isArray(rows) ? (rows as DealJobRowV2[]) : [];
          const best = selectBestAnalyzeJob(arr, null);
          if (best?.job_id) {
            addToast('info', 'Analysis already running', `Tracking job ${best.job_id}`, `deal-analysis-409:${dealId}`);
            return { job_id: best.job_id, status: String(best.status ?? 'running') };
          }
        } catch {
          // ignore
        }

        addToast('info', 'Analysis already running', 'Backend returned 409 (no job id).', `deal-analysis-409:${dealId}`);
        return null;
      }

      const message =
        (res.json && typeof (res.json as any)?.message === 'string' ? String((res.json as any).message) : null) ??
        (typeof res.text === 'string' && res.text.trim() ? res.text.trim() : null) ??
        `HTTP ${res.status}`;
      throw new Error(message);
    };

    const pollReadiness = async (): Promise<void> => {
      if (readinessPollRef.current.token !== token) return;
      const elapsedMs = Date.now() - startedAtMs;
      const pollMs = elapsedMs > 30_000 ? 5_000 : 2_000;

      if (elapsedMs > 180_000) {
        logDev('poll_timeout', { elapsed_ms: elapsedMs, version });
        setPageUnderstandingGate((prev) => ({
          ...prev,
          status: 'timeout',
          lastPolledAtMs: Date.now(),
          error: 'Still preparing — check worker logs',
        }));
        return;
      }

      let readiness: PageUnderstandingReadiness | null = null;
      try {
        readiness = await apiGetDealReadiness(dealId, version, { min_dpu_created_at: minDpuCreatedAtToken });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logDev('poll_failed', { err: msg });
        setPageUnderstandingGate((prev) => ({
          ...prev,
          status: 'error',
          error: msg,
          lastPolledAtMs: Date.now(),
        }));
        return;
      }

      const ready = !!readiness?.ready;
      const missingPagesTotal = typeof readiness?.missing_pages_total === 'number' ? readiness.missing_pages_total : null;

      setPageUnderstandingGate((prev) => ({
        ...prev,
        status: ready ? 'ready' : 'preparing',
        readiness,
        lastPolledAtMs: Date.now(),
        error: null,
      }));
      logDev('poll_payload', readiness);
      logDev('poll', { ready, missing_pages_total: missingPagesTotal, expected_pages_total: readiness?.expected_pages_total, dpu_rows_total: readiness?.dpu_rows_total });

      if (lastReady === false && ready === true) {
        logDev('ready_flip_false_to_true', { version });
      }
      lastReady = ready;

      if (ready) {
        logDev('ready_transition', { version });
        try {
          // Once readiness is truly ready (including freshness token, if any), enqueue analysis without force_refresh
          // to avoid re-triggering refresh loops.
          const job = await tryAnalyze({ force_refresh: false });
          if (job) {
            setPageUnderstandingGate((prev) => ({ ...prev, status: 'idle', readiness: null, error: null, minDpuCreatedAt: null }));
            setJobId(job.job_id);
            setJobStatus(job.status);
            addToast('info', 'Job queued', `Job ${job.job_id}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setPageUnderstandingGate((prev) => ({ ...prev, status: 'ready', error: msg }));
          addToast('error', 'Analysis failed to start', msg);
        }
        return;
      }

      // Periodic self-heal nudge: after the first 30 s, call POST /analyze (no
      // force_refresh, with min_dpu_created_at) every 60 s to trigger the server-side
      // DPU_STALE recovery path which re-enqueues populate_document_page_understanding
      // jobs if the initial ones failed or were evicted from the queue.
      const NUDGE_INTERVAL_MS = 60000;
      if (
        minDpuCreatedAtToken &&
        elapsedMs >= 30_000 &&
        (lastNudgeAtMs === null || Date.now() - lastNudgeAtMs >= NUDGE_INTERVAL_MS)
      ) {
        lastNudgeAtMs = Date.now();
        logDev('dpu_stale_nudge', { elapsed_ms: elapsedMs, min_dpu_created_at: minDpuCreatedAtToken });
        tryAnalyze({ force_refresh: false }).catch(() => {
          // best-effort nudge — suppress errors
        });
      }

      readinessPollRef.current.timerId = window.setTimeout(() => {
        pollReadiness().catch(() => {
          // ignore
        });
      }, pollMs);
    };

    const job = await tryAnalyze({ force_refresh: requestedForceRefresh });
    if (job) {
      setJobId(job.job_id);
      setJobStatus(job.status);
      addToast('info', 'Job queued', `Job ${job.job_id}`);
      return;
    }

    // Not ready => start polling immediately (preflight started).
    pollReadiness().catch(() => {
      // ignore
    });
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

    addToast('info', 'Starting analysis…', 'Checking page understanding readiness', `deal-analysis-start:${dealId}`);
    try {
      await runAnalysisWithReadinessGate(dealId, 'page_understanding_v1', { forceRefresh: true });
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

    if (fullProcessInFlightRef.current || fullProcessLocked) {
      addToast('warning', 'Full process already running', 'Please wait for the current run to finish');
      return;
    }
    fullProcessInFlightRef.current = true;
    setFullProcessLocked(true);
    const requestId = makeClientRequestId();
    fullProcessRequestIdRef.current = requestId;

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

    addToast('info', 'Full process started', 'Re-extract documents → extract visuals → analyze (auto after finalize)', `deal-full-process:${dealId}`);

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

      // The API can return 409 rendered_pages_not_ready while it enqueues render_document_pages jobs.
      // Treat this as a normal intermediate state: wait for those render jobs, then retry enqueueing extract_visuals.
      const parseExtractVisualsNotReady = (err: unknown): null | {
        render_jobs_enqueued: Array<{ document_id?: string; job_id?: string; status?: string }>;
        blocked_documents?: Array<{ document_id?: string; failure_reason?: string; next_action?: string }>;
        render_state?: Record<string, any>;
        message?: string;
      } => {
        const msg =
          err instanceof Error
            ? err.message
            : typeof (err as any)?.message === 'string'
              ? String((err as any).message)
              : String(err ?? '');

        const jsonStart = msg.indexOf('{');
        const jsonEnd = msg.lastIndexOf('}');
        if (jsonStart < 0 || jsonEnd < 0 || jsonEnd <= jsonStart) return null;

        const jsonText = msg.slice(jsonStart, jsonEnd + 1).trim();
        try {
          const parsed = JSON.parse(jsonText);
          if (!parsed || typeof parsed !== 'object') return null;
          if ((parsed as any).error !== 'rendered_pages_not_ready') return null;
          const jobs = Array.isArray((parsed as any).render_jobs_enqueued) ? (parsed as any).render_jobs_enqueued : [];
          const blocked = Array.isArray((parsed as any).blocked_documents) ? (parsed as any).blocked_documents : undefined;
          const renderState = (parsed as any).render_state && typeof (parsed as any).render_state === 'object' ? (parsed as any).render_state : undefined;

          // Lightweight breadcrumb (helps confirm the wait+retry branch is running).
          console.info('[DDAI][runFullProcess] extract-visuals blocked; waiting for render jobs', {
            renderJobCount: jobs.length,
          });

          return {
            render_jobs_enqueued: jobs,
            blocked_documents: blocked,
            render_state: renderState,
            message: typeof (parsed as any).message === 'string' ? (parsed as any).message : undefined,
          };
        } catch {
          return null;
        }
      };

      const enqueueExtractVisualsWithRenderWait = async (): Promise<{ job_id: string; status: string }> => {
        const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

        // Guardrails: keep the UI responsive, avoid retry storms, and rely on backend job ledger truth.
        const maxTotalWaitMs = 20 * 60_000;
        const startedAt = Date.now();
        let retryBackoffMs = 5000;

        const isActiveStatus = (s: unknown) => ['queued', 'running', 'retrying', 'blocked'].includes(String(s ?? '').toLowerCase());
        const isTerminalStatus = (s: unknown) => ['succeeded', 'succeeded_with_warnings', 'failed', 'cancelled'].includes(String(s ?? '').toLowerCase());

        const waitForRenderJobsToSettle = async (opts: {
          blockedDocIds: string[];
          renderJobIds: string[];
          hintMessage?: string;
        }) => {
          const waitStartedAt = Date.now();
          const maxRenderWaitMs = 15 * 60_000;
          let pollMs = 2500;
          const blockedSet = new Set((opts.blockedDocIds || []).filter((d) => typeof d === 'string' && d.trim().length > 0));
          const initialJobIds = Array.from(new Set((opts.renderJobIds || []).filter((j) => typeof j === 'string' && j.trim().length > 0)));

          const computeMsgFromCounts = (done: number, total: number, active: number): string => {
            if (total <= 0) return 'Waiting for page rendering to start…';
            if (active > 0) return `Rendering pages… (${done}/${total} job(s) done)`;
            return 'Page rendering completed. Verifying readiness…';
          };

          while (Date.now() - waitStartedAt < maxRenderWaitMs) {
            let relevant: DealJobRowV2[] = [];
            try {
              const rows = await apiGetDealJobs(dealId, { type: 'render_document_pages', limit: 200 });
              relevant = (rows || []).filter((r) => {
                const t = String(r.type ?? r.queue ?? '').toLowerCase();
                if (t !== 'render_document_pages') return false;
                if (blockedSet.size === 0) return true;
                const docId = String(r.document_id ?? '');
                return !!docId && blockedSet.has(docId);
              });
            } catch {
              relevant = [];
            }

            if (relevant.length === 0 && initialJobIds.length > 0) {
              // Fallback when the deal jobs list is empty/limited: directly poll the explicit render job IDs.
              const results = await Promise.all(
                initialJobIds.map(async (jid) => {
                  try {
                    return await apiGetJob(jid);
                  } catch {
                    return null;
                  }
                })
              );
              const statuses = results.map((j) => String((j as any)?.status ?? '').toLowerCase());
              const failed = statuses.filter((s) => s === 'failed' || s === 'cancelled').length;
              const active = statuses.filter((s) => isActiveStatus(s)).length;
              const done = statuses.filter((s) => isTerminalStatus(s)).length;
              const total = initialJobIds.length;
              const pct = total > 0 ? Math.round((done / total) * 100) : null;

              const lastMsg = results
                .map((j) => ((j as any)?.status_detail?.progress?.message ?? (j as any)?.message) as any)
                .reverse()
                .find((m) => typeof m === 'string' && m.trim().length > 0) as string | undefined;

              updateFullStep('extract_visuals', {
                status: 'blocked' as any,
                job_id: null,
                progress_pct: pct,
                message: lastMsg ?? opts.hintMessage ?? computeMsgFromCounts(done, total, active),
                updated_at: new Date().toISOString(),
              });

              // If any rendering job actually failed/cancelled, stop here (retrying extract_visuals will just loop on 409).
              if (failed > 0) {
                throw new Error('Page rendering failed (one or more render jobs did not complete successfully)');
              }

              // Only consider rendering "settled" once all tracked jobs are terminal.
              // If we can’t see any job statuses yet (nulls), keep waiting instead of immediately retrying extract_visuals.
              if (done >= total && total > 0) return;

              await sleep(pollMs);
              pollMs = Math.min(10_000, Math.round(pollMs * 1.25));
              continue;
            }

            const failed = relevant.filter((r) => ['failed', 'cancelled'].includes(String(r.status ?? '').toLowerCase())).length;
            const active = relevant.filter((r) => isActiveStatus(r.status)).length;
            const done = relevant.filter((r) => isTerminalStatus(r.status)).length;
            const total = relevant.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : null;

            updateFullStep('extract_visuals', {
              status: 'blocked' as any,
              job_id: null,
              progress_pct: pct,
              message: opts.hintMessage ?? computeMsgFromCounts(done, total, active),
              updated_at: new Date().toISOString(),
            });

            if (failed > 0) {
              throw new Error('Page rendering failed (one or more render jobs did not complete successfully)');
            }

            // Only proceed once there are no active jobs and at least one job exists (i.e. rendering work is observable).
            if (total > 0 && active === 0) return;

            // If we can't see any jobs, keep polling briefly, but don't hammer extract_visuals.
            await sleep(pollMs);
            pollMs = Math.min(10_000, Math.round(pollMs * 1.25));
          }

          throw new Error('Timed out waiting for page rendering to complete');
        };

        while (Date.now() - startedAt < maxTotalWaitMs) {
          try {
            return await apiPostExtractVisuals(dealId, {
              source: 'job-center/run-full-process',
              requestId,
              idempotencyKey: requestId,
            });
          } catch (err) {
            const notReady = parseExtractVisualsNotReady(err);
            if (!notReady) throw err;

            const renderJobIds = Array.from(
              new Set(
                (notReady.render_jobs_enqueued || [])
                  .map((j) => (typeof j?.job_id === 'string' ? j.job_id : ''))
                  .filter((j) => j && j.length > 0)
              )
            );
            const blockedDocIds = Array.from(
              new Set(
                (notReady.blocked_documents || [])
                  .map((d) => (typeof d?.document_id === 'string' ? d.document_id : ''))
                  .filter((d) => d && d.length > 0)
              )
            );

            addToast('info', 'Waiting for rendering', notReady.message || 'Rendered pages are not ready yet.');
            updateFullStep('extract_visuals', {
              status: 'blocked' as any,
              job_id: null,
              progress_pct: null,
              message:
                renderJobIds.length > 0
                  ? `Waiting for page rendering (${renderJobIds.length} job(s)) before enqueueing visual extraction…`
                  : 'Waiting for page rendering before enqueueing visual extraction…',
              updated_at: new Date().toISOString(),
            });

            await waitForRenderJobsToSettle({
              blockedDocIds,
              renderJobIds,
              hintMessage: notReady.message,
            });

            setDocumentsReloadKey((v) => v + 1);
            await sleep(Math.min(15_000, Math.max(3000, retryBackoffMs)));
            retryBackoffMs = Math.min(60_000, Math.round(retryBackoffMs * 1.5));
            continue;
          }
        }

        throw new Error('Timed out waiting for rendered pages to become ready for visual extraction');
      };

      const extractRes = await enqueueExtractVisualsWithRenderWait();
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
        let timeoutReason: 'extract_not_finalized' | 'analyze_not_enqueued' | 'analyze_queued_but_failed' = 'analyze_not_enqueued';
        let timeoutDetail = 'Timed out waiting for backend to enqueue analyze job';
        try {
          const rows = await apiGetDealJobs(dealId, { limit: 250 });
          const inWindow = (Array.isArray(rows) ? rows : []).filter((r) => {
            const t = parseIsoMs((r as any)?.created_at ?? (r as any)?.updated_at ?? null);
            return t != null && t >= runWindow.startMs && t <= runWindow.endMs;
          });

          const extractRows = inWindow.filter((r) => String((r as any)?.type ?? '') === 'extract_visuals');
          const latestExtract = extractRows.sort((a, b) => (parseIsoMs(b.updated_at ?? b.created_at ?? null) ?? 0) - (parseIsoMs(a.updated_at ?? a.created_at ?? null) ?? 0))[0] ?? null;
          const latestExtractStatus = latestExtract ? normalizeJobStatus((latestExtract as any).status as any) : null;

          const analyzeRows = inWindow.filter((r) => String((r as any)?.type ?? '') === 'analyze_deal');
          const latestAnalyze = analyzeRows.sort((a, b) => (parseIsoMs(b.updated_at ?? b.created_at ?? null) ?? 0) - (parseIsoMs(a.updated_at ?? a.created_at ?? null) ?? 0))[0] ?? null;
          const latestAnalyzeStatus = latestAnalyze ? normalizeJobStatus((latestAnalyze as any).status as any) : null;

          if (latestAnalyzeStatus === 'failed' || latestAnalyzeStatus === 'cancelled') {
            timeoutReason = 'analyze_queued_but_failed';
            timeoutDetail = `Analyze was queued but ${latestAnalyzeStatus}.`;
          } else if (latestExtractStatus === 'queued' || latestExtractStatus === 'running' || latestExtractStatus === 'retrying' || latestExtractStatus === 'blocked') {
            timeoutReason = 'extract_not_finalized';
            timeoutDetail = 'Extraction did not finalize in time, so analyze was never enqueued.';
          } else {
            timeoutReason = 'analyze_not_enqueued';
            timeoutDetail = 'Extraction appears finalized, but no analyze job was enqueued in the run window.';
          }

          console.warn('[DDAI][runFullProcess] analyze-timeout-diagnosis', {
            dealId,
            timeoutReason,
            latestExtractStatus,
            latestAnalyzeStatus,
            runWindow,
          });
        } catch {
          timeoutReason = 'analyze_not_enqueued';
          timeoutDetail = 'Timed out waiting for backend to enqueue analyze job';
        }

        addToast('error', 'Analyze did not start', timeoutDetail);
        updateFullStep('analyze_deal', { status: 'failed', message: `Timed out (${timeoutReason})` });
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
          const nextMeta = {
            dioVersionId: (deal as any).dioVersionId,
            dioStatus: (deal as any).dioStatus,
            lastAnalyzedAt: (deal as any).lastAnalyzedAt,
            dioRunCount: (deal as any).dioRunCount,
            dioAnalysisVersion: (deal as any).dioAnalysisVersion,
          };
          setDioMeta(nextMeta);
          reportMissingRef.current = false;
          loadReport({ force: true, version: typeof nextMeta.dioAnalysisVersion === 'number' ? nextMeta.dioAnalysisVersion : null }).catch(() => {});
        })
        .catch(() => {
          reportMissingRef.current = false;
          loadReport({ force: true, version: latestKnownVersionRef.current ?? null }).catch(() => {});
        });
      loadEvidence();

      addToast('success', 'Full process completed', 'Documents, visuals, and analysis refreshed');
      setFullProcessUi((prev) => (prev ? { ...prev, ok: true, error: null } : prev));
    } catch (err) {
      addToast('error', 'Full process failed to start', err instanceof Error ? err.message : 'Unknown error');
      setFullProcessUi((prev) => (prev ? { ...prev, ok: false, error: err instanceof Error ? err.message : 'Unknown error' } : prev));
    } finally {
      setAnalyzing(false);
      fullProcessInFlightRef.current = false;
      fullProcessRequestIdRef.current = null;
      setFullProcessLocked(false);
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
	  completed: 'succeeded',
	  done: 'succeeded',
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
      if (status === 'queued' && bestQueuedAge != null && bestQueuedAge > queuedThresholdSec) {
        setLabelAndSeverity('Queued (stalled)', 'warning');
        sublabel = reason || message || `No worker update for ${bestQueuedAge}s`;
      }

      if (['running', 'retrying'].includes(status) && activityAge != null && activityAge > runningThresholdSec) {
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


  const handleBack = () => {
    if (typeof onViewReport === 'function') {
      onViewReport();
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    }
  };

  return (
    <DealWorkspaceV4
      darkMode={darkMode}
      {...selectWorkspaceRedesignedShellProps({
        report: reportFromApi,
        overviewVM: vm.overview,
        lastAnalyzedAt: dioMeta?.lastAnalyzedAt ?? null,
        blockerCount: vm.header.blockers,
        deepDiveReady: Boolean(deepDiveResponse && !deepDiveLoading && !deepDiveError),
        insightsReady: investorInsights.status === 'ready' && !!investorInsights.report,
      })}
      keyDrivers={filteredStrengths}
      onBack={handleBack}
      onRunAnalysis={runAIAnalysis}
    />
  );
}
