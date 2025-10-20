"use client";

import { Divider } from "@heroui/react";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useBridges } from "@/lib/swr/hooks/bridges";
import { useUserDetails } from "@/lib/swr/hooks/user";

import CsvBridges from "./csv-bridges";
import BridgesHeading from "./heading";

export default function BridgesPageClient() {
  const {
    bridges,
    isLoading: bridgesLoading,
    isError: bridgesError,
  } = useBridges();

  const { user, isLoading: userLoading, isError: userError } = useUserDetails();

  // Check if any essential data is still loading or missing
  const isLoading = bridgesLoading || userLoading;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Show error state
  const hasError = bridgesError || userError;

  if (hasError) {
    return (
      <main>
        <ErrorCard
          error="Fehler beim Laden der Daten"
          message="Eine oder mehrere erforderliche Datenquellen konnten nicht geladen werden."
        />
      </main>
    );
  }

  return (
    <main>
      <BridgesHeading />
      <Divider className="my-4" />
      <CsvBridges bridges={bridges} user={user} />
    </main>
  );
}
