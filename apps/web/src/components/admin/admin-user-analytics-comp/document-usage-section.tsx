import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { FileText, Upload, AlertTriangle } from 'lucide-react';

const uploadTrendData = [
  { date: 'Mar 21', uploads: 8 },
  { date: 'Mar 22', uploads: 15 },
  { date: 'Mar 23', uploads: 12 },
  { date: 'Mar 24', uploads: 22 },
  { date: 'Mar 25', uploads: 18 },
  { date: 'Mar 26', uploads: 28 },
  { date: 'Mar 27', uploads: 24 },
  { date: 'Mar 28', uploads: 31 },
];

const documentTypeData = [
  { name: 'PDF', value: 342, color: '#3b82f6' },
  { name: 'Word', value: 156, color: '#8b5cf6' },
  { name: 'Excel', value: 89, color: '#10b981' },
  { name: 'PowerPoint', value: 67, color: '#f59e0b' },
  { name: 'Other', value: 43, color: '#6b7280' },
];

const documentsByDeal = [
  { dealName: 'Acme Corp Acquisition', docCount: 247, recentUploads: 18, failedUploads: 2, totalSize: '2.4 GB', lastUpload: '2 hours ago', avgProcessing: '3.2s' },
  { dealName: 'TechVenture Series B', docCount: 142, recentUploads: 12, failedUploads: 0, totalSize: '1.8 GB', lastUpload: '5 hours ago', avgProcessing: '2.8s' },
  { dealName: 'RetailCo Merger', docCount: 318, recentUploads: 24, failedUploads: 3, totalSize: '3.1 GB', lastUpload: '1 day ago', avgProcessing: '4.1s' },
  { dealName: 'FinTech Startup Investment', docCount: 89, recentUploads: 6, failedUploads: 1, totalSize: '892 MB', lastUpload: '3 days ago', avgProcessing: '2.5s' },
];

export function DocumentUsageSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg text-white">Document Usage Analytics</h3>
      </div>

      {/* Document Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Last 7 Days</div>
          <div className="text-xl text-white">158</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Last 30 Days</div>
          <div className="text-xl text-white">542</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Avg Per Deal</div>
          <div className="text-xl text-white">22.4</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Failed Uploads</div>
          <div className="text-xl text-red-400">6</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Success Rate</div>
          <div className="text-xl text-emerald-400">98.9%</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Trend */}
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6">
          <h4 className="text-sm text-zinc-300 mb-4">Upload Trend (Last 7 Days)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={uploadTrendData}>
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
              <Line type="monotone" dataKey="uploads" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Document Type Distribution */}
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6">
          <h4 className="text-sm text-zinc-300 mb-4">Document Type Distribution</h4>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={documentTypeData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
              >
                {documentTypeData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  color: '#ffffff',
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px', color: '#a1a1aa' }}
                iconType="circle"
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Documents by Deal Table */}
      <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] overflow-hidden">
        <div className="p-6 border-b border-zinc-700/50">
          <h4 className="text-sm text-zinc-300">Documents by Deal</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-700/50">
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Deal Name</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Document Count</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Recent Uploads</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Failed Uploads</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Total Size</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Last Upload</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Avg Processing</th>
              </tr>
            </thead>
            <tbody>
              {documentsByDeal.map((deal, index) => (
                <tr key={index} className="border-b border-zinc-700/30 hover:bg-zinc-700/20 transition-colors">
                  <td className="px-6 py-4">
                    <span className="text-sm text-white">{deal.dealName}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm text-zinc-300">
                      <FileText className="w-3.5 h-3.5" />
                      {deal.docCount}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm text-zinc-300">
                      <Upload className="w-3.5 h-3.5" />
                      {deal.recentUploads}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {deal.failedUploads > 0 ? (
                      <div className="flex items-center gap-1.5 text-sm text-red-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {deal.failedUploads}
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-500">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">{deal.totalSize}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-400">{deal.lastUpload}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">{deal.avgProcessing}</span>
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
