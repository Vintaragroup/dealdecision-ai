import React, { useState, useRef } from 'react';
import { AlertCircle, CheckCircle, FileText, Upload, X, ChevronDown, ChevronUp } from 'lucide-react';
import { apiAnalyzeDocumentsBatch, apiBulkAssignDocuments, apiUploadDocument, isLiveBackend } from '../../lib/apiClient';

interface DocumentBatchUploadProps {
  onClose: () => void;
  onSuccess?: (results: any) => void;
}

export function DocumentBatchUploadModal({ onClose, onSuccess }: DocumentBatchUploadProps) {
  const [step, setStep] = useState<'select' | 'review' | 'confirm'>('select');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [userConfirmation, setUserConfirmation] = useState<Record<string, 'confirm' | 'skip' | 'newdeal'>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setSelectedFiles(files);
      analyzeFiles(files);
    }
  };

  const analyzeFiles = async (files: File[]) => {
    setLoading(true);
    try {
      const filenames = files.map((f) => f.name);

      if (!isLiveBackend()) {
        throw new Error('Batch upload requires live backend');
      }

      const data = await apiAnalyzeDocumentsBatch(filenames);
      setAnalysisResult(data.analysis);

      // Initialize user confirmations
      const confirmations: Record<string, 'confirm' | 'skip' | 'newdeal'> = {};
      data.analysis.groups.forEach((group: any) => {
        confirmations[group.company] = group.status === 'matched' ? 'confirm' : 'newdeal';
      });
      setUserConfirmation(confirmations);

      setStep('review');
    } catch (error) {
      alert(`Error analyzing files: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  const handleUpload = async () => {
    setLoading(true);
    try {
      if (!isLiveBackend()) {
        throw new Error('Batch upload requires live backend');
      }

      // Build assignments based on user confirmations
      // NOTE: We only send one "newDeals" entry per company to avoid duplicate deal creation.
      // We still upload all files in the group after we resolve the target deal id.
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
          // Keep a representative filename so the backend can echo back a row for this group
          filename: (group.files || [])[0],
          dealName: group.company,
          type: group.documentType,
        }))
        .filter((d: any) => !!d.filename);

      const result = await apiBulkAssignDocuments({ assignments, newDeals });

      // Resolve deal ids for any newly created/reused deals from the bulk-assign response.
      // The backend returns { assignments: [{ filename, dealId, dealName, status, ... }, ...] }
      const createdDealIdsByName = new Map<string, string>();
      const responseAssignments: any[] = Array.isArray(result?.assignments) ? result.assignments : [];
      for (const row of responseAssignments) {
        if (row?.dealName && row?.dealId) {
          createdDealIdsByName.set(String(row.dealName), String(row.dealId));
        }
      }

      // Index selected files by filename for quick lookup
      const fileByName = new Map<string, File>();
      for (const f of selectedFiles) fileByName.set(f.name, f);

      // Upload every file in each group to its resolved deal
      for (const group of analysisResult.groups) {
        const action = userConfirmation[group.company];
        if (action === 'skip') continue;

        const targetDealId = action === 'confirm'
          ? group.dealId
          : createdDealIdsByName.get(group.company);

        if (!targetDealId) {
          throw new Error(`Could not resolve deal id for group "${group.company}"`);
        }

        for (const filename of group.files || []) {
          const file = fileByName.get(filename);
          if (!file) continue;
          await uploadDocumentToDeal(file, targetDealId, group.documentType);
        }
      }

      onSuccess?.(result);
      onClose();
    } catch (error) {
      alert(`Error uploading documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadDocumentToDeal = async (file: File, dealId: string, documentType?: string) => {
    await apiUploadDocument(dealId, file, documentType || 'other', file.name);
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
    </div>
  );
}
