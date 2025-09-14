import type { UseDisclosureReturn } from "@heroui/use-disclosure";

import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ScrollShadow,
} from "@heroui/react";
import React from "react";
import { Icon } from "@iconify/react";

export default function KostenstellenUploadCheckModal({
  disclosure,
  data,
}: {
  disclosure: UseDisclosureReturn;
  data: any;
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
                  <p className="text-lg font-bold">
                    Kostenstellen Upload Übersicht
                  </p>
                </div>
              </ModalHeader>
              <ModalBody>
                <p className="text-md">
                  Anzahl der erkannten Kostenstellen:{" "}
                  <span className="font-bold">
                    {data.count !== undefined ? data.count : "N/A"}
                  </span>
                </p>
                <ScrollShadow className="max-h-96">
                  <div className="mt-4 flex flex-wrap gap-2">
                    {data.kostenstellen.map(
                      (kostenstelle: string, index: number) => (
                        <Chip
                          key={index}
                          className="text-md"
                          radius="sm"
                          variant="flat"
                        >
                          {kostenstelle}
                        </Chip>
                      ),
                    )}
                  </div>
                </ScrollShadow>
              </ModalBody>
              <ModalFooter>
                <Button
                  fullWidth
                  startContent={<Icon icon="hugeicons:tick-01" width={18} />}
                  variant="solid"
                  onPress={onClose}
                >
                  OK
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </main>
  );
}
