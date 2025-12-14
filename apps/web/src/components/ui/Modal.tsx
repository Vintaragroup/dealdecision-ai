import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  darkMode?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
  footer?: React.ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  darkMode = true,
  size = 'md',
  showCloseButton = true,
  footer
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeStyles = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 transition-opacity ${ 
          darkMode 
            ? 'bg-black/80 backdrop-blur-sm' 
            : 'bg-black/40 backdrop-blur-sm'
        }`}
        onClick={onClose}
      />
      
      {/* Modal Container with Centering */}
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Modal */}
        <div 
          ref={modalRef}
          className={`
            relative w-full ${sizeStyles[size]} backdrop-blur-xl border rounded-2xl shadow-2xl my-8
            transform transition-all
            ${darkMode 
              ? 'bg-[#18181b]/95 border-white/10' 
              : 'bg-white/95 border-gray-200/50'
            }
          `}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          {(title || showCloseButton) && (
            <div className={`flex items-start justify-between p-4 sm:p-6 border-b ${ 
              darkMode ? 'border-white/10' : 'border-gray-200/50'
            }`}>
              <div className="flex-1">
                {title && (
                  <h2 className={`text-lg sm:text-xl ${ 
                    darkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                    {title}
                  </h2>
                )}
                {description && (
                  <p className={`text-sm mt-1 ${ 
                    darkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {description}
                  </p>
                )}
              </div>
              
              {showCloseButton && (
                <Button
                  variant="icon"
                  darkMode={darkMode}
                  onClick={onClose}
                  className="ml-4"
                >
                  <X className="w-5 h-5" />
                </Button>
              )}
            </div>
          )}
          
          {/* Content */}
          <div className="p-4 sm:p-6">
            {children}
          </div>
          
          {/* Footer */}
          {footer && (
            <div className={`flex items-center justify-end gap-3 p-4 sm:p-6 border-t ${ 
              darkMode ? 'border-white/10' : 'border-gray-200/50'
            }`}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}