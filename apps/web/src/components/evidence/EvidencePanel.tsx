import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { EvidenceChip } from './EvidenceChip';
import { Button } from '../ui/button';
import { apiGetDealVisualAssets, type DealVisualAsset } from '../../lib/apiClient';

export type EvidenceCard = {
  evidence_id: string;
  deal_id: string;
  document_id?: string;
  visual_asset_id?: string;
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
  onLocateVisualEvidenceNode?: (visualAssetId: string) => void;
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
    coverage_group_key?: string;
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

  resolvedEvidence?: Record<
    string,
    {
      id: string;
      ok: boolean;
      resolvable?: boolean;
      document_id?: string;
      document_title?: string;
      page?: number;
      snippet?: string;
    }
  >;
}

function humanizeSegmentLabel(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const parts = s.split(/[_\s]+/g).filter(Boolean);
  if (parts.length === 0) return '';
  return parts
    .map((p) => (p.length <= 2 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

function pickEffectiveSegment(asset: DealVisualAsset | undefined | null): string | null {
  if (!asset) return null;
  const pick = (...vals: Array<unknown>) => {
    for (const v of vals) {
      if (typeof v !== 'string') continue;
      const s = v.trim();
      if (!s || s === 'unknown') continue;
      return s;
    }
    return null;
  };
  return pick(asset.effective_segment, asset.segment, asset.persisted_segment_key, asset.computed_segment);
}

function formatPct01(conf: unknown): string | null {
  const c = typeof conf === 'number' ? conf : typeof conf === 'string' ? Number(conf) : NaN;
  if (!Number.isFinite(c)) return null;
  const clamped = Math.max(0, Math.min(1, c));
  return `${Math.round(clamped * 100)}%`;
}

type ScoreFilter = 'all' | 'missing' | 'weak';
type LegacySourceFilter = 'all' | string;

const SCORE_SECTION_KEYS: ScoreSectionKey[] = ['market', 'product', 'business_model', 'traction', 'risks', 'team', 'icp'];
const COVERAGE_GROUP_MAP: Record<ScoreSectionKey, string> = {
  market: 'market_icp',
  product: 'product_solution',
  business_model: 'business_model',
  traction: 'traction',
  risks: 'risks',
  team: 'team',
  icp: 'market_icp',
};
const isScoreSectionKeyValue = (value: unknown): value is ScoreSectionKey =>
  typeof value === 'string' && SCORE_SECTION_KEYS.includes(value as ScoreSectionKey);

// DEV CHECKLIST (manual verification):
// - Coverage-missing sections render as missing (no UI-inferred mismatch).
// - Market + ICP group into a single row when coverage_group_key is market_icp.
// - Linked evidence count decreases when only samples exist (no doc-backed UUIDs).
// - Mismatch badge shows only when backend sets mismatch=true.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_REGEX.test(value.trim());
// Synthetic IDs are UI placeholders; they must never count toward coverage or linking metrics.
const isSyntheticId = (value: string): boolean => value.startsWith('missing-') || value.startsWith('claim-') || value.startsWith('ev-');

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
  if (item.source === 'phaseb_visual') return 'Visual Evidence';
  return `${item.source} • ${item.kind}`;
}

function chipLabelForEvidence(item: EvidenceCard): string {
  if (item.source === 'phaseb_visual') return 'Visual';
  if (item.source === 'extraction' && item.kind === 'metric') return 'Metric';
  if (item.source === 'extraction' && item.kind === 'summary') return 'Summary';
  if (item.source === 'extraction' && item.kind === 'section') return 'Section';
  if (item.source === 'fetch_evidence') return 'Fetched';
  return 'Evidence';
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
  onLocateVisualEvidenceNode,
  reportSections = [],
  documentTitles = {},
  scoreEvidence = null,
  selectedScoreSectionKey = null,
  scoreBreakdownSections = [],
  highlightedEvidenceIds = [],
  selectedScoreSectionMismatch = null,
  externalTraceMode = null,
  scoreTraceAudit = null,
  resolvedEvidence = {},
}: EvidencePanelProps) {
  const [activeTab, setActiveTab] = useState<'score' | 'legacy'>(scoreEvidence ? 'score' : 'legacy');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [traceMode, setTraceMode] = useState<'all' | 'trace'>('all');
  const [legacySourceFilter, setLegacySourceFilter] = useState<LegacySourceFilter>('all');
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

  const legacySources = useMemo(() => {
    const unique = new Set<string>();
    for (const item of evidence ?? []) {
      if (typeof item?.source !== 'string') continue;
      const s = item.source.trim();
      if (!s) continue;
      unique.add(s);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [evidence]);

  useEffect(() => {
    if (legacySourceFilter === 'all') return;
    if (legacySources.includes(legacySourceFilter)) return;
    setLegacySourceFilter('all');
  }, [legacySourceFilter, legacySources]);

  const legacyEvidence = useMemo(() => {
    if (legacySourceFilter === 'all') return evidence;
    return (evidence ?? []).filter((e) => e.source === legacySourceFilter);
  }, [evidence, legacySourceFilter]);

  const legacyDealId = useMemo(() => {
    for (const ev of legacyEvidence ?? []) {
      if (typeof ev?.deal_id === 'string' && ev.deal_id.trim().length > 0) return ev.deal_id.trim();
    }
    return null;
  }, [legacyEvidence]);

  const legacyVisualAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ev of legacyEvidence ?? []) {
      if (typeof ev?.visual_asset_id !== 'string') continue;
      const id = ev.visual_asset_id.trim();
      if (id) ids.add(id);
    }
    return Array.from(ids);
  }, [legacyEvidence]);

  const [visualAssetById, setVisualAssetById] = useState<Record<string, DealVisualAsset>>({});
  const [visualAssetsLoadedForDeal, setVisualAssetsLoadedForDeal] = useState<string | null>(null);
  const [visualAssetsLoadError, setVisualAssetsLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!showLegacyEvidence) return;
    if (!legacyDealId) return;
    if (legacyVisualAssetIds.length === 0) return;
    if (visualAssetsLoadedForDeal === legacyDealId) return;

    let cancelled = false;
    setVisualAssetsLoadError(null);
    (async () => {
      try {
        const res = await apiGetDealVisualAssets(legacyDealId);
        if (cancelled) return;
        const map: Record<string, DealVisualAsset> = {};
        for (const a of res.visual_assets ?? []) {
          if (a && typeof a.visual_asset_id === 'string' && a.visual_asset_id.trim().length > 0) {
            map[a.visual_asset_id] = a;
          }
        }
        setVisualAssetById(map);
        setVisualAssetsLoadedForDeal(legacyDealId);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load visual assets';
        setVisualAssetsLoadError(message);
        setVisualAssetById({});
        setVisualAssetsLoadedForDeal(legacyDealId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showLegacyEvidence, legacyDealId, legacyVisualAssetIds.length, visualAssetsLoadedForDeal]);

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

  const scoreLinkedByEvidenceId = useMemo(() => {
    const byId = new Map<string, ScoreSectionKey[]>();
    for (const sec of scoreBreakdownSections ?? []) {
      const key = (sec?.section_key ?? sec?.key) as unknown;
      if (!isScoreSectionKeyValue(key)) continue;
      const ids = Array.isArray(sec?.evidence_ids_linked)
        ? sec.evidence_ids_linked
        : Array.isArray(sec?.evidence_ids)
          ? sec.evidence_ids
          : [];
      for (const id of ids) {
        if (typeof id !== 'string' || !id.trim()) continue;
        const list = byId.get(id) ?? [];
        if (!list.includes(key)) list.push(key);
        byId.set(id, list);
      }
    }
    return byId;
  }, [scoreBreakdownSections]);

  const ruleKeyBySectionKey = useMemo(() => {
    const map = new Map<ScoreSectionKey, string>();
    for (const sec of scoreBreakdownSections ?? []) {
      const key = (sec?.section_key ?? sec?.key) as unknown;
      if (!isScoreSectionKeyValue(key)) continue;
      if (typeof sec?.rule_key === 'string' && sec.rule_key.trim().length > 0) {
        map.set(key, sec.rule_key.trim());
      }
    }
    return map;
  }, [scoreBreakdownSections]);

  type DecisionTrace = { sectionKey: ScoreSectionKey; ruleKey?: string; claimId?: string };
  const decisionTracesByEvidenceId = useMemo(() => {
    const out = new Map<string, DecisionTrace[]>();
    if (!scoreEvidence || !Array.isArray(scoreEvidence.sections)) return out;

    const push = (evidenceId: string, trace: DecisionTrace) => {
      const list = out.get(evidenceId) ?? [];
      const dedupeKey = `${trace.sectionKey}|${trace.ruleKey ?? ''}|${trace.claimId ?? ''}`;
      if (!list.some((t) => `${t.sectionKey}|${t.ruleKey ?? ''}|${t.claimId ?? ''}` === dedupeKey)) {
        list.push(trace);
        out.set(evidenceId, list);
      }
    };

    for (const sec of scoreEvidence.sections) {
      const sectionKey = sec?.key as unknown;
      if (!isScoreSectionKeyValue(sectionKey)) continue;
      const ruleKey = ruleKeyBySectionKey.get(sectionKey);
      const claims = Array.isArray(sec?.claims) ? sec.claims : [];
      for (const claim of claims) {
        const claimId = typeof claim?.id === 'string' && claim.id.trim().length > 0 ? claim.id.trim() : undefined;
        const evs = Array.isArray(claim?.evidence) ? claim.evidence : [];
        for (const ev of evs) {
          const evidenceId = typeof ev?.id === 'string' ? ev.id.trim() : '';
          if (!evidenceId) continue;
          push(evidenceId, { sectionKey, ruleKey, claimId });
        }
      }
    }

    // Prefer stable ordering: by section label, then claim id.
    for (const [k, list] of out.entries()) {
      list.sort((a, b) => {
        const sa = sectionLabel(a.sectionKey);
        const sb = sectionLabel(b.sectionKey);
        const s = sa.localeCompare(sb);
        if (s !== 0) return s;
        return String(a.claimId ?? '').localeCompare(String(b.claimId ?? ''));
      });
      out.set(k, list);
    }

    return out;
  }, [scoreEvidence, ruleKeyBySectionKey]);

  const scoreLinkedIdSet = useMemo(() => new Set(Array.from(scoreLinkedByEvidenceId.keys())), [scoreLinkedByEvidenceId]);

  const activeMismatch = useMemo(() => {
    if (!selectedScoreSectionKey) return false;
    const match = scoreBreakdownSections.find(
      (s) => s?.key === selectedScoreSectionKey || (s as any)?.section_key === selectedScoreSectionKey
    );
    // Mismatch is authoritative from backend audit; the UI must not infer it from counts.
    return match?.mismatch === true;
  }, [selectedScoreSectionKey, scoreBreakdownSections]);

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

    const supportStatusRaw = typeof (activeTraceSection as any)?.support_status === 'string' ? (activeTraceSection as any).support_status.trim() : '';
    const supportStatusFallback = typeof (activeTraceSection as any)?.support === 'string' ? (activeTraceSection as any).support.trim() : '';
    const supportStatus = supportStatusRaw || supportStatusFallback;

    const toUuidSet = (values: unknown): Set<string> => {
      const set = new Set<string>();
      if (!Array.isArray(values)) return set;
      for (const v of values) {
        if (typeof v !== 'string') continue;
        const id = v.trim();
        if (!id || isSyntheticId(id) || !isUuid(id)) continue;
        set.add(id);
      }
      return set;
    };

    const totalIds = toUuidSet((activeTraceSection as any)?.evidence_ids);
    const sampleIds = toUuidSet((activeTraceSection as any)?.evidence_ids_sample);
    const linkedIds = toUuidSet((activeTraceSection as any)?.evidence_ids_linked);

    const totalIdsCombined = new Set<string>([...totalIds, ...sampleIds, ...linkedIds]);

    const linkedCount = linkedIds.size;
    const totalCount = totalIdsCombined.size;

    if (supportStatus === 'missing') {
      return { linked: 0, total: 0, pct: null };
    }

    const pct = totalCount > 0 ? Math.min(100, Math.max(0, Math.round((linkedCount / totalCount) * 100))) : null;

    return { linked: linkedCount, total: totalCount, pct };
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

  const metrics = useMemo(() => legacyEvidence.filter((e) => e.source === 'extraction' && e.kind === 'metric'), [legacyEvidence]);
  const summaries = useMemo(() => legacyEvidence.filter((e) => e.source === 'extraction' && e.kind === 'summary'), [legacyEvidence]);
  const sections = useMemo(
    () => legacyEvidence.filter((e) => e.source === 'extraction' && e.kind === 'section'),
    [legacyEvidence]
  );
  const other = useMemo(
    () => legacyEvidence.filter((e) => !((e.source === 'extraction') && (e.kind === 'metric' || e.kind === 'summary' || e.kind === 'section'))),
    [legacyEvidence]
  );
  const referencedCount = useMemo(() => legacyEvidence.filter((e) => usedIn.has(e.evidence_id)).length, [legacyEvidence, usedIn]);

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

  const linkedEvidenceCount = useMemo(() => {
    if (!scoreEvidence || !Array.isArray(scoreEvidence.sections)) return null;

    const ids = new Set<string>();
    const hasResolver = resolvedEvidence && Object.keys(resolvedEvidence).length > 0;

    for (const section of scoreEvidence.sections) {
      for (const claim of section.claims ?? []) {
        for (const ev of claim.evidence ?? []) {
          const idRaw = ev?.id;
          if (!idRaw || typeof idRaw !== 'string') continue;
          const id = idRaw.trim();
          if (!id || isSyntheticId(id) || !isUuid(id)) continue;

          if (hasResolver) {
            const resolved = resolvedEvidence?.[id];
            if (!resolved || !resolved.document_id) continue;
          } else {
            const hasDoc = typeof ev?.doc_id === 'string' ? ev.doc_id.trim().length > 0 : false;
            if (!hasDoc) continue;
          }

          ids.add(id);
        }
      }
    }

    return ids.size;
  }, [resolvedEvidence, scoreEvidence]);

  const missingSections = useMemo(() => {
    if (!Array.isArray(scoreBreakdownSections)) return [] as Array<{ key: string; label: string; sectionKey: ScoreSectionKey | null }>;

    const seen = new Set<string>();
    const results: Array<{ key: string; label: string; sectionKey: ScoreSectionKey | null }> = [];

    const labelForGroup = (groupKey: string, sectionKey: ScoreSectionKey | null) => {
      if (sectionKey) return sectionLabel(sectionKey);
      if (isScoreSectionKeyValue(groupKey)) return sectionLabel(groupKey);
      if (groupKey === 'market_icp') return 'Market / ICP';
      if (groupKey === 'product_solution') return 'Product';
      return groupKey.replace(/_/g, ' ');
    };

    for (const section of scoreBreakdownSections) {
      const supportStatusRaw = typeof (section as any)?.support_status === 'string' ? (section as any).support_status.trim() : '';
      const supportFallback = typeof (section as any)?.support === 'string' ? (section as any).support.trim() : '';
      const supportStatus = supportStatusRaw || supportFallback;
      if (supportStatus !== 'missing') continue;

      const sectionKeyRaw = typeof section.section_key === 'string' ? section.section_key.trim() : typeof section.key === 'string' ? section.key.trim() : '';
      const sectionKey = isScoreSectionKeyValue(sectionKeyRaw) ? sectionKeyRaw : null;
      const coverageGroupKey = typeof (section as any)?.coverage_group_key === 'string' ? (section as any).coverage_group_key.trim() : '';
      const groupKey = coverageGroupKey || sectionKeyRaw;

      if (!groupKey || seen.has(groupKey)) continue;
      seen.add(groupKey);

      results.push({ key: groupKey, label: labelForGroup(groupKey, sectionKey), sectionKey });
    }

    return results;
  }, [scoreBreakdownSections]);

  const missingSectionsForView = useMemo(() => {
    if (sectionFilter === 'all') return missingSections;
    const coverageKey = COVERAGE_GROUP_MAP[sectionFilter];
    return missingSections.filter(
      (m) => m.sectionKey === sectionFilter || m.key === sectionFilter || (coverageKey && m.key === coverageKey)
    );
  }, [missingSections, sectionFilter]);

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
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Source:</div>
            <select
              value={legacySourceFilter}
              onChange={(e) => setLegacySourceFilter(e.target.value)}
              className={`text-xs rounded-md border px-2 py-1 outline-none ${
                darkMode
                  ? 'bg-white/5 border-white/10 text-gray-200'
                  : 'bg-white border-gray-200 text-gray-800'
              }`}
            >
              <option value="all">All sources ({evidence.length})</option>
              {legacySources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Showing {legacyEvidence.length} item{legacyEvidence.length === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {visualAssetsLoadError ? (
        <div
          className={`mb-3 rounded-xl border p-3 text-xs ${
            darkMode ? 'bg-amber-500/10 border-amber-400/40 text-amber-100' : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          Could not load visual segment labels: {visualAssetsLoadError}
        </div>
      ) : null}

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
              <div className="text-sm font-semibold">{referencedCount}/{legacyEvidence.length}</div>
            </div>
          </div>
        </div>
      )}

      {(() => {
        type NodeGroup = { nodeKey: string; nodeLabel: string; visual_asset_id?: string; items: EvidenceCard[] };
        type PageGroup = { pageKey: string; pageLabel: string; nodes: Map<string, NodeGroup> };
        type DocGroup = { document_id: string; document_title: string; pages: Map<string, PageGroup> };

        const allItems = [...summaries, ...metrics, ...sections, ...other];
        if (allItems.length === 0) return null;

        const docs = new Map<string, DocGroup>();
        for (const item of allItems) {
          const resolved = resolvedEvidence?.[item.evidence_id];

          const document_id =
            typeof item.document_id === 'string' && item.document_id.trim().length > 0
              ? item.document_id
              : typeof resolved?.document_id === 'string' && resolved.document_id.trim().length > 0
                ? resolved.document_id
                : 'unknown';

          const document_title =
            document_id !== 'unknown' && typeof documentTitles?.[document_id] === 'string'
              ? documentTitles[document_id]
              : typeof resolved?.document_title === 'string' && resolved.document_title.trim().length > 0
                ? resolved.document_title
                : document_id;

          const page = typeof resolved?.page === 'number' && Number.isFinite(resolved.page) ? resolved.page : null;
          const pageKey = page != null ? String(page) : 'unknown';
          const pageLabel = page != null ? `Page ${page}` : 'Page unknown';

          const nodeKey = item.visual_asset_id ? `evidence:${item.visual_asset_id}` : 'document';
          const nodeLabel = item.visual_asset_id ? `Node evidence:${item.visual_asset_id}` : 'Document-level';

          const doc = docs.get(document_id) ?? { document_id, document_title, pages: new Map() };
          const pg = doc.pages.get(pageKey) ?? { pageKey, pageLabel, nodes: new Map() };
          const nd = pg.nodes.get(nodeKey) ?? { nodeKey, nodeLabel, visual_asset_id: item.visual_asset_id, items: [] };
          nd.items.push(item);
          pg.nodes.set(nodeKey, nd);
          doc.pages.set(pageKey, pg);
          docs.set(document_id, doc);
        }

        const docsSorted = Array.from(docs.values()).sort((a, b) => a.document_title.localeCompare(b.document_title));

        return (
          <div className="space-y-3">
            {docsSorted.map((doc) => {
              const docItems = Array.from(doc.pages.values()).flatMap((p) => Array.from(p.nodes.values()).flatMap((n) => n.items));

              const counts = {
                summaries: docItems.filter((x) => x.kind === 'summary').length,
                metrics: docItems.filter((x) => x.kind === 'metric').length,
                sections: docItems.filter((x) => x.kind === 'section').length,
                other: docItems.filter((x) => x.kind !== 'summary' && x.kind !== 'metric' && x.kind !== 'section').length,
              };

              const pagesSorted = Array.from(doc.pages.values()).sort((a, b) => {
                const ak = a.pageKey === 'unknown' ? Number.POSITIVE_INFINITY : Number(a.pageKey);
                const bk = b.pageKey === 'unknown' ? Number.POSITIVE_INFINITY : Number(b.pageKey);
                return ak - bk;
              });

              return (
                <details
                  key={doc.document_id}
                  className={`rounded-xl border p-4 ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}
                  open
                >
                  <summary className="cursor-pointer select-none">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-[260px]">
                        <div className="text-sm font-semibold" title={doc.document_id}>{doc.document_title}</div>
                        <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {docItems.length} item(s) · {counts.summaries} summaries · {counts.metrics} metrics · {counts.sections} sections · {counts.other} other
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[11px] px-2 py-1 rounded-full border ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
                          Pages: {doc.pages.size}
                        </span>
                      </div>
                    </div>
                  </summary>

                  <div className="mt-3 space-y-3">
                    {pagesSorted.map((page) => {
                      const nodesSorted = Array.from(page.nodes.values()).sort((a, b) => a.nodeKey.localeCompare(b.nodeKey));
                      const pageItemCount = nodesSorted.reduce((acc, n) => acc + n.items.length, 0);
                      return (
                        <div key={page.pageKey} className={`rounded-lg border p-3 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className={`text-xs font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{page.pageLabel}</div>
                            <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{pageItemCount} item(s)</div>
                          </div>

                          <div className="mt-2 space-y-2">
                            {nodesSorted.map((node) => {
                              const hasVisual = typeof node.visual_asset_id === 'string' && node.visual_asset_id.trim().length > 0;
                              const visualAsset = hasVisual ? visualAssetById[node.visual_asset_id as string] : undefined;
                              const segRaw = hasVisual ? pickEffectiveSegment(visualAsset) : null;
                              const segLabel = segRaw ? humanizeSegmentLabel(segRaw) : null;
                              const segSource = hasVisual && typeof visualAsset?.segment_source === 'string' ? visualAsset.segment_source.trim() : null;
                              const segConf = hasVisual ? formatPct01(visualAsset?.segment_confidence) : null;
                              const itemsSorted = [...node.items].sort((a, b) => String(a.kind).localeCompare(String(b.kind)));

                              return (
                                <div key={node.nodeKey} className={`rounded-lg border p-3 ${darkMode ? 'border-white/10 bg-black/10' : 'border-gray-200 bg-white'}`}>
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <div
                                        className={`text-[11px] font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
                                        title={
                                          hasVisual
                                            ? `${node.nodeLabel}${segRaw ? ` · segment=${segRaw}` : ''}${segSource ? ` · source=${segSource}` : ''}${segConf ? ` · confidence=${segConf}` : ''}`
                                            : node.nodeLabel
                                        }
                                      >
                                        {hasVisual ? (segLabel ? `Node: ${segLabel}` : 'Node: Visual evidence') : 'Node: Document-level'}
                                      </div>

                                      {hasVisual && (segSource || segConf) ? (
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {segSource ? (
                                            <span
                                              className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                                darkMode ? 'border-white/10 text-gray-200' : 'border-gray-200 text-gray-700'
                                              }`}
                                              title="Segment source"
                                            >
                                              {segSource}
                                            </span>
                                          ) : null}
                                          {segConf ? (
                                            <span
                                              className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                                darkMode ? 'border-white/10 text-gray-200' : 'border-gray-200 text-gray-700'
                                              }`}
                                              title="Segment confidence"
                                            >
                                              {segConf}
                                            </span>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                    {hasVisual && onLocateVisualEvidenceNode ? (
                                      <button
                                        type="button"
                                        onClick={() => onLocateVisualEvidenceNode(node.visual_asset_id as string)}
                                        className={`text-[11px] px-2 py-1 rounded-full border ${darkMode ? 'border-white/10 text-gray-200 hover:bg-white/10' : 'border-gray-200 text-gray-800 hover:bg-gray-100'}`}
                                        title={node.nodeKey}
                                      >
                                        Locate node
                                      </button>
                                    ) : null}
                                  </div>

                                  <div className="mt-2 space-y-2">
                                    {itemsSorted.map((item) => {
                                      const usedInSections = usedIn.get(item.evidence_id) ?? [];
                                      const conf = confidencePct(item.confidence);
                                      const label = labelForEvidence(item);
                                      const chipLabel = chipLabelForEvidence(item);
                                      const metric = item.kind === 'metric' ? formatMetricText(item.text) : null;

                                      const scoreSections = scoreLinkedByEvidenceId.get(item.evidence_id) ?? [];
                                      const inScore = scoreLinkedIdSet.has(item.evidence_id);
                                      const inReport = usedInSections.length > 0;

                                      return (
                                        <div key={item.evidence_id} className={`rounded-md border px-3 py-2 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
                                          <div className="flex items-start justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <EvidenceChip evidenceId={item.evidence_id} label={chipLabel} darkMode={darkMode} excerpt={metric ? metric.title : undefined} />
                                              {conf ? (
                                                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
                                                  Confidence {conf}
                                                </span>
                                              ) : null}
                                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${inScore ? (darkMode ? 'border-indigo-400/50 text-indigo-200' : 'border-indigo-200 text-indigo-700') : (darkMode ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700')}`}>
                                                {inScore ? 'SCORE-LINKED' : 'NOT SCORE-LINKED'}
                                              </span>
                                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${inReport ? (darkMode ? 'border-emerald-500/40 text-emerald-200' : 'border-emerald-200 text-emerald-700') : (darkMode ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700')}`}>
                                                {inReport ? 'IN REPORT' : 'NOT IN REPORT'}
                                              </span>
                                            </div>
                                            <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'} uppercase tracking-wide`}>
                                              {label}
                                            </div>
                                          </div>

                                          <div className={`mt-1 text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                            {metric ? (
                                              <>
                                                <span className="font-semibold">{metric.title}:</span> {metric.details}
                                              </>
                                            ) : (
                                              <span className="font-medium">{item.text}</span>
                                            )}
                                          </div>

                                          {inScore && scoreSections.length > 0 ? (
                                            <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} text-[11px] mt-1`}>
                                              Score sections: {scoreSections.map(sectionLabel).join(', ')}
                                            </div>
                                          ) : null}

                                          {inScore ? (() => {
                                            const traces = decisionTracesByEvidenceId.get(item.evidence_id) ?? [];
                                            if (traces.length > 0) {
                                              const formatted = traces.slice(0, 3).map((t) => {
                                                const bits = [sectionLabel(t.sectionKey)];
                                                if (t.ruleKey) bits.push(`rule ${t.ruleKey}`);
                                                if (t.claimId) bits.push(`claim ${t.claimId}`);
                                                return bits.join(' · ');
                                              });
                                              return (
                                                <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} text-[11px] mt-1`}>
                                                  Used in decision: {formatted.join(' | ')}
                                                  {traces.length > 3 ? ` (+${traces.length - 3} more)` : ''}
                                                </div>
                                              );
                                            }

                                            // Fallback (explicitly section-level): we know the evidence is score-linked to one or more
                                            // sections, but we don't have claim-level trace paths for this specific evidence id.
                                            const sectionsOnly = scoreLinkedByEvidenceId.get(item.evidence_id) ?? [];
                                            if (sectionsOnly.length === 0) return null;
                                            const formatted = sectionsOnly.slice(0, 3).map((sectionKey) => {
                                              const bits = [sectionLabel(sectionKey)];
                                              const ruleKey = ruleKeyBySectionKey.get(sectionKey);
                                              if (ruleKey) bits.push(`rule ${ruleKey}`);
                                              return bits.join(' · ');
                                            });
                                            return (
                                              <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} text-[11px] mt-1`}>
                                                Potentially used in decision (section-level): {formatted.join(' | ')}
                                                {sectionsOnly.length > 3 ? ` (+${sectionsOnly.length - 3} more)` : ''}
                                              </div>
                                            );
                                          })() : null}

                                          {inReport && usedInSections.length > 0 ? (
                                            <div className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} text-[11px] mt-1`}>
                                              Referenced in report: {usedInSections.slice(0, 3).join(', ')}{usedInSections.length > 3 ? ` (+${usedInSections.length - 3} more)` : ''}
                                            </div>
                                          ) : null}

                                          {item.created_at ? (
                                            <div className={`${darkMode ? 'text-gray-500' : 'text-gray-500'} text-[11px] mt-1`}>
                                              {new Date(item.created_at).toLocaleString()}
                                            </div>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        );
      })()}
    </>
  );

  const renderScoreEvidence = () => {
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
              <div className="text-sm font-semibold">{linkedEvidenceCount ?? '—'}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Last updated</div>
              <div className="text-sm font-semibold">{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}</div>
            </div>
          </div>
          {missingSectionsForView.length > 0 && (
            <div className={`text-[12px] mt-3 flex items-center gap-2 ${darkMode ? 'text-amber-200' : 'text-amber-700'}`}>
              Missing sections: {missingSectionsForView.map((m) => m.label).join(', ')}
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
              const resolved = item.evidenceId ? resolvedEvidence[item.evidenceId] : undefined;
              const resolvedDocId = resolved?.document_id;
              const resolvedDocTitle = resolved?.document_title;
              const citationDocId = item.documentId ?? resolvedDocId;
              const citationPage = item.page ?? resolved?.page;
              const citationSnippet = item.snippet ?? resolved?.snippet;

              const docLabel = item.documentTitle || resolvedDocTitle || (citationDocId ? documentTitles[citationDocId] || citationDocId : null);
              const metaParts = [docLabel, citationPage != null ? `Page ${citationPage}` : null].filter(Boolean).join(' • ');
              const conf = confidencePct(item.confidence);
              const isHighlighted = item.evidenceId ? highlightedSet.has(item.evidenceId) || flashHighlightIds.has(item.evidenceId) : false;
              const showUsedInScore = Boolean(item.evidenceId) && Boolean(citationDocId);
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
                      {citationSnippet && (
                        <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{citationSnippet}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-[11px] px-2 py-1 rounded-full border ${scoreSupportBadgeClass(item.support)}`}>
                        {scoreSupportLabel(item.support)}
                      </span>
                      {showUsedInScore && (
                        <span className={`text-[10px] px-2 py-1 rounded-full border ${darkMode ? 'border-emerald-500/40 text-emerald-200' : 'border-emerald-200 text-emerald-700'}`}>
                          USED IN SCORE
                        </span>
                      )}
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
