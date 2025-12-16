import { useState } from 'react';
import { Button } from '../ui/button';
import { DocumentUpload } from '../documents/DocumentUpload';
import { DocumentLibrary } from '../documents/DocumentLibrary';
import { 
  Upload, 
  FolderOpen,
  FileText,
  Sparkles,
  TrendingUp
} from 'lucide-react';

interface DocumentsProps {
  darkMode: boolean;
}

export function Documents({ darkMode }: DocumentsProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<any[]>([]);

  const handleUploadComplete = (files: any[]) => {
    setUploadedDocuments(prev => [...prev, ...files]);
    setShowUpload(false);
  };

  const stats = [
    {
      label: 'Total Documents',
      value: '24',
      change: '+6 this month',
      icon: FileText,
      color: '#6366f1'
    },
    {
      label: 'AI Processed',
      value: '18',
      change: '75% of total',
      icon: Sparkles,
      color: '#8b5cf6'
    },
    {
      label: 'Storage Used',
      value: '28.4 MB',
      change: 'of 5 GB',
      icon: FolderOpen,
      color: '#10b981'
    },
    {
      label: 'Avg. Processing Time',
      value: '2.3s',
      change: '-15% faster',
      icon: TrendingUp,
      color: '#f59e0b'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
        <div>
          <h1 className={`text-2xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Documents
          </h1>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Upload, manage, and analyze your deal documents with AI
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowUpload(!showUpload)}
        >
          <Upload className="w-4 h-4" />
          {showUpload ? 'Close Upload' : 'Upload Documents'}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div
              key={index}
              className={`p-5 rounded-xl border ${
                darkMode
                  ? 'bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: stat.color + '20' }}
                >
                  <Icon className="w-5 h-5" style={{ color: stat.color }} />
                </div>
              </div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {stat.value}
              </div>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {stat.label}
              </div>
              <div className="text-xs text-emerald-500">
                {stat.change}
              </div>
            </div>
          );
        })}
      </div>

      {/* Upload Section */}
      {showUpload && (
        <div
          className={`p-6 rounded-xl border ${
            darkMode
              ? 'bg-white/5 border-white/10'
              : 'bg-white border-gray-200'
          }`}
        >
          <h2 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Upload New Documents
          </h2>
          <DocumentUpload
            darkMode={darkMode}
            onUploadComplete={handleUploadComplete}
            enableAIExtraction={true}
          />
        </div>
      )}

      {/* Document Library */}
      <div
        className={`p-6 rounded-xl border ${
          darkMode
            ? 'bg-white/5 border-white/10'
            : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Document Library
          </h2>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
            darkMode ? 'bg-purple-500/20' : 'bg-purple-100'
          }`}>
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span className="text-sm text-purple-500">
              AI-Powered Analysis
            </span>
          </div>
        </div>
        <DocumentLibrary darkMode={darkMode} documents={uploadedDocuments} />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          className={`p-5 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${
            darkMode
              ? 'bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border-blue-500/20'
              : 'bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200'
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mb-3">
            <FileText className="w-5 h-5 text-blue-500" />
          </div>
          <h3 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Bulk Upload
          </h3>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Upload multiple documents at once with folder support
          </p>
        </div>

        <div
          className={`p-5 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${
            darkMode
              ? 'bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/20'
              : 'bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200'
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5 text-purple-500" />
          </div>
          <h3 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            AI Analysis
          </h3>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Automatically extract key data from your documents
          </p>
        </div>

        <div
          className={`p-5 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${
            darkMode
              ? 'bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/20'
              : 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200'
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center mb-3">
            <FolderOpen className="w-5 h-5 text-emerald-500" />
          </div>
          <h3 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Smart Organization
          </h3>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Auto-categorize documents by type and content
          </p>
        </div>
      </div>
    </div>
  );
}