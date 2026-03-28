import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const activityData = [
  { date: 'Mar 21', sessions: 12, timeSpent: 45 },
  { date: 'Mar 22', sessions: 18, timeSpent: 62 },
  { date: 'Mar 23', sessions: 15, timeSpent: 51 },
  { date: 'Mar 24', sessions: 22, timeSpent: 78 },
  { date: 'Mar 25', sessions: 19, timeSpent: 65 },
  { date: 'Mar 26', sessions: 25, timeSpent: 89 },
  { date: 'Mar 27', sessions: 21, timeSpent: 72 },
  { date: 'Mar 28', sessions: 28, timeSpent: 95 },
];

const usageHeatmapData = [
  { day: 'Mon', '0-6h': 2, '6-12h': 8, '12-18h': 15, '18-24h': 5 },
  { day: 'Tue', '0-6h': 1, '6-12h': 12, '12-18h': 18, '18-24h': 7 },
  { day: 'Wed', '0-6h': 3, '6-12h': 10, '12-18h': 20, '18-24h': 8 },
  { day: 'Thu', '0-6h': 2, '6-12h': 14, '12-18h': 22, '18-24h': 6 },
  { day: 'Fri', '0-6h': 1, '6-12h': 11, '12-18h': 16, '18-24h': 9 },
  { day: 'Sat', '0-6h': 0, '6-12h': 3, '12-18h': 5, '18-24h': 2 },
  { day: 'Sun', '0-6h': 0, '6-12h': 2, '12-18h': 4, '18-24h': 1 },
];

export function EngagementSection() {
  return (
    <div className="space-y-6">
      <h3 className="text-lg text-white">Engagement & Activity Overview</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Trend */}
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6">
          <h4 className="text-sm text-zinc-300 mb-4">Session Activity (Last 7 Days)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={activityData}>
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
              <Line type="monotone" dataKey="sessions" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Time Spent Trend */}
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6">
          <h4 className="text-sm text-zinc-300 mb-4">Time Spent (Minutes)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={activityData}>
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
              <Bar dataKey="timeSpent" fill="#3b82f6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Usage Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Last 7 Days Active</div>
          <div className="text-xl text-white">7/7 days</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Last 30 Days Active</div>
          <div className="text-xl text-white">28/30 days</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Peak Usage Hour</div>
          <div className="text-xl text-white">2-3 PM</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Most Active Day</div>
          <div className="text-xl text-white">Thursday</div>
        </div>
      </div>
    </div>
  );
}
