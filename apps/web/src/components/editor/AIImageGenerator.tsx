import { useState } from 'react';
import { X, Search, Check, Image as ImageIcon } from 'lucide-react';
import { Button } from '../ui/button';

interface AIImageGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageUrl: string) => void;
  darkMode: boolean;
  slideContext: string;
}

export function AIImageGenerator({ 
  isOpen, 
  onClose, 
  onSelect, 
  darkMode,
  slideContext 
}: AIImageGeneratorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [images, setImages] = useState<{ url: string; alt: string }[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearch = async () => {
    setSearching(true);
    
    // Simulate image search - in production, use Unsplash API
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const mockImages = [
      { url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800', alt: 'Business meeting' },
      { url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800', alt: 'Team collaboration' },
      { url: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800', alt: 'Strategy session' },
      { url: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800', alt: 'Office workspace' },
      { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800', alt: 'Data analytics' },
      { url: 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=800', alt: 'Business growth' },
      { url: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800', alt: 'Technology' },
      { url: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800', alt: 'Innovation' },
      { url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800', alt: 'Startup' },
      { url: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?w=800', alt: 'Professionals' },
      { url: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800', alt: 'Teamwork' },
      { url: 'https://images.unsplash.com/photo-1553484771-371a605b060b?w=800', alt: 'Leadership' }
    ];
    
    setImages(mockImages);
    setSearching(false);
  };

  const suggestedSearches = [
    'business team',
    'technology',
    'data analytics',
    'innovation',
    'growth chart',
    'office workspace',
    'professional handshake',
    'startup culture'
  ];

  const handleUseImage = () => {
    if (selectedImage) {
      onSelect(selectedImage);
    }
  };

  // Auto-suggest based on slide context
  const getContextualSuggestion = (context: string): string => {
    const suggestions: Record<string, string> = {
      'Cover Slide': 'technology innovation',
      'Problem': 'business challenge',
      'Solution': 'solution technology',
      'Market Opportunity': 'market growth',
      'Product Demo': 'product interface',
      'Team': 'business team professionals',
      'Traction': 'growth success',
      'Competition': 'competitive advantage'
    };
    return suggestions[context] || 'business professional';
  };

  return (
    <div 
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden ${
          darkMode ? 'bg-[#18181b]' : 'bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-lg flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Find Images
              </h2>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Search professional stock photos for: {slideContext}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className={`px-6 py-4 border-b ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={`Try "${getContextualSuggestion(slideContext)}"`}
                className={`w-full pl-10 pr-4 py-2 rounded-lg border text-sm ${
                  darkMode 
                    ? 'bg-[#27272a] border-white/10 text-white placeholder-gray-500' 
                    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>
            <Button
              variant="primary"
              darkMode={darkMode}
              onClick={handleSearch}
              loading={searching}
              icon={<Search className="w-4 h-4" />}
            >
              Search
            </Button>
          </div>

          {/* Suggested Searches */}
          <div className="flex flex-wrap gap-2 mt-3">
            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              Suggested:
            </span>
            {suggestedSearches.map((suggestion, i) => (
              <button
                key={i}
                onClick={() => {
                  setSearchQuery(suggestion);
                  handleSearch();
                }}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  darkMode
                    ? 'bg-white/10 hover:bg-white/20 text-gray-300'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {images.length === 0 ? (
            <div className={`h-full flex items-center justify-center text-center p-8 ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`}>
              <div>
                <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-sm mb-2">Search for professional stock photos</p>
                <p className="text-xs">
                  Try searching for &quot;{getContextualSuggestion(slideContext)}&quot;
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {images.map((image, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedImage(image.url)}
                  className={`aspect-video rounded-lg overflow-hidden border-2 transition-all relative group ${
                    selectedImage === image.url
                      ? 'border-[#6366f1] ring-2 ring-[#6366f1]/30'
                      : darkMode
                        ? 'border-white/10 hover:border-white/30'
                        : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <img 
                    src={image.url} 
                    alt={image.alt}
                    className="w-full h-full object-cover"
                  />
                  {selectedImage === image.url && (
                    <div className="absolute inset-0 bg-[#6366f1]/20 flex items-center justify-center">
                      <div className="w-8 h-8 bg-[#6366f1] rounded-full flex items-center justify-center">
                        <Check className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  )}
                  <div className={`absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity`}>
                    <p className="text-xs text-white truncate">{image.alt}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            Powered by Unsplash • {images.length > 0 && `${images.length} images found`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              darkMode={darkMode}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              darkMode={darkMode}
              onClick={handleUseImage}
              disabled={!selectedImage}
              icon={<Check className="w-4 h-4" />}
            >
              Use Image
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
