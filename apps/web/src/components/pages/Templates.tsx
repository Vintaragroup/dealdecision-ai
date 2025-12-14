import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ReportPreview } from '../report-templates/ReportPreview';
import { PitchDeckPreview } from '../template-previews/PitchDeckPreview';
import { ExecutiveSummaryPreview } from '../template-previews/ExecutiveSummaryPreview';
import { FinancialModelPreview } from '../template-previews/FinancialModelPreview';
import { TermSheetPreview } from '../template-previews/TermSheetPreview';
import { OnePagerPreview } from '../template-previews/OnePagerPreview';
import { templateRegistry } from '../report-templates/TemplateRegistry';
import { useUserRole } from '../../contexts/UserRoleContext';
import { 
  FileText, 
  Search, 
  Download, 
  Eye, 
  Star,
  Sparkles,
  TrendingUp,
  Users,
  Shield,
  Lightbulb,
  Target,
  DollarSign,
  Calendar,
  CheckCircle,
  Copy,
  Plus,
  Code,
  Map,
  Rocket,
  AlertTriangle,
  BarChart3,
  Briefcase,
  ClipboardCheck
} from 'lucide-react';

interface TemplatesProps {
  darkMode: boolean;
}

interface Template {
  id: string;
  name: string;
  category: 'pitch' | 'financial' | 'legal' | 'research' | 'due-diligence' | 'investment' | 'portfolio' | 'reports';
  description: string;
  icon: React.ReactNode;
  downloads: number;
  rating: number;
  popular: boolean;
  aiGenerated?: boolean;
}

export function Templates({ darkMode }: TemplatesProps) {
  const { isFounder } = useUserRole();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  const handlePreview = (template: Template) => {
    console.log('Preview clicked for:', template.name);
    setSelectedTemplate(template);
    setShowReportPreview(true);
  };

  const founderTemplates: Template[] = [
    {
      id: '1',
      name: 'Investor Pitch Deck',
      category: 'pitch',
      description: 'Professional pitch deck template with 15 slides covering problem, solution, market, traction, and ask.',
      icon: <TrendingUp className="w-5 h-5" />,
      downloads: 2847,
      rating: 4.9,
      popular: true,
      aiGenerated: true
    },
    {
      id: '2',
      name: 'Executive Summary',
      category: 'pitch',
      description: '2-page executive summary template designed to capture investor attention in under 5 minutes.',
      icon: <FileText className="w-5 h-5" />,
      downloads: 1923,
      rating: 4.8,
      popular: true
    },
    {
      id: '3',
      name: 'Financial Model (3-Year)',
      category: 'financial',
      description: 'Comprehensive financial projection model with revenue, expenses, cash flow, and key metrics.',
      icon: <DollarSign className="w-5 h-5" />,
      downloads: 1654,
      rating: 4.7,
      popular: true,
      aiGenerated: true
    },
    {
      id: '7',
      name: 'One-Pager',
      category: 'pitch',
      description: 'Concise one-page overview perfect for initial investor outreach and networking events.',
      icon: <FileText className="w-5 h-5" />,
      downloads: 2156,
      rating: 4.7,
      popular: true
    },
    {
      id: '8',
      name: 'Business Plan',
      category: 'pitch',
      description: 'Full business plan template with market analysis, go-to-market strategy, and financial projections.',
      icon: <Lightbulb className="w-5 h-5" />,
      downloads: 843,
      rating: 4.5,
      popular: false
    },
    {
      id: '5',
      name: 'Market Research Report',
      category: 'research',
      description: 'Structured template for TAM/SAM/SOM analysis, competitive landscape, and market trends.',
      icon: <Target className="w-5 h-5" />,
      downloads: 1289,
      rating: 4.6,
      popular: false,
      aiGenerated: true
    },
    {
      id: '6',
      name: 'Term Sheet Template',
      category: 'legal',
      description: 'Standard term sheet covering valuation, equity, board seats, liquidation preferences, and more.',
      icon: <Shield className="w-5 h-5" />,
      downloads: 987,
      rating: 4.8,
      popular: false
    },
    {
      id: '9',
      name: 'Cap Table Template',
      category: 'financial',
      description: 'Equity tracking spreadsheet with dilution scenarios and option pool management.',
      icon: <Users className="w-5 h-5" />,
      downloads: 765,
      rating: 4.6,
      popular: false
    },
    {
      id: '10',
      name: 'Investor Update Email',
      category: 'pitch',
      description: 'Monthly investor update template covering metrics, wins, challenges, and asks.',
      icon: <Calendar className="w-5 h-5" />,
      downloads: 1543,
      rating: 4.8,
      popular: false,
      aiGenerated: true
    },
    {
      id: '11',
      name: 'Product Roadmap',
      category: 'pitch',
      description: 'Visual product roadmap template to showcase your development timeline and priorities.',
      icon: <Map className="w-5 h-5" />,
      downloads: 982,
      rating: 4.7,
      popular: false
    }
  ];

  const investorTemplates: Template[] = [
    {
      id: 'inv-1',
      name: 'Due Diligence Report',
      category: 'due-diligence',
      description: 'Comprehensive DD report template covering financial, legal, technical, and market analysis.',
      icon: <ClipboardCheck className="w-5 h-5" />,
      downloads: 2341,
      rating: 4.9,
      popular: true,
      aiGenerated: true
    },
    {
      id: 'inv-2',
      name: 'Investment Memo',
      category: 'investment',
      description: 'Professional investment memo template for presenting deal opportunities to your team.',
      icon: <Briefcase className="w-5 h-5" />,
      downloads: 2156,
      rating: 4.8,
      popular: true,
      aiGenerated: true
    },
    {
      id: 'inv-3',
      name: 'IC Presentation',
      category: 'investment',
      description: 'Investment Committee presentation template with deal highlights, risks, and recommendation.',
      icon: <TrendingUp className="w-5 h-5" />,
      downloads: 1923,
      rating: 4.9,
      popular: true
    },
    {
      id: 'inv-4',
      name: 'Due Diligence Checklist',
      category: 'due-diligence',
      description: 'Complete checklist covering legal, financial, technical, and market due diligence items.',
      icon: <CheckCircle className="w-5 h-5" />,
      downloads: 1876,
      rating: 4.9,
      popular: false
    },
    {
      id: 'inv-5',
      name: 'Deal Evaluation Framework',
      category: 'investment',
      description: 'Structured framework for assessing deals with scoring criteria and decision matrices.',
      icon: <Target className="w-5 h-5" />,
      downloads: 1654,
      rating: 4.7,
      popular: false,
      aiGenerated: true
    },
    {
      id: 'inv-6',
      name: 'Risk Assessment Report',
      category: 'due-diligence',
      description: 'Template for identifying, analyzing, and quantifying investment risks across categories.',
      icon: <AlertTriangle className="w-5 h-5" />,
      downloads: 1432,
      rating: 4.6,
      popular: false
    },
    {
      id: 'inv-7',
      name: 'Market Analysis Report',
      category: 'research',
      description: 'Deep-dive market analysis template with TAM/SAM/SOM, competitors, and trends.',
      icon: <BarChart3 className="w-5 h-5" />,
      downloads: 1289,
      rating: 4.8,
      popular: false,
      aiGenerated: true
    },
    {
      id: 'inv-8',
      name: 'Portfolio Company Review',
      category: 'portfolio',
      description: 'Quarterly portfolio company performance review template with KPIs and insights.',
      icon: <Calendar className="w-5 h-5" />,
      downloads: 1156,
      rating: 4.7,
      popular: false
    },
    {
      id: 'inv-9',
      name: 'Term Sheet Analysis',
      category: 'legal',
      description: 'Template for analyzing and comparing term sheet provisions and negotiation points.',
      icon: <Shield className="w-5 h-5" />,
      downloads: 987,
      rating: 4.8,
      popular: false
    },
    {
      id: 'inv-10',
      name: 'Deal Flow Report',
      category: 'reports',
      description: 'Monthly deal flow summary template with pipeline metrics and conversion analysis.',
      icon: <FileText className="w-5 h-5" />,
      downloads: 843,
      rating: 4.6,
      popular: false,
      aiGenerated: true
    }
  ];

  const templates = isFounder ? founderTemplates : investorTemplates;

  const categories = isFounder
    ? [
        { id: 'all', label: 'All Templates', count: templates.length },
        { id: 'pitch', label: 'Pitch Materials', count: templates.filter(t => t.category === 'pitch').length },
        { id: 'financial', label: 'Financial', count: templates.filter(t => t.category === 'financial').length },
        { id: 'legal', label: 'Legal', count: templates.filter(t => t.category === 'legal').length },
        { id: 'research', label: 'Research', count: templates.filter(t => t.category === 'research').length }
      ]
    : [
        { id: 'all', label: 'All Templates', count: templates.length },
        { id: 'due-diligence', label: 'Due Diligence', count: templates.filter(t => t.category === 'due-diligence').length },
        { id: 'investment', label: 'Investment Analysis', count: templates.filter(t => t.category === 'investment').length },
        { id: 'portfolio', label: 'Portfolio Management', count: templates.filter(t => t.category === 'portfolio').length },
        { id: 'legal', label: 'Legal', count: templates.filter(t => t.category === 'legal').length },
        { id: 'research', label: 'Market Research', count: templates.filter(t => t.category === 'research').length },
        { id: 'reports', label: 'Reports', count: templates.filter(t => t.category === 'reports').length }
      ];

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const popularTemplates = templates.filter(t => t.popular);

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
            : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
        }`}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className={`text-2xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Document Templates
              </h1>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {isFounder 
                  ? 'Professional templates to accelerate your fundraising journey'
                  : 'Professional templates to streamline your investment analysis and due diligence'
                }
              </p>
            </div>
            <Button
              variant="primary"
              darkMode={darkMode}
              icon={<Plus className="w-4 h-4" />}
            >
              Custom Template
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`} />
            <Input
              darkMode={darkMode}
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12"
            />
          </div>
        </div>

        {/* Popular Templates */}
        {searchQuery === '' && selectedCategory === 'all' && (
          <>
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Most Popular
                </h2>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {popularTemplates.map((template) => (
                  <div
                    key={template.id}
                    className={`p-5 rounded-xl border transition-all hover:scale-[1.02] cursor-pointer ${
                      darkMode
                        ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/10 hover:border-[#6366f1]/50'
                        : 'bg-white/80 border-gray-200/50 hover:border-[#6366f1]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                        darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
                      }`}>
                        {template.icon}
                      </div>
                      {template.aiGenerated && (
                        <div className={`px-2 py-1 rounded-full text-xs flex items-center gap-1 ${
                          darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700'
                        }`}>
                          <Sparkles className="w-3 h-3" />
                          AI
                        </div>
                      )}
                    </div>
                    <h3 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {template.name}
                    </h3>
                    <p className={`text-xs mb-4 line-clamp-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {template.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                          <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {template.rating}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Download className={`w-3 h-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                          <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {template.downloads.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePreview(template);
                          }}
                          className={`p-1.5 rounded-lg transition-colors ${
                          darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                        }`}>
                          <Eye className="w-4 h-4" />
                        </button>
                        <button className={`p-1.5 rounded-lg transition-colors ${
                          darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                        }`}>
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Report Section Templates */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {isFounder ? 'AI-Powered Document Sections' : 'AI-Powered Report Sections'}
                </h2>
                <span className={`px-2 py-1 rounded-full text-xs ${
                  darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700'
                }`}>
                  {templateRegistry.length} Available
                </span>
              </div>
              <div className="grid grid-cols-4 gap-4">
                {templateRegistry.slice(0, 8).map((template) => (
                  <div
                    key={template.id}
                    className={`p-4 rounded-xl border transition-all hover:scale-[1.02] cursor-pointer ${
                      darkMode
                        ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/10 hover:border-purple-500/30'
                        : 'bg-white/80 border-gray-200/50 hover:border-purple-500/30'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                      darkMode ? 'bg-purple-500/20' : 'bg-purple-100'
                    }`}>
                      <FileText className="w-5 h-5 text-purple-500" />
                    </div>
                    <h3 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {template.name}
                    </h3>
                    <p className={`text-xs line-clamp-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {template.description}
                    </p>
                    <div className={`mt-3 px-2 py-1 rounded text-xs inline-block ${
                      template.category === 'essential' ? 'bg-blue-500/20 text-blue-400' :
                      template.category === 'financial' ? 'bg-emerald-500/20 text-emerald-400' :
                      template.category === 'strategic' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-purple-500/20 text-purple-400'
                    }`}>
                      {template.category}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Categories & All Templates */}
        <div className="grid grid-cols-4 gap-6">
          {/* Categories Sidebar */}
          <div className={`backdrop-blur-xl border rounded-2xl p-4 h-fit ${
            darkMode
              ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
              : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
          }`}>
            <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Categories
            </h3>
            <div className="space-y-1">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedCategory === category.id
                      ? darkMode
                        ? 'bg-[#6366f1]/20 text-white'
                        : 'bg-[#6366f1]/10 text-gray-900'
                      : darkMode
                        ? 'text-gray-400 hover:bg-white/5'
                        : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span>{category.label}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    selectedCategory === category.id
                      ? darkMode
                        ? 'bg-[#6366f1]/30 text-white'
                        : 'bg-[#6366f1]/20 text-gray-900'
                      : darkMode
                        ? 'bg-white/10 text-gray-500'
                        : 'bg-gray-200 text-gray-600'
                  }`}>
                    {category.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Templates Grid */}
          <div className="col-span-3">
            <div className="mb-4 flex items-center justify-between">
              <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {selectedCategory === 'all' ? 'All Templates' : categories.find(c => c.id === selectedCategory)?.label}
              </h2>
              <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {filteredTemplates.length} templates
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className={`p-5 rounded-xl border transition-all hover:scale-[1.02] cursor-pointer ${
                    darkMode
                      ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/10 hover:border-[#6366f1]/50'
                      : 'bg-white/80 border-gray-200/50 hover:border-[#6366f1]/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                      darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
                    }`}>
                      {template.icon}
                    </div>
                    <div className="flex items-center gap-2">
                      {template.popular && (
                        <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                      )}
                      {template.aiGenerated && (
                        <div className={`px-2 py-1 rounded-full text-xs flex items-center gap-1 ${
                          darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700'
                        }`}>
                          <Sparkles className="w-3 h-3" />
                          AI
                        </div>
                      )}
                    </div>
                  </div>
                  <h3 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {template.name}
                  </h3>
                  <p className={`text-xs mb-4 line-clamp-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {template.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {template.rating}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Download className={`w-3 h-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {template.downloads.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePreview(template);
                        }}
                        className={`p-1.5 rounded-lg transition-colors ${
                        darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                      }`}>
                        <Eye className="w-4 h-4" />
                      </button>
                      <button className={`p-1.5 rounded-lg transition-colors ${
                        darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                      }`}>
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {filteredTemplates.length === 0 && (
              <div className={`text-center py-12 ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}>
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No templates found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Template Preview Modals */}
      {showReportPreview && selectedTemplate && (
        <>
          {selectedTemplate.name === 'Investor Pitch Deck' && (
            <PitchDeckPreview
              isOpen={showReportPreview}
              onClose={() => setShowReportPreview(false)}
              darkMode={darkMode}
              templateName={selectedTemplate.name}
            />
          )}
          
          {selectedTemplate.name === 'Executive Summary' && (
            <ExecutiveSummaryPreview
              isOpen={showReportPreview}
              onClose={() => setShowReportPreview(false)}
              darkMode={darkMode}
              templateName={selectedTemplate.name}
            />
          )}

          {selectedTemplate.name === 'Financial Model (3-Year)' && (
            <FinancialModelPreview
              isOpen={showReportPreview}
              onClose={() => setShowReportPreview(false)}
              darkMode={darkMode}
              templateName={selectedTemplate.name}
            />
          )}

          {selectedTemplate.name === 'Term Sheet Template' && (
            <TermSheetPreview
              isOpen={showReportPreview}
              onClose={() => setShowReportPreview(false)}
              darkMode={darkMode}
              templateName={selectedTemplate.name}
            />
          )}

          {selectedTemplate.name === 'One-Pager' && (
            <OnePagerPreview
              isOpen={showReportPreview}
              onClose={() => setShowReportPreview(false)}
              darkMode={darkMode}
              templateName={selectedTemplate.name}
            />
          )}

          {/* For remaining templates, use the report preview */}
          {!['Investor Pitch Deck', 'Executive Summary', 'Financial Model (3-Year)', 'Term Sheet Template', 'One-Pager'].includes(selectedTemplate.name) && (
            <ReportPreview
              isOpen={showReportPreview}
              onClose={() => setShowReportPreview(false)}
              darkMode={darkMode}
              dealName={selectedTemplate.name}
              selectedSections={[
                'executive-summary',
                'go-no-go',
                'roi-summary',
                'market-analysis',
                'financial-analysis',
                'team-assessment',
                'key-findings',
                'ai-confidence-scores',
                'competitive-landscape',
                'traction-metrics',
                'product-technical-assessment',
                'risk-map',
                'verification-checklist',
                'deal-terms-summary'
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}