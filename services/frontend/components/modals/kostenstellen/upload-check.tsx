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
  Card,
  CardBody,
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
        size="lg"
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
                <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Card className="bg-content2">
                    <CardBody className="text-center">
                      <p className="text-md">
                        {data.count !== undefined ? data.count : "N/A"}
                      </p>
                      <p className="text-sm text-default-500">Erkannt</p>
                    </CardBody>
                  </Card>

                  <Card className="bg-content2">
                    <CardBody className="text-center">
                      <p className="text-md">
                        {data.db_count !== undefined ? data.db_count : "N/A"}
                      </p>
                      <p className="text-sm text-default-500">Im System</p>
                    </CardBody>
                  </Card>

                  <Card className="bg-content2">
                    <CardBody className="text-center">
                      <p className="text-md">
                        {data.new_count !== undefined ? data.new_count : "N/A"}
                      </p>
                      <p className="text-sm text-default-500">Neu</p>
                    </CardBody>
                  </Card>
                </div>

                <p className="font-semibold text-default-500">
                  Neue Kostenstellen
                </p>
                <ScrollShadow className="max-h-96">
                  <div className="flex flex-wrap gap-2">
                    {data.new_kostenstellen !== null &&
                      data.new_kostenstellen.map(
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
                    {data.new_kostenstellen === null && (
                      <p className="font-semibold">
                        Keine neuen Kostenstellen vorhanden.
                      </p>
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
