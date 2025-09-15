"use client";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useUserDetails } from "@/lib/swr/hooks/user";
import { useArtikel } from "@/lib/swr/hooks/artikel";

import ArtikelList from "./list";

export default function ArtikelPageClient() {
  const {
    artikel,
    isLoading: artikelLoading,
    isError: artikelError,
  } = useArtikel();
  const { user, isLoading: userLoading, isError: userError } = useUserDetails();

  // Check if any essential data is still loading or missing
  const isLoading = artikelLoading || userLoading || !artikel || !user;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Show error state
  const hasError = artikelError || userError;

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
      <ArtikelList artikel={artikel} />
    </main>
  );
}
