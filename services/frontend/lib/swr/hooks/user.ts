import useSWR from "swr";

import GetUserDetails from "@/lib/fetch/user/getDetails";

// Hook for fetching user details
export function useUserDetails() {
  const { data, error, mutate, isLoading } = useSWR("user-details", () =>
    GetUserDetails(),
  );

  return {
    user: data?.success ? data.data.user : null,
    isLoading,
    isError: error || (data && !data.success),
    refresh: mutate,
  };
}
