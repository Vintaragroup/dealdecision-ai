import { useState } from 'react';
import { Button } from '../ui/Button';
import { Briefcase, FileText, DollarSign, Users, TrendingUp, Rocket, Upload, X } from 'lucide-react';
import { useUserRole } from '../../contexts/UserRoleContext';

interface FirstDealGuideProps {
  darkMode: boolean;
  onComplete: (dealData: DealData) => void;
  onSkip: () => void;
}

export interface DealData {
  companyName: string;
  stage: string;
  amount: string;
  industry: string;
  hasDocuments: boolean;
  uploadedFiles?: File[];
}

export function FirstDealGuide({ darkMode, onComplete, onSkip }: FirstDealGuideProps) {
  const { isFounder } = useUserRole();
  const [formData, setFormData] = useState<DealData>({
    companyName: '',
    stage: '',
    amount: '',
    industry: '',
    hasDocuments: false,
    uploadedFiles: []
  });
  const [dragActive, setDragActive] = useState(false);

  const stages = [
    { id: 'seed', label: 'Seed', icon: '🌱' },
    { id: 'seriesA', label: 'Series A', icon: '🚀' },
    { id: 'seriesB', label: 'Series B', icon: '📈' },
    { id: 'growth', label: 'Growth', icon: '💪' }
  ];

  const industries = [
    // SaaS & Cloud
    { id: 'b2b-saas', label: 'B2B SaaS', category: 'SaaS & Cloud' },
    { id: 'vertical-saas', label: 'Vertical SaaS', category: 'SaaS & Cloud' },
    { id: 'cloud-infra', label: 'Cloud Infrastructure', category: 'SaaS & Cloud' },
    { id: 'devtools', label: 'Developer Tools', category: 'SaaS & Cloud' },
    { id: 'api-infra', label: 'API/Infrastructure', category: 'SaaS & Cloud' },
    
    // FinTech
    { id: 'payments', label: 'Payments', category: 'FinTech' },
    { id: 'lending', label: 'Lending', category: 'FinTech' },
    { id: 'insurtech', label: 'InsurTech', category: 'FinTech' },
    { id: 'wealthtech', label: 'WealthTech', category: 'FinTech' },
    { id: 'crypto', label: 'Crypto/Blockchain', category: 'FinTech' },
    { id: 'banking', label: 'Digital Banking', category: 'FinTech' },
    
    // HealthTech
    { id: 'digital-health', label: 'Digital Health', category: 'HealthTech' },
    { id: 'biotech', label: 'BioTech', category: 'HealthTech' },
    { id: 'medtech', label: 'MedTech', category: 'HealthTech' },
    { id: 'telehealth', label: 'Telehealth', category: 'HealthTech' },
    { id: 'mental-health', label: 'Mental Health', category: 'HealthTech' },
    
    // Consumer
    { id: 'ecommerce', label: 'E-commerce', category: 'Consumer' },
    { id: 'marketplace', label: 'Marketplace', category: 'Consumer' },
    { id: 'd2c', label: 'D2C Brands', category: 'Consumer' },
    { id: 'consumer-apps', label: 'Consumer Apps', category: 'Consumer' },
    { id: 'social', label: 'Social/Community', category: 'Consumer' },
    { id: 'gaming', label: 'Gaming', category: 'Consumer' },
    
    // Enterprise
    { id: 'enterprise-software', label: 'Enterprise Software', category: 'Enterprise' },
    { id: 'productivity', label: 'Productivity', category: 'Enterprise' },
    { id: 'collaboration', label: 'Collaboration', category: 'Enterprise' },
    { id: 'hr-tech', label: 'HR Tech', category: 'Enterprise' },
    { id: 'sales-marketing', label: 'Sales & Marketing', category: 'Enterprise' },
    
    // AI/ML
    { id: 'ai-platform', label: 'AI/ML Platform', category: 'AI/ML' },
    { id: 'computer-vision', label: 'Computer Vision', category: 'AI/ML' },
    { id: 'nlp', label: 'NLP/Generative AI', category: 'AI/ML' },
    { id: 'ai-infrastructure', label: 'AI Infrastructure', category: 'AI/ML' },
    
    // Other
    { id: 'cybersecurity', label: 'Cybersecurity', category: 'Security' },
    { id: 'data-analytics', label: 'Data & Analytics', category: 'Data' },
    { id: 'iot', label: 'IoT/Hardware', category: 'Hardware' },
    { id: 'logistics', label: 'Logistics/Supply Chain', category: 'Operations' },
    { id: 'proptech', label: 'PropTech', category: 'Real Estate' },
    { id: 'edtech', label: 'EdTech', category: 'Education' },
    { id: 'climate', label: 'Climate Tech', category: 'Sustainability' },
    { id: 'other', label: 'Other', category: 'Other' }
  ];

  // Group industries by category for better display
  const industriesByCategory = industries.reduce((acc, industry) => {
    if (!acc[industry.category]) {
      acc[industry.category] = [];
    }
    acc[industry.category].push(industry);
    return acc;
  }, {} as Record<string, typeof industries>);

  const handleFileUpload = (files: FileList | null) => {
    if (files && files.length > 0) {
      const newFiles = Array.from(files);
      setFormData(prev => ({
        ...prev,
        uploadedFiles: [...(prev.uploadedFiles || []), ...newFiles],
        hasDocuments: true
      }));
    }
  };

  const removeFile = (index: number) => {
    setFormData(prev => ({
      ...prev,
      uploadedFiles: prev.uploadedFiles?.filter((_, i) => i !== index) || []
    }));
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const isValid = formData.companyName && formData.stage && formData.amount && formData.industry;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid) {
      onComplete(formData);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className={`relative max-w-2xl w-full rounded-2xl shadow-2xl overflow-hidden border my-8 ${ 
          darkMode ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="p-4 sm:p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                {isFounder ? <Rocket className="w-8 h-8 text-white" /> : <Briefcase className="w-8 h-8 text-white" />}
              </div>
              <h2 className={`text-2xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {isFounder ? 'Set up your company profile' : 'Create your first deal'}
              </h2>
              <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {isFounder 
                  ? 'Start building your pitch with your company details'
                  : 'Start analyzing with a real or sample deal'
                }
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Company Name */}
              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Company Name
                </label>
                <div className="relative">
                  {isFounder ? <Rocket className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`} /> : <Briefcase className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`} />}
                  <input
                    type="text"
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    placeholder={isFounder ? "e.g., Your Startup Name" : "e.g., CloudScale SaaS"}
                    className={`w-full pl-10 pr-4 py-2.5 rounded-lg border transition-all ${
                      darkMode
                        ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-[#6366f1]'
                        : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-[#6366f1]'
                    }`}
                  />
                </div>
              </div>

              {/* Stage Selection */}
              <div>
                <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Funding Stage
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {stages.map((stage) => (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, stage: stage.id })}
                      className={`p-4 rounded-lg border transition-all ${
                        formData.stage === stage.id
                          ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] border-[#6366f1] shadow-[0_0_20px_rgba(99,102,241,0.3)]'
                          : darkMode
                            ? 'bg-white/5 border-white/10 hover:bg-white/10'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <div className="text-2xl mb-2">{stage.icon}</div>
                      <div className={`text-xs ${
                        formData.stage === stage.id
                          ? 'text-white'
                          : darkMode ? 'text-white' : 'text-gray-900'
                      }`}>
                        {stage.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount & Industry */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {isFounder ? 'Funding Target' : 'Deal Amount'}
                  </label>
                  <div className="relative">
                    <DollarSign className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      darkMode ? 'text-gray-500' : 'text-gray-400'
                    }`} />
                    <input
                      type="text"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder={isFounder ? "e.g., $500K - $2M" : "e.g., $2M"}
                      className={`w-full pl-10 pr-4 py-2.5 rounded-lg border transition-all ${
                        darkMode
                          ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-[#6366f1]'
                          : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-[#6366f1]'
                      }`}
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Industry
                  </label>
                  <div className="relative">
                    <TrendingUp className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      darkMode ? 'text-gray-500' : 'text-gray-400'
                    }`} />
                    <select
                      value={formData.industry}
                      onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                      className={`w-full pl-10 pr-4 py-2.5 rounded-lg border transition-all appearance-none cursor-pointer ${
                        darkMode
                          ? 'bg-white/5 border-white/10 text-white focus:border-[#6366f1]'
                          : 'bg-white border-gray-200 text-gray-900 focus:border-[#6366f1]'
                      }`}
                    >
                      <option value="">Select industry</option>
                      {Object.keys(industriesByCategory).map(category => (
                        <optgroup key={category} label={category}>
                          {industriesByCategory[category].map((industry) => (
                            <option key={industry.id} value={industry.id}>
                              {industry.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Document Upload Section */}
              <div>
                <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {isFounder ? 'Upload Documents (Optional)' : 'Upload Deal Documents'}
                </label>
                
                {/* Drag & Drop Area */}
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  className={`relative p-6 rounded-lg border-2 border-dashed transition-all cursor-pointer ${
                    dragActive
                      ? 'border-[#6366f1] bg-[#6366f1]/10'
                      : darkMode
                        ? 'border-white/20 bg-white/5 hover:border-white/30'
                        : 'border-gray-300 bg-gray-50 hover:border-gray-400'
                  }`}
                  onClick={() => document.getElementById('file-upload-input')?.click()}
                >
                  <input
                    id="file-upload-input"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e.target.files)}
                  />
                  
                  <div className="flex flex-col items-center gap-3">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      darkMode ? 'bg-white/10' : 'bg-gray-200'
                    }`}>
                      <Upload className={`w-6 h-6 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                    </div>
                    
                    <div className="text-center">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        <span className="text-[#6366f1]">Click to upload</span> or drag and drop
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {isFounder 
                          ? 'Pitch deck, financials, business plan (PDF, DOC, XLS, PPT)'
                          : 'Pitch deck, financials, due diligence docs (PDF, DOC, XLS, PPT)'
                        }
                      </div>
                    </div>
                  </div>
                </div>

                {/* Uploaded Files List */}
                {formData.uploadedFiles && formData.uploadedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {formData.uploadedFiles.length} file{formData.uploadedFiles.length > 1 ? 's' : ''} uploaded
                    </div>
                    {formData.uploadedFiles.map((file, index) => (
                      <div
                        key={index}
                        className={`flex items-center gap-3 p-3 rounded-lg border ${
                          darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 ${
                          darkMode ? 'bg-white/10' : 'bg-gray-100'
                        }`}>
                          <FileText className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {file.name}
                          </div>
                          <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            {(file.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(index);
                          }}
                          className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                            darkMode 
                              ? 'hover:bg-red-500/20 text-red-400' 
                              : 'hover:bg-red-50 text-red-500'
                          }`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Info Box */}
              <div className={`p-4 rounded-lg border ${
                darkMode 
                  ? 'bg-[#6366f1]/5 border-[#6366f1]/20' 
                  : 'bg-[#6366f1]/5 border-[#6366f1]/20'
              }`}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      💡 Pro Tip
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {isFounder 
                        ? 'Don\'t have a pitch deck yet? No problem! Our AI Studio can help you create a compelling pitch from scratch.'
                        : 'Don\'t have documents yet? No problem! Our AI Studio can help you generate everything you need.'
                      }
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  type="button"
                  onClick={onSkip}
                  variant="outline"
                  className="flex-1"
                >
                  I'll do this later
                </Button>
                <Button
                  type="submit"
                  disabled={!isValid}
                  className="flex-1"
                >
                  {isFounder ? 'Create Profile' : 'Create Deal'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}