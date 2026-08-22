'use client';

import { RouteErrorState } from '@/components/route-state';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="Page failed to load"
      message="JustScan could not finish rendering this page. Retry the route or return to the dashboard."
      onRetry={reset}
    />
  );
}
