import { RouteLoadingState } from '@/components/route-state';

export default function Loading() {
  return <RouteLoadingState title="Loading Helm activity" message="Fetching Helm scan runs and release visibility." />;
}