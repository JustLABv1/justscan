'use client';
import {
  ToastProvider as HeroUIToastProvider,
  toast as heroToast,
  toastQueue,
} from '@heroui/react';
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

function toHeroToastOptions(options?: ToastOptions) {
  if (!options) return undefined;
  return {
    description: options.description,
    timeout: options.timeout,
    actionProps: options.action
      ? {
          children: options.action.label,
          onPress: options.action.onPress,
        }
      : undefined,
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const success = useCallback((message: string, options?: ToastOptions) => {
    heroToast.success(message, toHeroToastOptions(options));
  }, []);

  const error = useCallback((message: string, options?: ToastOptions) => {
    heroToast.danger(message, toHeroToastOptions(options));
  }, []);

  const info = useCallback((message: string, options?: ToastOptions) => {
    heroToast.info(message, toHeroToastOptions(options));
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ success, error, info }),
    [error, info, success]
  );

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
  const ctx = use(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
