'use client';

import { Button, Spinner } from '@heroui/react';
import type { ReactNode } from 'react';

import { StatusAlert } from '@/components/ui/form-alert';

export type LoadableCollectionStateProps = {
  loading: boolean;
  error?: ReactNode;
  /** Whether the current collection has no rows to retain during a refetch. */
  isEmpty: boolean;
  emptyState: ReactNode;
  children: ReactNode;
  /** Shown for the initial empty load; existing children remain visible on refetch. */
  loadingFallback?: ReactNode;
  retry?: () => void;
  retryLabel?: string;
  errorTitle?: string;
  className?: string;
};

/**
 * Keeps collection screens honest and consistent across loading, failure, and
 * loaded-empty states. The busy state is exposed to assistive technology while
 * the request is in flight.
 */
export function LoadableCollectionState({
  loading,
  error,
  isEmpty,
  emptyState,
  children,
  loadingFallback,
  retry,
  retryLabel = 'Retry',
  errorTitle = 'Could not load this collection',
  className,
}: LoadableCollectionStateProps) {
  let content = children;

  if (loading && isEmpty) {
    content = loadingFallback ?? (
      <div className="flex min-h-48 items-center justify-center" role="status">
        <Spinner aria-label="Loading" color="accent" size="sm" />
      </div>
    );
  } else if (error) {
    const errorContent = (
      <StatusAlert
        action={
          retry ? (
            <Button size="sm" variant="secondary" onPress={retry}>
              {retryLabel}
            </Button>
          ) : undefined
        }
        description={error}
        status="danger"
        title={errorTitle}
      />
    );
    content = isEmpty ? (
      errorContent
    ) : (
      <div className="space-y-3">
        {errorContent}
        {children}
      </div>
    );
  } else if (isEmpty) {
    content = emptyState;
  }

  return (
    <div aria-busy={loading} className={className}>
      {content}
    </div>
  );
}
