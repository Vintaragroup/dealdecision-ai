import { Logo } from './Logo';
import { useState } from 'react';

type LogoVariant = 'orbiting' | 'pulse' | 'network' | 'hexagon' | 'morph';

const variants: { name: string; variant: LogoVariant; description: string }[] = [
  { 
    name: 'Orbiting Particles', 
    variant: 'orbiting', 
    description: 'Particles orbit around a core, representing AI processing and collaboration'
  },
  { 
    name: 'Pulse Chart', 
    variant: 'pulse', 
    description: 'Animated bars representing data analysis and growth metrics'
  },
  { 
    name: 'Neural Network', 
    variant: 'network', 
    description: 'Connected nodes lighting up sequentially, showing AI decision pathways'
  },
  { 
    name: 'Smart Hexagon', 
    variant: 'hexagon', 
    description: 'Layered hexagons rotating independently, modern tech aesthetic'
  },
  { 
    name: 'Morphing Shape', 
    variant: 'morph', 
    description: 'Shape transforms continuously, representing adaptability'
  }
];

interface LogoShowcaseProps {
  darkMode: boolean;
  onSelect: (variant: LogoVariant) => void;
}

export function LogoShowcase({ darkMode, onSelect }: LogoShowcaseProps) {
  const [selected, setSelected] = useState<LogoVariant>('network');

  const handleSelect = (variant: LogoVariant) => {
    setSelected(variant);
    onSelect(variant);
  };

  return (
    <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
      darkMode
        ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
        : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
    }`}>
      <h2 className={`mb-6 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        Choose Your Logo
      </h2>
      
      <div className="grid grid-cols-5 gap-4">
        {variants.map((item) => (
          <button
            key={item.variant}
            onClick={() => handleSelect(item.variant)}
            className={`p-6 rounded-xl transition-all cursor-pointer border ${
              selected === item.variant
                ? 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20 border-[#6366f1]/30 shadow-[0_0_20px_rgba(99,102,241,0.2)]'
                : darkMode
                  ? 'bg-white/5 border-white/10 hover:bg-white/10'
                  : 'bg-white/80 border-gray-200 hover:bg-gray-100/80'
            }`}
          >
            <div className="flex flex-col items-center gap-3">
              <div className={`w-16 h-16 rounded-xl flex items-center justify-center ${
                darkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50'
              }`}>
                <Logo variant={item.variant} size={32} />
              </div>
              <div className="text-center">
                <div className={`text-sm mb-1 ${
                  darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  {item.name}
                </div>
                <div className={`text-xs ${
                  darkMode ? 'text-gray-500' : 'text-gray-600'
                }`}>
                  {item.description}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
