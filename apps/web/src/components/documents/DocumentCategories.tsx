import { 
  FileText, 
  Image, 
  FileSpreadsheet,
  Scale,
  Target,
  TrendingUp,
  Users,
  Briefcase
} from 'lucide-react';

interface DocumentCategoriesProps {
  darkMode: boolean;
  onCategorySelect?: (category: string) => void;
  selectedCategory?: string;
}

export function DocumentCategories({ 
  darkMode, 
  onCategorySelect,
  selectedCategory = 'all' 
}: DocumentCategoriesProps) {
  const categories = [
    { id: 'all', name: 'All Documents', icon: FileText, count: 24, color: '#6366f1' },
    { id: 'pitch-decks', name: 'Pitch Decks', icon: Briefcase, count: 5, color: '#3b82f6' },
    { id: 'financial', name: 'Financial Models', icon: TrendingUp, count: 7, color: '#10b981' },
    { id: 'legal', name: 'Legal', icon: Scale, count: 4, color: '#f59e0b' },
    { id: 'research', name: 'Market Research', icon: Target, count: 3, color: '#8b5cf6' },
    { id: 'team', name: 'Team & HR', icon: Users, count: 2, color: '#ec4899' },
    { id: 'media', name: 'Media & Assets', icon: Image, count: 3, color: '#06b6d4' }
  ];

  return (
    <div className="grid grid-cols-7 gap-3">
      {categories.map((category) => {
        const Icon = category.icon;
        const isSelected = selectedCategory === category.id;
        
        return (
          <button
            key={category.id}
            onClick={() => onCategorySelect?.(category.id)}
            className={`p-4 rounded-xl border transition-all hover:scale-[1.02] ${
              isSelected
                ? darkMode
                  ? 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20 border-[#6366f1]/40'
                  : 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/40'
                : darkMode
                ? 'bg-white/5 border-white/10 hover:border-white/20'
                : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-center">
              <div 
                className={`w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-2 ${
                  isSelected
                    ? `bg-[${category.color}]`
                    : darkMode
                    ? 'bg-white/10'
                    : 'bg-gray-100'
                }`}
                style={isSelected ? { backgroundColor: category.color + '30' } : {}}
              >
                <Icon 
                  className="w-5 h-5" 
                  style={{ color: isSelected ? category.color : darkMode ? '#fff' : '#666' }}
                />
              </div>
              <div className={`text-xs mb-1 ${
                darkMode ? 'text-white' : 'text-gray-900'
              }`}>
                {category.name}
              </div>
              <div className={`text-xs ${
                isSelected
                  ? 'text-[#6366f1]'
                  : darkMode
                  ? 'text-gray-500'
                  : 'text-gray-600'
              }`}>
                {category.count}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
