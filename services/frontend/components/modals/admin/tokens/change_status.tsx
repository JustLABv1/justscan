import type { UseDisclosureReturn } from "@heroui/use-disclosure";

import {
  addToast,
  Button,
  Input,
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
import ChangeTokenStatus from "@/lib/fetch/admin/PUT/ChangeTokenStatus";

export default function ChangeTokenStatusModal({
  disclosure,
  token,
  disabled,
}: {
  disclosure: UseDisclosureReturn;
  token: any;
  disabled: any;
}) {
  const { refreshTokens } = useRefreshCache();

  const { isOpen, onOpenChange } = disclosure;

  const [disableReason, setDisableReason] = React.useState("");
  const [isLoading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [errorText, setErrorText] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");

  async function changeTokenStatus() {
    setLoading(true);

    const res = (await ChangeTokenStatus(
      token.description,
      token.id,
      disabled,
      disableReason || "no info provided",
    )) as any;

    if (!res) {
      setLoading(false);
      setError(true);
      setErrorText("Failed to update token status");
      setErrorMessage("Failed to update token status");
      addToast({
        title: "Project",
        description: "Failed to update token status",
        color: "danger",
        variant: "flat",
      });

      return;
    }

    if (res.success) {
      setLoading(false);
      setError(false);
      setErrorText("");
      setErrorMessage("");
      onOpenChange();
      refreshTokens();
      addToast({
        title: "Project",
        description: "Token status updated successfully",
        color: "success",
        variant: "flat",
      });
    } else {
      setLoading(false);
      setError(true);
      setErrorText(res.error);
      setErrorMessage(res.message);
      refreshTokens();
      addToast({
        title: "Project",
        description: "Failed to update token status",
        color: "danger",
        variant: "flat",
      });
    }
  }

  return (
    <main>
      <Modal isOpen={isOpen} placement="top-center" onOpenChange={onOpenChange}>
        {disabled && (
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-wrap items-center">
                  <div className="flex flex-col">
                    <p className="text-lg font-bold">Token Deaktivieren</p>
                    <p className="text-sm text-default-500">
                      Sind Sie sicher, dass Sie diesen Token deaktivieren
                      möchten?
                    </p>
                  </div>
                </ModalHeader>
                <ModalBody>
                  {error && (
                    <ErrorCard error={errorText} message={errorMessage} />
                  )}
                  <Snippet hideCopyButton hideSymbol>
                    <span>ID: {token.id}</span>
                  </Snippet>
                  <Input
                    label="Deaktivierungsgrund"
                    placeholder="Geben Sie den Grund für die Deaktivierung dieses Tokens ein"
                    value={disableReason}
                    variant="flat"
                    onValueChange={setDisableReason}
                  />
                </ModalBody>
                <ModalFooter>
                  <Button
                    color="default"
                    startContent={
                      <Icon icon="hugeicons:cancel-01" width={18} />
                    }
                    variant="ghost"
                    onPress={onClose}
                  >
                    Abbrechen
                  </Button>
                  <Button
                    color="danger"
                    isLoading={isLoading}
                    startContent={
                      <Icon icon="hugeicons:square-lock-01" width={18} />
                    }
                    onPress={changeTokenStatus}
                  >
                    Deaktivieren
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        )}
        {!disabled && (
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-wrap items-center">
                  <div className="flex flex-col">
                    <p className="text-lg font-bold">Token Aktivieren</p>
                    <p className="text-sm text-default-500">
                      Sind Sie sicher, dass Sie diesen Token aktivieren möchten?
                    </p>
                  </div>
                </ModalHeader>
                <ModalBody>
                  <Snippet hideCopyButton hideSymbol>
                    <span>ID: {token.id}</span>
                  </Snippet>
                </ModalBody>
                <ModalFooter>
                  <Button
                    color="default"
                    startContent={
                      <Icon icon="hugeicons:cancel-01" width={18} />
                    }
                    variant="flat"
                    onPress={onClose}
                  >
                    Abbrechen
                  </Button>
                  <Button
                    color="success"
                    isLoading={isLoading}
                    startContent={
                      <Icon icon="hugeicons:square-unlock-01" width={18} />
                    }
                    onPress={changeTokenStatus}
                  >
                    Aktivieren
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        )}
      </Modal>
    </main>
  );
}
