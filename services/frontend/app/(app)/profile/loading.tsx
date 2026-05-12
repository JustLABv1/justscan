import { RouteLoadingState } from '@/components/route-state';

export default function Loading() {
  return (
    <RouteLoadingState
      title="Loading profile"
      message="Fetching account details and current session information."
    />
  );
}
