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
      title="This page didn’t load"
      message="Something went wrong while loading this page. Try again, or go back to the home page."
      error={error}
      onRetry={reset}
      homeHref="/"
      homeLabel="Go home"
    />
  );
}
