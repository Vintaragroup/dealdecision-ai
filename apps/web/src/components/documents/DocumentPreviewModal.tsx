import { 
  X, 
  Download, 
  Share2, 
  FileText,
  Sparkles,
  Calendar,
  User,
  Tag,
  Copy
} from 'lucide-react';
import { Button } from '../ui/button';

interface DocumentPreviewModalProps {
  document: any;
  darkMode: boolean;
  onClose: () => void;
}

export function DocumentPreviewModal({ document, darkMode, onClose }: DocumentPreviewModalProps) {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className={`w-full max-w-5xl max-h-[90vh] rounded-2xl overflow-hidden flex flex-col ${
          darkMode ? 'bg-[#18181b]' : 'bg-white'
        }`}
      >
        {/* Header */}
        <div
          className={`p-6 border-b ${
            darkMode ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h2 className={`text-xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {document.name}
              </h2>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <User className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                  <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                    {document.uploadedBy}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                  <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                    {formatDate(document.uploadedAt)}
                  </span>
                </div>
                <div className={`px-2 py-1 rounded text-xs ${
                  darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-600'
                }`}>
                  {formatFileSize(document.size)}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm">
              <Download className="w-4 h-4" />
              Download
            </Button>
            <Button variant="secondary" size="sm" darkMode={darkMode}>
              <Share2 className="w-4 h-4" />
              Share
            </Button>
            <Button variant="secondary" size="sm" darkMode={darkMode}>
              <Copy className="w-4 h-4" />
              Copy Link
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-6">
            {/* Preview */}
            <div className="col-span-2">
              <div
                className={`aspect-[3/4] rounded-xl border flex items-center justify-center ${
                  darkMode
                    ? 'bg-white/5 border-white/10'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                {document.type.includes('image') ? (
                  <img
                    src={document.url}
                    alt={document.name}
                    className="w-full h-full object-contain rounded-xl"
                  />
                ) : (
                  <div className="text-center">
                    <FileText className={`w-16 h-16 mx-auto mb-4 ${
                      darkMode ? 'text-gray-600' : 'text-gray-400'
                    }`} />
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Preview not available
                    </p>
                    <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      Click download to view this file
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Details */}
            <div className="space-y-4">
              {/* Document Info */}
              <div
                className={`p-4 rounded-xl ${
                  darkMode ? 'bg-white/5' : 'bg-gray-50'
                }`}
              >
                <h3 className={`text-sm mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Document Details
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Category</span>
                    <span className={darkMode ? 'text-white' : 'text-gray-900'}>{document.category}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Type</span>
                    <span className={darkMode ? 'text-white' : 'text-gray-900'}>
                      {document.type.split('/')[1]?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Size</span>
                    <span className={darkMode ? 'text-white' : 'text-gray-900'}>
                      {formatFileSize(document.size)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tags */}
              {document.tags && document.tags.length > 0 && (
                <div
                  className={`p-4 rounded-xl ${
                    darkMode ? 'bg-white/5' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Tag className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                    <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Tags
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {document.tags.map((tag: string) => (
                      <span
                        key={tag}
                        className={`px-2 py-1 rounded text-xs ${
                          darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Extracted Data */}
              {document.aiExtracted && document.extractedData && (
                <div
                  className={`p-4 rounded-xl ${
                    darkMode
                      ? 'bg-gradient-to-br from-purple-500/10 to-indigo-500/10 border border-purple-500/20'
                      : 'bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-purple-500" />
                    <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      AI Extracted Data
                    </h3>
                  </div>
                  <div className="space-y-2 text-xs">
                    {Object.entries(document.extractedData).map(([key, value]) => (
                      <div key={key}>
                        <div className={`mb-1 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`}>
                          {key.replace(/([A-Z])/g, ' $1').trim()}:
                        </div>
                        <div className={`pl-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {typeof value === 'object' 
                            ? JSON.stringify(value, null, 2) 
                            : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2">
                <button
                  className={`w-full p-3 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors text-red-500 ${
                    darkMode
                      ? 'bg-red-500/10 hover:bg-red-500/20'
                      : 'bg-red-50 hover:bg-red-100'
                  }`}
                >
                  Delete Document
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
