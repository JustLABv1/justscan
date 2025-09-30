import type { UseDisclosureReturn } from "@heroui/use-disclosure";

import {
  Button,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
import React from "react";
import { Icon } from "@iconify/react";

export default function DeleteModal({
  disclosure,
}: {
  disclosure: UseDisclosureReturn;
}) {
  const { isOpen, onOpenChange } = disclosure;

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
              {/* <ModalBody>
                {error && (
                  <ErrorCard error={errorText} message={errorMessage} />
                )}
                <Snippet hideCopyButton hideSymbol>
                  <span>
                    ID:
                    {alert.id}
                  </span>
                </Snippet>
              </ModalBody> */}
              <ModalFooter className="grid grid-cols-2">
                <Button color="default" variant="ghost" onPress={onClose}>
                  Abbrechen
                </Button>
                <Button
                  color="danger"
                  // isLoading={isDeleteLoading}
                  variant="solid"
                  // onPress={deleteAlert}
                  startContent={<Icon icon="hugeicons:delete-02" width={18} />}
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
