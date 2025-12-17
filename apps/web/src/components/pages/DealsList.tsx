import { useEffect, useMemo, useState } from 'react';
import type { DealPriority, DealStage, DealTrend, Deal } from '@dealdecision/contracts';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { ExportDealsModal } from '../ExportDealsModal';
import { apiGetDeals, apiGetDocuments, apiAutoProgressDeal, isLiveBackend } from '../../lib/apiClient';
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
  score: number;
  lastUpdated: string;
  documents: number;
  completeness: number;
  fundingTarget: string;
  trend: DealTrend;
  priority: DealPriority;
  views: number;
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

  const deals: DealData[] = useMemo(() => {
    // Deduplicate deals by name, keeping the most recent one
    const deduplicatedDeals = new Map<string, typeof liveDeals[0]>();
    for (const deal of liveDeals) {
      const existing = deduplicatedDeals.get(deal.name);
      if (!existing || new Date(deal.lastUpdated || 0) > new Date(existing.lastUpdated || 0)) {
        deduplicatedDeals.set(deal.name, deal);
      }
    }

    return Array.from(deduplicatedDeals.values()).map((deal) => ({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      score: deal.score ?? 0,
      lastUpdated: deal.lastUpdated ?? deal.id, // fallback to keep stable display
      documents: (deal as any).documents ?? 0,
      completeness: (deal as any).completeness ?? 0,
      fundingTarget: (deal as any).fundingTarget ?? '',
      trend: (deal.trend as DealTrend) ?? 'stable',
      priority: deal.priority ?? 'medium',
      views: (deal as any).views ?? 0,
      owner: deal.owner ?? 'Unassigned'
    }));
  }, [liveDeals]);

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

  const filteredDeals = deals.filter(deal => {
    const matchesSearch = deal.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStage = stageFilter === 'all' || deal.stage === stageFilter;
    const matchesPriority = priorityFilter === 'all' || deal.priority === priorityFilter;
    return matchesSearch && matchesStage && matchesPriority;
  });

  const summaryStats = {
    total: deals.length,
    ready: deals.filter(d => d.stage === 'ready_decision').length,
    avgScore: Math.round(deals.reduce((sum, d) => sum + d.score, 0) / deals.length),
    totalViews: deals.reduce((sum, d) => sum + d.views, 0)
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
      }
    } catch (error) {
      console.error('Failed to check stage progression:', error);
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
                            {deal.score}%
                          </span>
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
                              style={{ width: `${deal.completeness}%` }}
                            />
                          </div>
                          <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {deal.completeness}%
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
                          {deal.lastUpdated}
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
                          {deal.views}
                        </span>
                      </td>
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            aria-label="View" 
                            className={`!text-gray-400 hover:!text-gray-300`}
                            onClick={() => onDealClick?.(deal.id)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            aria-label="Edit" 
                            className={`!text-gray-400 hover:!text-gray-300`}
                            onClick={() => onDealClick?.(deal.id)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            aria-label="Check Stage Progression" 
                            className={`!text-gray-400 hover:!text-amber-400`}
                            title="Check if deal can advance to next stage"
                            onClick={() => handleAutoProgressDeal(deal.id)}
                          >
                            <ArrowRight className="w-4 h-4" />
                          </Button>
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
                        {deal.score}%
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
                      style={{ width: `${deal.completeness}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className={`flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      <Clock className="w-3 h-3" />
                      {deal.lastUpdated}
                    </span>
                    <span className={`flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      <FileText className="w-3 h-3" />
                      {deal.documents}
                    </span>
                    <span className={`flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      <Eye className="w-3 h-3" />
                      {deal.views}
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
          deals={filteredDeals}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}