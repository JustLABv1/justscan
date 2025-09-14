"use client";

import { Divider } from "@heroui/react";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useKostenstellen } from "@/lib/swr/hooks/kostenstellen";
import { useUserDetails } from "@/lib/swr/hooks/user";

import KostenstellenHeading from "./heading";
import KostenstellenList from "./list";

export default function KostenstellenPageClient() {
  const {
    kostenstellen,
    isLoading: kostenstellenLoading,
    isError: kostenstellenError,
  } = useKostenstellen();
  const { user, isLoading: userLoading, isError: userError } = useUserDetails();

  // Check if any essential data is still loading or missing
  const isLoading =
    kostenstellenLoading || userLoading || !kostenstellen || !user;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Show error state
  const hasError = kostenstellenError || userError;

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
      <KostenstellenHeading />
      <Divider className="my-4" />
      <KostenstellenList kostenstellen={kostenstellen} />
    </main>
  );
}
