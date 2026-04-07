import { RouteLoadingState } from '@/components/route-state';

export default function Loading() {
  return <RouteLoadingState title="Loading scans" message="Fetching images, scan history, and queued work." />;
}