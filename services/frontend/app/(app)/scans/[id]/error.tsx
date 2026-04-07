'use client';

import { RouteErrorState } from '@/components/route-state';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="Scan detail failed to load" message="This scan could not be rendered right now. Retry the page or return to the dashboard." onRetry={reset} />;
}