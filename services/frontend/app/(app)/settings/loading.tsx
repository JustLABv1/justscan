import { RouteLoadingState } from '@/components/route-state';

export default function Loading() {
  return <RouteLoadingState title="Loading settings" message="Fetching account details and current session information." />;
}