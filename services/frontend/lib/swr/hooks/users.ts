import useSWR from "swr";

import AdminGetUsers from "@/lib/fetch/admin/users";

// Hook for fetching user details
export function useAdminGetUsers() {
  const { data, error, mutate, isLoading } = useSWR("users", () =>
    AdminGetUsers(),
  );

  return {
    users: data?.success ? data.data.users : null,
    isLoading,
    isError: error || (data && !data.success),
    refresh: mutate,
  };
}
