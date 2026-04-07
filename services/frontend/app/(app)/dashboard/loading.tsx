import { RouteLoadingState } from '@/components/route-state';

export default function Loading() {
  return <RouteLoadingState title="Loading dashboard" message="Refreshing scan activity, severity totals, and scanner health." />;
}