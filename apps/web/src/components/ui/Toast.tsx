import { useCallback, useEffect, useRef, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info, XCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

// ─── Per-type default auto-dismiss durations ────────────────────────────────
// null means sticky (no auto-dismiss).
export const TOAST_AUTO_DISMISS_MS: Record<ToastType, number | null> = {
  success: 5_000,
  info: 5_000,
  warning: 10_000,
  error: null, // sticky — stays until user explicitly closes
};

// Maximum number of toasts visible simultaneously.
export const MAX_VISIBLE_TOASTS = 4;

// ─── Toast item shape used in the queue ─────────────────────────────────────

export interface ToastItem {
  /** Auto-generated unique instance identifier. */
  id: string;
  /**
   * Stable deduplication key.  When a new toast is pushed with the same key as
   * an already-visible toast, the existing toast is updated in place rather than
   * a second entry being stacked.
   * If omitted a random key is generated (effectively no dedup).
   */
  key: string;
  type: ToastType;
  title: string;
  message?: string;
  /**
   * When true the toast will NOT auto-dismiss.
   * Defaults to true for `error` type, false for all others.
   */
  sticky?: boolean;
}

// ─── useToastQueue ───────────────────────────────────────────────────────────

export interface UseToastQueueReturn {
  toasts: ToastItem[];
  /**
   * Push a new notification (or update an existing one when the same key is
   * already visible).
   *
   * Replacement rules:
   *  1. If `key` matches a visible toast → update it in place (no new entry).
   *  2. Else if the queue is full → evict the oldest non-sticky toast first;
   *     if all are sticky, evict the oldest entry regardless.
   *  3. Otherwise append normally.
   */
  push: (item: Omit<ToastItem, 'id' | 'key'> & { key?: string }) => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

export function useToastQueue(maxVisible = MAX_VISIBLE_TOASTS): UseToastQueueReturn {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (item: Omit<ToastItem, 'id' | 'key'> & { key?: string }) => {
      const key = item.key ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const sticky = item.sticky ?? item.type === 'error';
      const newToast: ToastItem = { id, key, type: item.type, title: item.title, message: item.message, sticky };

      setToasts((prev) => {
        // 1. Key match → replace in place (cancel old timer too)
        const existingIdx = prev.findIndex((t) => t.key === key);
        if (existingIdx !== -1) {
          const oldId = prev[existingIdx].id;
          const oldTimer = timersRef.current.get(oldId);
          if (oldTimer !== undefined) {
            clearTimeout(oldTimer);
            timersRef.current.delete(oldId);
          }
          const next = [...prev];
          next[existingIdx] = newToast;
          return next;
        }

        // 2. At capacity → evict oldest non-sticky, then oldest if all sticky
        let next = [...prev];
        while (next.length >= maxVisible) {
          const evictIdx = next.findIndex((t) => !t.sticky);
          const evictTarget = evictIdx !== -1 ? evictIdx : 0;
          const evictedId = next[evictTarget].id;
          const evictedTimer = timersRef.current.get(evictedId);
          if (evictedTimer !== undefined) {
            clearTimeout(evictedTimer);
            timersRef.current.delete(evictedId);
          }
          next.splice(evictTarget, 1);
        }
        return [...next, newToast];
      });

      // Schedule auto-dismiss unless sticky
      if (!sticky) {
        const delay = TOAST_AUTO_DISMISS_MS[item.type];
        if (delay !== null) {
          const t = setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
            timersRef.current.delete(id);
          }, delay);
          timersRef.current.set(id, t);
        }
      }
    },
    [maxVisible]
  );

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const clearAll = useCallback(() => {
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
    setToasts([]);
  }, []);

  return { toasts, push, dismiss, clearAll };
}

// ─── Toast component ────────────────────────────────────────────────────────

interface ToastProps {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  /** Override auto-dismiss duration (ms). Pass 0 for sticky (no auto-dismiss). */
  duration?: number;
  /** When true, never auto-dismiss regardless of duration. */
  sticky?: boolean;
  onClose: (id: string) => void;
  darkMode?: boolean;
}

export function Toast({ 
  id, 
  type, 
  title, 
  message, 
  duration, 
  sticky = false,
  onClose, 
  darkMode = true 
}: ToastProps) {
  // Resolve effective dismiss delay:
  //   - explicit sticky prop → no dismiss
  //   - explicit duration=0  → no dismiss
  //   - explicit duration>0  → use that
  //   - no explicit duration → use per-type default (null = no dismiss)
  const effectiveDuration = sticky ? null : (duration !== undefined ? (duration === 0 ? null : duration) : TOAST_AUTO_DISMISS_MS[type]);

  useEffect(() => {
    if (effectiveDuration === null) return; // sticky
    const timer = setTimeout(() => {
      onClose(id);
    }, effectiveDuration);

    return () => clearTimeout(timer);
  }, [id, effectiveDuration, onClose]);

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
          <h4 className={`text-sm mb-0.5 truncate ${
            darkMode ? 'text-white' : 'text-gray-900'
          }`}>
            {title}
          </h4>
          {message && (
            <p className={`text-xs line-clamp-2 ${
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

// ─── ToastContainer ─────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: Array<{
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    sticky?: boolean;
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
            sticky={toast.sticky}
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

