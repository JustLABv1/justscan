'use client';

import { RouteErrorState } from '@/components/route-state';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="Status pages failed to load" message="The status route could not finish rendering." onRetry={reset} />;
}