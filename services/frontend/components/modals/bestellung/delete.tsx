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
import DeleteBestellung from "@/lib/fetch/bestellungen/DELETE/delete";

export default function DeleteBestellungModal({
  disclosure,
  bestellung,
}: {
  disclosure: UseDisclosureReturn;
  bestellung: any;
}) {
  const { isOpen, onOpenChange } = disclosure;

  const { refreshBestellungen } = useRefreshCache();

  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [errorText, setErrorText] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");

  async function deleteBestellung() {
    setIsLoading(true);
    const res = (await DeleteBestellung(bestellung.id)) as any;

    if (!res) {
      setIsLoading(false);
      setError(true);
      setErrorText("Bestellung konnte nicht gelöscht werden");
      setErrorMessage("Bestellung konnte nicht gelöscht werden");
      addToast({
        title: "Fehler",
        description: "Bestellung konnte nicht gelöscht werden",
        color: "danger",
        variant: "flat",
      });

      return;
    }

    if (res.success) {
      refreshBestellungen(); // Refresh SWR cache instead of router
      onOpenChange();
      setIsLoading(false);
      setError(false);
      setErrorText("");
      setErrorMessage("");
      addToast({
        title: "Erfolgreich",
        description: "Bestellung wurde erfolgreich gelöscht.",
        color: "success",
        variant: "flat",
      });
    } else {
      setIsLoading(false);
      setError(true);
      setErrorText(res.error);
      setErrorMessage(res.message);
      addToast({
        title: "Fehler",
        description: "Bestellung konnte nicht gelöscht werden",
        color: "danger",
        variant: "flat",
      });
    }
  }

  return (
    <main>
      <Modal
        backdrop="blur"
        isOpen={isOpen}
        placement="center"
        onOpenChange={onOpenChange}
      >
        <ModalContent className="w-full">
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-wrap items-center">
                <div className="flex flex-col gap-2">
                  <p className="text-lg font-bold">Bist du dir sicher?</p>
                  <p className="text-sm text-default-500">
                    Du bist dabei diesen Eintrag zu löschen. Dies{" "}
                    <span className="font-bold">
                      kann nicht rückgängig gemacht werden.
                    </span>
                  </p>
                </div>
              </ModalHeader>
              <ModalBody>
                {error && (
                  <ErrorCard error={errorText} message={errorMessage} />
                )}
                <Snippet hideCopyButton hideSymbol>
                  <span>ID: {bestellung.id}</span>
                </Snippet>
              </ModalBody>
              <ModalFooter className="grid grid-cols-2">
                <Button color="default" variant="ghost" onPress={onClose}>
                  Abbrechen
                </Button>
                <Button
                  color="danger"
                  isLoading={isLoading}
                  startContent={<Icon icon="hugeicons:delete-02" width={18} />}
                  variant="solid"
                  onPress={deleteBestellung}
                >
                  Löschen
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </main>
  );
}
