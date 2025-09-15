import useSWR from "swr";

import GetArtikel from "@/lib/fetch/artikel/all";

// Hook for fetching all flows
export function useArtikel() {
  const { data, error, mutate, isLoading } = useSWR("artikel", () =>
    GetArtikel(),
  );

  return {
    artikel: data?.success ? data.data.artikel : [],
    isLoading,
    isError: error || (data && !data.success),
    refresh: mutate,
  };
}
