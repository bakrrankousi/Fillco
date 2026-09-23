'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { errorMessage } from '@/lib/api';

type ToastItem = { id: number; tone: 'success' | 'error'; text: string };

const ToastContext = createContext<{ success: (text: string) => void; error: (err: unknown) => void } | null>(
  null,
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  const success = useCallback((text: string) => push('success', text), [push]);
  const error = useCallback((err: unknown) => push('error', errorMessage(err)), [push]);
  return (
    <ToastContext.Provider value={{ success, error }}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100%-2rem)] flex-col gap-2"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2 rounded-md border border-line bg-white px-3 py-2.5 text-sm shadow-lg"
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            {t.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
