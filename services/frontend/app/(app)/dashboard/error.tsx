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
      title="Dashboard failed to load"
      message="The dashboard data could not be loaded. Retry the route or return to the main dashboard."
      error={error}
      onRetry={reset}
    />
  );
}
