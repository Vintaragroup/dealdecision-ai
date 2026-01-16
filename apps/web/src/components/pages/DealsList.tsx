import { useEffect, useMemo, useState } from 'react';
import type { DealPriority, DealStage, DealTrend, Deal } from '@dealdecision/contracts';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { ExportDealsModal } from '../ExportDealsModal';
import { apiGetDeals, apiGetDocuments, apiAutoProgressDeal, apiDeleteDeal, isLiveBackend } from '../../lib/apiClient';
import { Modal } from '../ui/Modal';
import { useScoreSource } from '../../contexts/ScoreSourceContext';
import { getDisplayScoreForDeal } from '../../lib/dealScore';
import { 
  Search,
  Plus,
  Filter,
  Download,
  Grid3x3,
  List,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  AlertCircle,
  Eye,
  Edit,
  Trash2,
  MoreVertical,
  ChevronRight,
  Calendar,
  Users,
  Target,
  Zap,
  FileText,
  ArrowRight
} from 'lucide-react';

interface DealData {
  id: string;
  name: string;
  stage: DealStage;
  score: number | null;
  scoreSourceUsed?: 'legacy' | 'fundability_v1';
  lastUpdated: string;
  documents: number;
  completeness: number | null;
  fundingTarget: string;
  trend: DealTrend;
  priority: DealPriority;
  views: number | null;
  owner: string;
}

interface DealsListProps {
  darkMode: boolean;
  onDealClick?: (dealId: string) => void;
  onNewDeal?: () => void;
  onExportAll?: () => void;
  createdDeal?: Deal | null;
}

export function DealsList({ darkMode, onDealClick, onNewDeal, onExportAll, createdDeal }: DealsListProps) {
  const { scoreSource } = useScoreSource();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('updated');
  const [selectedDeals, setSelectedDeals] = useState<string[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveDeals, setLiveDeals] = useState<Deal[]>([]);
  const [progressionNotification, setProgressionNotification] = useState<{ dealId: string; oldStage: string; newStage: string } | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingDealId, setDeletingDealId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLiveBackend()) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    const fetchDealsAndDocuments = async () => {
      try {
        const deals = await apiGetDeals();
        if (!isMounted) return;

        // Fetch documents for each deal
        const documentCounts: Record<string, number> = {};
        for (const deal of deals) {
          try {
            const docsResponse = await apiGetDocuments(deal.id);
            documentCounts[deal.id] = docsResponse.documents?.length || 0;
          } catch (error) {
            console.error(`Failed to fetch documents for deal ${deal.id}:`, error);
            documentCounts[deal.id] = 0;
          }
        }

        // Update deals with document counts
        const dealsWithDocuments = deals.map(deal => ({
          ...deal,
          documents: documentCounts[deal.id] || 0
        }));

        if (!isMounted) return;
        setLiveDeals(dealsWithDocuments);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load deals');
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    };

    fetchDealsAndDocuments();

    return () => {
      isMounted = false;
    };
  }, []);

  const openDeleteModal = (deal: { id: string; name: string }) => {
    setError(null);
    setDeleteTarget({ id: deal.id, name: deal.name });
    setDeleteConfirmText('');
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    if (deletingDealId) return;
    setDeleteModalOpen(false);
    setDeleteTarget(null);
    setDeleteConfirmText('');
  };

  const isDeleteConfirmed = (() => {
    const typed = deleteConfirmText.trim();
    if (!deleteTarget) return false;
    if (typed === 'DELETE') return true;
    return typed === deleteTarget.name;
  })();

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (!isLiveBackend()) {
      setError('Delete Deal is only available in live backend mode.');
      return;
    }
    if (!isDeleteConfirmed) return;

    setDeletingDealId(deleteTarget.id);
    setError(null);
    try {
      await apiDeleteDeal(deleteTarget.id, { purge: true });
      setLiveDeals((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setSelectedDeals((prev) => prev.filter((id) => id !== deleteTarget.id));
      setDeleteModalOpen(false);
      setDeleteTarget(null);
      setDeleteConfirmText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete deal');
    } finally {
      setDeletingDealId(null);
    }
  };

  const deals: DealData[] = useMemo(() => {
    const toNonEmptyString = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const s = value.trim();
      return s.length > 0 ? s : null;
    };

    const extractFundingTarget = (deal: any): string => {
      const direct = toNonEmptyString(deal?.fundingTarget);
      if (direct) return direct;

      const overview = deal?.ui?.overviewV2 ?? deal?.ui?.dealOverviewV2 ?? deal?.deal_overview_v2 ?? deal?.phase1?.deal_overview_v2;
      const raise = toNonEmptyString(overview?.raise);
      return raise ?? '';
    };

    const computeCompleteness = (deal: any): number | null => {
      const existing = typeof deal?.completeness === 'number' && Number.isFinite(deal.completeness) ? deal.completeness : null;
      if (existing != null) return Math.max(0, Math.min(100, Math.round(existing)));

      const overview = deal?.ui?.overviewV2 ?? deal?.ui?.dealOverviewV2 ?? deal?.deal_overview_v2 ?? deal?.phase1?.deal_overview_v2;
      if (!overview || typeof overview !== 'object') return null;

      const fields: Array<unknown> = [
        overview?.product_solution,
        overview?.market_icp,
        overview?.deal_type,
        overview?.raise,
        overview?.business_model,
      ];
      const filledScalar = fields.filter((v) => typeof v === 'string' && v.trim().length > 0).length;
      const tractionFilled = Array.isArray(overview?.traction_signals) && overview.traction_signals.filter((x: any) => typeof x === 'string' && x.trim().length > 0).length > 0 ? 1 : 0;
      const total = fields.length + 1;
      const filled = filledScalar + tractionFilled;
      return Math.round((filled / total) * 100);
    };

    const normalizeViews = (deal: any): number | null => {
      const v = deal?.views;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };

    const normalizeScore = (deal: any): { score: number | null; sourceUsed: 'legacy' | 'fundability_v1' } => {
      const { score, sourceUsed } = getDisplayScoreForDeal(deal as any, scoreSource);
      return { score, sourceUsed };
    };

    // Deduplicate deals by name, keeping the most recent one
    const deduplicatedDeals = new Map<string, typeof liveDeals[0]>();
    for (const deal of liveDeals) {
      const existing = deduplicatedDeals.get(deal.name);
      if (!existing || new Date(deal.lastUpdated || 0) > new Date(existing.lastUpdated || 0)) {
        deduplicatedDeals.set(deal.name, deal);
      }
    }

    return Array.from(deduplicatedDeals.values()).map((deal) => {
      const normalized = normalizeScore(deal as any);
      return ({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      score: normalized.score,
      scoreSourceUsed: normalized.sourceUsed,
      lastUpdated: deal.lastUpdated ?? deal.id, // fallback to keep stable display
      documents: (deal as any).documents ?? 0,
      completeness: computeCompleteness(deal as any),
      fundingTarget: extractFundingTarget(deal as any),
      trend: (deal.trend as DealTrend) ?? 'stable',
      priority: deal.priority ?? 'medium',
      views: normalizeViews(deal as any),
      owner: deal.owner ?? 'Unassigned'
      });
    });
  }, [liveDeals, scoreSource]);

  useEffect(() => {
    if (!isLiveBackend()) return;
    if (!createdDeal) return;
    setLiveDeals((prev) => {
      const exists = prev.some((d) => d.id === createdDeal.id);
      if (exists) return prev;
      return [createdDeal, ...prev];
    });
  }, [createdDeal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Loading deals...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'intake':
        return darkMode ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-200 text-gray-700';
      case 'under_review':
        return darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700';
      case 'in_diligence':
        return darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700';
      case 'ready_decision':
        return darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700';
      case 'pitched':
        return darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700';
      default:
        return '';
    }
  };

  const getStageName = (stage: string) => {
    switch (stage) {
      case 'intake': return 'Intake';
      case 'under_review': return 'Under Review';
      case 'in_diligence': return 'In Due Diligence';
      case 'ready_decision': return 'Ready for Decision';
      case 'pitched': return 'Pitched';
      default: return stage;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return darkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700';
      case 'medium':
        return darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700';
      case 'low':
        return darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700';
      default:
        return '';
    }
  };

  const formatPercent = (value: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return `${Math.round(value)}%`;
  };

  const formatMaybeNumber = (value: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return String(Math.round(value));
  };

  const formatLastUpdated = (value: string) => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : value;
  };

  const filteredDeals = deals.filter(deal => {
    const matchesSearch = deal.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStage = stageFilter === 'all' || deal.stage === stageFilter;
    const matchesPriority = priorityFilter === 'all' || deal.priority === priorityFilter;
    return matchesSearch && matchesStage && matchesPriority;
  });

  const summaryStats = {
    total: deals.length,
    ready: deals.filter(d => d.stage === 'ready_decision').length,
		avgScore: deals.length > 0
			? Math.round(
				deals.reduce((sum, d) => sum + (typeof d.score === 'number' ? d.score : 0), 0) / deals.length
			)
			: 0,
		totalViews: deals.reduce((sum, d) => sum + (typeof d.views === 'number' ? d.views : 0), 0)
  };

  const toggleDealSelection = (dealId: string) => {
    setSelectedDeals(prev =>
      prev.includes(dealId) ? prev.filter(id => id !== dealId) : [...prev, dealId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedDeals.length === filteredDeals.length) {
      setSelectedDeals([]);
    } else {
      setSelectedDeals(filteredDeals.map(d => d.id));
    }
  };

  const handleAutoProgressDeal = async (dealId: string) => {
    try {
      const result = await apiAutoProgressDeal(dealId);
      if (result.progressed && result.newStage) {
        setError(null);
        setProgressionNotification({
          dealId,
          oldStage: '',
          newStage: result.newStage
        });
        // Refresh deals list
        const updatedDeals = await apiGetDeals();
        setLiveDeals(updatedDeals);
        // Clear notification after 4 seconds
        setTimeout(() => setProgressionNotification(null), 4000);
      } else {
        setError(result.message || 'Deal does not meet conditions for stage progression');
      }
    } catch (error) {
      console.error('Failed to check stage progression:', error);
      setError(error instanceof Error ? error.message : 'Failed to check stage progression');
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6">
        {/* Stage Progression Notification */}
        {progressionNotification && (
          <div className={`p-4 rounded-lg border flex items-center gap-3 animate-pulse ${
            darkMode
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}>
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">
                Deal automatically progressed to <strong>{progressionNotification.newStage}</strong>
              </p>
              <p className={`text-xs ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                Conditions met for stage advancement
              </p>
            </div>
          </div>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <Target className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
              }`}>
                Active
              </span>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {summaryStats.total}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Total Deals
            </div>
          </div>

          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className={`w-5 h-5 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
              }`}>
                +{summaryStats.ready}
              </span>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {summaryStats.ready}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Investor Ready
            </div>
          </div>

          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <Zap className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {summaryStats.avgScore}%
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Average Score
            </div>
          </div>

          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <Eye className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700'
              }`}>
                This week
              </span>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {summaryStats.totalViews}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Investor Views
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className={`backdrop-blur-xl border rounded-2xl ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          {/* Toolbar */}
          <div className="p-4 border-b border-white/5">
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                All Deals
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  darkMode={darkMode}
                  icon={<Download className="w-4 h-4" />}
                  onClick={() => setShowExportModal(true)}
                >
                  Export
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  darkMode={darkMode}
                  icon={<Plus className="w-4 h-4" />}
                  onClick={onNewDeal}
                >
                  New Deal
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="flex-1">
                <Input
                  placeholder="Search deals by name, stage, or owner..."
                  leftIcon={<Search className="w-4 h-4" />}
                  darkMode={darkMode}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Filters */}
              <Select
                darkMode={darkMode}
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Stages' },
                  { value: 'intake', label: 'Intake' },
                  { value: 'under_review', label: 'Under Review' },
                  { value: 'in_diligence', label: 'In Due Diligence' },
                  { value: 'ready_decision', label: 'Ready for Decision' },
                  { value: 'pitched', label: 'Pitched' }
                ]}
              />

              <Select
                darkMode={darkMode}
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Priorities' },
                  { value: 'high', label: 'High' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'low', label: 'Low' }
                ]}
              />

              <Select
                darkMode={darkMode}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                options={[
                  { value: 'updated', label: 'Last Updated' },
                  { value: 'score', label: 'Score' },
                  { value: 'name', label: 'Name' },
                  { value: 'views', label: 'Views' }
                ]}
              />

              {/* View Mode Toggle */}
              <div className={`flex items-center border rounded-lg overflow-hidden ${
                darkMode ? 'border-white/10' : 'border-gray-200'
              }`}>
                <Button
                  variant={viewMode === 'list' ? 'primary' : 'ghost'}
                  size="icon"
                  aria-label="List view"
                  onClick={() => setViewMode('list')}
                  className={viewMode === 'list' ? 'dd-btn-icon' : 'dd-btn-icon text-muted-foreground'}
                >
                  <List className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'grid' ? 'primary' : 'ghost'}
                  size="icon"
                  aria-label="Grid view"
                  onClick={() => setViewMode('grid')}
                  className={viewMode === 'grid' ? 'dd-btn-icon' : 'dd-btn-icon text-muted-foreground'}
                >
                  <Grid3x3 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Bulk Actions */}
            {selectedDeals.length > 0 && (
              <div className={`mt-3 p-3 rounded-lg border flex items-center justify-between ${
                darkMode
                  ? 'bg-[#6366f1]/10 border-[#6366f1]/30'
                  : 'bg-[#6366f1]/5 border-[#6366f1]/20'
              }`}>
                <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {selectedDeals.length} deal{selectedDeals.length > 1 ? 's' : ''} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" darkMode={darkMode}>
                    Export Selected
                  </Button>
                  <Button variant="ghost" size="sm" darkMode={darkMode}>
                    Archive
                  </Button>
                  <Button variant="ghost" size="sm" darkMode={darkMode}>
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* List View */}
          {viewMode === 'list' && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${darkMode ? 'border-white/5' : 'border-gray-200'}`}>
                    <th className="p-4 text-left">
                      <input
                        type="checkbox"
                        checked={selectedDeals.length === filteredDeals.length}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </th>
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Deal Name
                    </th>
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Stage
                    </th>
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Score
                    </th>
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Progress
                    </th>
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Priority
                    </th>
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Last Updated
                    </th>
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Documents
                    </th>
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Views
                    </th>
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((deal) => (
                    <tr
                      key={deal.id}
                      className={`border-b transition-colors cursor-pointer ${
                        darkMode
                          ? 'border-white/5 hover:bg-white/5'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                      onClick={() => onDealClick?.(deal.id)}
                    >
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedDeals.includes(deal.id)}
                          onChange={() => toggleDealSelection(deal.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]`}>
                            <span className="text-white text-sm">{deal.name[0]}</span>
                          </div>
                          <div>
                            <div className={`text-sm mb-0.5 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {deal.name}
                            </div>
                            <div className={`text-xs flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              <Users className="w-3 h-3" />
                              {deal.owner}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded-full ${getStageColor(deal.stage)}`}>
                            {getStageName(deal.stage)}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${
                            darkMode
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-amber-100 text-amber-700'
                          }`} title="Click arrow button to check if deal can advance">
                            <ArrowRight className="w-3 h-3" />
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
							{formatPercent(deal.score)}
                          </span>
                          {deal.scoreSourceUsed === 'fundability_v1' && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              darkMode ? 'bg-[#6366f1]/20 text-[#a5b4fc]' : 'bg-[#6366f1]/10 text-[#4f46e5]'
                            }`} title="Using fundability score (UI-only)">
                              F
                            </span>
                          )}
                          {deal.trend === 'up' && <TrendingUp className="w-3 h-3 text-emerald-400" />}
                          {deal.trend === 'down' && <TrendingDown className="w-3 h-3 text-red-400" />}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className={`flex-1 h-2 rounded-full overflow-hidden ${
                            darkMode ? 'bg-white/10' : 'bg-gray-200'
                          }`}>
                            <div
                              className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]"
							style={{ width: `${typeof deal.completeness === 'number' ? deal.completeness : 0}%` }}
                            />
                          </div>
                          <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
							{formatPercent(deal.completeness)}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${getPriorityColor(deal.priority)}`}>
                          {deal.priority}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`text-xs flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <Clock className="w-3 h-3" />
							{formatLastUpdated(deal.lastUpdated)}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`text-xs flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <FileText className="w-3 h-3" />
                          {deal.documents}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`text-xs flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <Eye className="w-3 h-3" />
							{formatMaybeNumber(deal.views)}
                        </span>
                      </td>
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label="Actions"
                              className="dd-btn-base dd-btn-icon-only hover:bg-accent text-muted-foreground hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                              type="button"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </DropdownMenuTrigger>

                            <DropdownMenuContent
                              align="end"
                              sideOffset={6}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  onDealClick?.(deal.id);
                                }}
                              >
                                <Eye />
                                View
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  onDealClick?.(deal.id);
                                }}
                              >
                                <Edit />
                                Edit
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  handleAutoProgressDeal(deal.id);
                                }}
                              >
                                <ChevronRight />
                                Check stage progression
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={(e) => {
                                  e.preventDefault();
                                  openDeleteModal({ id: deal.id, name: deal.name });
                                }}
                                disabled={deletingDealId === deal.id}
                              >
                                <Trash2 />
                                {deletingDealId === deal.id ? 'Deleting…' : 'Delete'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Grid View */}
          {viewMode === 'grid' && (
            <div className="p-4 grid grid-cols-3 gap-4">
              {filteredDeals.map((deal) => (
                <div
                  key={deal.id}
                  onClick={() => onDealClick?.(deal.id)}
                  className={`backdrop-blur-xl border rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.02] ${
                    darkMode
                      ? 'bg-white/5 border-white/10 hover:border-[#6366f1]/50'
                      : 'bg-white/80 border-gray-200/50 hover:border-[#6366f1]/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]`}>
                      <span className="text-white">{deal.name[0]}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedDeals.includes(deal.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleDealSelection(deal.id);
                      }}
                      className="rounded"
                    />
                  </div>

                  <h3 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {deal.name}
                  </h3>
                  <div className={`text-xs mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    {deal.fundingTarget}
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${getStageColor(deal.stage)}`}>
                      {getStageName(deal.stage)}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded-full ${getPriorityColor(deal.priority)}`}>
                      {deal.priority}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`ml-auto w-6 h-6 !text-gray-400 hover:!text-amber-400`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAutoProgressDeal(deal.id);
                      }}
                      title="Check if deal can advance to next stage"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Investor Ready
                    </span>
                    <div className="flex items-center gap-1">
                      <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
						{formatPercent(deal.score)}
                      </span>
                      {deal.trend === 'up' && <TrendingUp className="w-3 h-3 text-emerald-400" />}
                      {deal.trend === 'down' && <TrendingDown className="w-3 h-3 text-red-400" />}
                    </div>
                  </div>

                  <div className={`h-2 rounded-full overflow-hidden mb-3 ${
                    darkMode ? 'bg-white/10' : 'bg-gray-200'
                  }`}>
                    <div
                      className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]"
						style={{ width: `${typeof deal.completeness === 'number' ? deal.completeness : 0}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className={`flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      <Clock className="w-3 h-3" />
						{formatLastUpdated(deal.lastUpdated)}
                    </span>
                    <span className={`flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      <FileText className="w-3 h-3" />
                      {deal.documents}
                    </span>
                    <span className={`flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      <Eye className="w-3 h-3" />
						{formatMaybeNumber(deal.views)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty State */}
          {filteredDeals.length === 0 && (
            <div className="p-12 text-center">
              <Target className={`w-12 h-12 mx-auto mb-3 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
              <h3 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                No deals found
              </h3>
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                Try adjusting your filters or create a new deal
              </p>
            </div>
          )}
        </div>
      </div>
      {showExportModal && (
        <ExportDealsModal
          isOpen={showExportModal}
          darkMode={darkMode}
          deals={filteredDeals.map((d) => ({
            id: d.id,
            name: d.name,
            stage: d.stage,
            priority: d.priority,
            trend: d.trend,
            score: d.score ?? undefined,
            owner: d.owner || undefined,
            lastUpdated: d.lastUpdated || undefined,
            documents: d.documents,
            completeness: d.completeness ?? undefined,
            fundingTarget: d.fundingTarget || undefined,
            views: d.views ?? undefined,
          }))}
          onClose={() => setShowExportModal(false)}
        />
      )}

      <Modal isOpen={deleteModalOpen} onClose={closeDeleteModal} size="md" darkMode={darkMode}>
        <div className="space-y-4">
          <div>
            <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Delete Deal</h2>
            <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              This permanently deletes the deal and all related data. This action is irreversible.
            </p>
          </div>

          {deleteTarget && (
            <div className={`rounded-lg p-3 text-sm ${darkMode ? 'bg-red-500/10 text-red-200' : 'bg-red-50 text-red-800'}`}>
              <div className="font-medium">You are deleting:</div>
              <div className="mt-1 break-words">{deleteTarget.name}</div>
            </div>
          )}

          <div className="space-y-2">
            <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Type <span className="font-semibold">{deleteTarget?.name || 'DELETE'}</span> or <span className="font-semibold">DELETE</span> to confirm.
            </p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteTarget?.name || 'DELETE'}
              disabled={Boolean(deletingDealId)}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={closeDeleteModal} disabled={Boolean(deletingDealId)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={!isDeleteConfirmed || Boolean(deletingDealId)}
              loading={Boolean(deletingDealId)}
            >
              Delete permanently
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}