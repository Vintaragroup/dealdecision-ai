import { useState } from 'react';
import { 
  X, 
  Save, 
  Download, 
  Undo, 
  Redo, 
  Eye,
  Sparkles,
  Type,
  Image as ImageIcon,
  Layout,
  Wand2,
  Plus,
  Trash2,
  Copy,
  ChevronLeft,
  ChevronRight,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Underline,
  Palette,
  Upload,
  Settings,
  Check
} from 'lucide-react';
import { Button } from './ui/button';
import { AITextGenerator } from './editor/AITextGenerator';
import { AIImageGenerator } from './editor/AIImageGenerator';
import { DealFormData } from './NewDealModal';

interface TemplateEditorProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
  templateName: string;
  dealData: DealFormData | null;
}

interface TextElement {
  id: string;
  type: 'text';
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: string;
  color: string;
  align: 'left' | 'center' | 'right';
}

interface ImageElement {
  id: string;
  type: 'image';
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ShapeElement {
  id: string;
  type: 'shape';
  shape: 'rectangle' | 'circle';
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke?: string;
}

type Element = TextElement | ImageElement | ShapeElement;

interface Slide {
  id: string;
  name: string;
  elements: Element[];
  background: string;
}

export function TemplateEditor({ isOpen, onClose, darkMode, templateName, dealData }: TemplateEditorProps) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [showAITextGenerator, setShowAITextGenerator] = useState(false);
  const [showAIImageGenerator, setShowAIImageGenerator] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'elements' | 'design' | 'ai'>('elements');

  // Initialize with sample slides based on template
  const [slides, setSlides] = useState<Slide[]>([
    {
      id: 'slide-1',
      name: 'Cover Slide',
      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      elements: [
        {
          id: 'el-1',
          type: 'text',
          content: dealData?.companyName || 'Your Company Name',
          x: 100,
          y: 200,
          width: 600,
          height: 80,
          fontSize: 48,
          fontWeight: 'bold',
          color: '#ffffff',
          align: 'center'
        },
        {
          id: 'el-2',
          type: 'text',
          content: 'Investor Pitch Deck',
          x: 100,
          y: 300,
          width: 600,
          height: 40,
          fontSize: 24,
          fontWeight: 'normal',
          color: '#ffffff',
          align: 'center'
        }
      ]
    },
    {
      id: 'slide-2',
      name: 'Problem',
      background: '#ffffff',
      elements: [
        {
          id: 'el-3',
          type: 'text',
          content: 'The Problem',
          x: 50,
          y: 50,
          width: 700,
          height: 60,
          fontSize: 36,
          fontWeight: 'bold',
          color: '#1f2937',
          align: 'left'
        },
        {
          id: 'el-4',
          type: 'text',
          content: 'Describe the pain point your target customers face. Make it relatable and quantifiable.',
          x: 50,
          y: 150,
          width: 700,
          height: 200,
          fontSize: 18,
          fontWeight: 'normal',
          color: '#4b5563',
          align: 'left'
        }
      ]
    },
    {
      id: 'slide-3',
      name: 'Solution',
      background: '#ffffff',
      elements: [
        {
          id: 'el-5',
          type: 'text',
          content: 'Our Solution',
          x: 50,
          y: 50,
          width: 700,
          height: 60,
          fontSize: 36,
          fontWeight: 'bold',
          color: '#1f2937',
          align: 'left'
        },
        {
          id: 'el-6',
          type: 'text',
          content: 'Explain how your product/service solves the problem.',
          x: 50,
          y: 150,
          width: 700,
          height: 200,
          fontSize: 18,
          fontWeight: 'normal',
          color: '#4b5563',
          align: 'left'
        }
      ]
    }
  ]);

  const currentSlide = slides[currentSlideIndex];
  const selectedEl = selectedElement 
    ? currentSlide.elements.find(el => el.id === selectedElement)
    : null;

  if (!isOpen) return null;

  const addTextElement = () => {
    const newElement: TextElement = {
      id: `el-${Date.now()}`,
      type: 'text',
      content: 'New text element',
      x: 100,
      y: 100,
      width: 400,
      height: 60,
      fontSize: 24,
      fontWeight: 'normal',
      color: '#1f2937',
      align: 'left'
    };

    setSlides(prev => prev.map((slide, idx) => 
      idx === currentSlideIndex
        ? { ...slide, elements: [...slide.elements, newElement] }
        : slide
    ));
    setSelectedElement(newElement.id);
  };

  const addImageElement = async () => {
    const newElement: ImageElement = {
      id: `el-${Date.now()}`,
      type: 'image',
      url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400',
      x: 100,
      y: 100,
      width: 300,
      height: 200
    };

    setSlides(prev => prev.map((slide, idx) => 
      idx === currentSlideIndex
        ? { ...slide, elements: [...slide.elements, newElement] }
        : slide
    ));
    setSelectedElement(newElement.id);
  };

  const addShape = (shape: 'rectangle' | 'circle') => {
    const newElement: ShapeElement = {
      id: `el-${Date.now()}`,
      type: 'shape',
      shape,
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      fill: '#6366f1'
    };

    setSlides(prev => prev.map((slide, idx) => 
      idx === currentSlideIndex
        ? { ...slide, elements: [...slide.elements, newElement] }
        : slide
    ));
    setSelectedElement(newElement.id);
  };

  const updateElement = (elementId: string, updates: Partial<Element>) => {
    setSlides(prev => prev.map((slide, idx) =>
      idx === currentSlideIndex
        ? {
            ...slide,
            elements: slide.elements.map(el =>
              el.id === elementId ? ({ ...el, ...updates } as Element) : el
            )
          }
        : slide
    ));
  };

  const deleteElement = (elementId: string) => {
    setSlides(prev => prev.map((slide, idx) =>
      idx === currentSlideIndex
        ? {
            ...slide,
            elements: slide.elements.filter(el => el.id !== elementId)
          }
        : slide
    ));
    setSelectedElement(null);
  };

  const duplicateElement = (elementId: string) => {
    const element = currentSlide.elements.find(el => el.id === elementId);
    if (element) {
      const newElement = {
        ...element,
        id: `el-${Date.now()}`,
        x: element.x + 20,
        y: element.y + 20
      };
      setSlides(prev => prev.map((slide, idx) =>
        idx === currentSlideIndex
          ? { ...slide, elements: [...slide.elements, newElement] }
          : slide
      ));
      setSelectedElement(newElement.id);
    }
  };

  const addSlide = () => {
    const newSlide: Slide = {
      id: `slide-${Date.now()}`,
      name: `Slide ${slides.length + 1}`,
      background: '#ffffff',
      elements: []
    };
    setSlides([...slides, newSlide]);
    setCurrentSlideIndex(slides.length);
  };

  const deleteSlide = (index: number) => {
    if (slides.length > 1) {
      setSlides(prev => prev.filter((_, idx) => idx !== index));
      if (currentSlideIndex >= slides.length - 1) {
        setCurrentSlideIndex(Math.max(0, slides.length - 2));
      }
    }
  };

  const handleAITextGenerate = (generatedText: string) => {
    if (selectedElement && selectedEl?.type === 'text') {
      updateElement(selectedElement, { content: generatedText });
    } else {
      // Create new text element with generated content
      const newElement: TextElement = {
        id: `el-${Date.now()}`,
        type: 'text',
        content: generatedText,
        x: 100,
        y: 100,
        width: 600,
        height: 150,
        fontSize: 18,
        fontWeight: 'normal',
        color: '#1f2937',
        align: 'left'
      };
      setSlides(prev => prev.map((slide, idx) => 
        idx === currentSlideIndex
          ? { ...slide, elements: [...slide.elements, newElement] }
          : slide
      ));
      setSelectedElement(newElement.id);
    }
    setShowAITextGenerator(false);
  };

  const handleAIImageGenerate = (imageUrl: string) => {
    if (selectedElement && selectedEl?.type === 'image') {
      updateElement(selectedElement, { url: imageUrl });
    } else {
      // Create new image element
      const newElement: ImageElement = {
        id: `el-${Date.now()}`,
        type: 'image',
        url: imageUrl,
        x: 100,
        y: 100,
        width: 400,
        height: 300
      };
      setSlides(prev => prev.map((slide, idx) => 
        idx === currentSlideIndex
          ? { ...slide, elements: [...slide.elements, newElement] }
          : slide
      ));
      setSelectedElement(newElement.id);
    }
    setShowAIImageGenerator(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Main Editor Area */}
      <div className={`flex-1 flex flex-col ${darkMode ? 'bg-[#18181b]' : 'bg-gray-100'}`}>
        {/* Top Toolbar */}
        <div className={`px-4 py-3 border-b flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <h2 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {templateName}
              </h2>
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                {dealData?.companyName || 'Untitled'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              icon={<Undo className="w-4 h-4" />}
            />
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              icon={<Redo className="w-4 h-4" />}
            />
            <div className="h-6 w-px bg-white/10 mx-2" />
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              icon={<Eye className="w-4 h-4" />}
            >
              Preview
            </Button>
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              icon={<Download className="w-4 h-4" />}
            >
              Export
            </Button>
            <Button
              variant="primary"
              size="sm"
              darkMode={darkMode}
              icon={<Save className="w-4 h-4" />}
            >
              Save
            </Button>
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Slide Thumbnails */}
          <div className={`w-48 border-r overflow-y-auto ${
            darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
          }`}>
            <div className="p-3 space-y-2">
              {slides.map((slide, index) => (
                <div key={slide.id}>
                  <button
                    onClick={() => setCurrentSlideIndex(index)}
                    className={`w-full aspect-video rounded-lg border-2 overflow-hidden transition-all relative group ${
                      currentSlideIndex === index
                        ? 'border-[#6366f1] ring-2 ring-[#6366f1]/30'
                        : darkMode
                          ? 'border-white/10 hover:border-white/20'
                          : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div 
                      className="w-full h-full flex items-center justify-center text-xs"
                      style={{ background: slide.background }}
                    >
                      <span className={`${
                        slide.background.includes('gradient') ? 'text-white' : 'text-gray-400'
                      }`}>
                        {index + 1}
                      </span>
                    </div>
                    {slides.length > 1 && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSlide(index);
                        }}
                        className={`absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                          darkMode ? 'bg-red-500/80 hover:bg-red-500' : 'bg-red-500/80 hover:bg-red-600'
                        }`}
                      >
                        <Trash2 className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>
                  <p className={`text-xs mt-1 text-center truncate ${
                    darkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {slide.name}
                  </p>
                </div>
              ))}
              <button
                onClick={addSlide}
                className={`w-full aspect-video rounded-lg border-2 border-dashed flex items-center justify-center transition-colors ${
                  darkMode
                    ? 'border-white/20 hover:border-white/40 hover:bg-white/5'
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <Plus className={`w-6 h-6 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
              </button>
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 flex items-center justify-center overflow-auto p-8">
            <div 
              className="relative shadow-2xl"
              style={{ 
                width: '800px', 
                height: '450px',
                background: currentSlide.background
              }}
              onClick={() => setSelectedElement(null)}
            >
              {currentSlide.elements.map((element) => (
                <div
                  key={element.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedElement(element.id);
                  }}
                  className={`absolute cursor-move ${
                    selectedElement === element.id ? 'ring-2 ring-[#6366f1]' : ''
                  }`}
                  style={{
                    left: element.x,
                    top: element.y,
                    width: element.width,
                    height: element.height
                  }}
                >
                  {element.type === 'text' && (
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => updateElement(element.id, { content: e.currentTarget.textContent || '' })}
                      style={{
                        fontSize: element.fontSize,
                        fontWeight: element.fontWeight,
                        color: element.color,
                        textAlign: element.align,
                        outline: 'none',
                        width: '100%',
                        height: '100%'
                      }}
                    >
                      {element.content}
                    </div>
                  )}
                  {element.type === 'image' && (
                    <img 
                      src={element.url} 
                      alt="" 
                      className="w-full h-full object-cover rounded"
                    />
                  )}
                  {element.type === 'shape' && (
                    <div
                      className={element.shape === 'circle' ? 'rounded-full' : 'rounded'}
                      style={{
                        width: '100%',
                        height: '100%',
                        backgroundColor: element.fill,
                        border: element.stroke ? `2px solid ${element.stroke}` : 'none'
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Navigation */}
        <div className={`px-4 py-3 border-t flex items-center justify-center gap-2 ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <Button
            variant="outline"
            size="sm"
            darkMode={darkMode}
            onClick={() => setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1))}
            disabled={currentSlideIndex === 0}
            icon={<ChevronLeft className="w-4 h-4" />}
          />
          <span className={`text-sm px-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {currentSlideIndex + 1} / {slides.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            darkMode={darkMode}
            onClick={() => setCurrentSlideIndex(Math.min(slides.length - 1, currentSlideIndex + 1))}
            disabled={currentSlideIndex === slides.length - 1}
            icon={<ChevronRight className="w-4 h-4" />}
          />
        </div>
      </div>

      {/* Right Sidebar */}
      <div className={`w-80 border-l flex flex-col ${
        darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
      }`}>
        {/* Sidebar Tabs */}
        <div className={`flex border-b ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            onClick={() => setSidebarTab('elements')}
            className={`flex-1 px-4 py-3 text-sm transition-colors ${
              sidebarTab === 'elements'
                ? darkMode
                  ? 'bg-[#6366f1] text-white'
                  : 'bg-[#6366f1] text-white'
                : darkMode
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Layout className="w-4 h-4 mx-auto mb-1" />
            Elements
          </button>
          <button
            onClick={() => setSidebarTab('design')}
            className={`flex-1 px-4 py-3 text-sm transition-colors ${
              sidebarTab === 'design'
                ? darkMode
                  ? 'bg-[#6366f1] text-white'
                  : 'bg-[#6366f1] text-white'
                : darkMode
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Palette className="w-4 h-4 mx-auto mb-1" />
            Design
          </button>
          <button
            onClick={() => setSidebarTab('ai')}
            className={`flex-1 px-4 py-3 text-sm transition-colors ${
              sidebarTab === 'ai'
                ? darkMode
                  ? 'bg-[#6366f1] text-white'
                  : 'bg-[#6366f1] text-white'
                : darkMode
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Sparkles className="w-4 h-4 mx-auto mb-1" />
            AI
          </button>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Elements Tab */}
          {sidebarTab === 'elements' && (
            <div className="space-y-4">
              <div>
                <h3 className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Add Elements
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={addTextElement}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      darkMode
                        ? 'border-white/10 hover:bg-white/5'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Type className="w-5 h-5 mb-1" />
                    <p className="text-xs">Text</p>
                  </button>
                  <button
                    onClick={addImageElement}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      darkMode
                        ? 'border-white/10 hover:bg-white/5'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <ImageIcon className="w-5 h-5 mb-1" />
                    <p className="text-xs">Image</p>
                  </button>
                  <button
                    onClick={() => addShape('rectangle')}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      darkMode
                        ? 'border-white/10 hover:bg-white/5'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="w-5 h-5 mb-1 bg-current rounded" />
                    <p className="text-xs">Rectangle</p>
                  </button>
                  <button
                    onClick={() => addShape('circle')}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      darkMode
                        ? 'border-white/10 hover:bg-white/5'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="w-5 h-5 mb-1 bg-current rounded-full" />
                    <p className="text-xs">Circle</p>
                  </button>
                </div>
              </div>

              {selectedEl && (
                <>
                  <div className="h-px bg-white/10" />
                  <div>
                    <h3 className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Selected Element
                    </h3>
                    
                    {selectedEl.type === 'text' && (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateElement(selectedEl.id, { 
                              fontWeight: selectedEl.fontWeight === 'bold' ? 'normal' : 'bold'
                            })}
                            className={`p-2 rounded transition-colors ${
                              selectedEl.fontWeight === 'bold'
                                ? 'bg-[#6366f1] text-white'
                                : darkMode
                                  ? 'bg-white/10 hover:bg-white/20'
                                  : 'bg-gray-100 hover:bg-gray-200'
                            }`}
                          >
                            <Bold className="w-4 h-4" />
                          </button>
                          <button className={`p-2 rounded transition-colors ${
                            darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'
                          }`}>
                            <Italic className="w-4 h-4" />
                          </button>
                          <button className={`p-2 rounded transition-colors ${
                            darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'
                          }`}>
                            <Underline className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex gap-2">
                          {(['left', 'center', 'right'] as const).map(align => (
                            <button
                              key={align}
                              onClick={() => updateElement(selectedEl.id, { align })}
                              className={`flex-1 p-2 rounded transition-colors ${
                                selectedEl.align === align
                                  ? 'bg-[#6366f1] text-white'
                                  : darkMode
                                    ? 'bg-white/10 hover:bg-white/20'
                                    : 'bg-gray-100 hover:bg-gray-200'
                              }`}
                            >
                              {align === 'left' && <AlignLeft className="w-4 h-4 mx-auto" />}
                              {align === 'center' && <AlignCenter className="w-4 h-4 mx-auto" />}
                              {align === 'right' && <AlignRight className="w-4 h-4 mx-auto" />}
                            </button>
                          ))}
                        </div>

                        <div>
                          <label className={`text-xs mb-1 block ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Font Size
                          </label>
                          <input
                            type="range"
                            min="12"
                            max="72"
                            value={selectedEl.fontSize}
                            onChange={(e) => updateElement(selectedEl.id, { fontSize: parseInt(e.target.value) })}
                            className="w-full"
                          />
                          <div className="text-xs text-center mt-1">{selectedEl.fontSize}px</div>
                        </div>

                        <div>
                          <label className={`text-xs mb-1 block ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Color
                          </label>
                          <input
                            type="color"
                            value={selectedEl.color}
                            onChange={(e) => updateElement(selectedEl.id, { color: e.target.value })}
                            className="w-full h-10 rounded cursor-pointer"
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        darkMode={darkMode}
                        onClick={() => selectedElement && duplicateElement(selectedElement)}
                        icon={<Copy className="w-4 h-4" />}
                      >
                        Duplicate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        darkMode={darkMode}
                        onClick={() => selectedElement && deleteElement(selectedElement)}
                        icon={<Trash2 className="w-4 h-4" />}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Design Tab */}
          {sidebarTab === 'design' && (
            <div className="space-y-4">
              <div>
                <h3 className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Slide Background
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { name: 'White', value: '#ffffff' },
                    { name: 'Light Gray', value: '#f3f4f6' },
                    { name: 'Dark Gray', value: '#1f2937' },
                    { name: 'Black', value: '#000000' },
                    { name: 'Blue Gradient', value: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)' },
                    { name: 'Purple Gradient', value: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' },
                    { name: 'Green Gradient', value: 'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)' },
                    { name: 'Orange Gradient', value: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)' }
                  ].map((bg) => (
                    <button
                      key={bg.name}
                      onClick={() => setSlides(prev => prev.map((slide, idx) =>
                        idx === currentSlideIndex ? { ...slide, background: bg.value } : slide
                      ))}
                      className={`aspect-video rounded-lg border-2 transition-all ${
                        currentSlide.background === bg.value
                          ? 'border-[#6366f1] ring-2 ring-[#6366f1]/30'
                          : darkMode
                            ? 'border-white/10 hover:border-white/20'
                            : 'border-gray-200 hover:border-gray-300'
                      }`}
                      style={{ background: bg.value }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AI Tab */}
          {sidebarTab === 'ai' && (
            <div className="space-y-3">
              <div className={`p-4 rounded-lg border ${
                darkMode ? 'bg-[#6366f1]/10 border-[#6366f1]/30' : 'bg-[#6366f1]/5 border-[#6366f1]/20'
              }`}>
                <Sparkles className="w-5 h-5 text-[#6366f1] mb-2" />
                <p className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Use AI to generate content, improve text, and create images for your slides.
                </p>
              </div>

              <button
                onClick={() => setShowAITextGenerator(true)}
                className={`w-full p-4 rounded-lg border text-left transition-colors ${
                  darkMode
                    ? 'border-white/10 hover:bg-white/5'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <Wand2 className="w-5 h-5 text-[#6366f1]" />
                  <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Generate Text
                  </h4>
                </div>
                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Create compelling copy for your slides using AI
                </p>
              </button>

              <button
                onClick={() => setShowAIImageGenerator(true)}
                className={`w-full p-4 rounded-lg border text-left transition-colors ${
                  darkMode
                    ? 'border-white/10 hover:bg-white/5'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <ImageIcon className="w-5 h-5 text-[#6366f1]" />
                  <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Find Images
                  </h4>
                </div>
                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Search for professional stock photos
                </p>
              </button>

              <button
                className={`w-full p-4 rounded-lg border text-left transition-colors ${
                  darkMode
                    ? 'border-white/10 hover:bg-white/5'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <Upload className="w-5 h-5 text-[#6366f1]" />
                  <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Upload Image
                  </h4>
                </div>
                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Upload your own images and graphics
                </p>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* AI Modals */}
      {showAITextGenerator && (
        <AITextGenerator
          isOpen={showAITextGenerator}
          onClose={() => setShowAITextGenerator(false)}
          onGenerate={handleAITextGenerate}
          darkMode={darkMode}
          dealData={dealData}
          currentText={selectedEl?.type === 'text' ? selectedEl.content : ''}
          slideContext={currentSlide.name}
        />
      )}

      {showAIImageGenerator && (
        <AIImageGenerator
          isOpen={showAIImageGenerator}
          onClose={() => setShowAIImageGenerator(false)}
          onSelect={handleAIImageGenerate}
          darkMode={darkMode}
          slideContext={currentSlide.name}
        />
      )}
    </div>
  );
}