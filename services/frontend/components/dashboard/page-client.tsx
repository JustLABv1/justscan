"use client";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useUserDetails } from "@/lib/swr/hooks/user";

import QuickNavigation from "./quick-navigation";

export default function DashboardPageClient() {
  const { user, isLoading: userLoading, isError: userError } = useUserDetails();

  // Check if any essential data is still loading or missing
  const isLoading =
    userLoading ||
    !user;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Show error state
  const hasError = userError;

  if (hasError) {
    return (
      <main>
        <ErrorCard
          error="Failed to load page data"
          message="One or more required data sources failed to load."
        />
      </main>
    );
  }

  return (
    <main>
      <QuickNavigation
        user={user}
      />
    </main>
  );
}
