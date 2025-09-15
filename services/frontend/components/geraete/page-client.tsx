"use client";

import { Divider } from "@heroui/react";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useUserDetails } from "@/lib/swr/hooks/user";
import { useGeraete } from "@/lib/swr/hooks/geraete";

import GeraeteHeading from "./heading";
import GeraeteList from "./list";

export default function GeraetePageClient() {
  const {
    geraete,
    isLoading: geraeteLoading,
    isError: geraeteError,
  } = useGeraete();
  const { user, isLoading: userLoading, isError: userError } = useUserDetails();

  // Check if any essential data is still loading or missing
  const isLoading = geraeteLoading || userLoading || !geraete || !user;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Show error state
  const hasError = geraeteError || userError;

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
      <GeraeteHeading />
      <Divider className="my-4" />
      <GeraeteList geraete={geraete} />
    </main>
  );
}
