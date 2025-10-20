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
import DeleteBridge from "@/lib/fetch/admin/DELETE/DeleteBridge";

export default function DeleteBridgeModal({
  disclosure,
  bridge,
}: {
  disclosure: UseDisclosureReturn;
  bridge: any;
}) {
  const { refreshBridges } = useRefreshCache();
  const { isOpen, onOpenChange } = disclosure;

  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [errorText, setErrorText] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");

  async function handleDeleteBridge() {
    setIsLoading(true);

    const response = (await DeleteBridge(bridge.id)) as any;

    if (!response) {
      setIsLoading(false);
      setError(true);
      setErrorText("Unbekannter Fehler");
      setErrorMessage("Fehler beim Löschen der Bridge");
      addToast({
        title: "Bridge",
        description: "Fehler beim Löschen der Bridge",
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
      refreshBridges();
      onOpenChange();
      addToast({
        title: "Bridge",
        description: "Bridge erfolgreich gelöscht",
        color: "success",
        variant: "flat",
      });
    } else {
      setError(true);
      setErrorText(response.error);
      setErrorMessage(response.message);
      setIsLoading(false);
      addToast({
        title: "Bridge",
        description: "Fehler beim Löschen der Bridge",
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
                    Sie sind dabei, die folgende Bridge zu löschen, was{" "}
                    <span className="font-bold">nicht rückgängig gemacht</span>{" "}
                    werden kann.
                    <br /> Diese Bridge wird unbrauchbar.
                  </p>
                </div>
              </ModalHeader>
              <ModalBody>
                {error && (
                  <ErrorCard error={errorText} message={errorMessage} />
                )}
                <Snippet hideCopyButton hideSymbol>
                  <span>ID: {bridge.bridge_id}</span>
                  <span>Name: {bridge.bridge_name}</span>
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
                  onPress={handleDeleteBridge}
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
