'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANTS: Record<ToastVariant, { color: string; bg: string; border: string; icon: string }> = {
  success: { color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', icon: '✓' },
  error:   { color: '#f87171', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  icon: '✕' },
  info:    { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', icon: 'ℹ' },
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const v = VARIANTS[item.variant];
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="alert"
      onClick={() => onDismiss(item.id)}
      className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-300"
      style={{
        background: 'var(--modal-bg, rgba(24,24,27,0.95))',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: `1px solid ${v.border}`,
        boxShadow: `0 4px 24px rgba(0,0,0,0.3), inset 0 0 0 1px ${v.bg}`,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateX(0)' : 'translateX(24px)',
        minWidth: 220,
        maxWidth: 360,
      }}
    >
      <span
        className="flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0"
        style={{ background: v.bg, color: v.color, border: `1px solid ${v.border}` }}
      >
        {v.icon}
      </span>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary, #fafafa)' }}>
        {item.message}
      </p>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const add = useCallback((message: string, variant: ToastVariant) => {
    const id = String(++counterRef.current);
    setToasts(prev => [...prev.slice(-2), { id, message, variant }]);
    setTimeout(() => dismiss(id), 3500);
  }, [dismiss]);

  const value: ToastContextValue = {
    success: (m) => add(m, 'success'),
    error:   (m) => add(m, 'error'),
    info:    (m) => add(m, 'info'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Portal-like fixed container */}
      <div
        className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none print:hidden"
        aria-live="polite"
      >
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <Toast item={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
