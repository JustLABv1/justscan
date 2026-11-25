'use client';

import { RouteErrorState } from '@/components/route-state';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="Helm view failed to load"
      message="The Helm route ran into an unexpected error."
      error={error}
      onRetry={reset}
    />
  );
}
