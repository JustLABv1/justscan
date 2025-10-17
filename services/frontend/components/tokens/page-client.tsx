"use client";

import { Divider, Spacer } from "@heroui/react";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useAdminGetUsers } from "@/lib/swr/hooks/users";
import { useKostenstellen } from "@/lib/swr/hooks/kostenstellen";
import { useGeraete } from "@/lib/swr/hooks/geraete";
import { useArtikel } from "@/lib/swr/hooks/artikel";
import { useBridges } from "@/lib/swr/hooks/bridges";
import { useUserDetails } from "@/lib/swr/hooks/user";

import SystemVerwaltungHeading from "./heading";
import SystemVerwaltungUploads from "./uploads";
import { AdminUsersList } from "./user-list";
import AdminUsersHeading from "./user-heading";
import CsvBridges from "./csv-bridges";

export default function SystemVerwaltungPageClient() {
  const {
    users,
    isLoading: usersLoading,
    isError: usersError,
  } = useAdminGetUsers();

  const {
    bridges,
    isLoading: bridgesLoading,
    isError: bridgesError,
  } = useBridges();

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

  const { user, isLoading: userLoading, isError: userError } = useUserDetails();

  // Check if any essential data is still loading or missing
  const isLoading =
    usersLoading ||
    kostenstellenLoading ||
    geraeteLoading ||
    artikelLoading ||
    bridgesLoading ||
    userLoading;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Show error state
  const hasError =
    usersError ||
    kostenstellenError ||
    geraeteError ||
    artikelError ||
    bridgesError ||
    userError;

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
      <Divider className="my-4" />
      <CsvBridges bridges={bridges} user={user} />
      <Divider className="my-4" />
      <AdminUsersHeading />
      <Spacer y={4} />
      <AdminUsersList users={users} />
    </main>
  );
}
