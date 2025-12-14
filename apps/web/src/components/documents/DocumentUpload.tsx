import { useState, useRef, useCallback } from 'react';
import { Button } from '../ui/Button';
import { 
  Upload, 
  File, 
  FileText, 
  Image, 
  FileSpreadsheet,
  X,
  CheckCircle,
  AlertCircle,
  Loader,
  Sparkles,
  FolderOpen
} from 'lucide-react';

interface DocumentUploadProps {
  darkMode: boolean;
  onUploadComplete?: (files: UploadedFile[]) => void;
  acceptedFileTypes?: string[];
  maxFileSize?: number; // in MB
  enableAIExtraction?: boolean;
}

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  category?: string;
  uploadedAt: Date;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  aiExtracted?: boolean;
  extractedData?: any;
}

export function DocumentUpload({ 
  darkMode, 
  onUploadComplete,
  acceptedFileTypes = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.png', '.csv'],
  maxFileSize = 10,
  enableAIExtraction = true
}: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf':
        return <FileText className="w-6 h-6 text-red-500" />;
      case 'doc':
      case 'docx':
        return <FileText className="w-6 h-6 text-blue-500" />;
      case 'xls':
      case 'xlsx':
      case 'csv':
        return <FileSpreadsheet className="w-6 h-6 text-emerald-500" />;
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
        return <Image className="w-6 h-6 text-purple-500" />;
      default:
        return <File className="w-6 h-6 text-gray-500" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const simulateAIExtraction = async (file: UploadedFile) => {
    // Simulate AI processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Mock extracted data based on file type
    const ext = file.name.split('.').pop()?.toLowerCase();
    let extractedData = {};
    
    if (ext === 'pdf' || ext === 'doc' || ext === 'docx') {
      extractedData = {
        documentType: 'Pitch Deck',
        companyName: 'TechStartup Inc.',
        foundingDate: '2023',
        fundingRound: 'Series A',
        amountRaising: '$5M',
        keyMetrics: {
          revenue: '$2.5M ARR',
          growth: '180% YoY',
          customers: '145'
        }
      };
    } else if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') {
      extractedData = {
        documentType: 'Financial Model',
        revenue: [
          { year: 2024, value: 2500000 },
          { year: 2025, value: 7500000 },
          { year: 2026, value: 18000000 }
        ],
        expenses: {
          cogs: 750000,
          sales: 1200000,
          engineering: 1800000
        }
      };
    }
    
    return extractedData;
  };

  const processFile = async (file: File) => {
    const uploadedFile: UploadedFile = {
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      type: file.type,
      size: file.size,
      url: URL.createObjectURL(file),
      uploadedAt: new Date(),
      status: 'uploading'
    };

    setUploadedFiles(prev => [...prev, uploadedFile]);

    // Simulate upload
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update to processing if AI extraction is enabled
    if (enableAIExtraction) {
      setUploadedFiles(prev => 
        prev.map(f => f.id === uploadedFile.id ? { ...f, status: 'processing' } : f)
      );

      const extractedData = await simulateAIExtraction(uploadedFile);

      setUploadedFiles(prev => 
        prev.map(f => 
          f.id === uploadedFile.id 
            ? { ...f, status: 'complete', aiExtracted: true, extractedData } 
            : f
        )
      );
    } else {
      setUploadedFiles(prev => 
        prev.map(f => f.id === uploadedFile.id ? { ...f, status: 'complete' } : f)
      );
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;

    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      const sizeInMB = file.size / (1024 * 1024);
      return acceptedFileTypes.includes(ext) && sizeInMB <= maxFileSize;
    });

    for (const file of validFiles) {
      await processFile(file);
    }

    if (onUploadComplete && validFiles.length > 0) {
      onUploadComplete(uploadedFiles);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-[#6366f1] bg-[#6366f1]/10 scale-[1.02]'
            : darkMode
            ? 'border-white/20 hover:border-[#6366f1]/50 hover:bg-white/5'
            : 'border-gray-300 hover:border-[#6366f1]/50 hover:bg-gray-50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedFileTypes.join(',')}
          onChange={handleFileInput}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
            isDragging
              ? 'bg-[#6366f1]/20'
              : darkMode
              ? 'bg-white/10'
              : 'bg-gray-100'
          }`}>
            {isDragging ? (
              <FolderOpen className="w-8 h-8 text-[#6366f1]" />
            ) : (
              <Upload className={`w-8 h-8 ${darkMode ? 'text-white' : 'text-gray-600'}`} />
            )}
          </div>

          <div>
            <p className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {isDragging ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              or click to browse
            </p>
          </div>

          {enableAIExtraction && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
              darkMode ? 'bg-purple-500/20' : 'bg-purple-100'
            }`}>
              <Sparkles className="w-4 h-4 text-purple-500" />
              <span className="text-sm text-purple-500">
                AI-powered data extraction enabled
              </span>
            </div>
          )}

          <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            Supported: {acceptedFileTypes.join(', ')} • Max size: {maxFileSize}MB
          </div>
        </div>
      </div>

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Uploaded Files ({uploadedFiles.length})
          </div>
          {uploadedFiles.map((file) => (
            <div
              key={file.id}
              className={`p-4 rounded-xl border ${
                darkMode
                  ? 'bg-white/5 border-white/10'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-center gap-3">
                {getFileIcon(file.name)}
                
                <div className="flex-1 min-w-0">
                  <div className={`text-sm mb-1 truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {file.name}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      {formatFileSize(file.size)}
                    </span>
                    {file.status === 'uploading' && (
                      <div className="flex items-center gap-1 text-xs text-blue-500">
                        <Loader className="w-3 h-3 animate-spin" />
                        Uploading...
                      </div>
                    )}
                    {file.status === 'processing' && (
                      <div className="flex items-center gap-1 text-xs text-purple-500">
                        <Sparkles className="w-3 h-3 animate-pulse" />
                        AI Processing...
                      </div>
                    )}
                    {file.status === 'complete' && (
                      <div className="flex items-center gap-1 text-xs text-emerald-500">
                        <CheckCircle className="w-3 h-3" />
                        {file.aiExtracted ? 'Extracted & Ready' : 'Ready'}
                      </div>
                    )}
                    {file.status === 'error' && (
                      <div className="flex items-center gap-1 text-xs text-red-500">
                        <AlertCircle className="w-3 h-3" />
                        Upload failed
                      </div>
                    )}
                  </div>
                </div>

                {file.status === 'complete' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file.id);
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${
                      darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* AI Extracted Data Preview */}
              {file.aiExtracted && file.extractedData && (
                <div 
                  className={`mt-3 p-3 rounded-lg text-xs ${
                    darkMode ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-purple-50 border border-purple-200'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-3 h-3 text-purple-500" />
                    <span className="text-purple-500">AI Extracted Data</span>
                  </div>
                  <div className={`space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {Object.entries(file.extractedData).slice(0, 3).map(([key, value]) => (
                      <div key={key}>
                        <strong>{key}:</strong> {typeof value === 'object' ? JSON.stringify(value).slice(0, 50) + '...' : String(value)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
