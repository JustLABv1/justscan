'use client';

import { RouteErrorState } from '@/components/route-state';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="Settings failed to load" message="The settings route could not be prepared for this session." onRetry={reset} />;
}