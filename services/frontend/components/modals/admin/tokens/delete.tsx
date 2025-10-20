"use client";

import type { UseDisclosureReturn } from "@heroui/use-disclosure";

import {
  addToast,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Snippet,
} from "@heroui/react";
import React from "react";
import { Icon } from "@iconify/react";

import ErrorCard from "@/components/error/ErrorCard";
import { useRefreshCache } from "@/lib/swr/hooks/useRefreshCache";
import DeleteToken from "@/lib/fetch/admin/DELETE/DeleteToken";

export default function DeleteTokenModal({
  disclosure,
  token,
}: {
  disclosure: UseDisclosureReturn;
  token: any;
}) {
  const { refreshTokens } = useRefreshCache();
  const { isOpen, onOpenChange } = disclosure;

  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [errorText, setErrorText] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");

  async function handleDeleteToken() {
    setIsLoading(true);

    const response = (await DeleteToken(token.id)) as any;

    if (!response) {
      setIsLoading(false);
      setError(true);
      setErrorText("Unbekannter Fehler");
      setErrorMessage("Fehler beim Löschen des Tokens");
      addToast({
        title: "Token",
        description: "Fehler beim Löschen des Tokens",
        color: "danger",
        variant: "flat",
      });

      return;
    }

    if (response.success) {
      setIsLoading(false);
      setError(false);
      setErrorText("");
      setErrorMessage("");
      refreshTokens();
      onOpenChange();
      addToast({
        title: "Token",
        description: "Token erfolgreich gelöscht",
        color: "success",
        variant: "flat",
      });
    } else {
      setError(true);
      setErrorText(response.error);
      setErrorMessage(response.message);
      setIsLoading(false);
      addToast({
        title: "Token",
        description: "Fehler beim Löschen des Tokens",
        color: "danger",
        variant: "flat",
      });
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} placement="center" onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-wrap items-center">
                <div className="flex flex-col">
                  <p className="text-lg font-bold">Sind Sie sicher?</p>
                  <p className="text-sm text-default-500">
                    Sie sind dabei, den folgenden Token zu löschen, was{" "}
                    <span className="font-bold">nicht rückgängig gemacht</span>{" "}
                    werden kann.
                    <br /> Dieser Token wird unbrauchbar.
                  </p>
                </div>
              </ModalHeader>
              <ModalBody>
                {error && (
                  <ErrorCard error={errorText} message={errorMessage} />
                )}
                <Snippet hideCopyButton hideSymbol>
                  <span>ID: {token.id}</span>
                  <span>Typ: {token.type}</span>
                </Snippet>
              </ModalBody>
              <ModalFooter>
                <Button
                  color="default"
                  startContent={<Icon icon="hugeicons:cancel-01" width={18} />}
                  variant="ghost"
                  onPress={onClose}
                >
                  Abbrechen
                </Button>
                <Button
                  color="danger"
                  isLoading={isLoading}
                  startContent={<Icon icon="hugeicons:delete-02" width={18} />}
                  onPress={handleDeleteToken}
                >
                  Löschen
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
