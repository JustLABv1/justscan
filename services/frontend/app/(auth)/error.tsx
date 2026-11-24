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
      title="Authentication view failed to load"
      message="The sign-in experience hit an error before it could render. Try again or return to sign in."
      error={error}
      homeHref="/login"
      homeLabel="Back to sign in"
      onRetry={reset}
    />
  );
}
