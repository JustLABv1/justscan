import useSWR from "swr";

import GetGeraete from "@/lib/fetch/geraete/all";

// Hook for fetching all flows
export function useGeraete() {
  const { data, error, mutate, isLoading } = useSWR("geraete", () =>
    GetGeraete(),
  );

  return {
    geraete: data?.success ? data.data.geraete : [],
    isLoading,
    isError: error || (data && !data.success),
    refresh: mutate,
  };
}
