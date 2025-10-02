"use client";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useKostenstellen } from "@/lib/swr/hooks/kostenstellen";
import { useUserDetails } from "@/lib/swr/hooks/user";
import { useArtikel } from "@/lib/swr/hooks/artikel";

import QuickNavigation from "./quick-navigation";

export default function DashboardPageClient() {
  const {
    kostenstellen,
    isLoading: kostenstellenLoading,
    isError: kostenstellenError,
  } = useKostenstellen();
  const {
    artikel,
    isLoading: artikelLoading,
    isError: artikelError,
  } = useArtikel();
  const { user, isLoading: userLoading, isError: userError } = useUserDetails();

  // Check if any essential data is still loading or missing
  const isLoading =
    kostenstellenLoading ||
    artikelLoading ||
    userLoading ||
    !kostenstellen ||
    !artikel ||
    !user;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Show error state
  const hasError = kostenstellenError || userError || artikelError;

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
        artikel={artikel}
        kostenstellen={kostenstellen}
        user={user}
      />
    </main>
  );
}
