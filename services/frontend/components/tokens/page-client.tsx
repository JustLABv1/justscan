"use client";

import { Divider } from "@heroui/react";

import ErrorCard from "@/components/error/ErrorCard";
import { PageSkeleton } from "@/components/loading/page-skeleton";
import { useAdminGetTokens } from "@/lib/swr/hooks/tokens";

import TokensHeading from "./heading";
import TokensTable from "./tokens-table";

export default function TokensPageClient() {
  const {
    tokens,
    isLoading: tokensLoading,
    isError: tokensError,
  } = useAdminGetTokens();

  // Check if any essential data is still loading or missing
  const isLoading = tokensLoading;

  // Show loading state if essential data is still loading
  if (isLoading) {
    return <PageSkeleton />;
  }

  // Normalize tokens to an array to avoid "possibly null" errors
  const tokenList = tokens ?? [];

  // Show error state
  const hasError = tokensError;

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
      <TokensHeading />
      <Divider className="my-4" />
      <TokensTable
        showCopyToClipboard
        showTokenGenerate
        tokens={tokenList.filter((token: any) => token.type !== "user")}
      />
      <Divider className="my-4" />
      <p className="text-xl font-bold mb-2">User Tokens</p>
      <TokensTable
        showCopyToClipboard={false}
        showTokenGenerate={false}
        tokens={tokenList.filter((token: any) => token.type === "user")}
      />
    </main>
  );
}
