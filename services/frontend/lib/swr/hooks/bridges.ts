import useSWR from "swr";

import GetBridges from "@/lib/fetch/bridges/all";

// Hook for fetching user details
export function useBridges() {
  const { data, error, mutate, isLoading } = useSWR("bridges", () =>
    GetBridges(),
  );

  return {
    bridges: data?.success ? data.data.bridges : null,
    isLoading,
    isError: error || (data && !data.success),
    refresh: mutate,
  };
}
