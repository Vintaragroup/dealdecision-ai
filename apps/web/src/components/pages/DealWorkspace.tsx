import { useEffect, useRef, useState } from 'react';
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
import { apiAutoProfileDeal, apiConfirmDealProfile, apiGetDeal, apiPostAnalyze, apiPostExtractVisuals, apiGetJob, apiFetchEvidence, apiGetEvidence, apiGetDealReport, apiGetDocuments, apiResolveEvidence, isLiveBackend, subscribeToEvents, type AutoProfileResponse, type DealReport, type EvidenceResolveResult, type JobUpdatedEvent, type ProposedDealProfile } from '../../lib/apiClient';
import { debugLogger } from '../../lib/debugLogger';
import { debugApiGetEntries, debugApiIsEnabled, debugApiSubscribe, type DebugApiEntry } from '../../lib/debugApi';
import { derivePhaseBInsights } from '../../lib/phaseb-findings';
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
  const [showDevPhaseBDiagnostics, setShowDevPhaseBDiagnostics] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [showScoreTraceDebug, setShowScoreTraceDebug] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [dioMeta, setDioMeta] = useState<{ dioVersionId?: string; dioStatus?: string; lastAnalyzedAt?: string; dioRunCount?: number; dioAnalysisVersion?: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const [jobUpdatedAt, setJobUpdatedAt] = useState<string | null>(null);
  const [jobQueuedSeconds, setJobQueuedSeconds] = useState<number>(0);
  const [sseReady, setSseReady] = useState(false);
  const [evidence, setEvidence] = useState<Array<{ evidence_id: string; deal_id: string; document_id?: string; source: string; kind: string; text: string; confidence?: number; created_at?: string }>>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [lastEvidenceRefresh, setLastEvidenceRefresh] = useState<string | null>(null);
  const [documentTitles, setDocumentTitles] = useState<Record<string, string>>({});
  const [dealFromApi, setDealFromApi] = useState<any>(null);
  const [reportFromApi, setReportFromApi] = useState<DealReport | null>(null);
  const [analystReloadKey, setAnalystReloadKey] = useState(0);
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
  const shownToastKeysRef = useRef<Set<string>>(new Set());

  const [debugApiEntries, setDebugApiEntries] = useState<DebugApiEntry[]>(() => (debugApiIsEnabled() ? debugApiGetEntries() : []));

  useEffect(() => {
    if (!debugApiIsEnabled()) return;
    setDebugApiEntries(debugApiGetEntries());
    return debugApiSubscribe(() => {
      setDebugApiEntries(debugApiGetEntries());
    });
  }, []);

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

  useEffect(() => {
    setSelectedScoreSectionKey(null);
    setHighlightedEvidenceIds([]);
    setResolvedEvidence({});
    setSelectedScoreSectionMismatch(false);
    setScoreTraceModeOverride(null);
  }, [dealId]);

  useEffect(() => {
    if (!isLiveBackend()) {
      setResolvedEvidence({});
      return;
    }
    const ids = Array.from(new Set((highlightedEvidenceIds ?? []).filter((v) => typeof v === 'string' && v.trim().length > 0))).slice(0, 100);
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
  }, [highlightedEvidenceIds]);

  const getConfidenceLabel = (v: unknown): 'High' | 'Med' | 'Low' => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    if (n >= 0.8) return 'High';
    if (n >= 0.5) return 'Med';
    return 'Low';
  };

  const handleAnalyzeAndAutofill = async () => {
    if (!dealId || !isLiveBackend()) return;
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
    if (!dealId || !isLiveBackend()) return;
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

  const legacyOverallScore = typeof (dealFromApi as any)?.score === 'number' && Number.isFinite((dealFromApi as any).score)
    ? Math.round((dealFromApi as any).score)
    : null;
  const legacyOverallStatus = (dealFromApi as any)?.dioStatus ?? undefined;

  const decisionScoreSource: 'phase1_signals' | 'legacy_overall' = hasPhase1Signals ? 'phase1_signals' : 'legacy_overall';

  const decisionScore: number | null = hasPhase1Signals
    ? phase1Score
    : (legacyOverallScore ?? (typeof investorScore === 'number' && Number.isFinite(investorScore) ? Math.round(investorScore) : null));

  const decisionLabel = hasPhase1Signals
    ? (normalizedRecommendation
      ? (normalizedRecommendation.includes('pass') || normalizedRecommendation.includes('reject')
        ? 'PASS'
        : normalizedRecommendation.includes('go') || normalizedRecommendation.includes('invest') || normalizedRecommendation.includes('proceed')
          ? 'FUND'
          : 'CONSIDER')
      : (phase1Score != null ? scoreToWorkspaceDecision(phase1Score) : '—'))
    : (legacyOverallScore != null ? scoreToWorkspaceDecision(legacyOverallScore) : '—');

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

  const devPhaseBDiagnostics = import.meta.env.DEV
    ? {
        routeDealId: dealId ?? null,
        apiDealId: typeof (dealFromApi as any)?.id === 'string' ? (dealFromApi as any).id : null,
        dioVersionId: dioMeta?.dioVersionId ?? null,
        phaseB: {
          hasLatest: Boolean(phaseBLatestRun),
          version: phaseBVersion ?? null,
          timestamp: phaseBRunTimestamp ?? null,
          timestampDisplay: phaseBRunTimestampDisplay ?? null,
          coverage: {
            documents: phaseBDocCount,
            segments: phaseBPageCount,
            visuals: phaseBVisualsCount,
            evidence: phaseBEvidenceCount,
            evidencePerVisual: phaseBEvidencePerVisual,
            sourceCoveragePct: phaseBSourceCoveragePct,
          },
          flags: phaseBActiveFlags,
          history: phaseBRunHistory.map((run) => ({
            key: run.key,
            version: run.version,
            timestamp: run.timestamp,
            metrics: run.metrics,
          })),
        },
      }
    : null;

  if (import.meta.env.DEV && devPhaseBDiagnostics) {
    // Dev-only inspection to verify latest Phase B wiring
    // eslint-disable-next-line no-console
    console.debug('Phase B diagnostics', devPhaseBDiagnostics);
  }

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

  const copyDevPhaseBDiagnostics = async () => {
    if (!import.meta.env.DEV || !devPhaseBDiagnostics) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      addToast('error', 'Copy unavailable', 'Clipboard API not supported');
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(devPhaseBDiagnostics, null, 2));
      addToast('info', 'Dev data copied', 'Phase B diagnostics JSON copied');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error copying diagnostics';
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
  const displayScore: number | null = decisionScore;

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
        { label: 'Score', value: displayScore != null ? `${Math.round(displayScore)}/100` : (phase1Score != null ? `${phase1Score}/100` : '—'), change: 'Overall score' },
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
    if (!jobId || jobStatus !== 'queued') {
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
  }, [jobId, jobStatus]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

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

    const poll = async () => {
      try {
        jobsLog('poll:getJob:start', { jobId, sseReady });
        const job = await apiGetJob(jobId);
        if (cancelled) return;

        jobsLog('poll:getJob:result', {
          job_id: job.job_id,
          type: job.type,
          status: job.status,
          progress_pct: job.progress_pct,
          updated_at: job.updated_at,
        });

        setJobStatus(job.status);
        setJobProgress(typeof job.progress_pct === 'number' ? job.progress_pct : null);
        setJobMessage(job.message || null);
        setJobUpdatedAt(job.updated_at || null);
        if (job.status === 'queued' || job.status === 'running' || job.status === 'retrying') {
          // SSE is best-effort; keep polling as a safety net.
          // When SSE is connected, back off to reduce load.
          setTimeout(poll, sseReady ? 10000 : 2000);
        } else {
          setAnalyzing(false);
          addToastOnce(`analysis-complete:${jobId}:${job.status}`, job.status === 'succeeded' ? 'success' : 'error', 'Analysis completed', job.message || job.status);
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
            if (job.type === 'extract_visuals') {
              setAnalystReloadKey((v) => v + 1);
              setDocumentsReloadKey((v) => v + 1);
            }
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
          const terminalKey = `job-terminal:${job.job_id}:${job.status}`;
          if (handledTerminalJobKeysRef.current.has(terminalKey)) return;
          handledTerminalJobKeysRef.current.add(terminalKey);
          loadEvidence();
          addToastOnce(terminalKey, 'success', 'Evidence updated', job.message || 'Fetch completed');
          return;
        }
        if (["succeeded", "failed", "cancelled"].includes(job.status)) {
          const terminalKey = `job-terminal:${job.job_id}:${job.status}`;
          if (handledTerminalJobKeysRef.current.has(terminalKey)) return;
          handledTerminalJobKeysRef.current.add(terminalKey);
          setAnalyzing(false);
          addToastOnce(`analysis-complete:${job.job_id}:${job.status}`, job.status === "succeeded" ? "success" : "error", "Analysis completed", job.message || job.status);
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
  }, [dealId, jobId]);

  // Role-specific tabs
  const tabs: Tab[] = isFounder ? [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'documents', label: 'Pitch Materials', icon: <Presentation className="w-4 h-4" />, badge: 7 },
    { id: 'evidence', label: 'Evidence', icon: <Shield className="w-4 h-4" /> },
    { id: 'analyst', label: 'Analyst', icon: <Eye className="w-4 h-4" /> },
    { id: 'analysis', label: 'AI Refinement', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'feedback', label: 'Investor Feedback', icon: <Lightbulb className="w-4 h-4" />, badge: 12 },
    { id: 'diligence', label: 'Fundraising Progress', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports Generated', icon: <FileText className="w-4 h-4" />, badge: 2 }
  ] : [
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

  const runExtractVisuals = async () => {
    if (!dealId || !isLiveBackend()) {
      addToast('info', 'Live mode required', 'Switch to live backend to extract visuals');
      return;
    }
    setAnalyzing(true);
    setJobProgress(null);
    setJobMessage(null);
    setJobUpdatedAt(null);
    addToast('info', 'Visual extraction started', 'Queued extract visuals job...');
    try {
      const res = await apiPostExtractVisuals(dealId);
      setJobId(res.job_id);
      setJobStatus(res.status);
      addToast('info', 'Job queued', `Job ${res.job_id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      // Surface backend diagnostics for missing originals/rendered pages.
      // Example: "No page images available... Diagnostics: {"docs_targeted":1,...}".
      const diagMatch = typeof message === 'string' ? message.match(/Diagnostics:\s*(\{.*\})/) : null;
      const diagnostics = (() => {
        if (!diagMatch) return null;
        try {
          return JSON.parse(diagMatch[1]);
        } catch {
          return null;
        }
      })();

      if (diagnostics) {
        const missingOriginals = diagnostics.original_bytes_missing ?? 0;
        const missingRendered = diagnostics.page_images_missing ?? 0;
        const missingDocIds = diagnostics.missing_page_images_doc_ids ?? diagnostics.missing_original_bytes_doc_ids;
        const docList = Array.isArray(missingDocIds) && missingDocIds.length > 0 ? missingDocIds.join(', ') : '—';

        addToast(
          'error',
          'Visual extraction blocked (missing source files)',
          `Docs targeted=${diagnostics.docs_targeted ?? '?'} · missing originals=${missingOriginals} · missing renders=${missingRendered} · docIds=${docList}`
        );

        // Provide remediation guidance inline so users can self-serve.
        addToast(
          'info',
          'Fix extraction inputs',
          diagnostics.original_file_tables_ok === false
            ? 'Run migration infra/migrations/2025-12-22-002-add-document-original-files.sql then re-ingest documents.'
            : missingOriginals > 0
              ? 'Re-upload/re-ingest the document so document_files.original_bytes is populated; then rerun extraction.'
              : 'Ensure rendered page images exist under uploads/rendered_pages/<docId>/page_000.png and rerun extraction.'
        );
      } else {
        addToast('error', 'Visual extraction failed to start', message);
      }
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

          {import.meta.env.DEV && (
            <div className={`border rounded-xl p-4 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className={`text-xs uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Dev only · Phase B debug
                    </div>
                    <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      Route dealId: {dealId ?? '—'} · API: {typeof (dealFromApi as any)?.id === 'string' ? (dealFromApi as any).id : '—'} · History runs: {phaseBRunHistory.length}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      darkMode={darkMode}
                      icon={<Clipboard className="w-4 h-4" />}
                      onClick={copyDevPhaseBDiagnostics}
                    >
                      Copy debug JSON
                    </Button>
                    <Button
                      variant="secondary"
                      darkMode={darkMode}
                      icon={showDevPhaseBDiagnostics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      onClick={() => setShowDevPhaseBDiagnostics((prev) => !prev)}
                    >
                      {showDevPhaseBDiagnostics ? 'Hide details' : 'Show details'}
                    </Button>
                  </div>
                </div>

                {showDevPhaseBDiagnostics && (
                  <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    <div className={`${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'} p-3 rounded-lg border`}>
                      <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Latest run</div>
                      <div className="mt-1 text-sm">{phaseBRunTimestampDisplay ?? 'Timestamp unavailable'}</div>
                      <div className="text-[11px]">{phaseBVersion != null ? `v${phaseBVersion}` : 'Version missing'}</div>
                    </div>
                    <div className={`${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'} p-3 rounded-lg border`}>
                      <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Coverage</div>
                      <div className="mt-1 text-sm">Docs {phaseBDocCount ?? '—'} · Segments {phaseBPageCount ?? '—'}</div>
                      <div className="text-[11px]">Source coverage: {phaseBSourceCoveragePct != null ? `${phaseBSourceCoveragePct}%` : '—'}</div>
                    </div>
                    <div className={`${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'} p-3 rounded-lg border`}>
                      <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Visuals & evidence</div>
                      <div className="mt-1 text-sm">Visuals {phaseBVisualsCount ?? '—'} · Evidence {phaseBEvidenceCount ?? '—'}</div>
                      <div className="text-[11px]">Evidence/visual: {phaseBEvidencePerVisual != null ? phaseBEvidencePerVisual.toFixed(2) : '—'}</div>
                    </div>
                    <div className={`${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'} p-3 rounded-lg border`}>
                      <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Flags</div>
                      <div className="mt-1 text-sm">{phaseBActiveFlags.length > 0 ? phaseBActiveFlags.join(', ') : 'No active flags'}</div>
                      <div className="text-[11px]">History keys: {phaseBRunHistory.length > 0 ? phaseBRunHistory.map((run) => `${run.version ?? '—'}@${run.timestampDisplay ?? 'ts'}`).join(' | ') : 'none'}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Score Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Decision Tile */}
            <div className={`backdrop-blur-xl border rounded-xl p-6 w-full max-w-md ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-xs uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Decision</div>
                  <div className={`mt-2 text-3xl sm:text-4xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{decisionLabel}</div>
                  <div className={`mt-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {displayScore != null
                      ? `${Math.round(displayScore)}/100${hasPhase1Signals && phase1ConfidenceLabel ? ` · ${phase1ConfidenceLabel}` : ''}`
                      : '—'}
                  </div>
                  {import.meta.env.DEV && (
                    <div className={`mt-1 text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      Source: {decisionScoreSource}
                    </div>
                  )}
                  {import.meta.env.DEV && hasPhase1Signals && legacyOverallScore != null && legacyOverallScore !== displayScore && (
                    <div className={`mt-1 text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      Legacy overall: {legacyOverallScore}{legacyOverallStatus ? ` (${legacyOverallStatus})` : ''}
                    </div>
                  )}
                  {blockersCount != null && (
                    <div className={`mt-2 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {blockersCount} blocker{blockersCount === 1 ? '' : 's'}
                    </div>
                  )}
                  <p className={`mt-3 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Phase 1 signals shown when available; legacy overall only when Phase 1 is missing.
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full border text-xs font-medium ${decisionAccent}`}>
                  {isFounder ? 'Pitch snapshot' : 'Investment snapshot'}
                </span>
              </div>
            </div>

            {/* Why This Decision Tile */}
            <div className={`backdrop-blur-xl border rounded-xl p-6 w-full ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'}`}>
              <div className={`text-xs uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Why this decision</div>
              {decisionHighlights.length > 0 ? (
                <ul className={`mt-3 list-disc pl-5 space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {decisionHighlights.map((h: string, i: number) => (
                    <li key={`why-${i}`}>{h}</li>
                  ))}
                </ul>
              ) : (
                <div className={`mt-3 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Run analysis to populate decision reasoning.</div>
              )}

              <div className="mt-5">
                <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Gaps to fill</div>
                {decisionMissing.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {decisionMissing.map((chip) => (
                      <span
                        key={`gap-${chip}`}
                        className={`px-2 py-1 rounded-full border text-xs ${darkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No gaps flagged.</div>
                )}
              </div>
            </div>

            {/* Score Driver Tile */}
            <div
              className={`backdrop-blur-xl border rounded-xl p-6 w-full md:col-span-2 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'}`}
              style={{ gridColumn: '1 / -1' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-xs uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Score drivers</div>
                  <div className={`mt-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {executiveSummaryV2 || executiveSummaryV1 ? 'Phase 1 coverage by category' : 'Run analysis to populate score drivers.'}
                  </div>
                </div>
              </div>

              {(executiveSummaryV2 || executiveSummaryV1) ? (
                <>
                  <div className={`mt-4 rounded-lg border overflow-hidden ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex h-3">
                      {categories.map((c, idx) => {
                        const band = getBandForCategory(c.key);
                        return (
                          <div
                            key={c.key}
                            className={`flex-1 ${bandToClasses(band)} ${idx > 0 ? (darkMode ? 'border-l border-white/10' : 'border-l border-gray-200') : ''}`}
                            title={`${c.label}: ${band}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                    {categories.map((c) => {
                      const band = getBandForCategory(c.key);
                      return (
                        <div key={`${c.key}-legend`} className="flex items-center gap-2">
                          <span className={`inline-block w-2.5 h-2.5 rounded-sm ${bandToClasses(band)}`} />
                          <span className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{c.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Missing</div>
                    {missingChips.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {missingChips.map((chip) => (
                          <span
                            key={chip}
                            className={`px-2 py-1 rounded-full border text-xs ${darkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No missing sections flagged.</div>
                    )}
                  </div>

                  {scoreBreakdownSections.length > 0 && (
                    <>
                      <div className="mt-6">
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

                      {import.meta.env.DEV && (
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
                {jobStatus === 'queued' && jobQueuedSeconds >= 20 && (
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

                <Button
                  variant="secondary"
                  darkMode={darkMode}
                  icon={<Eye className="w-4 h-4" />}
                  onClick={runExtractVisuals}
                  loading={analyzing}
                >
                  {analyzing ? 'Working...' : 'Extract visuals'}
                </Button>
                {jobStatus && (
                  <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Auto-polling while a job is active (2–10s). Status updates when the job finishes.
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

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
                {isLiveBackend() && dealId && (
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
              <DealAnalystTab key={analystReloadKey} dealId={dealId || 'demo'} darkMode={darkMode} />
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