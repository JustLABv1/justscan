"use client";

import type { UseDisclosureReturn } from "@heroui/use-disclosure";

import {
  addToast,
  Button,
  Form,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
} from "@heroui/react";
import React, { useState } from "react";
import { Icon } from "@iconify/react";

import ErrorCard from "@/components/error/ErrorCard";
import { useRefreshCache } from "@/lib/swr/hooks/useRefreshCache";
import CreateBridgeToken from "@/lib/fetch/admin/POST/CreateBridgeToken";

export default function CreateBridgeTokenModal({
  disclosure,
}: {
  disclosure: UseDisclosureReturn;
}) {
  const { refreshTokens } = useRefreshCache();
  const { isOpen, onOpenChange } = disclosure;

  const [errors] = useState({});
  const [apiError, setApiError] = useState(false);
  const [apiErrorText, setApiErrorText] = useState("");
  const [apiErrorMessage, setApiErrorMessage] = useState("");

  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async (e: any) => {
    e.preventDefault();

    setIsLoading(true);

    const data = Object.fromEntries(new FormData(e.currentTarget));

    // Extract and cast bridgeID to string
    const bridgeID = data.bridgeID as string;

    const res = (await CreateBridgeToken(bridgeID)) as any;

    if (!res) {
      setIsLoading(false);
      setApiError(true);
      setApiErrorText("Unbekannter Fehler");
      setApiErrorMessage("Fehler beim Erstellen des Bridge Tokens");
      addToast({
        title: "Token",
        description: "Fehler beim Erstellen des Tokens",
        color: "danger",
        variant: "flat",
      });

      return;
    }

    if (res.success) {
      refreshTokens();
      onOpenChange();
      addToast({
        title: "Token",
        description: "Bridge Token wurde erfolgreich erstellt",
        color: "success",
        variant: "flat",
      });
    } else {
      setApiError(true);
      setApiErrorText(res.error);
      setApiErrorMessage(res.message);
      addToast({
        title: "Token",
        description: "Fehler beim Erstellen des Tokens",
        color: "danger",
        variant: "flat",
      });
    }

    setIsLoading(false);
  };

  return (
    <>
      <Modal isOpen={isOpen} placement="center" onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-wrap items-center">
                <div className="flex flex-col">
                  <p className="text-lg font-bold">Bridge Token generieren</p>
                  <p className="text-sm text-default-500">
                    Erstellen Sie einen neuen Bridge API Token
                  </p>
                </div>
              </ModalHeader>
              <ModalBody>
                {apiError && (
                  <ErrorCard error={apiErrorText} message={apiErrorMessage} />
                )}
                <Form
                  className="w-full items-stretch"
                  validationErrors={errors}
                  onSubmit={onSubmit}
                >
                  <div className="flex flex-col gap-4">
                    <Input
                      label="Bridge ID"
                      name="bridgeID"
                      placeholder="Geben Sie die Bridge ID ein"
                      type="text"
                      variant="flat"
                    />
                  </div>

                  <div className="flex flex-cols gap-2 mt-4 mb-2 items-center justify-end">
                    <Button
                      color="default"
                      startContent={
                        <Icon icon="hugeicons:cancel-01" width={18} />
                      }
                      type="reset"
                      variant="ghost"
                      onPress={onClose}
                    >
                      Abbrechen
                    </Button>
                    <Button
                      color="primary"
                      isLoading={isLoading}
                      startContent={
                        <Icon icon="hugeicons:plus-sign" width={18} />
                      }
                      type="submit"
                    >
                      Generieren
                    </Button>
                  </div>
                </Form>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
