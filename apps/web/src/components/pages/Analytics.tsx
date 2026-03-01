import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Button } from '../ui/button';
import { Select } from '../ui/select';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronDown, Clock, FileText, Sparkles, Target, Zap } from 'lucide-react';
import type { PageView } from '../Sidebar';
import { apiGetDealExtractionReport, apiGetDeals, apiGetDocuments } from '../../lib/apiClient';
import { DealExtractionReportModal } from '../documents/DealExtractionReportModal';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

interface AnalyticsProps {
  darkMode: boolean;
  onNavigate?: (page: PageView) => void;
  onDealClick?: (dealId: string) => void;
}

export function Analytics({ darkMode, onNavigate, onDealClick }: AnalyticsProps) {
  const { isLoaded: authLoaded, isSignedIn, orgId } = useAuth();
  const [dateRange, setDateRange] = useState<'7days' | '30days' | '90days' | 'ytd' | 'all'>('30days');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deals, setDeals] = useState<any[]>([]);
  const [docSummaryByDealId, setDocSummaryByDealId] = useState<Record<string, { count: number; lastUploadedAt?: string }>>(
    {}
  );
  const [docsOverTime, setDocsOverTime] = useState<Array<{ label: string; documents: number; sort: number }>>([]);
  const [attentionItems, setAttentionItems] = useState<
    Array<{
      dealId: string;
      dealName: string;
      confidenceBand?: string;
      recommendedAction?: string;
      docIssues: number;
    }>
  >([]);
  const [aiModalDealId, setAiModalDealId] = useState<string | null>(null);
  const [needsAttentionOpen, setNeedsAttentionOpen] = useState(false);

  function formatRelativeTime(iso: string | undefined | null): string {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    const diffMs = Date.now() - t;
    const sec = Math.max(0, Math.floor(diffMs / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
  }

  function stageLabel(raw: unknown): string {
    const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!s) return 'Unknown';
    if (s === 'intake') return 'Intake';
    if (s === 'under_review' || s === 'under review') return 'Under Review';
    if (s === 'in_diligence' || s === 'in diligence') return 'In Diligence';
    if (s === 'decision_ready' || s === 'ready_decision' || s === 'ready decision') return 'Decision Ready';
    return s
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function scoreBucket(score: number): '0-50' | '51-70' | '71-85' | '86-100' {
    if (score <= 50) return '0-50';
    if (score <= 70) return '51-70';
    if (score <= 85) return '71-85';
    return '86-100';
  }

  const getRangeStart = useCallback((): number | null => {
    const now = new Date();
    if (dateRange === '7days') return Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (dateRange === '30days') return Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (dateRange === '90days') return Date.now() - 90 * 24 * 60 * 60 * 1000;
    if (dateRange === 'ytd') return new Date(now.getFullYear(), 0, 1).getTime();
    return null;
  }, [dateRange]);

  const buildDocsSeries = useCallback(
    (allDocs: Array<{ uploaded_at?: string | null }>) => {
      const rangeStart = getRangeStart();
      const bucketMode: 'day' | 'week' | 'month' =
        dateRange === '7days' || dateRange === '30days' ? 'day' : dateRange === '90days' ? 'week' : 'month';

      const toBucketStart = (d: Date): Date => {
        if (bucketMode === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        if (bucketMode === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
        // week: Monday
        const day = d.getDay();
        const diffToMonday = (day + 6) % 7;
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffToMonday);
      };

      const labelFor = (bucketStart: Date): string => {
        const month = bucketStart.toLocaleString(undefined, { month: 'short' });
        if (bucketMode === 'month') return `${month} ${bucketStart.getFullYear()}`;
        return `${month} ${bucketStart.getDate()}`;
      };

      const buckets = new Map<string, { documents: number; sort: number }>();
      for (const doc of allDocs) {
        const iso = doc?.uploaded_at;
        if (!iso) continue;
        const t = Date.parse(iso);
        if (!Number.isFinite(t)) continue;
        if (rangeStart != null && t < rangeStart) continue;

        const bucketStart = toBucketStart(new Date(t));
        const sort = bucketStart.getTime();
        const label = labelFor(bucketStart);
        const existing = buckets.get(label);
        if (existing) existing.documents += 1;
        else buckets.set(label, { documents: 1, sort });
      }

      return Array.from(buckets.entries())
        .map(([label, v]) => ({ label, documents: v.documents, sort: v.sort }))
        .sort((a, b) => a.sort - b.sort);
    },
    [dateRange, getRangeStart]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loadedDeals = await apiGetDeals();
      const normalizedDeals = Array.isArray(loadedDeals) ? loadedDeals : [];
      setDeals(normalizedDeals);

      // Best-effort aggregations: sample deals to keep the page fast.
      const sampledDealIds = normalizedDeals
        .map((d: any) => String(d?.id ?? d?.deal_id ?? ''))
        .filter((id: string) => id.length > 0)
        .slice(0, 20);

      const docResults = await Promise.allSettled(sampledDealIds.map((dealId) => apiGetDocuments(dealId)));

      const summary: Record<string, { count: number; lastUploadedAt?: string }> = {};
      const allDocs: Array<{ uploaded_at?: string | null }> = [];

      docResults.forEach((r, idx) => {
        if (r.status !== 'fulfilled') return;
        const dealId = sampledDealIds[idx];
        const docs = (r.value?.documents ?? []) as any[];
        summary[dealId] = { count: docs.length };

        let latest: string | undefined = undefined;
        for (const d of docs) {
          const iso = typeof d?.uploaded_at === 'string' ? d.uploaded_at : undefined;
          if (iso) {
            allDocs.push({ uploaded_at: iso });
            if (!latest || Date.parse(iso) > Date.parse(latest)) latest = iso;
          }
        }
        if (latest) summary[dealId].lastUploadedAt = latest;
      });

      setDocSummaryByDealId(summary);
      setDocsOverTime(buildDocsSeries(allDocs));

      // Action queue (best-effort): sample a smaller set since extraction reports can be heavier.
      const attentionDealIds = sampledDealIds.slice(0, 10);
      const dealNameById = new Map(
        normalizedDeals
          .map((d: any) => [String(d?.id ?? d?.deal_id ?? ''), String(d?.name ?? 'Deal')] as const)
          .filter(([id]) => id.length > 0)
      );

      const reportResults = await Promise.allSettled(attentionDealIds.map((dealId) => apiGetDealExtractionReport(dealId)));
      const items: Array<{
        dealId: string;
        dealName: string;
        confidenceBand?: string;
        recommendedAction?: string;
        docIssues: number;
        _severity: number;
      }> = [];

      reportResults.forEach((r, idx) => {
        if (r.status !== 'fulfilled') return;
        const dealId = attentionDealIds[idx];
        const dealName = dealNameById.get(dealId) || 'Deal';
        const report = r.value as any;

        const dealBand = String(report?.extraction_report?.confidence_band ?? '').toLowerCase();
        const recommendedAction = String(report?.extraction_report?.recommended_action ?? '');
        const docReports = Array.isArray(report?.documents) ? report.documents : [];
        const docIssues = docReports.filter((d: any) => {
          const action = String(d?.recommended_action ?? '');
          return action && action.toLowerCase() !== 'none' && action.toLowerCase() !== 'ok';
        }).length;

        const severity = dealBand === 'low' ? 3 : dealBand === 'med' || dealBand === 'medium' ? 2 : dealBand === 'high' ? 1 : 0;
        const shouldShow = severity > 0 || docIssues > 0 || (recommendedAction && recommendedAction.toLowerCase() !== 'none');
        if (!shouldShow) return;

        items.push({
          dealId,
          dealName,
          confidenceBand: dealBand || undefined,
          recommendedAction: recommendedAction || undefined,
          docIssues,
          _severity: severity,
        });
      });

      items.sort((a, b) => b._severity - a._severity || b.docIssues - a.docIssues || a.dealName.localeCompare(b.dealName));
      setAttentionItems(items.map(({ _severity, ...rest }) => rest));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load analytics';
      setError(msg);
      setDeals([]);
      setDocSummaryByDealId({});
      setDocsOverTime([]);
      setAttentionItems([]);
    } finally {
      setLoading(false);
    }
  }, [buildDocsSeries]);

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn || !orgId) {
      setLoading(false);
      setError(null);
      setDeals([]);
      setDocSummaryByDealId({});
      setDocsOverTime([]);
      setAttentionItems([]);
      return;
    }

    load();
  }, [authLoaded, isSignedIn, orgId, load]);

  const derived = useMemo(() => {
    const dealItems = deals;
    const totalDeals = dealItems.length;
    const scores = dealItems
      .map((d: any) => {
        const raw = d?.score ?? d?.overall_score;
        const n = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(n) ? n : null;
      })
      .filter((x: number | null): x is number => x != null);
    const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;

    const stageCounts = new Map<string, number>();
    const bucketCounts = new Map<string, number>([
      ['0-50', 0],
      ['51-70', 0],
      ['71-85', 0],
      ['86-100', 0],
    ]);

    let decisionReadyCount = 0;
    let inDiligenceCount = 0;
    let analyzedCount = 0;

    for (const d of dealItems) {
      const stage = stageLabel((d as any)?.stage);
      stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);

      const rawScore = (d as any)?.score ?? (d as any)?.overall_score;
      const score = typeof rawScore === 'number' ? rawScore : Number(rawScore);
      if (Number.isFinite(score)) bucketCounts.set(scoreBucket(score), (bucketCounts.get(scoreBucket(score)) ?? 0) + 1);

      const stageRaw = String((d as any)?.stage ?? '').toLowerCase();
      if (stageRaw === 'decision_ready' || stageRaw === 'ready_decision') decisionReadyCount += 1;
      if (stageRaw === 'in_diligence') inDiligenceCount += 1;

      const ui = (d as any)?.ui;
      if (ui?.overviewV2 || ui?.dealOverviewV2 || ui?.executiveSummaryV2 || ui?.updateReportV1) analyzedCount += 1;
    }

    const dealsByStage = Array.from(stageCounts.entries())
      .map(([stage, count]) => ({ stage, count, percentage: totalDeals > 0 ? Math.round((100 * count * 10) / totalDeals) / 10 : 0 }))
      .sort((a, b) => b.count - a.count);

    const scoreDistribution = ['0-50', '51-70', '71-85', '86-100'].map((range) => ({
      range,
      count: bucketCounts.get(range) ?? 0,
    }));

    const docsInRange = docsOverTime.reduce((sum, x) => sum + x.documents, 0);

    const insights = [
      { text: `${decisionReadyCount} deal(s) are Decision Ready`, type: 'info' },
      { text: `${inDiligenceCount} deal(s) currently In Diligence`, type: 'info' },
      { text: `${analyzedCount} deal(s) have Phase 1 outputs available`, type: 'success' },
      { text: `${docsInRange} document(s) uploaded in selected range`, type: 'success' },
    ];

    const rows = dealItems
      .map((d: any) => {
        const id = String(d?.id ?? d?.deal_id ?? '');
        const name = String(d?.name ?? 'Deal');
        const rawScore = d?.score ?? d?.overall_score;
        const score = Number.isFinite(Number(rawScore)) ? Number(rawScore) : 0;
        const stage = stageLabel(d?.stage);
        const docSummary = docSummaryByDealId[id];
        const lastActivity = docSummary?.lastUploadedAt ? formatRelativeTime(docSummary.lastUploadedAt) : '—';
        const docs = typeof docSummary?.count === 'number' ? docSummary.count : 0;
        return { id, name, score, stage, docs, lastActivity };
      })
      .filter((r) => r.id.length > 0)
      .sort((a, b) => b.score - a.score);

    return {
      totalDeals,
      avgScore,
      analyzedCount,
      dealsByStage,
      scoreDistribution,
      insights,
      rows,
    };
  }, [deals, docSummaryByDealId, docsOverTime]);

  const [sortConfig, setSortConfig] = useState<{ key: 'name' | 'stage' | 'score' | 'docs' | 'lastActivity'; direction: 'asc' | 'desc' } | null>(
    null
  );

  const sortedDeals = useMemo(() => {
    const items = [...derived.rows];
    if (!sortConfig) return items;
    return items.sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [derived.rows, sortConfig]);

  const handleSort = (key: 'name' | 'stage' | 'score' | 'docs' | 'lastActivity') => {
    setSortConfig((current) => {
      if (!current || current.key !== key) return { key, direction: 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return null;
    });
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className={`p-3 rounded-lg border backdrop-blur-xl ${
          darkMode 
            ? 'bg-[#18181b]/95 border-white/10' 
            : 'bg-white/95 border-gray-200'
        }`}>
          <p className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {entry.name}: <span className="font-medium">{entry.value}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Header & Filters */}
        <div className={`backdrop-blur-xl border rounded-2xl p-4 sm:p-6 ${ 
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
            <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Analytics Dashboard
            </h2>
            <Button variant="secondary" size="sm" darkMode={darkMode} onClick={load} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>

          <div className="grid grid-cols-5 gap-3">
            <Select
              darkMode={darkMode}
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              options={[
                { value: '7days', label: 'Last 7 days' },
                { value: '30days', label: 'Last 30 days' },
                { value: '90days', label: 'Last 90 days' },
                { value: 'ytd', label: 'Year to date' },
                { value: 'all', label: 'All time' }
              ]}
            />

            <div className="col-span-4 flex items-center">
              {error ? (
                <span className="text-sm text-red-400">{error}</span>
              ) : (
                <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Live-backed snapshot from your deals and documents
                </span>
              )}
            </div>
          </div>
        </div>

        {/* AI Insights Panel */}
        <div className={`backdrop-blur-xl border rounded-2xl p-4 ${
          darkMode
            ? 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30'
            : 'bg-gradient-to-br from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
        }`}>
          <div className="flex items-start gap-3 mb-3">
            <Sparkles className="w-5 h-5 text-[#6366f1] mt-0.5" />
            <div>
              <h3 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                AI-Powered Insights
              </h3>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Key findings from your deal portfolio
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {derived.insights.map((insight, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg ${
                  darkMode ? 'bg-white/5' : 'bg-white/50'
                }`}
              >
                <p className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {insight.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Needs Attention Queue (Accordion) */}
        <div
          className={`backdrop-blur-xl border rounded-2xl p-4 sm:p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}
        >
          <Collapsible open={needsAttentionOpen} onOpenChange={setNeedsAttentionOpen}>
            <div className="flex items-start justify-between gap-4">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="group flex-1 text-left outline-none"
                  aria-label="Toggle Needs Attention"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Needs Attention</h3>
                        {!loading && attentionItems.length > 0 && (
                          <span
                            className={
                              darkMode
                                ? 'inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-200'
                                : 'inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800'
                            }
                          >
                            {attentionItems.length} item{attentionItems.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Based on document extraction confidence and recommended actions (sampled)
                      </p>
                    </div>
                    <ChevronDown
                      className={`mt-0.5 h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180 ${
                        darkMode ? 'text-gray-400' : 'text-gray-500'
                      }`}
                    />
                  </div>
                </button>
              </CollapsibleTrigger>

              <Button variant="outline" size="sm" darkMode={darkMode} onClick={load} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>

            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
              <div className="mt-4">
                {loading ? (
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Loading…</div>
                ) : attentionItems.length === 0 ? (
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>No flagged deals in the sample.</div>
                ) : (
                  <div className="space-y-2">
                    {attentionItems.slice(0, 8).map((item) => (
                      <div
                        key={item.dealId}
                        className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg ${
                          darkMode ? 'bg-white/5' : 'bg-white/60'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className={`text-sm truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{item.dealName}</div>
                          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {item.confidenceBand ? `Confidence: ${item.confidenceBand}` : 'Confidence: —'}
                            {item.docIssues > 0 ? ` • ${item.docIssues} doc(s) need action` : ''}
                            {item.recommendedAction ? ` • ${item.recommendedAction}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            darkMode={darkMode}
                            onClick={() => setAiModalDealId(item.dealId)}
                          >
                            Open AI Status
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            darkMode={darkMode}
                            onClick={() => {
                              if (onDealClick) return onDealClick(item.dealId);
                              onNavigate?.('dealsList');
                            }}
                            disabled={!onDealClick && !onNavigate}
                          >
                            View Deal
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-4 gap-4">
          {/* Total Deals */}
          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
              }`}>
                <Target className="w-5 h-5 text-[#6366f1]" />
              </div>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {derived.totalDeals}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Total Deals
            </div>
          </div>

          {/* Deals with Phase 1 Outputs */}
          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                darkMode ? 'bg-[#8b5cf6]/20' : 'bg-[#8b5cf6]/10'
              }`}>
                <FileText className="w-5 h-5 text-[#8b5cf6]" />
              </div>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {derived.analyzedCount}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Deals with Phase 1 Outputs
            </div>
          </div>

          {/* Avg Score */}
          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                darkMode ? 'bg-emerald-500/20' : 'bg-emerald-500/10'
              }`}>
                <Zap className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {derived.avgScore == null ? '—' : `${derived.avgScore}%`}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Avg Deal Quality Score
            </div>
          </div>

          {/* Documents in Range */}
          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                darkMode ? 'bg-emerald-500/20' : 'bg-emerald-500/10'
              }`}>
                <FileText className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {docsOverTime.reduce((sum, x) => sum + x.documents, 0)}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Documents Uploaded (sampled)
            </div>
          </div>
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-2 gap-4">
          {/* Area Chart - Documents Over Time */}
          <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Documents Uploaded Over Time (sampled)
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={docsOverTime}>
                <defs>
                  <linearGradient id="colorReports" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#ffffff10' : '#00000010'} />
                <XAxis 
                  dataKey="label" 
                  stroke={darkMode ? '#666' : '#999'}
                  style={{ fontSize: '12px' }}
                />
                <YAxis 
                  stroke={darkMode ? '#666' : '#999'}
                  style={{ fontSize: '12px' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area 
                  type="monotone" 
                  dataKey="documents" 
                  stroke="#6366f1" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorReports)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Bar Chart - Deals by Stage */}
          <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Deals by Pipeline Stage
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={derived.dealsByStage}>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#ffffff10' : '#00000010'} />
                <XAxis 
                  dataKey="stage" 
                  stroke={darkMode ? '#666' : '#999'}
                  style={{ fontSize: '12px' }}
                />
                <YAxis 
                  stroke={darkMode ? '#666' : '#999'}
                  style={{ fontSize: '12px' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-2 gap-4">
          {/* Score Distribution */}
          <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Score Distribution
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={derived.scoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#ffffff10' : '#00000010'} />
                <XAxis 
                  dataKey="range" 
                  stroke={darkMode ? '#666' : '#999'}
                  style={{ fontSize: '12px' }}
                />
                <YAxis 
                  stroke={darkMode ? '#666' : '#999'}
                  style={{ fontSize: '12px' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Stage Breakdown (text) */}
          <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Stage Breakdown
            </h3>
            <div className="space-y-2">
              {derived.dealsByStage.map((s) => (
                <div key={s.stage} className="flex items-center justify-between">
                  <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{s.stage}</span>
                  <span className={`text-xs ${darkMode ? 'text-white' : 'text-gray-900'}`}>{s.count}</span>
                </div>
              ))}
              {derived.dealsByStage.length === 0 && (
                <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No deals yet</span>
              )}
            </div>
          </div>
        </div>

        {/* Detailed Table */}
        <div className={`backdrop-blur-xl border rounded-2xl overflow-hidden ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <div className="p-4 border-b border-white/5">
            <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Deal Performance Details
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`border-b ${darkMode ? 'border-white/5' : 'border-gray-200'}`}>
                  <th 
                    className={`p-4 text-left text-xs cursor-pointer hover:bg-white/5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    onClick={() => handleSort('name')}
                  >
                    Deal Name {sortConfig?.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className={`p-4 text-left text-xs cursor-pointer hover:bg-white/5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    onClick={() => handleSort('score')}
                  >
                    Deal Quality {sortConfig?.key === 'score' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className={`p-4 text-left text-xs cursor-pointer hover:bg-white/5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    onClick={() => handleSort('stage')}
                  >
                    Stage {sortConfig?.key === 'stage' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className={`p-4 text-left text-xs cursor-pointer hover:bg-white/5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    onClick={() => handleSort('lastActivity')}
                  >
                    Last Activity {sortConfig?.key === 'lastActivity' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className={`p-4 text-left text-xs cursor-pointer hover:bg-white/5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    onClick={() => handleSort('docs')}
                  >
                    Documents {sortConfig?.key === 'docs' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedDeals.map((deal) => (
                  <tr
                    key={deal.id}
                    className={`border-b transition-colors ${
                      darkMode
                        ? 'border-white/5 hover:bg-white/5'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <td className="p-4">
                      <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {deal.name}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className={`flex-1 max-w-[100px] h-2 rounded-full overflow-hidden ${
                          darkMode ? 'bg-white/10' : 'bg-gray-200'
                        }`}>
                          <div
                            className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]"
                            style={{ width: `${Math.min(100, Math.max(0, deal.score))}%` }}
                          />
                        </div>
                        <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {Math.round(deal.score)}%
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{deal.stage}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1">
                        <Clock className={`w-3 h-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`} />
                        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {deal.lastActivity}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{deal.docs}</span>
                    </td>
                    <td className="p-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        darkMode={darkMode}
                        disabled={!onDealClick && !onNavigate}
                        onClick={() => {
                          if (onDealClick) return onDealClick(deal.id);
                          if (onNavigate) return onNavigate('dealsList');
                        }}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
                {!loading && sortedDeals.length === 0 && (
                  <tr>
                    <td colSpan={6} className={`p-6 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      No deals found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {aiModalDealId && (
          <DealExtractionReportModal
            darkMode={darkMode}
            dealId={aiModalDealId}
            onClose={() => setAiModalDealId(null)}
          />
        )}
      </div>
    </div>
  );
}