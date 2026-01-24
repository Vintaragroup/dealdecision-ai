import { useState } from 'react';
import type { ToastType } from '../components/ui/Toast';

export type LocalToast = { id: string; type: ToastType; title: string; message?: string };

export function useLocalToasts() {
  const [toasts, setToasts] = useState<LocalToast[]>([]);

  const addToast = (type: ToastType, title: string, message?: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    return id;
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const clearToasts = () => {
    setToasts([]);
  };

  return { toasts, addToast, removeToast, clearToasts };
}
