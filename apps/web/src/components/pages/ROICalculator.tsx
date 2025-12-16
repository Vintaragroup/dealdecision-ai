import { useState } from 'react';
import { Button } from '../ui/button';
import { AnimatedCounter } from '../AnimatedCounter';
import { useUserRole } from '../../contexts/UserRoleContext';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { 
  DollarSign,
  Clock,
  TrendingUp,
  Award,
  Sparkles,
  FileText,
  Target,
  Users,
  Zap,
  Trophy,
  CheckCircle,
  ArrowUpRight,
  Calendar,
  BarChart3,
  Rocket,
  Star
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface ROICalculatorProps {
  darkMode: boolean;
}

export function ROICalculator({ darkMode }: ROICalculatorProps) {
  const { isFounder } = useUserRole();
  const { settings } = useAppSettings();
  const [timeframe, setTimeframe] = useState<'week' | 'month' | 'all'>('all');

  // Total savings data
  const totalSavings = {
    money: 127450,
    hours: 486,
    deals: 12,
    documents: 47
  };

  // Breakdown by category
  const savingsBreakdown = isFounder
    ? [
        {
          category: 'Legal Fees Saved',
          icon: <FileText className="w-5 h-5" />,
          amount: 45600,
          hours: 142,
          description: 'Term sheets, contracts, incorporation docs',
          color: 'from-blue-500 to-blue-600',
          bgColor: darkMode ? 'bg-blue-500/20' : 'bg-blue-100',
          textColor: darkMode ? 'text-blue-400' : 'text-blue-700'
        },
        {
          category: 'Consultant Fees Saved',
          icon: <Users className="w-5 h-5" />,
          amount: 38200,
          hours: 156,
          description: 'Market research, pitch deck design, strategy',
          color: 'from-purple-500 to-purple-600',
          bgColor: darkMode ? 'bg-purple-500/20' : 'bg-purple-100',
          textColor: darkMode ? 'text-purple-400' : 'text-purple-700'
        },
        {
          category: 'Research Time Saved',
          icon: <Target className="w-5 h-5" />,
          amount: 28450,
          hours: 124,
          description: 'Market sizing, competitor analysis, investor research',
          color: 'from-emerald-500 to-emerald-600',
          bgColor: darkMode ? 'bg-emerald-500/20' : 'bg-emerald-100',
          textColor: darkMode ? 'text-emerald-400' : 'text-emerald-700'
        },
        {
          category: 'Design & Formatting',
          icon: <Sparkles className="w-5 h-5" />,
          amount: 15200,
          hours: 64,
          description: 'Pitch decks, executive summaries, one-pagers',
          color: 'from-amber-500 to-amber-600',
          bgColor: darkMode ? 'bg-amber-500/20' : 'bg-amber-100',
          textColor: darkMode ? 'text-amber-400' : 'text-amber-700'
        }
      ]
    : [
        {
          category: 'Legal Fees Saved',
          icon: <FileText className="w-5 h-5" />,
          amount: 45600,
          hours: 142,
          description: 'Due diligence docs, deal terms, NDA reviews',
          color: 'from-blue-500 to-blue-600',
          bgColor: darkMode ? 'bg-blue-500/20' : 'bg-blue-100',
          textColor: darkMode ? 'text-blue-400' : 'text-blue-700'
        },
        {
          category: 'Analyst Fees Saved',
          icon: <Users className="w-5 h-5" />,
          amount: 38200,
          hours: 156,
          description: 'Market research, competitive analysis, industry reports',
          color: 'from-purple-500 to-purple-600',
          bgColor: darkMode ? 'bg-purple-500/20' : 'bg-purple-100',
          textColor: darkMode ? 'text-purple-400' : 'text-purple-700'
        },
        {
          category: 'Due Diligence Time Saved',
          icon: <Target className="w-5 h-5" />,
          amount: 28450,
          hours: 124,
          description: 'Financial analysis, market validation, risk assessment',
          color: 'from-emerald-500 to-emerald-600',
          bgColor: darkMode ? 'bg-emerald-500/20' : 'bg-emerald-100',
          textColor: darkMode ? 'text-emerald-400' : 'text-emerald-700'
        },
        {
          category: 'Report Generation',
          icon: <Sparkles className="w-5 h-5" />,
          amount: 15200,
          hours: 64,
          description: 'Investment memos, IC presentations, deal summaries',
          color: 'from-amber-500 to-amber-600',
          bgColor: darkMode ? 'bg-amber-500/20' : 'bg-amber-100',
          textColor: darkMode ? 'text-amber-400' : 'text-amber-700'
        }
      ];

  // Historical savings over time
  const savingsOverTime = [
    { month: 'Jan', money: 8500, hours: 32 },
    { month: 'Feb', money: 18200, hours: 68 },
    { month: 'Mar', money: 31400, hours: 118 },
    { month: 'Apr', money: 46800, hours: 182 },
    { month: 'May', money: 67200, hours: 256 },
    { month: 'Jun', money: 89300, hours: 342 },
    { month: 'Jul', money: 108600, hours: 416 },
    { month: 'Aug', money: 127450, hours: 486 }
  ];

  // Comparison data
  const comparisonData = [
    { name: 'Traditional', cost: 185000, time: 920 },
    { name: 'With DealDecision AI', cost: 57550, time: 434 }
  ];

  const pieData = [
    { name: isFounder ? 'Legal Fees' : 'Legal Fees', value: 45600, color: '#3b82f6' },
    { name: isFounder ? 'Consultants' : 'Analysts', value: 38200, color: '#a855f7' },
    { name: isFounder ? 'Research' : 'Due Diligence', value: 28450, color: '#10b981' },
    { name: isFounder ? 'Design' : 'Reports', value: 15200, color: '#f59e0b' }
  ];

  // Milestones
  const milestones = [
    { 
      title: 'First $10K Saved', 
      achieved: true, 
      date: 'Jan 15, 2024',
      reward: 'Savings Starter 🎯'
    },
    { 
      title: '$50K Milestone', 
      achieved: true, 
      date: 'Mar 22, 2024',
      reward: 'Cost Crusher 💪'
    },
    { 
      title: '$100K Club', 
      achieved: true, 
      date: 'Jul 8, 2024',
      reward: 'Efficiency Master 🏆'
    },
    { 
      title: '$150K Goal', 
      achieved: false, 
      progress: 85,
      remaining: 22550,
      reward: 'Savings Legend 👑'
    },
    { 
      title: '$250K Ultimate', 
      achieved: false, 
      progress: 51,
      remaining: 122550,
      reward: 'ROI Champion 🚀'
    }
  ];

  // What the savings represent
  const savingsEquivalents = isFounder
    ? [
        { label: 'Junior Developer Salaries', value: '2 full years', icon: <Users className="w-5 h-5" /> },
        { label: 'Office Space Rent', value: '18 months', icon: <Target className="w-5 h-5" /> },
        { label: 'Marketing Budget', value: '$127K campaign', icon: <TrendingUp className="w-5 h-5" /> },
        { label: 'Time Back', value: '486 hours = 12 work weeks', icon: <Clock className="w-5 h-5" /> }
      ]
    : [
        { label: 'Junior Analyst Salaries', value: '2 full years', icon: <Users className="w-5 h-5" /> },
        { label: 'Research Subscriptions', value: '3 years of data', icon: <Target className="w-5 h-5" /> },
        { label: 'Due Diligence Outsourcing', value: '42 full DD reports', icon: <TrendingUp className="w-5 h-5" /> },
        { label: 'Time Back', value: '486 hours = 12 work weeks', icon: <Clock className="w-5 h-5" /> }
      ];

  const getMotivationalMessage = () => {
    if (totalSavings.money >= 100000) {
      return {
        title: settings.gamificationEnabled ? "🎉 You're crushing it!" : "Outstanding Performance",
        message: "You've saved over $100K! That's the cost of hiring 2 full-time employees for a year.",
        color: 'from-emerald-500 to-green-500'
      };
    } else if (totalSavings.money >= 50000) {
      return {
        title: settings.gamificationEnabled ? "🚀 Incredible progress!" : "Excellent Progress",
        message: "You're well past $50K in savings. Keep this momentum going!",
        color: 'from-purple-500 to-pink-500'
      };
    } else {
      return {
        title: settings.gamificationEnabled ? "💪 Great start!" : "Strong Start",
        message: "Every deal saves you thousands. You're on the right path!",
        color: 'from-blue-500 to-purple-500'
      };
    }
  };

  const motivationalMsg = getMotivationalMessage();

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6">
        {/* Hero Section - Big Numbers */}
        <div className={`backdrop-blur-xl border rounded-2xl p-8 relative overflow-hidden ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          {/* Animated background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#6366f1]/5 via-[#8b5cf6]/5 to-[#ec4899]/5 animate-pulse" />
          
          <div className="relative">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Trophy className="w-8 h-8 text-yellow-400" />
                  <h1 className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Your ROI Dashboard
                  </h1>
                </div>
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  See how much you're saving every day by using DealDecision AI
                </p>
              </div>
              
              <div className="flex gap-2">
                {(['week', 'month', 'all'] as const).map((period) => (
                  <button
                    key={period}
                    onClick={() => setTimeframe(period)}
                    className={`px-4 py-2 rounded-lg text-sm transition-all ${
                      timeframe === period
                        ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-lg'
                        : darkMode
                          ? 'bg-white/5 text-gray-400 hover:bg-white/10'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {period === 'all' ? 'All Time' : `This ${period.charAt(0).toUpperCase() + period.slice(1)}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Massive Savings Numbers */}
            <div className="grid grid-cols-4 gap-6 mb-6">
              <div className={`p-6 rounded-2xl border relative overflow-hidden ${
                darkMode
                  ? 'bg-gradient-to-br from-emerald-500/20 to-green-500/10 border-emerald-500/30'
                  : 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200'
              }`}>
                <DollarSign className={`w-8 h-8 mb-3 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
                <div className={`text-4xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  $<AnimatedCounter end={totalSavings.money} duration={2000} />
                </div>
                <div className={`text-sm ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                  Total Money Saved
                </div>
                <div className={`text-xs mt-2 ${darkMode ? 'text-emerald-400/70' : 'text-emerald-600'}`}>
                  vs. traditional methods
                </div>
              </div>

              <div className={`p-6 rounded-2xl border relative overflow-hidden ${
                darkMode
                  ? 'bg-gradient-to-br from-purple-500/20 to-pink-500/10 border-purple-500/30'
                  : 'bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200'
              }`}>
                <Clock className={`w-8 h-8 mb-3 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                <div className={`text-4xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  <AnimatedCounter end={totalSavings.hours} duration={2000} />h
                </div>
                <div className={`text-sm ${darkMode ? 'text-purple-400' : 'text-purple-700'}`}>
                  Time Saved
                </div>
                <div className={`text-xs mt-2 ${darkMode ? 'text-purple-400/70' : 'text-purple-600'}`}>
                  = {Math.floor(totalSavings.hours / 40)} work weeks back
                </div>
              </div>

              <div className={`p-6 rounded-2xl border relative overflow-hidden ${
                darkMode
                  ? 'bg-gradient-to-br from-blue-500/20 to-cyan-500/10 border-blue-500/30'
                  : 'bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200'
              }`}>
                <Zap className={`w-8 h-8 mb-3 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                <div className={`text-4xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  <AnimatedCounter end={totalSavings.deals} duration={2000} />
                </div>
                <div className={`text-sm ${darkMode ? 'text-blue-400' : 'text-blue-700'}`}>
                  Deals Accelerated
                </div>
                <div className={`text-xs mt-2 ${darkMode ? 'text-blue-400/70' : 'text-blue-600'}`}>
                  avg ${Math.floor(totalSavings.money / totalSavings.deals).toLocaleString()} saved per deal
                </div>
              </div>

              <div className={`p-6 rounded-2xl border relative overflow-hidden ${
                darkMode
                  ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/10 border-amber-500/30'
                  : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200'
              }`}>
                <FileText className={`w-8 h-8 mb-3 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                <div className={`text-4xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  <AnimatedCounter end={totalSavings.documents} duration={2000} />
                </div>
                <div className={`text-sm ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                  Documents Generated
                </div>
                <div className={`text-xs mt-2 ${darkMode ? 'text-amber-400/70' : 'text-amber-600'}`}>
                  professional quality, instant
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Savings Breakdown */}
        <div className="grid grid-cols-2 gap-6">
          {/* Category Breakdown */}
          <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h2 className={`text-lg mb-6 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              <BarChart3 className="w-5 h-5" />
              Savings Breakdown
            </h2>
            
            <div className="space-y-4">
              {savingsBreakdown.map((item, i) => (
                <div key={i} className={`p-4 rounded-xl border ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${item.bgColor} ${item.textColor}`}>
                      {item.icon}
                    </div>
                    <div className="flex-1">
                      <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {item.category}
                      </h3>
                      <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        ${(item.amount / 1000).toFixed(1)}K
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                        Money Saved
                      </div>
                    </div>
                    <div>
                      <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {item.hours}h
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                        Time Saved
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pie Chart */}
          <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h2 className={`text-lg mb-6 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              <Target className="w-5 h-5" />
              Savings Distribution
            </h2>
            
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{
                    backgroundColor: darkMode ? '#18181b' : '#ffffff',
                    border: darkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e5e7eb',
                    borderRadius: '0.5rem',
                    color: darkMode ? '#ffffff' : '#000000'
                  }}
                  formatter={(value: number) => `$${value.toLocaleString()}`}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              {pieData.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }} />
                  <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Savings Over Time */}
        <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <h2 className={`text-lg mb-6 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            <TrendingUp className="w-5 h-5" />
            Cumulative Savings Over Time
          </h2>
          
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={savingsOverTime}>
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke={darkMode ? '#ffffff20' : '#00000020'} 
              />
              <XAxis 
                dataKey="month" 
                stroke={darkMode ? '#9ca3af' : '#6b7280'}
              />
              <YAxis 
                stroke={darkMode ? '#9ca3af' : '#6b7280'}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: darkMode ? '#18181b' : '#ffffff',
                  border: darkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e5e7eb',
                  borderRadius: '0.5rem'
                }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, 'Saved']}
              />
              <Line 
                type="monotone" 
                dataKey="money" 
                stroke="#6366f1" 
                strokeWidth={3}
                dot={{ fill: '#6366f1', r: 5 }}
                activeDot={{ r: 8 }}
              />
            </LineChart>
          </ResponsiveContainer>

          <div className={`mt-4 p-4 rounded-xl border ${
            darkMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'
          }`}>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <span className={`text-sm ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                Average monthly savings: <strong>${Math.floor(totalSavings.money / 8).toLocaleString()}</strong>
              </span>
              <span className={`text-xs px-2 py-1 rounded-full ${
                darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
              }`}>
                +18% from last month
              </span>
            </div>
          </div>
        </div>

        {/* Comparison: Traditional vs AI */}
        <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <h2 className={`text-lg mb-6 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            <Award className="w-5 h-5" />
            Traditional Methods vs. DealDecision AI
          </h2>

          <div className="grid grid-cols-2 gap-6">
            {comparisonData.map((item, i) => (
              <div key={i} className={`p-6 rounded-xl border ${
                i === 0
                  ? darkMode ? 'bg-red-500/5 border-red-500/20' : 'bg-red-50 border-red-200'
                  : darkMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'
              }`}>
                <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {item.name}
                </h3>
                <div className="space-y-3">
                  <div>
                    <div className={`text-3xl mb-1 ${
                      i === 0 
                        ? darkMode ? 'text-red-400' : 'text-red-600'
                        : darkMode ? 'text-emerald-400' : 'text-emerald-600'
                    }`}>
                      ${item.cost.toLocaleString()}
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Total Cost
                    </div>
                  </div>
                  <div>
                    <div className={`text-3xl mb-1 ${
                      i === 0 
                        ? darkMode ? 'text-red-400' : 'text-red-600'
                        : darkMode ? 'text-emerald-400' : 'text-emerald-600'
                    }`}>
                      {item.time}h
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Time Required ({Math.floor(item.time / 40)} weeks)
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className={`mt-6 p-6 rounded-xl border bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/10 ${
            darkMode ? 'border-[#6366f1]/30' : 'border-[#6366f1]/20'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <div className={`text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  You've saved
                </div>
                <div className={`text-3xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  $127,450 & 486 hours
                </div>
                <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  That's 69% cost savings and 53% time savings!
                </div>
              </div>
              {settings.gamificationEnabled && <div className="text-6xl">🎉</div>}
            </div>
          </div>
        </div>

        {/* Milestones */}
        {settings.gamificationEnabled && (
          <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h2 className={`text-lg mb-6 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              <Trophy className="w-5 h-5" />
              Savings Milestones
            </h2>

            <div className="space-y-3">
              {milestones.map((milestone, i) => (
                <div key={i} className={`p-4 rounded-xl border ${
                  milestone.achieved
                    ? darkMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'
                    : darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      milestone.achieved
                        ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]'
                        : darkMode ? 'bg-white/10' : 'bg-gray-200'
                    }`}>
                      {milestone.achieved ? (
                        <CheckCircle className="w-6 h-6 text-white" />
                      ) : (
                        <Target className={`w-6 h-6 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      )}
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {milestone.title}
                        </h3>
                        {milestone.achieved && (
                          <div className={`px-2 py-0.5 rounded-full text-xs ${
                            darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {milestone.date}
                          </div>
                        )}
                      </div>
                      
                      {milestone.achieved ? (
                        <div className={`text-xs flex items-center gap-1 ${
                          darkMode ? 'text-emerald-400' : 'text-emerald-600'
                        }`}>
                          <Award className="w-3 h-3" />
                          Reward: {milestone.reward}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                            ${milestone.remaining?.toLocaleString()} remaining • Reward: {milestone.reward}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className={`flex-1 h-2 rounded-full overflow-hidden ${
                              darkMode ? 'bg-white/10' : 'bg-gray-200'
                            }`}>
                              <div 
                                className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all"
                                style={{ width: `${milestone.progress}%` }}
                              />
                            </div>
                            <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                              {milestone.progress}%
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What Your Savings Represent */}
        <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <h2 className={`text-lg mb-6 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            <Sparkles className="w-5 h-5" />
            What $127K Could Buy
          </h2>

          <div className="grid grid-cols-4 gap-4">
            {savingsEquivalents.map((item, i) => (
              <div key={i} className={`p-5 rounded-xl border text-center ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3 ${
                  darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
                }`}>
                  {item.icon}
                </div>
                <div className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {item.value}
                </div>
                <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className={`backdrop-blur-xl border rounded-2xl p-8 bg-gradient-to-r from-[#6366f1]/20 via-[#8b5cf6]/20 to-[#ec4899]/20 ${
          darkMode ? 'border-[#6366f1]/30' : 'border-[#6366f1]/20'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {settings.gamificationEnabled ? 'Keep The Momentum Going! 🚀' : 'Continue Optimizing Your Workflow'}
              </h3>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {isFounder 
                  ? 'Every deal you create saves you thousands. Start your next deal now!'
                  : 'Every deal you evaluate saves you thousands. Start your next analysis now!'
                }
              </p>
            </div>
            <Button
              variant="primary"
              darkMode={darkMode}
              icon={<ArrowUpRight className="w-4 h-4" />}
              size="lg"
            >
              {isFounder ? 'Create New Deal' : 'Evaluate New Deal'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}