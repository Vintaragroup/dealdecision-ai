import React, { useState, useRef } from 'react';
import { AlertCircle, CheckCircle, FileText, Upload, X, ChevronDown, ChevronUp } from 'lucide-react';
import { apiAnalyzeDocumentsBatch, apiBulkAssignDocuments, apiUploadDocument } from '../../lib/apiClient';
import { ToastContainer } from '../ui/Toast';
import { useLocalToasts } from '../../lib/useLocalToasts';

type DuplicatePolicy = 'skip' | 'replace' | 'keep_both';

type UploadFailure = {
  filename: string;
  reason: string;
  dealId: string;
  documentType: string;
};

type UploadTask = {
  filename: string;
  file: File;
  dealId: string;
  documentType: string;
};

interface DocumentBatchUploadProps {
  onClose: () => void;
  onSuccess?: (results: any) => void;
}

export function DocumentBatchUploadModal({ onClose, onSuccess }: DocumentBatchUploadProps) {
  const ACCEPTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.pptx', '.ppt', '.docx', '.doc', '.png', '.jpg', '.jpeg'];
  const MAX_FILE_SIZE_MB = 25;
  const BATCH_CONCURRENCY = 3;
  const MAX_UPLOAD_ATTEMPTS = 3;

  const { toasts, addToast, removeToast } = useLocalToasts();

  const [step, setStep] = useState<'select' | 'review'>('select');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [userConfirmation, setUserConfirmation] = useState<Record<string, 'confirm' | 'skip' | 'newdeal'>>({});
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>('skip');
  const [uploadProgress, setUploadProgress] = useState({ total: 0, completed: 0, succeeded: 0, failed: 0 });
  const [failedUploads, setFailedUploads] = useState<UploadFailure[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const invalid: string[] = [];
      const filtered = files.filter((file) => {
        const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
        const sizeMb = file.size / (1024 * 1024);
        const ok = ACCEPTED_EXTENSIONS.includes(ext) && sizeMb <= MAX_FILE_SIZE_MB;
        if (!ok) invalid.push(`${file.name} (${ext || 'unknown'}, ${Math.round(sizeMb)}MB)`);
        return ok;
      });
      if (invalid.length) {
        addToast(
          'warning',
          'Some files skipped',
          `Skipped ${invalid.length} file(s) due to type/size limits (max ${MAX_FILE_SIZE_MB}MB). First few: ${invalid.slice(0, 5).join('; ')}`
        );
      }
      setSelectedFiles(filtered);
      if (filtered.length) analyzeFiles(filtered);
    }
  };

  const analyzeFiles = async (files: File[]) => {
    setLoading(true);
    try {
      const filenames = files.map((f) => f.name);

      const data = await apiAnalyzeDocumentsBatch(filenames);
      setAnalysisResult(data.analysis);

      // Initialize user confirmations
      const confirmations: Record<string, 'confirm' | 'skip' | 'newdeal'> = {};
      data.analysis.groups.forEach((group: any) => {
        confirmations[group.company] = group.status === 'matched' ? 'confirm' : 'newdeal';
      });
      setUserConfirmation(confirmations);

      setStep('review');
      setFailedUploads([]);
      setUploadProgress({ total: 0, completed: 0, succeeded: 0, failed: 0 });
    } catch (error) {
      addToast('error', 'Analyze failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const toggleGroupExpanded = (company: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(company)) {
      newExpanded.delete(company);
    } else {
      newExpanded.add(company);
    }
    setExpandedGroups(newExpanded);
  };

  const handleConfirm = async (company: string, action: 'confirm' | 'skip' | 'newdeal') => {
    setUserConfirmation({ ...userConfirmation, [company]: action });
  };

  const isAllowedFile = (file: File) => {
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    const sizeMb = file.size / (1024 * 1024);
    return ACCEPTED_EXTENSIONS.includes(ext) && sizeMb <= MAX_FILE_SIZE_MB;
  };

  const uploadDocumentToDeal = async (file: File, dealId: string, documentType?: string) => {
    await apiUploadDocument(dealId, file, documentType || 'other', file.name, { duplicatePolicy });
  };

  const uploadWithRetry = async (task: UploadTask): Promise<{ ok: true } | { ok: false; reason: string }> => {
    let attempt = 0;
    while (attempt < MAX_UPLOAD_ATTEMPTS) {
      attempt += 1;
      try {
        await uploadDocumentToDeal(task.file, task.dealId, task.documentType);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'upload failed';
        if (attempt >= MAX_UPLOAD_ATTEMPTS) {
          return { ok: false, reason: message };
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    return { ok: false, reason: 'upload failed' };
  };

  const uploadTasksWithConcurrency = async (tasks: UploadTask[]) => {
    const failures: UploadFailure[] = [];
    let cursor = 0;

    setUploadProgress({ total: tasks.length, completed: 0, succeeded: 0, failed: 0 });

    const worker = async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        const result = await uploadWithRetry(task);
        setUploadProgress((prev) => ({
          ...prev,
          completed: prev.completed + 1,
          succeeded: prev.succeeded + (result.ok ? 1 : 0),
          failed: prev.failed + (result.ok ? 0 : 1),
        }));
        if (!result.ok) {
          failures.push({
            filename: task.filename,
            reason: result.reason,
            dealId: task.dealId,
            documentType: task.documentType,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, tasks.length) }, () => worker()));
    return failures;
  };

  const buildUploadTasks = (args: {
    groups: any[];
    selected: File[];
    createdDealIdsByName: Map<string, string>;
    onlyFailures?: UploadFailure[];
  }) => {
    const fileByName = new Map<string, File>();
    for (const f of args.selected) fileByName.set(f.name, f);

    const tasks: UploadTask[] = [];

    for (const group of args.groups) {
      const action = userConfirmation[group.company];
      if (action === 'skip') continue;

      const targetDealId = action === 'confirm'
        ? group.dealId
        : args.createdDealIdsByName.get(group.company);

      if (!targetDealId) {
        continue;
      }

      for (const filename of group.files || []) {
        const file = fileByName.get(filename);
        if (!file || !isAllowedFile(file)) continue;

        if (args.onlyFailures) {
          const failed = args.onlyFailures.some((f) => f.filename === filename && f.dealId === targetDealId);
          if (!failed) continue;
        }

        tasks.push({
          filename,
          file,
          dealId: targetDealId,
          documentType: group.documentType || 'other',
        });
      }
    }

    return tasks;
  };

  const handleUpload = async () => {
    setLoading(true);
    try {
      const assignments = analysisResult.groups
        .filter((group: any) => userConfirmation[group.company] === 'confirm' && group.dealId)
        .flatMap((group: any) =>
          (group.files || []).map((filename: string) => ({
            filename,
            dealId: group.dealId,
            type: group.documentType,
          }))
        );

      const newDeals = analysisResult.groups
        .filter((group: any) => userConfirmation[group.company] === 'newdeal' && !group.dealId)
        .map((group: any) => ({
          filename: (group.files || [])[0],
          dealName: group.company,
          type: group.documentType,
        }))
        .filter((d: any) => !!d.filename);

      const result = await apiBulkAssignDocuments({ assignments, newDeals });

      const createdDealIdsByName = new Map<string, string>();
      const responseAssignments: any[] = Array.isArray(result?.assignments) ? result.assignments : [];
      for (const row of responseAssignments) {
        if (row?.dealName && row?.dealId) {
          createdDealIdsByName.set(String(row.dealName), String(row.dealId));
        }
      }

      const tasks = buildUploadTasks({
        groups: analysisResult.groups,
        selected: selectedFiles,
        createdDealIdsByName,
      });

      if (!tasks.length) {
        addToast('warning', 'Nothing uploaded', 'No files were eligible for upload.');
        return;
      }

      const failures = await uploadTasksWithConcurrency(tasks);
      setFailedUploads(failures);

      if (failures.length > 0) {
        addToast(
          'error',
          'Upload incomplete',
          `Uploaded ${tasks.length - failures.length} file(s). Failures: ${failures.length}. You can retry failed files.`
        );
        return;
      }

      addToast('success', 'Upload complete', `Uploaded ${tasks.length} file(s).`);
      onSuccess?.(result);
      onClose();
    } catch (error) {
      addToast('error', 'Upload failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleRetryFailed = async () => {
    if (!analysisResult || failedUploads.length === 0) return;

    setLoading(true);
    try {
      const fileByName = new Map<string, File>();
      for (const file of selectedFiles) {
        fileByName.set(file.name, file);
      }

      const retryTasks: UploadTask[] = failedUploads
        .map((failed) => {
          const file = fileByName.get(failed.filename);
          if (!file || !isAllowedFile(file)) return null;
          return {
            filename: failed.filename,
            file,
            dealId: failed.dealId,
            documentType: failed.documentType || 'other',
          };
        })
        .filter((task): task is UploadTask => task !== null);

      const failures = await uploadTasksWithConcurrency(retryTasks);
      setFailedUploads(failures);

      if (failures.length > 0) {
        addToast(
          'error',
          'Retry incomplete',
          `${failures.length} file(s) still failing. First few: ${failures.slice(0, 5).map((f) => `${f.filename}: ${f.reason}`).join('; ')}`
        );
        return;
      }

      addToast('success', 'Retry complete', 'All failed files uploaded successfully.');
      onClose();
    } catch (error) {
      addToast('error', 'Retry failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const confirmedCount = analysisResult?.groups.filter((g: any) => userConfirmation[g.company] === 'confirm').length || 0;
  const newDealCount = analysisResult?.groups.filter((g: any) => userConfirmation[g.company] === 'newdeal').length || 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Batch Upload Documents</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition"
            aria-label="Close"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'select' && (
            <div className="space-y-4">
              <p className="text-slate-300">
                Select multiple documents. The system will automatically group them by company and match to existing deals.
              </p>

              <div
                className="border-2 border-dashed border-slate-600 rounded-lg p-12 text-center cursor-pointer hover:border-purple-500 hover:bg-slate-800/30 transition"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mx-auto mb-4 text-slate-400" size={48} />
                <p className="text-white font-medium mb-2">Drop files here or click to select</p>
                <p className="text-slate-400 text-sm">PDF, Excel, PowerPoint, Word, Images</p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                accept=".pdf,.xlsx,.xls,.pptx,.ppt,.docx,.doc,.png,.jpg,.jpeg"
              />

              {selectedFiles.length > 0 && (
                <div>
                  <p className="text-white font-medium mb-2">{selectedFiles.length} files selected</p>
                  <div className="bg-slate-800 rounded p-3 max-h-40 overflow-y-auto space-y-1">
                    {selectedFiles.map((file) => (
                      <p key={file.name} className="text-slate-300 text-sm flex items-center">
                        <FileText size={16} className="mr-2" />
                        {file.name}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'review' && analysisResult && (
            <div className="space-y-4">
              <div className="bg-slate-800 rounded-lg p-4 mb-4">
                <p className="text-white font-medium mb-2">Analysis Summary</p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center">
                    <FileText size={16} className="mr-2 text-blue-400" />
                    <span className="text-slate-300">{analysisResult.summary.totalFiles} files</span>
                  </div>
                  <div className="flex items-center">
                    <FileText size={16} className="mr-2 text-purple-400" />
                    <span className="text-slate-300">{analysisResult.summary.totalGroups} companies</span>
                  </div>
                  <div className="flex items-center">
                    <CheckCircle size={16} className="mr-2 text-green-400" />
                    <span className="text-slate-300">{analysisResult.summary.matched} matched to deals</span>
                  </div>
                  <div className="flex items-center">
                    <AlertCircle size={16} className="mr-2 text-yellow-400" />
                    <span className="text-slate-300">{analysisResult.summary.new} need new deals</span>
                  </div>
                </div>
              </div>

              {/* Document Groups */}
              <div className="space-y-3">
                {analysisResult.groups.map((group: any) => (
                  <div key={group.company} className="bg-slate-800 rounded-lg overflow-hidden">
                    {/* Group Header */}
                    <button
                      onClick={() => toggleGroupExpanded(group.company)}
                      className="w-full p-4 flex items-center justify-between hover:bg-slate-700/50 transition"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        {group.status === 'matched' ? (
                          <CheckCircle size={20} className="text-green-500" />
                        ) : (
                          <AlertCircle size={20} className="text-yellow-500" />
                        )}
                        <div className="text-left">
                          <p className="font-medium text-white">{group.company}</p>
                          <p className="text-sm text-slate-400">{group.fileCount} documents</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {group.dealName && <span className="text-sm bg-green-500/20 text-green-300 px-2 py-1 rounded">{group.dealName}</span>}
                        {expandedGroups.has(group.company) ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </div>
                    </button>

                    {/* Group Details */}
                    {expandedGroups.has(group.company) && (
                      <div className="border-t border-slate-700 p-4 bg-slate-900/50 space-y-4">
                        {/* Files List */}
                        <div>
                          <p className="text-sm font-medium text-slate-300 mb-2">Files in this group:</p>
                          <div className="space-y-1">
                            {group.files.map((file: string, idx: number) => (
                              <p key={idx} className="text-sm text-slate-400 flex items-center">
                                <FileText size={14} className="mr-2" />
                                {file}
                              </p>
                            ))}
                          </div>
                        </div>

                        {/* Duplicate Warning */}
                        {analysisResult.duplicates.some((d: any) => d.company === group.company) && (
                          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-sm text-yellow-300">
                            ⚠️ Multiple versions of the same document detected. Choose which to keep during confirmation.
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-2">
                          {group.dealName && (
                            <button
                              onClick={() => handleConfirm(group.company, 'confirm')}
                              className={`flex-1 py-2 px-3 rounded text-sm font-medium transition ${
                                userConfirmation[group.company] === 'confirm'
                                  ? 'bg-green-500 text-white'
                                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                              }`}
                            >
                              ✓ Add to {group.dealName}
                            </button>
                          )}

                          <button
                            onClick={() => handleConfirm(group.company, 'newdeal')}
                            className={`flex-1 py-2 px-3 rounded text-sm font-medium transition ${
                              userConfirmation[group.company] === 'newdeal'
                                ? 'bg-purple-500 text-white'
                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            }`}
                          >
                            + Create Deal
                          </button>

                          <button
                            onClick={() => handleConfirm(group.company, 'skip')}
                            className={`flex-1 py-2 px-3 rounded text-sm font-medium transition ${
                              userConfirmation[group.company] === 'skip'
                                ? 'bg-red-500 text-white'
                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            }`}
                          >
                            ✕ Skip
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Duplicate Groups Summary */}
              {analysisResult.duplicates.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <p className="text-yellow-300 font-medium mb-2">⚠️ Duplicate Documents Detected</p>
                  <ul className="text-sm text-yellow-200 space-y-1">
                    {analysisResult.duplicates.map((dup: any, idx: number) => (
                      <li key={idx}>
                        {dup.company}: {dup.files.length} versions found
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-yellow-300 mt-2">Expand groups above to review and choose versions to keep.</p>
                </div>
              )}

              <div className="bg-slate-800 rounded-lg p-4">
                <p className="text-white font-medium mb-2">Duplicate Handling Policy</p>
                <select
                  value={duplicatePolicy}
                  onChange={(e) => setDuplicatePolicy(e.target.value as DuplicatePolicy)}
                  className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  aria-label="Duplicate handling policy"
                >
                  <option value="skip">Skip duplicate files (safe default)</option>
                  <option value="replace">Replace existing duplicate files</option>
                  <option value="keep_both">Keep both versions</option>
                </select>
                <p className="mt-2 text-xs text-slate-400">
                  Duplicate detection uses deal and file content hash, with filename as secondary context.
                </p>
              </div>

              {uploadProgress.total > 0 && (
                <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                  <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                    <span>Upload progress</span>
                    <span>{uploadProgress.completed}/{uploadProgress.total}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-slate-700">
                    <div
                      className="h-full bg-green-500 transition-all"
                      style={{ width: `${uploadProgress.total ? (uploadProgress.completed / uploadProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    Success: {uploadProgress.succeeded} | Failed: {uploadProgress.failed} | Concurrency: {BATCH_CONCURRENCY} | Retries: {MAX_UPLOAD_ATTEMPTS - 1}
                  </p>
                </div>
              )}

              {failedUploads.length > 0 && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4">
                  <p className="mb-2 text-sm font-medium text-red-200">Failed uploads ({failedUploads.length})</p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-red-100">
                    {failedUploads.map((f, idx) => (
                      <li key={`${f.filename}-${idx}`}>
                        {f.filename}: {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-800 px-6 py-4 border-t border-slate-700 flex items-center justify-between">
          <button
            onClick={() => {
              if (step === 'review') {
                setStep('select');
                setSelectedFiles([]);
                setAnalysisResult(null);
              } else {
                onClose();
              }
            }}
            className="px-4 py-2 text-slate-300 hover:text-white transition"
          >
            {step === 'review' ? 'Back' : 'Cancel'}
          </button>

          {step === 'select' && (
            <button
              onClick={() => analyzeFiles(selectedFiles)}
              disabled={selectedFiles.length === 0 || loading}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition"
            >
              {loading ? 'Analyzing...' : 'Analyze Files'}
            </button>
          )}

          {step === 'review' && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400">
                {confirmedCount} confirmed, {newDealCount} new deals
              </span>
              {failedUploads.length > 0 && (
                <button
                  onClick={handleRetryFailed}
                  disabled={loading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition"
                >
                  {loading ? 'Retrying...' : `Retry Failed (${failedUploads.length})`}
                </button>
              )}
              <button
                onClick={handleUpload}
                disabled={confirmedCount + newDealCount === 0 || loading}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition"
              >
                {loading ? 'Uploading...' : 'Upload Documents'}
              </button>
            </div>
          )}
        </div>
      </div>

      <ToastContainer toasts={toasts} onClose={removeToast} darkMode={true} />
    </div>
  );
}
