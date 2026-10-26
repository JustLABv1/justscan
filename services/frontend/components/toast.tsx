'use client';
import { Toaster, toast } from 'sonner';
import { useTheme } from 'next-themes';
import type { ReactNode } from 'react';
import { createContext, use, useCallback, useMemo } from 'react';

export interface ToastOptions {
  description?: ReactNode;
  timeout?: number;
  action?: {
    label: string;
    onPress: () => void;
  };
}

interface ToastContextValue {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function toToastOptions(options?: ToastOptions) {
  if (!options) return undefined;
  return {
    description: options.description,
    duration: options.timeout,
    action: options.action
      ? {
          label: options.action.label,
          onClick: options.action.onPress,
        }
      : undefined,
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const success = useCallback((message: string, options?: ToastOptions) => {
    toast.success(message, toToastOptions(options));
  }, []);

  const error = useCallback((message: string, options?: ToastOptions) => {
    toast.error(message, toToastOptions(options));
  }, []);

  const info = useCallback((message: string, options?: ToastOptions) => {
    toast.info(message, toToastOptions(options));
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ success, error, info }),
    [error, info, success]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        className="print:hidden"
        visibleToasts={3}
        position="bottom-right"
        richColors
        closeButton
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = use(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
