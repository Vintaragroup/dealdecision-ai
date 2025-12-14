import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
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

interface DocumentLibraryProps {
  darkMode: boolean;
  documents?: Document[];
}

interface Document {
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
}

export function DocumentLibrary({ darkMode, documents: initialDocuments }: DocumentLibraryProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Mock documents
  const mockDocuments: Document[] = initialDocuments || [
    {
      id: '1',
      name: 'Series A Pitch Deck.pdf',
      type: 'application/pdf',
      category: 'Pitch Decks',
      size: 2500000,
      uploadedAt: new Date('2024-12-01'),
      uploadedBy: 'John Doe',
      tags: ['Series A', 'Investment', 'Pitch'],
      url: '#',
      aiExtracted: true,
      extractedData: { companyName: 'TechCo', fundingRound: 'Series A' }
    },
    {
      id: '2',
      name: 'Financial Model Q4 2024.xlsx',
      type: 'application/vnd.ms-excel',
      category: 'Financial Models',
      size: 1800000,
      uploadedAt: new Date('2024-11-28'),
      uploadedBy: 'Jane Smith',
      tags: ['Financial', 'Q4', '2024'],
      url: '#',
      aiExtracted: true,
      extractedData: { revenue: '$5M', growth: '120%' }
    },
    {
      id: '3',
      name: 'Term Sheet Draft.docx',
      type: 'application/msword',
      category: 'Legal',
      size: 450000,
      uploadedAt: new Date('2024-12-05'),
      uploadedBy: 'Mike Johnson',
      tags: ['Legal', 'Term Sheet', 'Draft'],
      url: '#',
      aiExtracted: false
    },
    {
      id: '4',
      name: 'Team Photo.jpg',
      type: 'image/jpeg',
      category: 'Media',
      size: 3200000,
      uploadedAt: new Date('2024-11-20'),
      uploadedBy: 'Sarah Lee',
      tags: ['Team', 'Photo'],
      url: '#',
      aiExtracted: false
    },
    {
      id: '5',
      name: 'Market Research Report.pdf',
      type: 'application/pdf',
      category: 'Research',
      size: 5600000,
      uploadedAt: new Date('2024-11-15'),
      uploadedBy: 'John Doe',
      tags: ['Market', 'Research', 'Analysis'],
      url: '#',
      aiExtracted: true,
      extractedData: { marketSize: '$50B', growth: '25% CAGR' }
    },
    {
      id: '6',
      name: 'Customer List.csv',
      type: 'text/csv',
      category: 'Data',
      size: 120000,
      uploadedAt: new Date('2024-12-07'),
      uploadedBy: 'Jane Smith',
      tags: ['Customers', 'Data'],
      url: '#',
      aiExtracted: true,
      extractedData: { totalCustomers: 145, activeCustomers: 132 }
    }
  ];

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

  const filteredDocuments = mockDocuments.filter(doc => {
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         doc.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || doc.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handlePreview = (doc: Document) => {
    setSelectedDocument(doc);
    setShowPreview(true);
  };

  const stats = {
    total: mockDocuments.length,
    aiProcessed: mockDocuments.filter(d => d.aiExtracted).length,
    totalSize: mockDocuments.reduce((sum, d) => sum + d.size, 0)
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
                <div className={`w-16 h-16 rounded-lg flex items-center justify-center mb-3 ${
                  darkMode ? 'bg-white/10' : 'bg-gray-100'
                }`}>
                  {getFileIcon(doc.type)}
                </div>

                <div className={`text-sm mb-2 truncate w-full ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {doc.name}
                </div>

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
                {getFileIcon(doc.type)}

                <div className="flex-1 min-w-0">
                  <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {doc.name}
                  </div>
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
        />
      )}
    </div>
  );
}
