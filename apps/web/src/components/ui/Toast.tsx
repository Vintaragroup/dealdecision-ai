import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, XCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  onClose: (id: string) => void;
  darkMode?: boolean;
}

export function Toast({ 
  id, 
  type, 
  title, 
  message, 
  duration = 5000, 
  onClose, 
  darkMode = true 
}: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, duration);

    return () => clearTimeout(timer);
  }, [id, duration, onClose]);

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
    error: <XCircle className="w-5 h-5 text-red-400" />,
    warning: <AlertCircle className="w-5 h-5 text-amber-400" />,
    info: <Info className="w-5 h-5 text-[#6366f1]" />
  };

  const borderColors = {
    success: 'border-emerald-500/30',
    error: 'border-red-500/30',
    warning: 'border-amber-500/30',
    info: 'border-[#6366f1]/30'
  };

  const bgGradients = {
    success: darkMode 
      ? 'from-emerald-500/20 to-teal-500/20' 
      : 'from-emerald-500/10 to-teal-500/10',
    error: darkMode 
      ? 'from-red-500/20 to-rose-500/20' 
      : 'from-red-500/10 to-rose-500/10',
    warning: darkMode 
      ? 'from-amber-500/20 to-orange-500/20' 
      : 'from-amber-500/10 to-orange-500/10',
    info: darkMode 
      ? 'from-[#6366f1]/20 to-[#8b5cf6]/20' 
      : 'from-[#6366f1]/10 to-[#8b5cf6]/10'
  };

  return (
    <div 
      className={`
        w-80 backdrop-blur-xl border rounded-xl p-4 shadow-2xl
        bg-gradient-to-br ${bgGradients[type]} ${borderColors[type]}
        animate-[slideInRight_0.3s_ease-out]
        ${darkMode ? 'bg-[#18181b]/95' : 'bg-white/95'}
      `}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          {icons[type]}
        </div>
        
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm mb-0.5 ${
            darkMode ? 'text-white' : 'text-gray-900'
          }`}>
            {title}
          </h4>
          {message && (
            <p className={`text-xs ${
              darkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {message}
            </p>
          )}
        </div>
        
        <button
          onClick={() => onClose(id)}
          className={`shrink-0 p-1 rounded transition-colors ${
            darkMode 
              ? 'hover:bg-white/10 text-gray-400 hover:text-white' 
              : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'
          }`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Toast Container Component
interface ToastContainerProps {
  toasts: Array<{
    id: string;
    type: ToastType;
    title: string;
    message?: string;
  }>;
  onClose: (id: string) => void;
  darkMode?: boolean;
}

export function ToastContainer({ toasts, onClose, darkMode = true }: ToastContainerProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast
            id={toast.id}
            type={toast.type}
            title={toast.title}
            message={toast.message}
            onClose={onClose}
            darkMode={darkMode}
          />
        </div>
      ))}
    </div>
  );
}

// Animation keyframes (add to globals.css if needed)
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`;
document.head.appendChild(style);
