import useSWR from "swr";

import GetBestellungen from "@/lib/fetch/bestellungen/all";

// Hook for fetching all bestellungen
export function useBestellungen() {
  const { data, error, mutate, isLoading } = useSWR("bestellungen", () =>
    GetBestellungen(),
  );

  return {
    bestellungen: data?.success ? data.data.bestellungen : [],
    isLoading,
    isError: error || (data && !data.success),
    refresh: mutate,
  };
}
