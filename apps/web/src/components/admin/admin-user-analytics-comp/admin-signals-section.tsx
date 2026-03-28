import { AlertTriangle, AlertCircle, Info } from 'lucide-react';

const signals = [
  { type: 'warning', title: 'High Token Usage Spike', description: 'Token usage increased by 340% in last 24 hours', timestamp: '2 hours ago' },
  { type: 'info', title: 'Consistent Daily Usage', description: 'User has been active for 28 consecutive days', timestamp: '1 day ago' },
  { type: 'critical', title: 'Multiple Failed Uploads', description: '6 document uploads failed in Acme Corp deal', timestamp: '3 hours ago' },
];

const lifecycleEvents = [
  { event: 'Role Changed', details: 'Changed from Member to Admin', date: 'Mar 15, 2026', severity: 'info' },
  { event: 'Archive Action', details: 'Archived 3 deals', date: 'Mar 10, 2026', severity: 'warning' },
  { event: 'Mass Document Upload', details: 'Uploaded 47 documents in 1 hour', date: 'Mar 8, 2026', severity: 'info' },
  { event: 'Invite Accepted', details: 'Accepted invitation from admin@company.com', date: 'Feb 12, 2026', severity: 'info' },
];

export function AdminSignalsSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg text-white">Admin Signals & Risk Monitoring</h3>
      </div>

      {/* Active Signals */}
      <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6">
        <h4 className="text-sm text-zinc-300 mb-4">Active Signals</h4>
        <div className="space-y-3">
          {signals.map((signal, index) => (
            <div
              key={index}
              className={`flex items-start gap-3 p-4 rounded-lg border ${
                signal.type === 'critical'
                  ? 'bg-red-500/10 border-red-500/30'
                  : signal.type === 'warning'
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-blue-500/10 border-blue-500/30'
              }`}
            >
              {signal.type === 'critical' ? (
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              ) : signal.type === 'warning' ? (
                <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              ) : (
                <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h5 className={`text-sm mb-1 ${
                      signal.type === 'critical'
                        ? 'text-red-300'
                        : signal.type === 'warning'
                        ? 'text-amber-300'
                        : 'text-blue-300'
                    }`}>
                      {signal.title}
                    </h5>
                    <p className="text-xs text-zinc-400">{signal.description}</p>
                  </div>
                  <span className="text-xs text-zinc-500 whitespace-nowrap">{signal.timestamp}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Failed Auth</div>
          <div className="text-xl text-white">0</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Permission Errors</div>
          <div className="text-xl text-white">2</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Delete Actions</div>
          <div className="text-xl text-amber-400">8</div>
        </div>
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-4">
          <div className="text-xs text-zinc-400 mb-1">Archive/Restore</div>
          <div className="text-xl text-white">15</div>
        </div>
      </div>

      {/* Lifecycle Events */}
      <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] overflow-hidden">
        <div className="p-6 border-b border-zinc-700/50">
          <h4 className="text-sm text-zinc-300">Lifecycle & Admin Actions</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-700/50">
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Event</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Details</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Date</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Severity</th>
              </tr>
            </thead>
            <tbody>
              {lifecycleEvents.map((event, index) => (
                <tr key={index} className="border-b border-zinc-700/30 hover:bg-zinc-700/20 transition-colors">
                  <td className="px-6 py-4">
                    <span className="text-sm text-white">{event.event}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">{event.details}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-400">{event.date}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                      event.severity === 'warning'
                        ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
                        : 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
                    }`}>
                      {event.severity}
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
