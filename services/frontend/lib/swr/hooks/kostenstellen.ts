import useSWR from "swr";

import GetKostenstellen from "@/lib/fetch/kostenstellen/all";

// Hook for fetching all flows
export function useKostenstellen() {
  const { data, error, mutate, isLoading } = useSWR("kostenstellen", () =>
    GetKostenstellen(),
  );

  return {
    kostenstellen: data?.success ? data.data.kostenstellen : [],
    isLoading,
    isError: error || (data && !data.success),
    refresh: mutate,
  };
}
