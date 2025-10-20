import useSWR from "swr";

import AdminGetTokens from "@/lib/fetch/admin/tokens";

// Hook for fetching user details
export function useAdminGetTokens() {
  const { data, error, mutate, isLoading } = useSWR("tokens", () =>
    AdminGetTokens(),
  );

  return {
    tokens: data?.success ? data.data.tokens : null,
    isLoading,
    isError: error || (data && !data.success),
    refresh: mutate,
  };
}
