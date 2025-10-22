import { mutate } from "swr";

/**
 * Custom hook that provides SWR cache refresh functions for different data types
 * Use this in modals instead of router.refresh() to update SWR cache after mutations
 *
 * This approach uses direct cache key mutations instead of importing all hooks
 * to avoid potential circular dependencies and bundle size issues.
 */
export function useRefreshCache() {
  return {
    // Direct cache key refreshes
    refreshUser: () => mutate("user-details"),
    refreshUsers: () => mutate("users"),
    refreshPageSettings: () => mutate("page-settings"),
    refreshTokens: () => mutate("tokens"),

    // Convenience methods for common combinations
    refreshAll: () => {
      mutate("user-details");
      mutate("users");
      mutate("page-settings");
    },
  };
}
