'use client';

import { RouteErrorState } from '@/components/route-state';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="Scans page failed to load" message="The scan inventory route hit an error before it could render." onRetry={reset} />;
}