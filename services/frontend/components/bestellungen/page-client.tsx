"use client";

import { Divider } from "@heroui/react";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useUserDetails } from "@/lib/swr/hooks/user";
import { useBestellungen } from "@/lib/swr/hooks/bestellungen";
import { useArtikel } from "@/lib/swr/hooks/artikel";

import BestellungenHeading from "./heading";
import BestellungenList from "./list";

export default function BestellungenPageClient() {
  const {
    bestellungen,
    isLoading: bestellungenLoading,
    isError: bestellungenError,
  } = useBestellungen();
  const {
    artikel,
    isLoading: artikelLoading,
    isError: artikelError,
  } = useArtikel();
  const { user, isLoading: userLoading, isError: userError } = useUserDetails();

  // Check if any essential data is still loading or missing
  const isLoading =
    bestellungenLoading ||
    userLoading ||
    !bestellungen ||
    !user ||
    artikelLoading ||
    !artikel;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Show error state
  const hasError = bestellungenError || userError || artikelError;

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
      <BestellungenHeading artikel={artikel} />
      <Divider className="my-4" />
      <BestellungenList bestellungen={bestellungen} />
    </main>
  );
}
