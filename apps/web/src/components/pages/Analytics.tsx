import { useState } from 'react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { useUserRole } from '../../contexts/UserRoleContext';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Download,
  Calendar,
  Target,
  FileText,
  DollarSign,
  Zap,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Award,
  Clock
} from 'lucide-react';

interface AnalyticsProps {
  darkMode: boolean;
}

export function Analytics({ darkMode }: AnalyticsProps) {
  const { isFounder } = useUserRole();
  const [dateRange, setDateRange] = useState('30days');
  const [dealFilter, setDealFilter] = useState('all');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [compareMode, setCompareMode] = useState(false);

  // Sample data for charts
  const reportsOverTime = [
    { month: 'Jan', reports: 12, deals: 3 },
    { month: 'Feb', reports: 18, deals: 4 },
    { month: 'Mar', reports: 24, deals: 5 },
    { month: 'Apr', reports: 32, deals: 6 },
    { month: 'May', reports: 28, deals: 7 },
    { month: 'Jun', reports: 38, deals: 8 }
  ];

  const dealsByStage = isFounder 
    ? [
        { stage: 'Idea', count: 1, percentage: 12.5 },
        { stage: 'Progress', count: 3, percentage: 37.5 },
        { stage: 'Ready', count: 3, percentage: 37.5 },
        { stage: 'Pitched', count: 1, percentage: 12.5 }
      ]
    : [
        { stage: 'Sourced', count: 2, percentage: 25 },
        { stage: 'Due Diligence', count: 3, percentage: 37.5 },
        { stage: 'Committee Review', count: 2, percentage: 25 },
        { stage: 'Closed', count: 1, percentage: 12.5 }
      ];

  const sectorData = [
    { name: 'AI/ML', value: 3, color: '#6366f1' },
    { name: 'HealthTech', value: 2, color: '#8b5cf6' },
    { name: 'FinTech', value: 2, color: '#ec4899' },
    { name: 'EdTech', value: 1, color: '#10b981' }
  ];

  const scoreDistribution = [
    { range: '0-50', count: 1 },
    { range: '51-70', count: 2 },
    { range: '71-85', count: 3 },
    { range: '86-100', count: 2 }
  ];

  const dealsTableData = [
    { id: '1', name: 'TechVision AI Platform', readiness: 87, lastActivity: '2h ago', roi: 2850, trend: 'up', change: 5 },
    { id: '2', name: 'EcoLogistics Network', readiness: 91, lastActivity: '3d ago', roi: 3200, trend: 'stable', change: 0 },
    { id: '3', name: 'CryptoTrade Pro', readiness: 89, lastActivity: '4h ago', roi: 2950, trend: 'up', change: 7 },
    { id: '4', name: 'FinFlow Analytics', readiness: 84, lastActivity: '5h ago', roi: 1850, trend: 'up', change: 3 },
    { id: '5', name: 'FoodDelivery Express', readiness: 76, lastActivity: '6h ago', roi: 1250, trend: 'up', change: 8 },
    { id: '6', name: 'HealthTrack Wearables', readiness: 72, lastActivity: '1d ago', roi: 950, trend: 'up', change: 4 },
    { id: '7', name: 'EduConnect Platform', readiness: 68, lastActivity: '2d ago', roi: 650, trend: 'down', change: -2 },
    { id: '8', name: 'SmartHome IoT Hub', readiness: 45, lastActivity: '1w ago', roi: 350, trend: 'stable', change: 0 }
  ];

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const sortedDeals = [...dealsTableData].sort((a, b) => {
    if (!sortConfig) return 0;
    const aValue = a[sortConfig.key as keyof typeof a];
    const bValue = b[sortConfig.key as keyof typeof b];
    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key: string) => {
    setSortConfig(current => {
      if (!current || current.key !== key) {
        return { key, direction: 'desc' };
      }
      if (current.direction === 'desc') {
        return { key, direction: 'asc' };
      }
      return null;
    });
  };

  const metrics = {
    totalDeals: { value: 8, change: 23, trend: 'up' as const },
    reportsGenerated: { value: 152, change: 15, trend: 'up' as const },
    avgReadiness: { value: 76.5, change: 12, trend: 'up' as const },
    roiSavings: { value: 12450, change: 28, trend: 'up' as const }
  };

  const insights = isFounder
    ? [
        { text: '3 companies are ready to pitch this week', type: 'success' },
        { text: 'Average pitch score improved 12% this month', type: 'success' },
        { text: 'You\'ve saved $12,450 in consultant fees', type: 'info' },
        { text: 'Team has earned 8,500 XP collectively', type: 'info' }
      ]
    : [
        { text: '3 deals advancing to committee review', type: 'success' },
        { text: 'Average deal quality improved 12% this month', type: 'success' },
        { text: 'You\'ve saved $12,450 in analyst fees', type: 'info' },
        { text: 'Team has earned 8,500 XP collectively', type: 'info' }
      ];

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
            <Button
              variant="secondary"
              size="sm"
              darkMode={darkMode}
              icon={<Download className="w-4 h-4" />}
            >
              Export Report
            </Button>
          </div>

          <div className="grid grid-cols-5 gap-3">
            <Select
              darkMode={darkMode}
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              options={[
                { value: '7days', label: 'Last 7 days' },
                { value: '30days', label: 'Last 30 days' },
                { value: '90days', label: 'Last 90 days' },
                { value: 'ytd', label: 'Year to date' },
                { value: 'all', label: 'All time' }
              ]}
            />

            <Select
              darkMode={darkMode}
              value={dealFilter}
              onChange={(e) => setDealFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Deals' },
                { value: 'my', label: 'My Deals' },
                { value: 'team', label: 'Team Deals' }
              ]}
            />

            <Select
              darkMode={darkMode}
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Sectors' },
                { value: 'ai', label: 'AI/ML' },
                { value: 'health', label: 'HealthTech' },
                { value: 'fintech', label: 'FinTech' },
                { value: 'edtech', label: 'EdTech' }
              ]}
            />

            <div className="col-span-2 flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={compareMode}
                  onChange={(e) => setCompareMode(e.target.checked)}
                  className="rounded"
                />
                <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Compare to previous period
                </span>
              </label>
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
            {insights.map((insight, i) => (
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
              <div className="flex items-center gap-1 text-xs text-emerald-400">
                <TrendingUp className="w-3 h-3" />
                {metrics.totalDeals.change}%
              </div>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {metrics.totalDeals.value}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Total Deals
            </div>
            <div className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              vs last period
            </div>
          </div>

          {/* Reports Generated */}
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
              <div className="flex items-center gap-1 text-xs text-emerald-400">
                <TrendingUp className="w-3 h-3" />
                {metrics.reportsGenerated.change}%
              </div>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {metrics.reportsGenerated.value}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Reports Generated
            </div>
            <div className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              vs last period
            </div>
          </div>

          {/* Average Readiness */}
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
              <div className="flex items-center gap-1 text-xs text-emerald-400">
                <TrendingUp className="w-3 h-3" />
                {metrics.avgReadiness.change}%
              </div>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {metrics.avgReadiness.value}%
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {isFounder ? 'Avg Pitch Readiness' : 'Avg Deal Quality Score'}
            </div>
            <div className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              vs last period
            </div>
          </div>

          {/* ROI Savings */}
          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                darkMode ? 'bg-emerald-500/20' : 'bg-emerald-500/10'
              }`}>
                <DollarSign className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="flex items-center gap-1 text-xs text-emerald-400">
                <TrendingUp className="w-3 h-3" />
                {metrics.roiSavings.change}%
              </div>
            </div>
            <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              ${metrics.roiSavings.value.toLocaleString()}
            </div>
            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Total ROI Savings
            </div>
            <div className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              vs last period
            </div>
          </div>
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-2 gap-4">
          {/* Line Chart - Reports Over Time */}
          <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Reports Generated Over Time
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={reportsOverTime}>
                <defs>
                  <linearGradient id="colorReports" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#ffffff10' : '#00000010'} />
                <XAxis 
                  dataKey="month" 
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
                  dataKey="reports" 
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
              {isFounder ? 'Companies by Readiness Stage' : 'Deals by Pipeline Stage'}
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={dealsByStage}>
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
          {/* Donut Chart - Sectors */}
          <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Deals by Sector
            </h3>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="60%" height={200}>
                <PieChart>
                  <Pie
                    data={sectorData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {sectorData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {sectorData.map((sector, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: sector.color }}
                      />
                      <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {sector.name}
                      </span>
                    </div>
                    <span className={`text-xs ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {sector.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

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
              <BarChart data={scoreDistribution}>
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
                    onClick={() => handleSort('readiness')}
                  >
                    {isFounder ? 'Pitch Readiness' : 'Deal Quality'} {sortConfig?.key === 'readiness' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className={`p-4 text-left text-xs cursor-pointer hover:bg-white/5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    onClick={() => handleSort('change')}
                  >
                    Trend {sortConfig?.key === 'change' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className={`p-4 text-left text-xs cursor-pointer hover:bg-white/5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    onClick={() => handleSort('lastActivity')}
                  >
                    Last Activity {sortConfig?.key === 'lastActivity' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className={`p-4 text-left text-xs cursor-pointer hover:bg-white/5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    onClick={() => handleSort('roi')}
                  >
                    ROI Saved {sortConfig?.key === 'roi' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
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
                            style={{ width: `${deal.readiness}%` }}
                          />
                        </div>
                        <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {deal.readiness}%
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1">
                        {deal.trend === 'up' && (
                          <>
                            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                            <span className="text-xs text-emerald-400">+{deal.change}%</span>
                          </>
                        )}
                        {deal.trend === 'down' && (
                          <>
                            <ArrowDownRight className="w-4 h-4 text-red-400" />
                            <span className="text-xs text-red-400">{deal.change}%</span>
                          </>
                        )}
                        {deal.trend === 'stable' && (
                          <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No change</span>
                        )}
                      </div>
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
                      <span className={`text-sm ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                        ${deal.roi.toLocaleString()}
                      </span>
                    </td>
                    <td className="p-4">
                      <Button variant="ghost" size="sm" darkMode={darkMode}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}