import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ExportDealsModal } from '../ExportDealsModal';
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
  Zap
} from 'lucide-react';

interface DealData {
  id: string;
  name: string;
  stage: 'idea' | 'progress' | 'ready' | 'pitched';
  score: number;
  lastUpdated: string;
  documents: number;
  completeness: number;
  fundingTarget: string;
  trend: 'up' | 'down' | 'stable';
  priority: 'high' | 'medium' | 'low';
  views: number;
  owner: string;
}

interface DealsListProps {
  darkMode: boolean;
  onDealClick?: (dealId: string) => void;
  onNewDeal?: () => void;
  onExportAll?: () => void;
}

export function DealsList({ darkMode, onDealClick, onNewDeal, onExportAll }: DealsListProps) {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('updated');
  const [selectedDeals, setSelectedDeals] = useState<string[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);

  const deals: DealData[] = [
    {
      id: 'vintara-001',
      name: 'Vintara Group LLC',
      stage: 'ready',
      score: 86,
      lastUpdated: '1 hour ago',
      documents: 12,
      completeness: 94,
      fundingTarget: '$2M-$3M Series A',
      trend: 'up',
      priority: 'high',
      views: 47,
      owner: 'Sarah Chen'
    },
    {
      id: '1',
      name: 'TechVision AI Platform',
      stage: 'ready',
      score: 87,
      lastUpdated: '2 hours ago',
      documents: 8,
      completeness: 88,
      fundingTarget: '$3M Series A',
      trend: 'up',
      priority: 'high',
      views: 24,
      owner: 'Sarah Chen'
    },
    {
      id: '2',
      name: 'HealthTrack Wearables',
      stage: 'progress',
      score: 72,
      lastUpdated: '1 day ago',
      documents: 6,
      completeness: 65,
      fundingTarget: '$1.5M Seed',
      trend: 'up',
      priority: 'high',
      views: 18,
      owner: 'Sarah Chen'
    },
    {
      id: '3',
      name: 'EcoLogistics Network',
      stage: 'pitched',
      score: 91,
      lastUpdated: '3 days ago',
      documents: 10,
      completeness: 95,
      fundingTarget: '$5M Series A',
      trend: 'stable',
      priority: 'medium',
      views: 42,
      owner: 'Michael Park'
    },
    {
      id: '4',
      name: 'FinFlow Analytics',
      stage: 'ready',
      score: 84,
      lastUpdated: '5 hours ago',
      documents: 7,
      completeness: 82,
      fundingTarget: '$2M Seed',
      trend: 'up',
      priority: 'high',
      views: 31,
      owner: 'Sarah Chen'
    },
    {
      id: '5',
      name: 'EduConnect Platform',
      stage: 'progress',
      score: 68,
      lastUpdated: '2 days ago',
      documents: 5,
      completeness: 58,
      fundingTarget: '$800K Pre-Seed',
      trend: 'down',
      priority: 'medium',
      views: 12,
      owner: 'Sarah Chen'
    },
    {
      id: '6',
      name: 'SmartHome IoT Hub',
      stage: 'idea',
      score: 45,
      lastUpdated: '1 week ago',
      documents: 3,
      completeness: 35,
      fundingTarget: '$1M Seed',
      trend: 'stable',
      priority: 'low',
      views: 8,
      owner: 'Alex Rivera'
    },
    {
      id: '7',
      name: 'CryptoTrade Pro',
      stage: 'ready',
      score: 89,
      lastUpdated: '4 hours ago',
      documents: 9,
      completeness: 92,
      fundingTarget: '$4M Series A',
      trend: 'up',
      priority: 'high',
      views: 38,
      owner: 'Michael Park'
    },
    {
      id: '8',
      name: 'FoodDelivery Express',
      stage: 'progress',
      score: 76,
      lastUpdated: '6 hours ago',
      documents: 6,
      completeness: 70,
      fundingTarget: '$2.5M Seed',
      trend: 'up',
      priority: 'medium',
      views: 15,
      owner: 'Sarah Chen'
    }
  ];

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'idea':
        return darkMode ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-200 text-gray-700';
      case 'progress':
        return darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700';
      case 'ready':
        return darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700';
      case 'pitched':
        return darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700';
      default:
        return '';
    }
  };

  const getStageName = (stage: string) => {
    switch (stage) {
      case 'idea': return 'Idea Stage';
      case 'progress': return 'In Progress';
      case 'ready': return 'Investor Ready';
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
    ready: deals.filter(d => d.stage === 'ready').length,
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

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6">
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
                  { value: 'idea', label: 'Idea Stage' },
                  { value: 'progress', label: 'In Progress' },
                  { value: 'ready', label: 'Investor Ready' },
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
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 transition-colors ${
                    viewMode === 'list'
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                      : darkMode
                        ? 'text-gray-400 hover:text-white'
                        : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white'
                      : darkMode
                        ? 'text-gray-400 hover:text-white'
                        : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Grid3x3 className="w-4 h-4" />
                </button>
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
                        <span className={`text-xs px-2 py-1 rounded-full ${getStageColor(deal.stage)}`}>
                          {getStageName(deal.stage)}
                        </span>
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
                          <Eye className="w-3 h-3" />
                          {deal.views}
                        </span>
                      </td>
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button className={`p-1.5 rounded transition-colors ${
                            darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                          }`}>
                            <Eye className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                          </button>
                          <button className={`p-1.5 rounded transition-colors ${
                            darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                          }`}>
                            <Edit className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                          </button>
                          <button className={`p-1.5 rounded transition-colors ${
                            darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                          }`}>
                            <MoreVertical className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                          </button>
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