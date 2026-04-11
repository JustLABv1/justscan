'use client';

import { RouteErrorState } from '@/components/route-state';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorState
      title="Application route failed to load"
      message="The signed-in area hit an error before it could finish rendering. Retry the route or return to the dashboard."
      onRetry={reset}
    />
  );
}