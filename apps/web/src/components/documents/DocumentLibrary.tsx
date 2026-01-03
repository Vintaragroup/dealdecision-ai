import { useMemo, useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { 
  Search, 
  Filter, 
  FileText, 
  Image, 
  FileSpreadsheet,
  File,
  Download,
  Eye,
  Trash2,
  Calendar,
  Tag,
  Sparkles,
  FolderOpen,
  Grid3x3,
  List,
  SortAsc
} from 'lucide-react';
import type { Document as ApiDocument } from '@dealdecision/contracts';
import { apiDeleteDocument, isLiveBackend } from '../../lib/apiClient';

interface DocumentLibraryProps {
  darkMode: boolean;
  dealId?: string;
  documents?: ApiDocument[];
  loading?: boolean;
  onRetry?: (documentId: string) => void;
  onDeleted?: () => void;
}

export function DocumentLibrary({ darkMode, dealId, documents: initialDocuments, loading, onRetry, onDeleted }: DocumentLibraryProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedDocument, setSelectedDocument] = useState<LibraryDoc | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  type LibraryDoc = {
    id: string;
    name: string;
    type: string;
    category: string;
    size: number;
    uploadedAt: Date;
    uploadedBy: string;
    tags: string[];
    url: string;
    aiExtracted: boolean;
    extractedData?: any;
    status?: string;
  };

  const documents: LibraryDoc[] = useMemo(() => {
    if (initialDocuments && initialDocuments.length > 0) {
      return initialDocuments.map((doc) => ({
        id: doc.document_id,
        name: doc.title || 'Document',
        type: doc.type,
        category: doc.type,
        size: 0,
        uploadedAt: doc.uploaded_at ? new Date(doc.uploaded_at) : new Date(),
        uploadedBy: 'System',
        tags: [],
        url: '#',
        aiExtracted: false,
        status: doc.status,
      }));
    }
    return []; // Return empty instead of mock data
  }, [initialDocuments]);

  const categories = ['all', 'Pitch Decks', 'Financial Models', 'Legal', 'Media', 'Research', 'Data'];

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return <FileText className="w-6 h-6 text-red-500" />;
    if (type.includes('word') || type.includes('document')) return <FileText className="w-6 h-6 text-blue-500" />;
    if (type.includes('excel') || type.includes('spreadsheet') || type.includes('csv')) return <FileSpreadsheet className="w-6 h-6 text-emerald-500" />;
    if (type.includes('image')) return <Image className="w-6 h-6 text-purple-500" />;
    return <File className="w-6 h-6 text-gray-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    }).format(date);
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         doc.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || doc.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handlePreview = (doc: LibraryDoc) => {
    setSelectedDocument(doc);
    setShowPreview(true);
  };

  const toggleSelected = (documentId: string) => {
    setSelectedDocumentIds((prev) => (prev.includes(documentId) ? prev.filter((id) => id !== documentId) : [...prev, documentId]));
  };

  const requestDelete = (documentIds: string[]) => {
    if (!isLiveBackend()) return;
    if (!dealId) return;
    if (documentIds.length === 0) return;
    setDeleteTargets(documentIds);
  };

  const confirmDelete = async () => {
    if (!deleteTargets || deleteTargets.length === 0) return;
    if (!dealId || !isLiveBackend()) return;
    setDeleting(true);
    try {
      for (const documentId of deleteTargets) {
        await apiDeleteDocument(dealId, documentId);
      }
      setDeleteTargets(null);
      setSelectedDocumentIds([]);
      setShowPreview(false);
      setSelectedDocument(null);
      onDeleted?.();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const stats = {
    total: documents.length,
    aiProcessed: documents.filter(d => d.aiExtracted).length,
    totalSize: documents.reduce((sum, d) => sum + d.size, 0)
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div
          className={`p-4 rounded-xl ${
            darkMode
              ? 'bg-white/5 border border-white/10'
              : 'bg-white border border-gray-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <FolderOpen className="w-5 h-5 text-[#6366f1]" />
            <div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {stats.total}
              </div>
              <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Total Documents
              </div>
            </div>
          </div>
        </div>

        <div
          className={`p-4 rounded-xl ${
            darkMode
              ? 'bg-white/5 border border-white/10'
              : 'bg-white border border-gray-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-purple-500" />
            <div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {stats.aiProcessed}
              </div>
              <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                AI Processed
              </div>
            </div>
          </div>
        </div>

        <div
          className={`p-4 rounded-xl ${
            darkMode
              ? 'bg-white/5 border border-white/10'
              : 'bg-white border border-gray-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-emerald-500" />
            <div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {formatFileSize(stats.totalSize)}
              </div>
              <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Total Storage
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            darkMode={darkMode}
          />
        </div>

        <div className="flex items-center gap-2">
          {selectedDocumentIds.length > 0 && (
            <button
              onClick={() => requestDelete(selectedDocumentIds)}
              className={`px-3 py-2 rounded-lg text-sm transition-colors text-red-500 ${
                darkMode ? 'bg-red-500/10 hover:bg-red-500/20' : 'bg-red-50 hover:bg-red-100'
              }`}
              title={`Delete ${selectedDocumentIds.length} document${selectedDocumentIds.length === 1 ? '' : 's'}`}
            >
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Delete ({selectedDocumentIds.length})
              </div>
            </button>
          )}
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'grid'
                ? 'bg-[#6366f1] text-white'
                : darkMode
                ? 'text-gray-400 hover:bg-white/10'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Grid3x3 className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'list'
                ? 'bg-[#6366f1] text-white'
                : darkMode
                ? 'text-gray-400 hover:bg-white/10'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <List className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
              selectedCategory === category
                ? 'bg-[#6366f1] text-white'
                : darkMode
                ? 'bg-white/5 text-gray-400 hover:bg-white/10'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {category.charAt(0).toUpperCase() + category.slice(1)}
          </button>
        ))}
      </div>

      {/* Documents Grid/List */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-4 gap-4">
          {filteredDocuments.map((doc) => (
            <div
              key={doc.id}
              className={`p-4 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${
                darkMode
                  ? 'bg-white/5 border-white/10 hover:border-[#6366f1]/50'
                  : 'bg-white border-gray-200 hover:border-[#6366f1]/50'
              }`}
              onClick={() => handlePreview(doc)}
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-full flex justify-end mb-1">
                  <input
                    type="checkbox"
                    checked={selectedDocumentIds.includes(doc.id)}
                    onChange={() => toggleSelected(doc.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className={`w-16 h-16 rounded-lg flex items-center justify-center mb-3 ${
                  darkMode ? 'bg-white/10' : 'bg-gray-100'
                }`}>
                  {getFileIcon(doc.type)}
                </div>

                <div className={`text-sm mb-2 truncate w-full ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {doc.name}
                </div>

                {doc.status && (
                  <div className={`px-2 py-1 rounded-full text-[11px] mb-2 border ${
                    doc.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : doc.status === 'processing' || doc.status === 'pending'
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                        : 'bg-red-500/10 text-red-300 border-red-500/30'
                  }`}>
                    {doc.status}
                  </div>
                )}

                <div className={`text-xs mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                  {formatFileSize(doc.size)}
                </div>

                {doc.aiExtracted && (
                  <div className={`px-2 py-1 rounded-full text-xs flex items-center gap-1 mb-2 ${
                    darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700'
                  }`}>
                    <Sparkles className="w-3 h-3" />
                    AI Extracted
                  </div>
                )}

                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreview(doc);
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${
                      darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry?.(doc.id);
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${
                      darkMode ? 'hover:bg-white/10 text-amber-300' : 'hover:bg-gray-100 text-amber-600'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                  <button
                    className={`p-1.5 rounded-lg transition-colors ${
                      darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    className={`p-1.5 rounded-lg transition-colors text-red-500 ${
                      darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestDelete([doc.id]);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredDocuments.map((doc) => (
            <div
              key={doc.id}
              className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                darkMode
                  ? 'bg-white/5 border-white/10 hover:bg-white/10'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => handlePreview(doc)}
            >
              <div className="flex items-center gap-4">
                <input
                  type="checkbox"
                  checked={selectedDocumentIds.includes(doc.id)}
                  onChange={() => toggleSelected(doc.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                {getFileIcon(doc.type)}

                <div className="flex-1 min-w-0">
                  <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {doc.name}
                  </div>
                  {doc.status && (
                    <div className={`px-2 py-0.5 inline-flex items-center rounded-full text-[11px] mb-1 border ${
                      doc.status === 'completed'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : doc.status === 'processing' || doc.status === 'pending'
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                          : 'bg-red-500/10 text-red-300 border-red-500/30'
                    }`}>
                      {doc.status}
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-xs">
                    <span className={darkMode ? 'text-gray-500' : 'text-gray-600'}>
                      {formatFileSize(doc.size)}
                    </span>
                    <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
                    <span className={darkMode ? 'text-gray-500' : 'text-gray-600'}>
                      {formatDate(doc.uploadedAt)}
                    </span>
                    <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
                    <span className={darkMode ? 'text-gray-500' : 'text-gray-600'}>
                      {doc.uploadedBy}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {doc.aiExtracted && (
                    <div className={`px-2 py-1 rounded-full text-xs flex items-center gap-1 ${
                      darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700'
                    }`}>
                      <Sparkles className="w-3 h-3" />
                      AI Extracted
                    </div>
                  )}

                  <div className={`px-2 py-1 rounded text-xs ${
                    darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {doc.category}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreview(doc);
                    }}
                    className={`p-2 rounded-lg transition-colors ${
                      darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry?.(doc.id);
                    }}
                    className={`p-2 rounded-lg transition-colors ${
                      darkMode ? 'hover:bg-white/10 text-amber-300' : 'hover:bg-gray-100 text-amber-600'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                  <button
                    className={`p-2 rounded-lg transition-colors ${
                      darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    className={`p-2 rounded-lg transition-colors text-red-500 ${
                      darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestDelete([doc.id]);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Tags */}
              {doc.tags.length > 0 && (
                <div className="flex items-center gap-2 mt-3">
                  <Tag className={`w-3 h-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                  {doc.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`px-2 py-0.5 rounded text-xs ${
                        darkMode ? 'bg-white/5 text-gray-400' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && selectedDocument && (
        <DocumentPreviewModal
          document={selectedDocument}
          darkMode={darkMode}
          onClose={() => setShowPreview(false)}
          onRequestDelete={() => requestDelete([selectedDocument.id])}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteTargets && (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          style={{ zIndex: 1000 }}
          onMouseDown={() => (deleting ? undefined : setDeleteTargets(null))}
        >
          <div className="min-h-screen flex items-center justify-center p-4">
            <div
              className={`w-full max-w-md rounded-xl border p-4 ${
                darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
              }`}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className={`text-base mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Delete {deleteTargets.length === 1 ? 'document' : 'documents'}?
              </div>
              <div className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                This will permanently remove {deleteTargets.length === 1 ? 'this document' : `these ${deleteTargets.length} documents`}.
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  darkMode={darkMode}
                  onClick={() => setDeleteTargets(null)}
                >
                  Cancel
                </Button>
                <button
                  disabled={deleting}
                  onClick={confirmDelete}
                  className={`px-3 py-2 rounded-lg text-sm text-white ${
                    deleting ? 'opacity-60' : ''
                  } bg-red-600`}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
