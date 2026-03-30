import { HelpCircle, AlertCircle } from 'lucide-react';

interface Question {
  text: string;
  priority: 'critical' | 'important' | 'low';
}

interface OpenQuestionsGridProps {
  categories: {
    title: string;
    questions: Question[];
  }[];
}

export function OpenQuestionsGrid({ categories }: OpenQuestionsGridProps) {
  const priorityConfig = {
    critical: {
      icon: AlertCircle,
      color: 'text-red-400',
      badge: 'bg-red-500/25 text-red-300 border-red-500/40',
    },
    important: {
      icon: AlertCircle,
      color: 'text-amber-400',
      badge: 'bg-amber-500/25 text-amber-300 border-amber-500/40',
    },
    low: {
      icon: HelpCircle,
      color: 'text-zinc-500',
      badge: 'bg-zinc-700 text-zinc-400 border-zinc-600',
    },
  };

  return (
    <div className="bg-zinc-800/50 rounded-lg p-6">
      <div className="grid md:grid-cols-2 gap-10">
        {categories.map((category, catIndex) => (
          <div key={catIndex}>
            <h4 className="text-sm text-white mb-4 font-medium">{category.title}</h4>
            <ul className="space-y-3.5">
              {category.questions.map((question, qIndex) => {
                const config = priorityConfig[question.priority];
                const Icon = config.icon;
                return (
                  <li key={qIndex} className="flex items-start gap-2.5">
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.color}`} />
                    <div className="flex-1">
                      <div className="flex items-start gap-2.5 flex-wrap">
                        <span className="text-sm text-zinc-300 flex-1 leading-relaxed">{question.text}</span>
                        {question.priority !== 'low' && (
                          <span className={`px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wider border font-semibold ${config.badge} whitespace-nowrap`}>
                            {question.priority}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}