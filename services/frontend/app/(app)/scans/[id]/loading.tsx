import { RouteLoadingState } from '@/components/route-state';

export default function Loading() {
  return <RouteLoadingState title="Loading scan detail" message="Pulling scan metadata, vulnerabilities, and related analysis." />;
}