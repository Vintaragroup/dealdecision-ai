import { CheckCircle, Clock, Circle, AlertCircle } from 'lucide-react';

interface ChecklistItem {
  id: string;
  title: string;
  status: 'completed' | 'in-progress' | 'not-started' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  assignee?: string;
  dueDate?: string;
  description?: string;
}

interface ValidationChecklistProps {
  darkMode: boolean;
}

export function ValidationChecklist({ darkMode }: ValidationChecklistProps) {
  const items: ChecklistItem[] = [
    {
      id: '1',
      title: 'Market validation with 10+ customer interviews',
      status: 'completed',
      priority: 'high',
      assignee: 'Sarah Chen',
      description: 'Completed 15 interviews with target customers, 87% showed strong interest'
    },
    {
      id: '2',
      title: 'Product MVP launched and operational',
      status: 'completed',
      priority: 'high',
      assignee: 'Development Team'
    },
    {
      id: '3',
      title: 'Secure 3 pilot customers',
      status: 'in-progress',
      priority: 'high',
      assignee: 'Sarah Chen',
      dueDate: 'Dec 20, 2024',
      description: '2 of 3 pilots secured, final negotiations ongoing'
    },
    {
      id: '4',
      title: 'Add technical co-founder or CTO',
      status: 'in-progress',
      priority: 'high',
      assignee: 'Sarah Chen',
      dueDate: 'Jan 15, 2025',
      description: 'Currently interviewing 3 strong candidates'
    },
    {
      id: '5',
      title: 'Complete financial projections (3-year)',
      status: 'completed',
      priority: 'medium',
      assignee: 'Finance Advisor'
    },
    {
      id: '6',
      title: 'Patent application filed for core technology',
      status: 'in-progress',
      priority: 'medium',
      dueDate: 'Dec 31, 2024',
      description: 'With IP attorney, filing in 2 weeks'
    },
    {
      id: '7',
      title: 'Establish advisory board (min. 3 advisors)',
      status: 'not-started',
      priority: 'medium',
      dueDate: 'Feb 1, 2025'
    },
    {
      id: '8',
      title: 'Set up investor data room',
      status: 'completed',
      priority: 'low',
      assignee: 'Sarah Chen'
    },
    {
      id: '9',
      title: 'Develop competitive analysis report',
      status: 'not-started',
      priority: 'low',
      dueDate: 'Jan 30, 2025'
    }
  ];

  const statusConfig = {
    completed: {
      icon: CheckCircle,
      color: 'text-green-500',
      bgColor: darkMode ? 'bg-green-500/10' : 'bg-green-50',
      borderColor: 'border-green-500/30',
      label: 'Completed'
    },
    'in-progress': {
      icon: Clock,
      color: 'text-yellow-500',
      bgColor: darkMode ? 'bg-yellow-500/10' : 'bg-yellow-50',
      borderColor: 'border-yellow-500/30',
      label: 'In Progress'
    },
    'not-started': {
      icon: Circle,
      color: 'text-gray-400',
      bgColor: darkMode ? 'bg-white/5' : 'bg-gray-50',
      borderColor: darkMode ? 'border-white/10' : 'border-gray-200',
      label: 'Not Started'
    },
    blocked: {
      icon: AlertCircle,
      color: 'text-red-500',
      bgColor: darkMode ? 'bg-red-500/10' : 'bg-red-50',
      borderColor: 'border-red-500/30',
      label: 'Blocked'
    }
  };

  const priorityConfig = {
    high: { label: 'High', color: 'text-red-500' },
    medium: { label: 'Med', color: 'text-yellow-500' },
    low: { label: 'Low', color: 'text-gray-500' }
  };

  const completedCount = items.filter(i => i.status === 'completed').length;
  const progressPercentage = (completedCount / items.length) * 100;

  return (
    <div className="space-y-4">
      {/* Progress Summary */}
      <div className={`p-4 rounded-lg backdrop-blur-xl border ${
        darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Validation Progress
          </span>
          <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {completedCount} / {items.length} completed
          </span>
        </div>
        <div className={`h-2 rounded-full overflow-hidden ${
          darkMode ? 'bg-white/10' : 'bg-gray-200'
        }`}>
          <div 
            className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all duration-500"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>
      </div>

      {/* Checklist Items */}
      <div className="space-y-3">
        {items.map((item) => {
          const StatusIcon = statusConfig[item.status].icon;
          const statusStyle = statusConfig[item.status];
          const priorityStyle = priorityConfig[item.priority];

          return (
            <div
              key={item.id}
              className={`p-4 rounded-lg backdrop-blur-xl border transition-all ${
                statusStyle.bgColor
              } ${statusStyle.borderColor} ${
                item.status === 'completed' ? 'opacity-75' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <StatusIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${statusStyle.color}`} />
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h4 className={`text-sm ${
                      item.status === 'completed'
                        ? darkMode ? 'text-gray-500 line-through' : 'text-gray-400 line-through'
                        : darkMode ? 'text-gray-200' : 'text-gray-800'
                    }`}>
                      {item.title}
                    </h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                      darkMode ? 'bg-black/20' : 'bg-white/50'
                    } ${priorityStyle.color}`}>
                      {priorityStyle.label}
                    </span>
                  </div>
                  
                  {item.description && (
                    <p className={`text-xs mb-2 ${
                      darkMode ? 'text-gray-500' : 'text-gray-500'
                    }`}>
                      {item.description}
                    </p>
                  )}
                  
                  <div className="flex items-center gap-3 text-xs">
                    {item.assignee && (
                      <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>
                        👤 {item.assignee}
                      </span>
                    )}
                    {item.dueDate && (
                      <span className={`${
                        item.status === 'in-progress' 
                          ? 'text-yellow-500' 
                          : darkMode ? 'text-gray-500' : 'text-gray-400'
                      }`}>
                        📅 Due: {item.dueDate}
                      </span>
                    )}
                    <span className={`${statusStyle.color} ml-auto`}>
                      {statusStyle.label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
