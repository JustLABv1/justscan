"use client";

import { Divider } from "@heroui/react";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useKostenstellen } from "@/lib/swr/hooks/kostenstellen";
import { useGeraete } from "@/lib/swr/hooks/geraete";
import { useArtikel } from "@/lib/swr/hooks/artikel";

import SystemVerwaltungHeading from "./heading";
import SystemVerwaltungUploads from "./uploads";

export default function SystemVerwaltungPageClient() {
  const {
    kostenstellen,
    isLoading: kostenstellenLoading,
    isError: kostenstellenError,
  } = useKostenstellen();

  const {
    geraete,
    isLoading: geraeteLoading,
    isError: geraeteError,
  } = useGeraete();

  const {
    artikel,
    isLoading: artikelLoading,
    isError: artikelError,
  } = useArtikel();

  // Check if any essential data is still loading or missing
  const isLoading = kostenstellenLoading || geraeteLoading || artikelLoading;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Show error state
  const hasError = kostenstellenError || geraeteError || artikelError;

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
      <SystemVerwaltungHeading />
      <Divider className="my-4" />
      <SystemVerwaltungUploads
        artikel={artikel}
        geraete={geraete}
        kostenstellen={kostenstellen}
      />
    </main>
  );
}
