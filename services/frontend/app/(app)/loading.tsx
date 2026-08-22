import { RouteLoadingState } from '@/components/route-state';

export default function Loading() {
  return (
    <RouteLoadingState title="Loading workspace" message="Fetching the latest workspace data." />
  );
}
