import { useState, useMemo } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { CircularProgress } from '../ui/CircularProgress';
import { Document, DocumentType, DocumentStatus, DOCUMENT_TYPE_INFO } from '../../types/documents';
import { mockDocuments } from '../../data/mockDocuments';
import {
  Search,
  Upload,
  Eye,
  Edit,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Clock,
  Pencil,
  Upload as UploadIcon,
  XCircle,
  Download,
  Trash2,
  MoreVertical
} from 'lucide-react';

interface DocumentsTableProps {
  dealId?: string;
  compact?: boolean;
  showDealColumn?: boolean;
  showStats?: boolean;
  allowBulk?: boolean;
  embedded?: boolean;
  darkMode?: boolean;
  onDocumentClick?: (doc: Document) => void;
}

export function DocumentsTable({
  dealId,
  compact = false,
  showDealColumn = false,
  showStats = true,
  allowBulk = false,
  embedded = false,
  darkMode = true,
  onDocumentClick
}: DocumentsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  // Filter documents based on dealId if provided
  const filteredDocuments = useMemo(() => {
    let docs = dealId 
      ? mockDocuments.filter(d => d.dealId === dealId)
      : mockDocuments;

    // Apply filters
    if (searchQuery) {
      docs = docs.filter(d => 
        d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        DOCUMENT_TYPE_INFO[d.type].label.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      docs = docs.filter(d => d.status === statusFilter);
    }

    if (typeFilter !== 'all') {
      docs = docs.filter(d => d.type === typeFilter);
    }

    return docs;
  }, [dealId, searchQuery, statusFilter, typeFilter]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = filteredDocuments.length;
    const complete = filteredDocuments.filter(d => d.status === 'complete').length;
    const avgScore = filteredDocuments
      .filter(d => d.score !== null)
      .reduce((sum, d) => sum + (d.score || 0), 0) / 
      filteredDocuments.filter(d => d.score !== null).length || 0;
    const totalSize = filteredDocuments
      .filter(d => d.fileSize)
      .reduce((sum, d) => {
        const size = parseFloat(d.fileSize?.replace(' MB', '') || '0');
        return sum + size;
      }, 0);

    return {
      total,
      complete,
      completionRate: (complete / total) * 100,
      avgScore: Math.round(avgScore),
      totalSize: totalSize.toFixed(1)
    };
  }, [filteredDocuments]);

  const getStatusBadge = (status: DocumentStatus) => {
    switch (status) {
      case 'complete':
        return {
          icon: <CheckCircle className="w-3 h-3" />,
          text: 'Complete',
          className: darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
        };
      case 'uploaded':
        return {
          icon: <UploadIcon className="w-3 h-3" />,
          text: 'Uploaded',
          className: darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700'
        };
      case 'draft':
        return {
          icon: <Pencil className="w-3 h-3" />,
          text: 'Draft',
          className: darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
        };
      case 'not_started':
        return {
          icon: <XCircle className="w-3 h-3" />,
          text: 'Not Started',
          className: darkMode ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-200 text-gray-600'
        };
    }
  };

  const getActionButtons = (doc: Document) => {
    switch (doc.status) {
      case 'not_started':
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" darkMode={darkMode} icon={<Upload className="w-3 h-3" />}>
              Upload
            </Button>
            <Button variant="ghost" size="sm" darkMode={darkMode} icon={<Sparkles className="w-3 h-3" />}>
              Generate
            </Button>
          </div>
        );
      case 'draft':
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" darkMode={darkMode} icon={<Edit className="w-3 h-3" />}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" darkMode={darkMode} icon={<Upload className="w-3 h-3" />}>
              Upload
            </Button>
          </div>
        );
      case 'uploaded':
      case 'complete':
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" darkMode={darkMode} icon={<Eye className="w-3 h-3" />}>
              View
            </Button>
            <Button variant="ghost" size="sm" darkMode={darkMode} icon={<Sparkles className="w-3 h-3" />}>
              Improve
            </Button>
            <button className={`p-1.5 rounded transition-colors ${
              darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
            }`}>
              <MoreVertical className={`w-3 h-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            </button>
          </div>
        );
    }
  };

  const toggleDocSelection = (docId: string) => {
    setSelectedDocs(prev =>
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedDocs.length === filteredDocuments.length) {
      setSelectedDocs([]);
    } else {
      setSelectedDocs(filteredDocuments.map(d => d.id));
    }
  };

  return (
    <div className={`${embedded ? '' : 'flex-1 overflow-auto'}`}>
      <div className={compact ? 'space-y-4' : 'p-6 space-y-6'}>
        {/* Stats Cards */}
        {showStats && (
          <div className="grid grid-cols-4 gap-4">
            <div className={`backdrop-blur-xl border rounded-xl p-4 ${
              darkMode
                ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
                : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <CircularProgress
                  value={stats.completionRate}
                  darkMode={darkMode}
                  size={60}
                  strokeWidth={6}
                  showValue={false}
                />
                <div className="text-right">
                  <div className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {stats.complete}/{stats.total}
                  </div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Complete
                  </div>
                </div>
              </div>
            </div>

            <div className={`backdrop-blur-xl border rounded-xl p-4 ${
              darkMode
                ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
                : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <Sparkles className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
              </div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {stats.avgScore}%
              </div>
              <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Avg Score
              </div>
            </div>

            <div className={`backdrop-blur-xl border rounded-xl p-4 ${
              darkMode
                ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
                : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <Clock className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
              </div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                2h ago
              </div>
              <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Last Updated
              </div>
            </div>

            <div className={`backdrop-blur-xl border rounded-xl p-4 ${
              darkMode
                ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
                : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <Download className={`w-5 h-5 ${darkMode ? 'text-[#6366f1]' : 'text-[#6366f1]'}`} />
              </div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {stats.totalSize} MB
              </div>
              <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Total Size
              </div>
            </div>
          </div>
        )}

        {/* AI Suggestions */}
        {!compact && (
          <div className={`backdrop-blur-xl border rounded-xl p-4 ${
            darkMode
              ? 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30'
              : 'bg-gradient-to-br from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
          }`}>
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-[#6366f1] mt-0.5" />
              <div className="flex-1">
                <h4 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  AI Recommendations
                </h4>
                <div className="flex items-center gap-3 text-xs">
                  <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                    • Generate Risk Register from existing documents
                  </span>
                  <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                    • Update Competitive Analysis with recent market data
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className={`backdrop-blur-xl border rounded-2xl ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          {/* Toolbar */}
          <div className="p-4 border-b border-white/5">
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Document Checklist
              </h3>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" darkMode={darkMode}>
                  Templates
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  darkMode={darkMode}
                  icon={<Upload className="w-4 h-4" />}
                >
                  Upload Multiple
                </Button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Input
                  placeholder="Search documents..."
                  leftIcon={<Search className="w-4 h-4" />}
                  darkMode={darkMode}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <Select
                darkMode={darkMode}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Status' },
                  { value: 'complete', label: 'Complete' },
                  { value: 'uploaded', label: 'Uploaded' },
                  { value: 'draft', label: 'Draft' },
                  { value: 'not_started', label: 'Not Started' }
                ]}
              />

              <Select
                darkMode={darkMode}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'executive', label: 'Executive Summary' },
                  { value: 'pitch', label: 'Pitch Deck' },
                  { value: 'financial', label: 'Financial Model' },
                  { value: 'market', label: 'Market Analysis' },
                  { value: 'competitive', label: 'Competitive' },
                  { value: 'business', label: 'Business Plan' },
                  { value: 'team', label: 'Team Overview' },
                  { value: 'risk', label: 'Risk Register' }
                ]}
              />
            </div>

            {/* Bulk Actions */}
            {allowBulk && selectedDocs.length > 0 && (
              <div className={`mt-3 p-3 rounded-lg border flex items-center justify-between ${
                darkMode
                  ? 'bg-[#6366f1]/10 border-[#6366f1]/30'
                  : 'bg-[#6366f1]/5 border-[#6366f1]/20'
              }`}>
                <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {selectedDocs.length} document{selectedDocs.length > 1 ? 's' : ''} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" darkMode={darkMode}>
                    Analyze All
                  </Button>
                  <Button variant="ghost" size="sm" darkMode={darkMode}>
                    Download
                  </Button>
                  <Button variant="ghost" size="sm" darkMode={darkMode}>
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Drag & Drop Zone */}
          <div
            className={`m-4 border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragActive
                ? darkMode
                  ? 'border-[#6366f1] bg-[#6366f1]/10'
                  : 'border-[#6366f1] bg-[#6366f1]/5'
                : darkMode
                  ? 'border-white/10 hover:border-white/20'
                  : 'border-gray-200 hover:border-gray-300'
            }`}
            onDragEnter={() => setDragActive(true)}
            onDragLeave={() => setDragActive(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
          >
            <Upload className={`w-8 h-8 mx-auto mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            <p className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Drag & drop files here or click to browse
            </p>
            <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              PDF, DOCX, XLSX, PPT up to 50MB
            </p>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`border-b ${darkMode ? 'border-white/5' : 'border-gray-200'}`}>
                  {allowBulk && (
                    <th className="p-4 text-left">
                      <input
                        type="checkbox"
                        checked={selectedDocs.length === filteredDocuments.length}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </th>
                  )}
                  <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Document Type
                  </th>
                  {showDealColumn && (
                    <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Deal
                    </th>
                  )}
                  <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Status
                  </th>
                  <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Score
                  </th>
                  <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    File Info
                  </th>
                  <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Last Modified
                  </th>
                  <th className={`p-4 text-left text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc) => {
                  const statusBadge = getStatusBadge(doc.status);
                  const typeInfo = DOCUMENT_TYPE_INFO[doc.type];

                  return (
                    <tr
                      key={doc.id}
                      className={`border-b transition-colors ${
                        darkMode
                          ? 'border-white/5 hover:bg-white/5'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {allowBulk && (
                        <td className="p-4">
                          <input
                            type="checkbox"
                            checked={selectedDocs.includes(doc.id)}
                            onChange={() => toggleDocSelection(doc.id)}
                            className="rounded"
                          />
                        </td>
                      )}
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${
                            darkMode ? 'bg-white/10' : 'bg-gray-100'
                          }`}>
                            {typeInfo.icon}
                          </div>
                          <div>
                            <div className={`text-sm mb-0.5 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {typeInfo.label}
                            </div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              {doc.name}
                            </div>
                          </div>
                        </div>
                      </td>
                      {showDealColumn && (
                        <td className="p-4">
                          <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {doc.dealName}
                          </span>
                        </td>
                      )}
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${statusBadge.className}`}>
                          {statusBadge.icon}
                          {statusBadge.text}
                        </span>
                      </td>
                      <td className="p-4">
                        {doc.score !== null ? (
                          <div className="flex items-center gap-2">
                            <div className={`flex-1 max-w-[80px] h-2 rounded-full overflow-hidden ${
                              darkMode ? 'bg-white/10' : 'bg-gray-200'
                            }`}>
                              <div
                                className={`h-full ${
                                  doc.score >= 80
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                                    : doc.score >= 60
                                      ? 'bg-gradient-to-r from-blue-500 to-cyan-500'
                                      : 'bg-gradient-to-r from-amber-500 to-orange-500'
                                }`}
                                style={{ width: `${doc.score}%` }}
                              />
                            </div>
                            <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {doc.score}%
                            </span>
                          </div>
                        ) : (
                          <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>—</span>
                        )}
                      </td>
                      <td className="p-4">
                        {doc.fileSize ? (
                          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            <div>{doc.fileSize}</div>
                            <div>{doc.pages} pages{doc.version && ` • ${doc.version}`}</div>
                          </div>
                        ) : (
                          <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>—</span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className={`text-xs flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <Clock className="w-3 h-3" />
                          {doc.lastModified}
                        </div>
                      </td>
                      <td className="p-4">
                        {getActionButtons(doc)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Empty State */}
          {filteredDocuments.length === 0 && (
            <div className="p-12 text-center">
              <Upload className={`w-12 h-12 mx-auto mb-3 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
              <h3 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                No documents found
              </h3>
              <p className={`text-xs mb-4 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                Upload files or generate with AI to get started
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button variant="primary" size="sm" darkMode={darkMode} icon={<Upload className="w-4 h-4" />}>
                  Upload Files
                </Button>
                <Button variant="secondary" size="sm" darkMode={darkMode} icon={<Sparkles className="w-4 h-4" />}>
                  Generate with AI
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
