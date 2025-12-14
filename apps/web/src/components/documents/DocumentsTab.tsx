import { useState } from 'react';
import { Button } from '../ui/Button';
import { DocumentUpload } from './DocumentUpload';
import { DocumentLibrary } from './DocumentLibrary';
import { Upload, Sparkles } from 'lucide-react';

interface DocumentsTabProps {
  dealId: string;
  darkMode?: boolean;
}

export function DocumentsTab({ dealId, darkMode = true }: DocumentsTabProps) {
  const [showUpload, setShowUpload] = useState(false);

  return (
    <div className="space-y-4">
      {/* Upload Toggle */}
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
          darkMode ? 'bg-purple-500/20' : 'bg-purple-100'
        }`}>
          <Sparkles className="w-4 h-4 text-purple-500" />
          <span className="text-sm text-purple-500">
            AI-Powered Extraction
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowUpload(!showUpload)}
        >
          <Upload className="w-4 h-4" />
          {showUpload ? 'Close Upload' : 'Upload'}
        </Button>
      </div>

      {/* Upload Section */}
      {showUpload && (
        <div
          className={`p-4 rounded-xl border ${
            darkMode
              ? 'bg-white/5 border-white/10'
              : 'bg-white border-gray-200'
          }`}
        >
          <DocumentUpload
            darkMode={darkMode}
            enableAIExtraction={true}
          />
        </div>
      )}

      {/* Document Library */}
      <DocumentLibrary darkMode={darkMode} />
    </div>
  );
}