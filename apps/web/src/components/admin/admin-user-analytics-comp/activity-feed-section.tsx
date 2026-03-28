import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileText, MessageSquare, Archive, Download, LogIn, FileEdit, Shield } from 'lucide-react';

type ActivityType = 'login' | 'chat' | 'document' | 'deal' | 'export' | 'archive' | 'role';
type ActivityCategory = 'deals' | 'documents' | 'ai' | 'admin' | 'security';

type ActivityItem = {
  type: ActivityType;
  action: string;
  entity: string;
  metadata: string;
  timestamp: string;
  category: ActivityCategory;
};

const activities: ActivityItem[] = [
  { type: 'login', action: 'Logged in', entity: '', metadata: 'From IP: 192.168.1.100', timestamp: '2 hours ago', category: 'security' },
  { type: 'chat', action: 'Started AI chat', entity: 'Acme Corp Acquisition', metadata: '12 messages exchanged', timestamp: '2 hours ago', category: 'ai' },
  { type: 'document', action: 'Uploaded documents', entity: 'Acme Corp Acquisition', metadata: '8 PDF files', timestamp: '3 hours ago', category: 'documents' },
  { type: 'deal', action: 'Created deal', entity: 'BioMed Partnership', metadata: 'Stage: Initial Review', timestamp: '5 hours ago', category: 'deals' },
  { type: 'document', action: 'Deleted document', entity: 'RetailCo Merger', metadata: 'financial_report_q3.pdf', timestamp: '6 hours ago', category: 'documents' },
  { type: 'export', action: 'Generated report', entity: 'TechVenture Series B', metadata: 'Due Diligence Report', timestamp: '1 day ago', category: 'deals' },
  { type: 'archive', action: 'Archived deal', entity: 'Old Acquisition', metadata: '', timestamp: '2 days ago', category: 'deals' },
  { type: 'role', action: 'Role changed', entity: '', metadata: 'Changed to Admin', timestamp: '1 week ago', category: 'admin' },
];

const activityIcons: Record<ActivityType, LucideIcon> = {
  login: LogIn,
  chat: MessageSquare,
  document: FileText,
  deal: FileEdit,
  export: Download,
  archive: Archive,
  role: Shield,
};

const activityFilters: Array<'all' | ActivityCategory> = ['all', 'deals', 'documents', 'ai', 'admin', 'security'];

export function ActivityFeedSection() {
  const [filter, setFilter] = useState<'all' | ActivityCategory>('all');

  const filteredActivities = filter === 'all'
    ? activities
    : activities.filter(a => a.category === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg text-white">Activity Timeline</h3>
        <div className="flex gap-2">
          {activityFilters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                filter === f
                  ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
                  : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6">
        <div className="space-y-4">
          {filteredActivities.map((activity, index) => {
            const Icon = activityIcons[activity.type];
            return (
              <div key={index} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    activity.category === 'security'
                      ? 'bg-purple-500/20 text-purple-400'
                      : activity.category === 'admin'
                      ? 'bg-amber-500/20 text-amber-400'
                      : activity.category === 'ai'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-zinc-700/50 text-zinc-400'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  {index !== filteredActivities.length - 1 && (
                    <div className="w-px flex-1 bg-zinc-700/50 mt-2" />
                  )}
                </div>
                <div className="flex-1 pb-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <p className="text-sm text-white">
                        {activity.action}
                        {activity.entity && (
                          <span className="text-blue-400 ml-1">
                            {activity.entity}
                          </span>
                        )}
                      </p>
                      {activity.metadata && (
                        <p className="text-xs text-zinc-500 mt-1">{activity.metadata}</p>
                      )}
                    </div>
                    <span className="text-xs text-zinc-500 whitespace-nowrap">{activity.timestamp}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {filteredActivities.length === 0 && (
        <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-12 text-center">
          <p className="text-zinc-500">No activities found for this filter</p>
        </div>
      )}
    </div>
  );
}
