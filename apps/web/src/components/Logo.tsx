import { useState } from 'react';

type LogoVariant = 'orbiting' | 'pulse' | 'network' | 'hexagon' | 'morph';

interface LogoProps {
  variant?: LogoVariant;
  size?: number;
}

// Orbiting Particles Logo
function OrbitingLogo({ size = 24 }: { size: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        
        {/* Center core */}
        <circle cx="12" cy="12" r="2.5" fill="url(#logoGradient)" className="animate-pulse" />
        
        {/* Orbiting particle 1 */}
        <circle cx="12" cy="12" r="1.5" fill="#6366f1" className="origin-center">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cx"
            values="12;19;12;5;12"
            dur="3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cy"
            values="5;12;19;12;5"
            dur="3s"
            repeatCount="indefinite"
          />
        </circle>
        
        {/* Orbiting particle 2 */}
        <circle cx="12" cy="12" r="1.5" fill="#8b5cf6" className="origin-center">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="120 12 12"
            to="480 12 12"
            dur="3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cx"
            values="12;5;12;19;12"
            dur="3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cy"
            values="5;12;19;12;5"
            dur="3s"
            repeatCount="indefinite"
          />
        </circle>
        
        {/* Orbiting particle 3 */}
        <circle cx="12" cy="12" r="1.5" fill="#a78bfa" className="origin-center">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="240 12 12"
            to="600 12 12"
            dur="3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cx"
            values="12;19;12;5;12"
            dur="3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cy"
            values="19;12;5;12;19"
            dur="3s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </div>
  );
}

// Pulse Chart Logo
function PulseLogo({ size = 24 }: { size: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id="pulseGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        
        {/* Bar 1 */}
        <rect x="3" y="14" width="3" height="6" rx="1.5" fill="url(#pulseGradient)">
          <animate
            attributeName="height"
            values="6;12;6"
            dur="1.5s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y"
            values="14;8;14"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </rect>
        
        {/* Bar 2 */}
        <rect x="8" y="10" width="3" height="10" rx="1.5" fill="url(#pulseGradient)">
          <animate
            attributeName="height"
            values="10;16;10"
            dur="1.5s"
            begin="0.2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y"
            values="10;4;10"
            dur="1.5s"
            begin="0.2s"
            repeatCount="indefinite"
          />
        </rect>
        
        {/* Bar 3 */}
        <rect x="13" y="6" width="3" height="14" rx="1.5" fill="url(#pulseGradient)">
          <animate
            attributeName="height"
            values="14;18;14"
            dur="1.5s"
            begin="0.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y"
            values="6;2;6"
            dur="1.5s"
            begin="0.4s"
            repeatCount="indefinite"
          />
        </rect>
        
        {/* Bar 4 */}
        <rect x="18" y="12" width="3" height="8" rx="1.5" fill="url(#pulseGradient)">
          <animate
            attributeName="height"
            values="8;14;8"
            dur="1.5s"
            begin="0.6s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y"
            values="12;6;12"
            dur="1.5s"
            begin="0.6s"
            repeatCount="indefinite"
          />
        </rect>
      </svg>
    </div>
  );
}

// Neural Network Logo
function NetworkLogo({ size = 24 }: { size: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id="networkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        
        {/* Connection lines */}
        <line x1="6" y1="6" x2="12" y2="12" stroke="url(#networkGradient)" strokeWidth="1.5" opacity="0.3">
          <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" repeatCount="indefinite" />
        </line>
        <line x1="18" y1="6" x2="12" y2="12" stroke="url(#networkGradient)" strokeWidth="1.5" opacity="0.3">
          <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" begin="0.3s" repeatCount="indefinite" />
        </line>
        <line x1="6" y1="18" x2="12" y2="12" stroke="url(#networkGradient)" strokeWidth="1.5" opacity="0.3">
          <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" begin="0.6s" repeatCount="indefinite" />
        </line>
        <line x1="18" y1="18" x2="12" y2="12" stroke="url(#networkGradient)" strokeWidth="1.5" opacity="0.3">
          <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" begin="0.9s" repeatCount="indefinite" />
        </line>
        
        {/* Nodes */}
        <circle cx="6" cy="6" r="2.5" fill="url(#networkGradient)">
          <animate attributeName="r" values="2.5;3.5;2.5" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="18" cy="6" r="2.5" fill="url(#networkGradient)">
          <animate attributeName="r" values="2.5;3.5;2.5" dur="2s" begin="0.3s" repeatCount="indefinite" />
        </circle>
        <circle cx="6" cy="18" r="2.5" fill="url(#networkGradient)">
          <animate attributeName="r" values="2.5;3.5;2.5" dur="2s" begin="0.6s" repeatCount="indefinite" />
        </circle>
        <circle cx="18" cy="18" r="2.5" fill="url(#networkGradient)">
          <animate attributeName="r" values="2.5;3.5;2.5" dur="2s" begin="0.9s" repeatCount="indefinite" />
        </circle>
        
        {/* Center node */}
        <circle cx="12" cy="12" r="3" fill="url(#networkGradient)">
          <animate attributeName="r" values="3;4;3" dur="2s" begin="1.2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

// Hexagon Logo
function HexagonLogo({ size = 24 }: { size: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id="hexGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        
        {/* Outer hexagon */}
        <path 
          d="M12 2L20 7V17L12 22L4 17V7L12 2Z" 
          stroke="url(#hexGradient)" 
          strokeWidth="1.5" 
          fill="none"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="8s"
            repeatCount="indefinite"
          />
        </path>
        
        {/* Middle hexagon */}
        <path 
          d="M12 5L17 8.5V15.5L12 19L7 15.5V8.5L12 5Z" 
          stroke="url(#hexGradient)" 
          strokeWidth="1.5" 
          fill="none"
          opacity="0.7"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="360 12 12"
            to="0 12 12"
            dur="6s"
            repeatCount="indefinite"
          />
        </path>
        
        {/* Inner shape */}
        <circle cx="12" cy="12" r="3" fill="url(#hexGradient)">
          <animate 
            attributeName="r" 
            values="3;4;3" 
            dur="2s" 
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </div>
  );
}

// Morphing Shape Logo
function MorphLogo({ size = 24 }: { size: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id="morphGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1">
              <animate attributeName="stopColor" values="#6366f1;#8b5cf6;#a78bfa;#8b5cf6;#6366f1" dur="4s" repeatCount="indefinite" />
            </stop>
            <stop offset="100%" stopColor="#8b5cf6">
              <animate attributeName="stopColor" values="#8b5cf6;#a78bfa;#c4b5fd;#a78bfa;#8b5cf6" dur="4s" repeatCount="indefinite" />
            </stop>
          </linearGradient>
        </defs>
        
        <path fill="url(#morphGradient)">
          <animate
            attributeName="d"
            values="
              M12,4 L19,12 L12,20 L5,12 Z;
              M12,3 L21,12 L12,21 L3,12 Z;
              M12,4 L20,8 L20,16 L12,20 L4,16 L4,8 Z;
              M12,4 C16,4 20,8 20,12 C20,16 16,20 12,20 C8,20 4,16 4,12 C4,8 8,4 12,4 Z;
              M12,4 L19,12 L12,20 L5,12 Z
            "
            dur="6s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
    </div>
  );
}

export function Logo({ variant = 'orbiting', size = 24 }: LogoProps) {
  const logos = {
    orbiting: OrbitingLogo,
    pulse: PulseLogo,
    network: NetworkLogo,
    hexagon: HexagonLogo,
    morph: MorphLogo
  };

  const LogoComponent = logos[variant];
  
  return (
    <div className="flex items-center justify-center">
      <LogoComponent size={size} />
    </div>
  );
}
