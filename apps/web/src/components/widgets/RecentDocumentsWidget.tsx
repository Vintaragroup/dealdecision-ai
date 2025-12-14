import { FileText, ArrowRight, Calendar } from 'lucide-react';

interface Document {
  id: string;
  title: string;
  type: string;
  lastModified: string;
  status?: 'draft' | 'final' | 'in-review';
}

interface RecentDocumentsWidgetProps {
  darkMode: boolean;
  documents: Document[];
  onDocumentClick?: (docId: string) => void;
  onViewAll?: () => void;
  title?: string;
}

export function RecentDocumentsWidget({ 
  darkMode, 
  documents, 
  onDocumentClick,
  onViewAll,
  title = 'Recent Documents'
}: RecentDocumentsWidgetProps) {
  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'final':
        return darkMode ? 'text-green-400' : 'text-green-600';
      case 'in-review':
        return darkMode ? 'text-yellow-400' : 'text-yellow-600';
      case 'draft':
      default:
        return darkMode ? 'text-gray-400' : 'text-gray-500';
    }
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'final':
        return 'Final';
      case 'in-review':
        return 'In Review';
      case 'draft':
      default:
        return 'Draft';
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
        {onViewAll && (
          <button
            onClick={onViewAll}
            className={`text-xs flex items-center gap-1 hover:gap-2 transition-all ${
              darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            View All
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="space-y-3">
        {documents.map((doc) => (
          <button
            key={doc.id}
            onClick={() => onDocumentClick?.(doc.id)}
            className={`w-full text-left p-3 rounded-lg border transition-all ${
              darkMode 
                ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20' 
                : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${
                darkMode ? 'bg-white/5' : 'bg-gray-100'
              }`}>
                <FileText className={`w-4 h-4 ${
                  darkMode ? 'text-gray-400' : 'text-gray-600'
                }`} />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className={`text-sm truncate ${
                      darkMode ? 'text-white' : 'text-gray-900'
                    }`}>
                      {doc.title}
                    </h4>
                    <p className={`text-xs ${
                      darkMode ? 'text-gray-500' : 'text-gray-400'
                    }`}>
                      {doc.type}
                    </p>
                  </div>
                  {doc.status && (
                    <span className={`text-xs whitespace-nowrap ${getStatusColor(doc.status)}`}>
                      {getStatusLabel(doc.status)}
                    </span>
                  )}
                </div>
                
                <div className={`flex items-center gap-1 mt-1 text-xs ${
                  darkMode ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  <Calendar className="w-3 h-3" />
                  <span>{doc.lastModified}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
