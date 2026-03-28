import { ArrowUpRight, Clock, FileText, MessageSquare } from 'lucide-react';

const topDeals = [
  { name: 'Acme Corp Acquisition', stage: 'Due Diligence', documents: 247, chats: 89, timeSpent: '24h 15m', lastActivity: '2 hours ago', completion: 78, status: 'active' },
  { name: 'TechVenture Series B', stage: 'Initial Review', documents: 142, chats: 56, timeSpent: '18h 42m', lastActivity: '5 hours ago', completion: 62, status: 'active' },
  { name: 'RetailCo Merger', stage: 'Final Review', documents: 318, chats: 124, timeSpent: '31h 08m', lastActivity: '1 day ago', completion: 92, status: 'active' },
  { name: 'FinTech Startup Investment', stage: 'Due Diligence', documents: 89, chats: 34, timeSpent: '12h 22m', lastActivity: '3 days ago', completion: 45, status: 'stalled' },
  { name: 'BioMed Partnership', stage: 'Initial Review', documents: 56, chats: 12, timeSpent: '6h 18m', lastActivity: '1 week ago', completion: 28, status: 'stalled' },
];

export function DealUsageSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg text-white">Deal Usage Analytics</h3>
        <button className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
          View All Deals →
        </button>
      </div>

      {/* Deal Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Avg Time Per Deal</div>
          <div className="text-xl text-white">18h 37m</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Deals Archived</div>
          <div className="text-xl text-white">12</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Deals Viewed</div>
          <div className="text-xl text-white">47</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Deals Deleted</div>
          <div className="text-xl text-white">3</div>
        </div>
      </div>

      {/* Top Deals Table */}
      <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] overflow-hidden">
        <div className="p-6 border-b border-zinc-700/50">
          <h4 className="text-sm text-zinc-300">Top Deals by Activity</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-700/50">
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Deal Name</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Stage</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Documents</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Chats</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Time Spent</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Last Activity</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Completion</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {topDeals.map((deal, index) => (
                <tr key={index} className="border-b border-zinc-700/30 hover:bg-zinc-700/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{deal.name}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-zinc-500 hover:text-blue-400 cursor-pointer" />
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">{deal.stage}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm text-zinc-300">
                      <FileText className="w-3.5 h-3.5" />
                      {deal.documents}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm text-zinc-300">
                      <MessageSquare className="w-3.5 h-3.5" />
                      {deal.chats}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm text-zinc-300">
                      <Clock className="w-3.5 h-3.5" />
                      {deal.timeSpent}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-400">{deal.lastActivity}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-zinc-700/50 rounded-full h-1.5 max-w-[60px]">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full"
                          style={{ width: `${deal.completion}%` }}
                        />
                      </div>
                      <span className="text-xs text-zinc-400">{deal.completion}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                      deal.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
                    }`}>
                      {deal.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
