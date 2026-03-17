import { useState, useRef } from 'react';
import { Upload, FileText, Check, AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { apiCreateDeal, apiCreateDealDraft, apiGetDeal, apiUploadDocument } from '../lib/apiClient';
import type { Deal } from '@dealdecision/contracts';
import type { DealFormData } from './Modal_Legacy/NewDealModal';

interface UploadedFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  error?: string;
}

interface NewDealModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (dealData: DealFormData, createdDeal?: Deal) => void;
  onCreatedDeal?: (deal: Deal | null) => void;
  darkMode: boolean;
}

export function NewDealModal({ isOpen, onClose, onSuccess, onCreatedDeal, darkMode }: NewDealModalProps) {
  const [dealName, setDealName] = useState('');
  const [dealNameError, setDealNameError] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── helpers ────────────────────────────────────────────────────────────────

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const truncateFilename = (filename: string, maxLength = 30) => {
    if (filename.length <= maxLength) return filename;
    const ext = filename.split('.').pop() ?? '';
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
    const truncated = nameWithoutExt.substring(0, maxLength - 3 - ext.length);
    return `${truncated}...${ext}`;
  };

  const buildDealData = (id: string): DealFormData => ({
    id,
    name: dealName.trim() || 'Untitled Deal',
    company: dealName.trim() || 'Unknown Company',
    companyName: dealName.trim() || 'Unknown Company',
    type: 'seed',
    stage: 'idea',
    investmentAmount: 500000,
    fundingAmount: '500000',
    description: '',
    estimatedSavings: { money: 0, hours: 0 },
  });

  const parseDealAlreadyExists = (
    err: unknown,
  ): { existing_deal_id: string; existing_deal_name?: string } | null => {
    const message = err instanceof Error ? err.message : '';
    const statusMatch = message.match(/^HTTP\s+(\d+)\s+/);
    const status = statusMatch ? Number(statusMatch[1]) : null;
    if (status !== 409) return null;
    const idx = message.indexOf(':');
    const tail = idx >= 0 ? message.slice(idx + 1).trim() : '';
    if (!tail.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(tail);
      const existingId = typeof parsed?.existing_deal_id === 'string' ? parsed.existing_deal_id : '';
      if (!existingId.trim()) return null;
      return {
        existing_deal_id: existingId,
        ...(parsed.existing_deal_name ? { existing_deal_name: parsed.existing_deal_name } : {}),
      };
    } catch {
      return null;
    }
  };

  // ── file handling ───────────────────────────────────────────────────────────

  const ALLOWED_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  const processFiles = (files: File[]) => {
    const next: UploadedFile[] = files
      .filter((f) => ALLOWED_TYPES.includes(f.type))
      .map((file) => ({
        id: Math.random().toString(36).substring(7),
        file,
        status: 'pending' as const,
      }));
    if (next.length > 0) setUploadedFiles((prev) => [...prev, ...next]);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(Array.from(e.target.files));
  };
  const handleRemoveFile = (id: string) => setUploadedFiles((prev) => prev.filter((f) => f.id !== id));

  // ── form state ──────────────────────────────────────────────────────────────

  const handleClose = () => {
    setDealName('');
    setDealNameError(false);
    setUploadedFiles([]);
    setSubmitError(null);
    setIsSubmitting(false);
    onClose();
  };

  const isFormValid = () => dealName.trim() !== '' && !isSubmitting;

  const updateFileStatus = (id: string, status: UploadedFile['status'], error?: string) =>
    setUploadedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status, error } : f)));

  // ── submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!dealName.trim()) { setDealNameError(true); return; }
    setSubmitError(null);
    setIsSubmitting(true);

    const pendingFiles = uploadedFiles.filter((f) => f.status === 'pending');
    const name = dealName.trim();

    try {
      let created: Deal;

      if (pendingFiles.length === 0) {
        // Path A — no uploads
        try {
          created = await apiCreateDeal({ name, stage: 'intake', priority: 'medium' });
        } catch (err) {
          const conflict = parseDealAlreadyExists(err);
          if (conflict) {
            created = await apiGetDeal(conflict.existing_deal_id);
          } else {
            throw err;
          }
        }
      } else {
        // Path B — create draft then upload
        let draftId: string;
        try {
          const draft = await apiCreateDealDraft({ name, stage: 'intake', priority: 'medium' });
          draftId = draft.deal_id;
        } catch (err) {
          const conflict = parseDealAlreadyExists(err);
          if (conflict) {
            draftId = conflict.existing_deal_id;
          } else {
            throw err;
          }
        }

        for (const item of pendingFiles) {
          updateFileStatus(item.id, 'uploading');
          try {
            await apiUploadDocument(draftId, item.file, 'other', item.file.name);
            updateFileStatus(item.id, 'uploaded');
          } catch {
            updateFileStatus(item.id, 'failed', 'Upload failed');
          }
        }

        created = await apiGetDeal(draftId);
      }

      onCreatedDeal?.(created);
      onSuccess(buildDealData(created.id), created);
      handleClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  };

  // ── render ──────────────────────────────────────────────────────────────────

  const dropzoneBase = 'border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all';
  const dropzoneIdle = isDragging
    ? 'border-blue-400 bg-blue-400/10'
    : 'border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800/30';

  const footer = (
    <div className="flex items-center justify-between w-full">
      <button
        onClick={handleClose}
        disabled={isSubmitting}
        className="px-4 py-2 text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        onClick={handleSubmit}
        disabled={!isFormValid()}
        className={`px-6 py-2 rounded-lg transition-all flex items-center gap-2 ${
          isFormValid()
            ? 'bg-blue-500 hover:bg-blue-600 text-white'
            : 'bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
        }`}
      >
        {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />}
        Create deal
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create deal"
      size="lg"
      darkMode={darkMode}
      footer={footer}
    >
      <div className="space-y-4">
        {/* Deal name */}
        <div>
          <label className="block text-sm text-zinc-300 mb-2">
            Deal name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={dealName}
            onChange={(e) => { setDealName(e.target.value); setDealNameError(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && isFormValid()) handleSubmit(); }}
            placeholder="e.g., CloudScale Seed Round"
            autoFocus
            className={`w-full px-4 py-2.5 bg-zinc-900/50 border ${
              dealNameError ? 'border-red-500/50' : 'border-zinc-700/50'
            } rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/20 transition-colors`}
          />
          {dealNameError && (
            <p className="text-red-400 text-xs mt-1.5">Deal name is required</p>
          )}
        </div>

        {/* Upload dropzone */}
        <div className="px-6 py-6">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`px-6 py-6 ${dropzoneBase} ${dropzoneIdle} ${uploadedFiles.length === 0 ? 'min-h-[140px]' : 'min-h-[72px]'}`}
          >
          <Upload
            className={`${uploadedFiles.length === 0 ? 'w-8 h-8 mb-3' : 'w-5 h-5 mb-1'} text-zinc-400`}
            strokeWidth={1.5}
          />
          {uploadedFiles.length === 0 ? (
            <>
              <p className="text-white mb-1">Drag &amp; drop a document</p>
              <p className="text-sm text-zinc-400">or choose a file</p>
              <p className="text-xs text-zinc-500 mt-2">PDF, PPTX, XLSX, DOCX</p>
            </>
          ) : (
            <p className="text-sm text-zinc-400">Add another file</p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            accept=".pdf,.pptx,.xlsx,.docx"
            multiple
            className="hidden"
          />
          </div>
        </div>

        {/* File list */}
        {uploadedFiles.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 p-3 bg-zinc-900/50 border border-zinc-700/50 rounded-lg"
          >
            <FileText className="flex-shrink-0 w-5 h-5 text-blue-400" strokeWidth={1.5} />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm truncate">{truncateFilename(item.file.name)}</p>
              <p className="text-xs text-zinc-500">{formatFileSize(item.file.size)}</p>
            </div>
            <div className="flex items-center gap-2">
              {item.status === 'pending' && (
                <span className="text-xs text-zinc-500">Ready</span>
              )}
              {item.status === 'uploading' && (
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" strokeWidth={1.5} />
              )}
              {item.status === 'uploaded' && (
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Check className="w-3 h-3 text-emerald-400" strokeWidth={2} />
                </div>
              )}
              {item.status === 'failed' && (
                <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center" title={item.error}>
                  <AlertCircle className="w-3 h-3 text-amber-400" strokeWidth={2} />
                </div>
              )}
              {item.status !== 'uploading' && (
                <button
                  onClick={() => handleRemoveFile(item.id)}
                  className="text-zinc-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Submit error */}
        {submitError && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertCircle className="flex-shrink-0 w-4 h-4 text-red-400 mt-0.5" strokeWidth={2} />
            <p className="text-sm text-red-300">{submitError}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}