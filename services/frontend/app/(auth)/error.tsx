'use client';

import { RouteErrorState } from '@/components/route-state';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorState
      title="Authentication view failed to load"
      message="The sign-in experience hit an error before it could render. Retry the route or return to the main dashboard."
      onRetry={reset}
    />
  );
}