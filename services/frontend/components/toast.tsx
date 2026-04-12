'use client';
import { ToastProvider as HeroUIToastProvider, toast as heroToast, toastQueue } from '@heroui/react';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext } from 'react';

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const success = useCallback((message: string) => {
    heroToast.success(message);
  }, []);

  const error = useCallback((message: string) => {
    heroToast.danger(message);
  }, []);

  const info = useCallback((message: string) => {
    heroToast.info(message);
  }, []);

  const value: ToastContextValue = {
    success,
    error,
    info,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <HeroUIToastProvider
        className="print:hidden"
        maxVisibleToasts={3}
        placement="bottom end"
        queue={toastQueue}
        width={360}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
