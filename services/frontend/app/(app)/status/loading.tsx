import { RouteLoadingState } from '@/components/route-state';

export default function Loading() {
  return <RouteLoadingState title="Loading status pages" message="Collecting published status pages and recent visibility state." />;
}