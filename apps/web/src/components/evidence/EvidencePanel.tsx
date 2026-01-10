import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { EvidenceChip } from './EvidenceChip';
import { Button } from '../ui/button';

export type EvidenceCard = {
  evidence_id: string;
  deal_id: string;
  document_id?: string;
  source: string;
  kind: string;
  text: string;
  confidence?: number;
  created_at?: string;
};

export type ScoreSectionKey = 'market' | 'product' | 'business_model' | 'traction' | 'risks' | 'team' | 'icp';

export type ScoreEvidenceItem = {
  id: string;
  label: string;
  category: 'coverage' | 'claim' | 'metric' | 'risk' | 'traction' | 'other';
  support: 'supported' | 'weak' | 'missing' | 'unknown';
  usedInScore: boolean;
  documentId?: string;
  documentTitle?: string;
  page?: number | null;
  snippet?: string;
  sourceKey?: string;
  confidence?: number;
  sectionKey?: ScoreSectionKey;
  evidenceId?: string;
};

export type ScoreEvidencePayload = {
  sections: Array<{
    key: 'product' | 'market' | 'icp' | 'business_model' | 'traction' | 'risks';
    support: 'evidence' | 'inferred' | 'missing';
    missingReason?: string;
    claims: Array<{
      id: string;
      text: string;
      confidence?: number | null;
      evidence: Array<{
        id: string;
        kind?: string;
        label?: string;
        value?: any;
        doc_id?: string;
        document_title?: string;
        page?: number | null;
        snippet?: string;
        source?: string;
        confidence?: number | null;
        created_at?: string;
      }>;
    }>;
  }>;
  totals?: { claims: number; evidence: number };
};

type ReportSectionRef = { title: string; evidence_ids?: string[] };

interface EvidencePanelProps {
  darkMode: boolean;
  evidence: EvidenceCard[];
  loading: boolean;
  lastUpdated?: string | null;
  onRefresh: () => void;
  onFetchEvidence: () => void;
  reportSections?: ReportSectionRef[];
  documentTitles?: Record<string, string>;
  scoreEvidence?: ScoreEvidencePayload | null;
  selectedScoreSectionKey?: ScoreSectionKey | null;
  scoreBreakdownSections?: Array<{
    key: ScoreSectionKey;
    section_key?: ScoreSectionKey;
    evidence_ids?: string[];
    evidence_ids_linked?: string[];
    evidence_ids_sample?: string[];
    evidence_count_total?: number;
    evidence_count_linked?: number;
    trace_coverage_pct?: number;
    coverage_pct?: number;
    rule_key?: string;
    support_status?: 'supported' | 'weak' | 'missing' | 'unknown';
    support_reason?: string;
    missing_reasons?: string[];
    missing_link_reasons?: string[];
    inputs_used?: {
      coverage_keys?: string[];
      claim_ids?: string[];
      doc_ids?: string[];
      evidence_ids?: string[];
    };
    mismatch?: boolean;
  }>;
  highlightedEvidenceIds?: string[];
  selectedScoreSectionMismatch?: boolean | null;
  externalTraceMode?: 'all' | 'trace' | null;
  scoreTraceAudit?: {
    status?: 'ok' | 'partial' | 'poor';
    sections_total?: number;
    sections_with_trace?: number;
    sections_missing_trace?: number;
    mismatch_sections?: number;
    notes?: string[];
  } | null;
}

type ScoreFilter = 'all' | 'missing' | 'weak';

const sectionLabel = (key: ScoreSectionKey) => {
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
    default:
      return key;
  }
};

function labelForEvidence(item: EvidenceCard) {
  if (item.source === 'extraction' && item.kind === 'summary') return 'Extraction Summary';
  if (item.source === 'extraction' && item.kind === 'metric') return 'Extracted Metric';
  if (item.source === 'extraction' && item.kind === 'section') return 'Extracted Section';
  if (item.source === 'fetch_evidence' && item.kind === 'document') return 'Document';
  return `${item.source} • ${item.kind}`;
}

function formatMetricText(text: string) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { title: 'Metric', details: '' };

  const [head, ...rest] = trimmed.split(' • ');
  const headLower = head.toLowerCase();
  const isExtractedNumber = headLower.startsWith('extracted_number');
  const title = isExtractedNumber ? 'Extracted number (unlabeled)' : 'Metric';
  const details = [head, ...rest].join(' • ');
  return { title, details };
}

function confidencePct(confidence?: number) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return `${pct}%`;
}

export function EvidencePanel({
  darkMode,
  evidence,
  loading,
  lastUpdated,
  onRefresh,
  onFetchEvidence,
  reportSections = [],
  documentTitles = {},
  scoreEvidence = null,
  selectedScoreSectionKey = null,
  scoreBreakdownSections = [],
  highlightedEvidenceIds = [],
  selectedScoreSectionMismatch = null,
  externalTraceMode = null,
  scoreTraceAudit = null,
}: EvidencePanelProps) {
  const [activeTab, setActiveTab] = useState<'score' | 'legacy'>(scoreEvidence ? 'score' : 'legacy');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [traceMode, setTraceMode] = useState<'all' | 'trace'>('all');
  const showLegacyEvidence = activeTab === 'legacy';
  const evidenceRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [flashHighlightIds, setFlashHighlightIds] = useState<Set<string>>(new Set());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!externalTraceMode) return;
    setTraceMode(externalTraceMode);
  }, [externalTraceMode]);

  useEffect(() => {
    if (!selectedScoreSectionKey) return;
    setActiveTab('score');
  }, [selectedScoreSectionKey]);

  const highlightedSet = useMemo(() => new Set((highlightedEvidenceIds || []).filter((id) => typeof id === 'string' && id.trim().length > 0)), [highlightedEvidenceIds]);

  const sectionFilter: ScoreSectionKey | 'all' = selectedScoreSectionKey ?? 'all';

  useEffect(() => () => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!scoreEvidence) return;
    // eslint-disable-next-line no-console
    console.debug('Score evidence (dev)', {
      sections: scoreEvidence.sections?.length ?? 0,
      totals: scoreEvidence.totals ?? { claims: 0, evidence: 0 },
    });
  }, [scoreEvidence]);

  const usedIn = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const section of reportSections) {
      const ids = Array.isArray(section?.evidence_ids) ? section.evidence_ids : [];
      for (const id of ids) {
        const list = map.get(id) ?? [];
        list.push(section.title);
        map.set(id, list);
      }
    }
    return map;
  }, [reportSections]);

  const activeMismatch = useMemo(() => {
    if (selectedScoreSectionMismatch != null) return Boolean(selectedScoreSectionMismatch);
    if (!selectedScoreSectionKey) return false;
    const match = scoreBreakdownSections.find(
      (s) => s?.key === selectedScoreSectionKey || (s as any)?.section_key === selectedScoreSectionKey
    );
    return Boolean(match?.mismatch);
  }, [selectedScoreSectionKey, selectedScoreSectionMismatch, scoreBreakdownSections]);

  const activeTraceSection = useMemo(() => {
    if (!selectedScoreSectionKey) return null;
    return (
      scoreBreakdownSections.find(
        (s) => s?.key === selectedScoreSectionKey || (s as any)?.section_key === selectedScoreSectionKey
      ) ?? null
    );
  }, [selectedScoreSectionKey, scoreBreakdownSections]);

  const activeTraceStats = useMemo(() => {
    if (!activeTraceSection) return { linked: null as number | null, total: null as number | null, pct: null as number | null };

    const total = typeof activeTraceSection.evidence_count_total === 'number'
      ? activeTraceSection.evidence_count_total
      : typeof (activeTraceSection as any)?.evidence_count === 'number'
        ? (activeTraceSection as any).evidence_count
        : null;

    const linked = typeof activeTraceSection.evidence_count_linked === 'number'
      ? activeTraceSection.evidence_count_linked
      : Array.isArray((activeTraceSection as any)?.evidence_ids_linked)
        ? (activeTraceSection as any).evidence_ids_linked.length
        : Array.isArray(activeTraceSection.evidence_ids)
          ? activeTraceSection.evidence_ids.length
          : Array.isArray(activeTraceSection.evidence_ids_sample)
            ? activeTraceSection.evidence_ids_sample.length
            : null;

    const pctFromField = typeof (activeTraceSection as any)?.coverage_pct === 'number'
      ? (activeTraceSection as any).coverage_pct
      : null;
    const pctFromTrace = typeof activeTraceSection.trace_coverage_pct === 'number'
      ? activeTraceSection.trace_coverage_pct * 100
      : null;

    const pct = (() => {
      if (pctFromField != null && Number.isFinite(pctFromField)) return Math.min(100, Math.max(0, Math.round(pctFromField)));
      if (pctFromTrace != null && Number.isFinite(pctFromTrace)) return Math.min(100, Math.max(0, Math.round(pctFromTrace)));
      if (total && total > 0 && linked != null) return Math.min(100, Math.max(0, Math.round((linked / total) * 100)));
      return null;
    })();

    return { linked, total, pct };
  }, [activeTraceSection]);

  const activeSupportReason = useMemo(() => {
    if (!activeTraceSection) return null;
    const reason = typeof (activeTraceSection as any).support_reason === 'string' ? (activeTraceSection as any).support_reason.trim() : '';
    return reason.length > 0 ? reason : null;
  }, [activeTraceSection]);

  const activeRuleKey = useMemo(() => {
    if (!activeTraceSection) return null;
    const ruleKey = typeof (activeTraceSection as any).rule_key === 'string' ? (activeTraceSection as any).rule_key.trim() : '';
    return ruleKey.length > 0 ? ruleKey : null;
  }, [activeTraceSection]);

  const activeInputsSummary = useMemo(() => {
    const inputs = (activeTraceSection as any)?.inputs_used ?? {};
    const coverageKeys = Array.isArray(inputs.coverage_keys) ? inputs.coverage_keys : [];
    const claimIds = Array.isArray(inputs.claim_ids) ? inputs.claim_ids : [];
    const docIds = Array.isArray(inputs.doc_ids) ? inputs.doc_ids : [];
    const evIds = Array.isArray(inputs.evidence_ids) ? inputs.evidence_ids : [];
    return {
      coverageCount: coverageKeys.length,
      claimCount: claimIds.length,
      docCount: docIds.length,
      evidenceCount: evIds.length,
    };
  }, [activeTraceSection]);

  const activeLinkReasons = useMemo(() => {
    if (!activeTraceSection) return [] as string[];
    const reasons: string[] = [];
    const linkReasons = Array.isArray((activeTraceSection as any)?.missing_link_reasons) ? (activeTraceSection as any).missing_link_reasons : [];
    const genericReasons = Array.isArray((activeTraceSection as any)?.missing_reasons) ? (activeTraceSection as any).missing_reasons : [];
    for (const reason of [...linkReasons, ...genericReasons]) {
      if (typeof reason === 'string' && reason.trim().length > 0) reasons.push(reason.trim());
    }
    return Array.from(new Set(reasons)).slice(0, 5);
  }, [activeTraceSection]);

  const handleJumpToLinkedEvidence = () => {
    if (highlightedSet.size === 0) return;
    setActiveTab('score');
    setScoreFilter('all');
    const firstId = Array.from(highlightedSet).find((id) => evidenceRefs.current[id]);
    if (firstId && evidenceRefs.current[firstId]) {
      evidenceRefs.current[firstId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setFlashHighlightIds(new Set(highlightedSet));
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setFlashHighlightIds(new Set()), 2000);
  };

  const metrics = useMemo(() => evidence.filter((e) => e.source === 'extraction' && e.kind === 'metric'), [evidence]);
  const summaries = useMemo(() => evidence.filter((e) => e.source === 'extraction' && e.kind === 'summary'), [evidence]);
  const sections = useMemo(
    () => evidence.filter((e) => e.source === 'extraction' && e.kind === 'section'),
    [evidence]
  );
  const other = useMemo(
    () => evidence.filter((e) => !((e.source === 'extraction') && (e.kind === 'metric' || e.kind === 'summary' || e.kind === 'section'))),
    [evidence]
  );
  const referencedCount = useMemo(() => evidence.filter((e) => usedIn.has(e.evidence_id)).length, [evidence, usedIn]);

  const scoreItems = useMemo<ScoreEvidenceItem[]>(() => {
    if (!scoreEvidence || !Array.isArray(scoreEvidence.sections)) return [];

    const categoryForSection = (key: ScoreEvidencePayload['sections'][number]['key']): ScoreEvidenceItem['category'] => {
      if (key === 'risks') return 'risk';
      if (key === 'traction') return 'traction';
      return 'claim';
    };

    const items: ScoreEvidenceItem[] = [];

    for (const section of scoreEvidence.sections) {
      const category = categoryForSection(section.key);

      if (section.support === 'missing') {
        items.push({
          id: `missing-${section.key}`,
          label: `${sectionLabel(section.key)} coverage missing`,
          category: 'coverage',
          support: 'missing',
          usedInScore: true,
          snippet: section.missingReason,
          sectionKey: section.key,
        });
      }

      for (const claim of section.claims ?? []) {
        const support: ScoreEvidenceItem['support'] = section.support === 'missing'
          ? 'missing'
          : claim.evidence.length > 0 && section.support === 'evidence'
            ? 'supported'
            : 'weak';

        items.push({
          id: `claim-${claim.id}`,
          label: claim.text,
          category,
          support,
          usedInScore: true,
          confidence: claim.confidence == null ? undefined : claim.confidence,
          snippet: claim.evidence[0]?.snippet ?? claim.evidence[0]?.value ?? undefined,
          documentId: claim.evidence[0]?.doc_id,
          documentTitle: claim.evidence[0]?.document_title,
          page: claim.evidence[0]?.page,
          sourceKey: section.key,
          sectionKey: section.key,
        });

        for (const ev of claim.evidence ?? []) {
          items.push({
            id: `ev-${ev.id}-${claim.id}`,
            label: ev.label || ev.kind || 'Evidence',
            category,
            support: 'supported',
            usedInScore: true,
            snippet: ev.snippet || (typeof ev.value === 'string' ? ev.value : undefined),
            documentId: ev.doc_id,
            documentTitle: ev.document_title,
            page: ev.page,
            sourceKey: claim.id,
            confidence: ev.confidence ?? undefined,
            sectionKey: section.key,
            evidenceId: ev.id,
          });
        }
      }
    }

    return items;
  }, [scoreEvidence, sectionLabel]);

  const filteredScoreItems = useMemo(() => {
    let items = scoreItems;

    if (sectionFilter !== 'all') {
      items = items.filter((i) => i.sectionKey === sectionFilter);
    }

    if (traceMode === 'trace') {
      if (highlightedSet.size === 0) return [];
      return items.filter((i) => i.evidenceId && highlightedSet.has(i.evidenceId));
    }

    if (scoreFilter === 'missing') return items.filter((i) => i.support === 'missing');
    if (scoreFilter === 'weak') return items.filter((i) => i.support === 'weak');
    return items;
  }, [scoreItems, scoreFilter, sectionFilter, traceMode, highlightedSet]);

  const scoreSupportBadgeClass = (support: ScoreEvidenceItem['support']) => {
    if (support === 'supported') {
      return darkMode
        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700';
    }
    if (support === 'weak') {
      return darkMode
        ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
        : 'bg-amber-50 border-amber-200 text-amber-800';
    }
    if (support === 'missing') {
      return darkMode
        ? 'bg-red-500/10 border-red-500/40 text-red-200'
        : 'bg-red-50 border-red-200 text-red-700';
    }
    return darkMode
      ? 'bg-gray-500/10 border-gray-500/40 text-gray-200'
      : 'bg-gray-50 border-gray-200 text-gray-700';
  };

  const scoreSupportLabel = (support: ScoreEvidenceItem['support']) => {
    if (support === 'supported') return 'Evidence-backed';
    if (support === 'weak') return 'Weak / inferred';
    if (support === 'missing') return 'Missing';
    return 'Unknown';
  };

  const renderLegacyEvidence = () => (
    <>
      {evidence.length === 0 && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            darkMode ? 'border-dashed border-white/10 text-gray-400' : 'border-dashed border-gray-200 text-gray-600'
          }`}
        >
          {loading ? 'Loading evidence...' : 'No evidence yet. Run Fetch Evidence to populate items.'}
        </div>
      )}

      {evidence.length > 0 && (
        <div className={`rounded-xl border p-4 mb-4 ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Summaries</div>
              <div className="text-sm font-semibold">{summaries.length}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Metrics</div>
              <div className="text-sm font-semibold">{metrics.length}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Sections</div>
              <div className="text-sm font-semibold">{sections.length}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Referenced in report</div>
              <div className="text-sm font-semibold">{referencedCount}/{evidence.length}</div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[...summaries, ...metrics, ...sections, ...other].map((item) => {
          const usedInSections = usedIn.get(item.evidence_id) ?? [];
          const docLabel = item.document_id ? (documentTitles[item.document_id] || item.document_id) : null;
          const conf = confidencePct(item.confidence);
          const label = labelForEvidence(item);
          const metric = item.kind === 'metric' ? formatMetricText(item.text) : null;
          return (
          <div
            key={item.evidence_id}
            className={`rounded-xl border p-4 space-y-2 ${
              darkMode
                ? 'bg-white/5 border-white/10 text-gray-200'
                : 'bg-white border-gray-200 text-gray-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <EvidenceChip evidenceId={item.evidence_id} darkMode={darkMode} />
              <div className="flex items-center gap-2">
                {conf && (
                  <span className={`text-[11px] px-2 py-1 rounded-full border ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
                    Confidence {conf}
                  </span>
                )}
                <span className={`text-[10px] px-2 py-1 rounded-full border ${darkMode ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
                  NOT USED
                </span>
                {docLabel && (
                  <span className={`text-[11px] px-2 py-1 rounded-full border max-w-[220px] truncate ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
                    {docLabel}
                  </span>
                )}
              </div>
            </div>
            <div className={`text-xs uppercase tracking-wide ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>
              {label}
            </div>
            {metric ? (
              <>
                <div className="text-sm font-semibold">{metric.title}</div>
                <div className={`${darkMode ? 'text-gray-300' : 'text-gray-700'} text-sm`}>{metric.details}</div>
              </>
            ) : (
              <div className="text-sm font-semibold">{item.text}</div>
            )}

            {usedInSections.length > 0 && (
              <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} text-[11px]`}>
                Used in report: {usedInSections.slice(0, 3).join(', ')}{usedInSections.length > 3 ? ` (+${usedInSections.length - 3} more)` : ''}
              </div>
            )}
            {item.created_at && (
              <div className={`${darkMode ? 'text-gray-500' : 'text-gray-500'} text-[11px]`}>
                {new Date(item.created_at).toLocaleString()}
              </div>
            )}
          </div>
        );
        })}
      </div>
    </>
  );

  const renderScoreEvidence = () => {
    const missingItems = filteredScoreItems.filter((i) => i.support === 'missing' && i.category === 'coverage');
    const totals = scoreEvidence?.totals;
    const traceModeEmpty = traceMode === 'trace' && highlightedSet.size === 0;
    const auditStatus = scoreTraceAudit?.status;
    const auditNotes = Array.isArray(scoreTraceAudit?.notes)
      ? scoreTraceAudit.notes.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      : [];
    const auditSectionsTotal = typeof scoreTraceAudit?.sections_total === 'number' ? scoreTraceAudit.sections_total : null;
    const auditSectionsWithTrace = typeof scoreTraceAudit?.sections_with_trace === 'number' ? scoreTraceAudit.sections_with_trace : null;
    const auditMismatchSections = typeof scoreTraceAudit?.mismatch_sections === 'number' ? scoreTraceAudit.mismatch_sections : null;
    const showAuditBanner = auditStatus === 'partial' || auditStatus === 'poor';

    if (!scoreEvidence || scoreItems.length === 0) {
      return (
        <div className={`rounded-xl border p-4 text-sm ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
          Score evidence unavailable. Showing extracted evidence below.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {showAuditBanner && (
          <div className={`rounded-xl border p-4 ${darkMode ? 'bg-amber-500/10 border-amber-400/40 text-amber-50' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  Trace audit: {auditStatus === 'poor' ? 'Poor coverage' : 'Partial coverage'}
                </div>
                <div className="text-xs mt-1">
                  Sections traced: {auditSectionsWithTrace ?? '—'}/{auditSectionsTotal ?? '—'}; mismatches: {auditMismatchSections ?? 0}
                </div>
                {auditNotes.length > 0 && (
                  <div className="text-xs mt-1">
                    {auditNotes.slice(0, 3).join(' · ')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={`rounded-xl border p-4 ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Items</div>
              <div className="text-sm font-semibold">{scoreItems.length}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Claims</div>
              <div className="text-sm font-semibold">{totals?.claims ?? '—'}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Linked evidence</div>
              <div className="text-sm font-semibold">{totals?.evidence ?? '—'}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Last updated</div>
              <div className="text-sm font-semibold">{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}</div>
            </div>
          </div>
          {missingItems.length > 0 && (
            <div className={`text-[12px] mt-3 flex items-center gap-2 ${darkMode ? 'text-amber-200' : 'text-amber-700'}`}>
              Missing sections: {missingItems.map((m) => m.label).join(', ')}
            </div>
          )}
        </div>

        {(activeMismatch || highlightedSet.size > 0) && (
          <div className="flex items-center gap-3 flex-wrap">
            {activeMismatch && (
              <div className={`flex items-center gap-2 text-xs ${darkMode ? 'text-amber-200' : 'text-amber-700'}`}>
                <AlertTriangle className="w-4 h-4" />
                Score section shows mismatch between status and evidence count.
              </div>
            )}
            {highlightedSet.size > 0 && (
              <Button
                variant="ghost"
                darkMode={darkMode}
                onClick={handleJumpToLinkedEvidence}
              >
                Jump to linked evidence
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Mode:</div>
          {(['all', 'trace'] as Array<'all' | 'trace'>).map((mode) => (
            <Button
              key={mode}
              variant={traceMode === mode ? 'secondary' : 'ghost'}
              darkMode={darkMode}
              onClick={() => setTraceMode(mode)}
            >
              {mode === 'all' ? 'All evidence' : 'Trace only'}
            </Button>
          ))}
        </div>

        {traceMode === 'trace' && selectedScoreSectionKey && (
          <div className={`rounded-xl border p-3 ${darkMode ? 'bg-emerald-500/5 border-emerald-400/40 text-emerald-50' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide">Trace for {sectionLabel(selectedScoreSectionKey)}</div>
                <div className="text-sm font-semibold mt-1 flex items-center gap-2">
                  <span>{activeTraceStats.linked ?? 0}/{activeTraceStats.total ?? '—'}</span>
                  {activeTraceStats.pct != null && (
                    <span className={`${darkMode ? 'text-emerald-200' : 'text-emerald-700'}`}>{activeTraceStats.pct}% coverage</span>
                  )}
                  {activeMismatch && (
                    <span className={`flex items-center gap-1 text-xs ${darkMode ? 'text-amber-200' : 'text-amber-700'}`}>
                      <AlertTriangle className="w-3 h-3" />
                      Mismatch flagged
                    </span>
                  )}
                </div>
              </div>
            </div>
            {activeSupportReason && (
              <div className={`mt-2 text-xs leading-relaxed ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">Why</span>
                  {activeRuleKey && (
                    <span className={`px-2 py-0.5 rounded-full border ${darkMode ? 'border-white/15 text-gray-200' : 'border-gray-200 text-gray-700'}`}>
                      Rule: {activeRuleKey}
                    </span>
                  )}
                </div>
                <div className="mt-1">{activeSupportReason}</div>
                {(activeInputsSummary.coverageCount > 0 || activeInputsSummary.claimCount > 0 || activeInputsSummary.docCount > 0 || activeInputsSummary.evidenceCount > 0) && (
                  <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} mt-1`}>
                    Inputs used:{' '}
                    {[
                      activeInputsSummary.coverageCount ? `${activeInputsSummary.coverageCount} coverage key${activeInputsSummary.coverageCount === 1 ? '' : 's'}` : null,
                      activeInputsSummary.claimCount ? `${activeInputsSummary.claimCount} claim${activeInputsSummary.claimCount === 1 ? '' : 's'}` : null,
                      activeInputsSummary.docCount ? `${activeInputsSummary.docCount} doc${activeInputsSummary.docCount === 1 ? '' : 's'}` : null,
                      activeInputsSummary.evidenceCount ? `${activeInputsSummary.evidenceCount} evidence id${activeInputsSummary.evidenceCount === 1 ? '' : 's'}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Filter:</div>
          {(['all', 'missing', 'weak'] as ScoreFilter[]).map((f) => (
            <Button
              key={f}
              variant={scoreFilter === f ? 'secondary' : 'ghost'}
              darkMode={darkMode}
              disabled={traceMode === 'trace'}
              onClick={() => setScoreFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'missing' ? 'Missing only' : 'Weak only'}
            </Button>
          ))}
        </div>

        {traceModeEmpty && (
          <div className={`rounded-xl border p-4 text-sm ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
            <div>No evidence IDs were linked to this score section yet.</div>
            {activeMismatch && (
              <div className={`mt-1 ${darkMode ? 'text-amber-200' : 'text-amber-700'}`}>
                This section is marked supported but has no linked evidence IDs.
              </div>
            )}
            {activeLinkReasons.length > 0 && (
              <div className={`mt-1 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Reasons: {activeLinkReasons.join(' · ')}
              </div>
            )}
          </div>
        )}

        {!traceModeEmpty && filteredScoreItems.length === 0 && (
          <div className={`rounded-xl border p-4 text-sm ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
            No score evidence matches this filter.
          </div>
        )}

        {!traceModeEmpty && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredScoreItems.map((item) => {
              const docLabel = item.documentTitle || (item.documentId ? documentTitles[item.documentId] || item.documentId : null);
              const metaParts = [docLabel, item.page != null ? `Page ${item.page}` : null].filter(Boolean).join(' • ');
              const conf = confidencePct(item.confidence);
              const isHighlighted = item.evidenceId ? highlightedSet.has(item.evidenceId) || flashHighlightIds.has(item.evidenceId) : false;
              return (
                <div
                  key={item.id}
                  ref={(node) => {
                    if (item.evidenceId) evidenceRefs.current[item.evidenceId] = node;
                  }}
                  className={`rounded-xl border p-4 space-y-2 ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-800'} ${isHighlighted ? 'ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-transparent' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold leading-5">{item.label}</div>
                      {item.snippet && (
                        <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{item.snippet}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-[11px] px-2 py-1 rounded-full border ${scoreSupportBadgeClass(item.support)}`}>
                        {scoreSupportLabel(item.support)}
                      </span>
                      <span className={`text-[10px] px-2 py-1 rounded-full border ${darkMode ? 'border-emerald-500/40 text-emerald-200' : 'border-emerald-200 text-emerald-700'}`}>
                        USED IN SCORE
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center flex-wrap gap-2 text-[11px]">
                    <EvidenceChip evidenceId={item.id} darkMode={darkMode} />
                    {metaParts && (
                      <span className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{metaParts}</span>
                    )}
                    {item.sourceKey && (
                      <span className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Source: {item.sourceKey}</span>
                    )}
                    {conf && (
                      <span className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Conf {conf}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`rounded-2xl border p-4 sm:p-6 ${
        darkMode
          ? 'bg-gradient-to-br from-[#0f172a] via-[#111827] to-[#0b1220] border-white/10'
          : 'bg-gradient-to-br from-white via-gray-50 to-white border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Evidence</div>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Evidence items derived from documents and used to support the report recommendation.
          </p>
          {lastUpdated && (
            <div className={`text-[11px] mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              Updated {new Date(lastUpdated).toLocaleTimeString()}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`rounded-full border p-1 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
            <Button
              variant={activeTab === 'score' ? 'secondary' : 'ghost'}
              darkMode={darkMode}
              onClick={() => setActiveTab('score')}
            >
              Score Evidence
            </Button>
            <Button
              variant={activeTab === 'legacy' ? 'secondary' : 'ghost'}
              darkMode={darkMode}
              onClick={() => setActiveTab('legacy')}
            >
              All Extracted Evidence
            </Button>
          </div>
          <Button
            variant="primary"
            darkMode={darkMode}
            icon={<Sparkles className="w-4 h-4" />}
            onClick={onFetchEvidence}
          >
            Fetch evidence
          </Button>
          <Button
            variant="secondary"
            darkMode={darkMode}
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={onRefresh}
            loading={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {activeTab === 'score' && renderScoreEvidence()}

      {(activeTab === 'legacy' || !scoreEvidence) && renderLegacyEvidence()}
    </div>
  );
}
