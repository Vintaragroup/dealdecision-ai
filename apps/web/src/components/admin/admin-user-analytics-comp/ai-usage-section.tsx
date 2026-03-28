import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { MessageSquare, Zap, DollarSign } from 'lucide-react';

const tokenTrendData = [
  { date: 'Mar 21', tokens: 12500 },
  { date: 'Mar 22', tokens: 18200 },
  { date: 'Mar 23', tokens: 15800 },
  { date: 'Mar 24', tokens: 24600 },
  { date: 'Mar 25', tokens: 19400 },
  { date: 'Mar 26', tokens: 28900 },
  { date: 'Mar 27', tokens: 22100 },
  { date: 'Mar 28', tokens: 31200 },
];

const aiUsageByDeal = [
  { dealName: 'Acme Corp Acquisition', chatSessions: 89, totalMessages: 342, tokensUsed: 85200, avgTokensPerSession: 958, lastChat: '2 hours ago', costEstimate: '$1.28' },
  { dealName: 'TechVenture Series B', chatSessions: 56, totalMessages: 218, tokensUsed: 52800, avgTokensPerSession: 943, lastChat: '5 hours ago', costEstimate: '$0.79' },
  { dealName: 'RetailCo Merger', chatSessions: 124, totalMessages: 487, tokensUsed: 118400, avgTokensPerSession: 955, lastChat: '1 day ago', costEstimate: '$1.78' },
  { dealName: 'FinTech Startup Investment', chatSessions: 34, totalMessages: 128, tokensUsed: 31200, avgTokensPerSession: 918, lastChat: '3 days ago', costEstimate: '$0.47' },
];

const tokensByDealData = [
  { dealName: 'Acme Corp', tokens: 85200 },
  { dealName: 'RetailCo', tokens: 118400 },
  { dealName: 'TechVenture', tokens: 52800 },
  { dealName: 'FinTech', tokens: 31200 },
];

export function AIUsageSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg text-white">AI / Chat / Token Usage</h3>
      </div>

      {/* AI Usage Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Total Chats</div>
          <div className="text-xl text-white">303</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Total Messages</div>
          <div className="text-xl text-white">1,175</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Total Tokens</div>
          <div className="text-xl text-white">287.6K</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Avg Per Session</div>
          <div className="text-xl text-white">949</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Est. Cost</div>
          <div className="text-xl text-emerald-400">$4.32</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Token Usage Trend */}
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6">
          <h4 className="text-sm text-zinc-300 mb-4">Token Usage Trend (Last 7 Days)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={tokenTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
              <XAxis dataKey="date" stroke="#71717a" style={{ fontSize: '12px' }} />
              <YAxis stroke="#71717a" style={{ fontSize: '12px' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  color: '#ffffff',
                }}
              />
              <Line type="monotone" dataKey="tokens" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Token Usage by Deal */}
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6">
          <h4 className="text-sm text-zinc-300 mb-4">Token Usage by Deal</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tokensByDealData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
              <XAxis type="number" stroke="#71717a" style={{ fontSize: '12px' }} />
              <YAxis type="category" dataKey="dealName" stroke="#71717a" style={{ fontSize: '12px' }} width={100} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  color: '#ffffff',
                }}
              />
              <Bar dataKey="tokens" fill="#8b5cf6" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AI Usage by Deal Table */}
      <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] overflow-hidden">
        <div className="p-6 border-b border-zinc-700/50">
          <h4 className="text-sm text-zinc-300">AI Usage by Deal</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-700/50">
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Deal Name</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Chat Sessions</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Total Messages</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Tokens Used</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Avg / Session</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Last Chat</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Cost Estimate</th>
              </tr>
            </thead>
            <tbody>
              {aiUsageByDeal.map((deal, index) => (
                <tr key={index} className="border-b border-zinc-700/30 hover:bg-zinc-700/20 transition-colors">
                  <td className="px-6 py-4">
                    <span className="text-sm text-white">{deal.dealName}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm text-zinc-300">
                      <MessageSquare className="w-3.5 h-3.5" />
                      {deal.chatSessions}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">{deal.totalMessages}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm text-zinc-300">
                      <Zap className="w-3.5 h-3.5 text-purple-400" />
                      {deal.tokensUsed.toLocaleString()}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">{deal.avgTokensPerSession}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-400">{deal.lastChat}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm text-emerald-400">
                      <DollarSign className="w-3.5 h-3.5" />
                      {deal.costEstimate}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Avg Chat Length</div>
          <div className="text-xl text-white">3.9 msgs</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Longest Thread</div>
          <div className="text-xl text-white">24 msgs</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">AI Actions</div>
          <div className="text-xl text-white">156</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Last 7 Days</div>
          <div className="text-xl text-white">158 chats</div>
        </div>
      </div>
    </div>
  );
}
