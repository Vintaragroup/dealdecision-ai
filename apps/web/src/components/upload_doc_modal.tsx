import { useState, useRef, useEffect } from 'react';
import { X, Upload, FileText, Check, AlertCircle, Loader2, Trash2, FileSpreadsheet, Presentation, File } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface UploadedFile {
  id: string;
  file: File;
  status: 'uploading' | 'uploaded' | 'failed';
  progress: number;
  errorMessage?: string;
}

export default function Component() {
  const [isOpen, setIsOpen] = useState(true);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
      if (e.key === 'Enter' && isFormValid() && !isSubmitting) {
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, uploadedFiles]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      processFiles(files);
    }
  };

  const processFiles = (files: File[]) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    files.forEach((file) => {
      if (allowedTypes.includes(file.type) && file.size <= MAX_FILE_SIZE) {
        const fileId = Math.random().toString(36).substring(7);
        const newFile: UploadedFile = {
          id: fileId,
          file,
          status: 'uploading',
          progress: 0
        };

        setUploadedFiles((prev) => [...prev, newFile]);

        // Simulate upload
        const uploadInterval = setInterval(() => {
          setUploadedFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, progress: Math.min(f.progress + 10, 100) } : f
            )
          );
        }, 150);

        setTimeout(() => {
          clearInterval(uploadInterval);
          setUploadedFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, status: 'uploaded' as const } : f
            )
          );
        }, 1500);
      } else {
        const fileId = Math.random().toString(36).substring(7);
        const newFile: UploadedFile = {
          id: fileId,
          file,
          status: 'failed',
          progress: 0,
          errorMessage: file.size > MAX_FILE_SIZE ? 'File size exceeds 10MB' : 'Unsupported file type'
        };

        setUploadedFiles((prev) => [...prev, newFile]);
      }
    });
  };

  const handleRemoveFile = (id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleSubmit = () => {
    const hasUploadedFile = uploadedFiles.some((f) => f.status === 'uploaded');
    if (!hasUploadedFile) return;

    setIsSubmitting(true);
    
    // Simulate submission
    setTimeout(() => {
      setIsSubmitting(false);
      setIsOpen(false);
      setShowSuccess(true);
      // Reset form
      setUploadedFiles([]);
    }, 2000);
  };

  const isFormValid = () => {
    return (
      uploadedFiles.some((f) => f.status === 'uploaded') &&
      !uploadedFiles.some((f) => f.status === 'uploading')
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf':
        return <File className="w-5 h-5 text-red-400" strokeWidth={1.5} />;
      case 'xlsx':
        return <FileSpreadsheet className="w-5 h-5 text-emerald-400" strokeWidth={1.5} />;
      case 'pptx':
        return <Presentation className="w-5 h-5 text-amber-400" strokeWidth={1.5} />;
      case 'docx':
        return <FileText className="w-5 h-5 text-blue-400" strokeWidth={1.5} />;
      default:
        return <FileText className="w-5 h-5 text-blue-400" strokeWidth={1.5} />;
    }
  };

  const getTotalFileInfo = () => {
    const totalSize = uploadedFiles.reduce((acc, f) => acc + f.file.size, 0);
    const uploadedCount = uploadedFiles.filter((f) => f.status === 'uploaded').length;
    return { totalSize, uploadedCount, totalCount: uploadedFiles.length };
  };

  const truncateFilename = (filename: string, maxLength = 30) => {
    if (filename.length <= maxLength) return filename;
    const ext = filename.split('.').pop();
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
    const truncated = nameWithoutExt.substring(0, maxLength - 3 - (ext?.length || 0));
    return `${truncated}...${ext}`;
  };

  if (!isOpen) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex items-center justify-center p-8">
        <button
          onClick={() => setIsOpen(true)}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
        >
          Open Document Upload Modal
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex items-center justify-center p-8">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
      
      {/* Modal */}
      <div className="relative w-full max-w-[600px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 rounded-[16px] shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.05)] border border-zinc-700/50 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl text-white">Document upload</h2>
          <button
            onClick={() => setIsOpen(false)}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4">
          {/* Upload Dropzone */}
          {uploadedFiles.length === 0 && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`min-h-[140px] border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-blue-400 bg-blue-400/10'
                  : 'border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800/30'
              }`}
            >
              <Upload className="w-8 h-8 text-zinc-400 mb-3" strokeWidth={1.5} />
              <p className="text-white mb-1">Drag & drop a document</p>
              <p className="text-sm text-zinc-400">or choose a file</p>
              <p className="text-xs text-zinc-500 mt-2">PDF, PPTX, XLSX, DOCX (max 10MB each)</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                accept=".pdf,.pptx,.xlsx,.docx"
                className="hidden"
              />
            </div>
          )}

          {/* Uploaded Files */}
          <AnimatePresence>
            {uploadedFiles.map((uploadedFile) => (
              <motion.div
                key={uploadedFile.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="group flex flex-col gap-2 p-3 bg-zinc-900/50 border border-zinc-700/50 rounded-lg hover:bg-zinc-900/70 hover:border-zinc-600/50 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {getFileIcon(uploadedFile.file.name)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm truncate">
                      {truncateFilename(uploadedFile.file.name)}
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-zinc-500">
                        {formatFileSize(uploadedFile.file.size)}
                      </p>
                      {uploadedFile.status === 'uploading' && (
                        <span className="text-xs text-blue-400">
                          {uploadedFile.progress}%
                        </span>
                      )}
                      {uploadedFile.errorMessage && (
                        <span className="text-xs text-amber-400">
                          {uploadedFile.errorMessage}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {uploadedFile.status === 'uploading' && (
                      <Loader2 className="w-4 h-4 text-blue-400 animate-spin" strokeWidth={1.5} />
                    )}
                    {uploadedFile.status === 'uploaded' && (
                      <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <Check className="w-3 h-3 text-emerald-400" strokeWidth={2} />
                      </div>
                    )}
                    {uploadedFile.status === 'failed' && (
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center">
                        <AlertCircle className="w-3 h-3 text-amber-400" strokeWidth={2} />
                      </div>
                    )}
                    
                    <button
                      onClick={() => handleRemoveFile(uploadedFile.id)}
                      className="text-zinc-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                {uploadedFile.status === 'uploading' && (
                  <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-blue-400"
                      initial={{ width: 0 }}
                      animate={{ width: `${uploadedFile.progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Show dropzone again if files exist */}
          {uploadedFiles.length > 0 && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`min-h-[80px] border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-blue-400 bg-blue-400/10'
                  : 'border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800/30'
              }`}
            >
              <Upload className="w-5 h-5 text-zinc-400 mb-1" strokeWidth={1.5} />
              <p className="text-sm text-zinc-400">Add another file</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                accept=".pdf,.pptx,.xlsx,.docx"
                className="hidden"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-6 pt-6 border-t border-zinc-700/50">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-zinc-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            {uploadedFiles.length > 0 && (
              <div className="text-xs text-zinc-400">
                {getTotalFileInfo().uploadedCount} of {getTotalFileInfo().totalCount} files ready • {formatFileSize(getTotalFileInfo().totalSize)}
              </div>
            )}
          </div>
          
          <button
            onClick={handleSubmit}
            disabled={!isFormValid() || isSubmitting}
            className={`px-6 py-2 rounded-lg transition-all flex items-center gap-2 ${
              isFormValid() && !isSubmitting
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
            }`}
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />}
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}