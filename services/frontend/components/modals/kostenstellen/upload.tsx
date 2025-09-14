import type { UseDisclosureReturn } from "@heroui/use-disclosure";

import {
  addToast,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
import React, { useState } from "react";
import { Icon } from "@iconify/react";

import { PostUploadKostenstellen } from "@/lib/fetch/kostenstellen/POST/upload";
import ErrorCard from "@/components/error/ErrorCard";

export default function UploadKostenstellenModal({
  disclosure,
  formData,
}: {
  disclosure: UseDisclosureReturn;
  formData: FormData;
}) {
  const { isOpen, onOpenChange } = disclosure;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function uploadKostenstellen() {
    setIsLoading(true);

    const res = await PostUploadKostenstellen(formData);

    if (!res) {
      setError(true);
      setErrorText("Fehler");
      setErrorMessage("Ein Fehler ist aufgetreten");
      setIsLoading(false);

      return;
    }

    if (res.success) {
      addToast({
        title: "Erfolgreich",
        description: "Die Datei wurde erfolgreich hochgeladen.",
        color: "success",
      });
    } else {
      setError(true);
      setErrorText("Fehler");
      setErrorMessage(res.error || "Ein Fehler ist aufgetreten");
      setIsLoading(false);
      onOpenChange();

      return;
    }

    setIsLoading(false);
    onOpenChange();
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
                  <p className="text-lg font-bold">Kostenstellen hochladen?</p>
                  <p className="text-sm text-default-500">
                    Möchten Sie die ausgewählten Kostenstellen wirklich
                    hochladen? Dieser Vorgang
                    <span className="font-bold">
                      kann nicht rückgängig gemacht werden.
                    </span>
                  </p>
                </div>
              </ModalHeader>
              {error && (
                <ModalBody>
                  <ErrorCard error={errorText} message={errorMessage} />
                </ModalBody>
              )}
              <ModalFooter className="grid grid-cols-2">
                <Button color="default" variant="ghost" onPress={onClose}>
                  Abbrechen
                </Button>
                <Button
                  color="warning"
                  isLoading={isLoading}
                  startContent={<Icon icon="hugeicons:upload-01" width={18} />}
                  variant="solid"
                  onPress={uploadKostenstellen}
                >
                  Importieren
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </main>
  );
}
