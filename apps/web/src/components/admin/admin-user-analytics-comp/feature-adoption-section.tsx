const features = [
  { name: 'Deal Pipeline', used: true, frequency: 'Daily', lastUsed: '2 hours ago', adoptionScore: 95 },
  { name: 'Deal Workspace', used: true, frequency: 'Daily', lastUsed: '2 hours ago', adoptionScore: 92 },
  { name: 'Documents', used: true, frequency: 'Daily', lastUsed: '2 hours ago', adoptionScore: 98 },
  { name: 'AI Assistant', used: true, frequency: 'Daily', lastUsed: '3 hours ago', adoptionScore: 88 },
  { name: 'Investor Insights', used: true, frequency: 'Weekly', lastUsed: '2 days ago', adoptionScore: 72 },
  { name: 'Reports', used: true, frequency: 'Weekly', lastUsed: '3 days ago', adoptionScore: 65 },
  { name: 'Archive/Restore', used: true, frequency: 'Monthly', lastUsed: '1 week ago', adoptionScore: 48 },
  { name: 'Exports/Downloads', used: true, frequency: 'Weekly', lastUsed: '4 days ago', adoptionScore: 58 },
  { name: 'Search & Filters', used: true, frequency: 'Daily', lastUsed: '5 hours ago', adoptionScore: 82 },
  { name: 'Admin Features', used: false, frequency: '-', lastUsed: 'Never', adoptionScore: 0 },
];

export function FeatureAdoptionSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg text-white">Feature Adoption & System Usage</h3>
      </div>

      {/* Most Used Features */}
      <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6">
        <h4 className="text-sm text-zinc-300 mb-4">Most Used Features</h4>
        <div className="space-y-3">
          {features
            .filter(f => f.used)
            .sort((a, b) => b.adoptionScore - a.adoptionScore)
            .slice(0, 5)
            .map((feature, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-zinc-300">{feature.name}</span>
                    <span className="text-xs text-zinc-500">{feature.adoptionScore}%</span>
                  </div>
                  <div className="bg-zinc-700/50 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${feature.adoptionScore}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Feature Usage Table */}
      <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] overflow-hidden">
        <div className="p-6 border-b border-zinc-700/50">
          <h4 className="text-sm text-zinc-300">All Features</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-700/50">
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Feature</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Frequency</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Last Used</th>
                <th className="text-left px-6 py-3 text-xs text-zinc-400 uppercase tracking-wider">Adoption Score</th>
              </tr>
            </thead>
            <tbody>
              {features.map((feature, index) => (
                <tr key={index} className="border-b border-zinc-700/30 hover:bg-zinc-700/20 transition-colors">
                  <td className="px-6 py-4">
                    <span className="text-sm text-white">{feature.name}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                      feature.used
                        ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                        : 'bg-zinc-700/50 text-zinc-400'
                    }`}>
                      {feature.used ? 'Active' : 'Not Used'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-300">{feature.frequency}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-400">{feature.lastUsed}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-zinc-700/50 rounded-full h-1.5 max-w-[80px]">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full"
                          style={{ width: `${feature.adoptionScore}%` }}
                        />
                      </div>
                      <span className="text-xs text-zinc-400 min-w-[35px]">{feature.adoptionScore}%</span>
                    </div>
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
