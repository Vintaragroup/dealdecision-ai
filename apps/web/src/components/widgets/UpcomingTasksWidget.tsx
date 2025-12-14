import { CheckCircle2, Circle, Clock, AlertCircle } from 'lucide-react';

interface Task {
  id: string;
  title: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  completed?: boolean;
  category?: string;
}

interface UpcomingTasksWidgetProps {
  darkMode: boolean;
  tasks: Task[];
  onTaskClick?: (taskId: string) => void;
  title?: string;
}

export function UpcomingTasksWidget({ 
  darkMode, 
  tasks,
  onTaskClick,
  title = 'Upcoming Tasks'
}: UpcomingTasksWidgetProps) {
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return darkMode ? 'text-red-400' : 'text-red-600';
      case 'medium':
        return darkMode ? 'text-yellow-400' : 'text-yellow-600';
      case 'low':
      default:
        return darkMode ? 'text-blue-400' : 'text-blue-600';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high':
        return <AlertCircle className="w-3 h-3" />;
      case 'medium':
        return <Clock className="w-3 h-3" />;
      case 'low':
      default:
        return <Circle className="w-3 h-3" />;
    }
  };

  return (
    <div className={`p-5 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          {title}
        </h3>
        <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {tasks.filter(t => !t.completed).length} pending
        </span>
      </div>

      <div className="space-y-2">
        {tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => onTaskClick?.(task.id)}
            className={`w-full text-left p-3 rounded-lg border transition-all ${
              task.completed
                ? darkMode 
                  ? 'bg-white/5 border-white/5 opacity-60' 
                  : 'bg-gray-50 border-gray-100 opacity-60'
                : darkMode 
                  ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20' 
                  : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              {task.completed ? (
                <CheckCircle2 className={`w-5 h-5 flex-shrink-0 ${
                  darkMode ? 'text-green-400' : 'text-green-600'
                }`} />
              ) : (
                <Circle className={`w-5 h-5 flex-shrink-0 ${
                  darkMode ? 'text-gray-500' : 'text-gray-400'
                }`} />
              )}
              
              <div className="flex-1 min-w-0">
                <h4 className={`text-sm ${
                  task.completed 
                    ? 'line-through' 
                    : darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  {task.title}
                </h4>
                
                <div className="flex items-center gap-3 mt-1">
                  <div className={`flex items-center gap-1 text-xs ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    <Clock className="w-3 h-3" />
                    <span>{task.dueDate}</span>
                  </div>
                  
                  {!task.completed && (
                    <div className={`flex items-center gap-1 text-xs ${getPriorityColor(task.priority)}`}>
                      {getPriorityIcon(task.priority)}
                      <span className="capitalize">{task.priority}</span>
                    </div>
                  )}
                  
                  {task.category && (
                    <span className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                      {task.category}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
