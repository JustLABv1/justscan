"use client";

import { Button, useDisclosure } from "@heroui/react";
import { Icon } from "@iconify/react";

import BestellungAufgebenModal from "../modals/bestellung/aufgeben";

export default function BestellungenHeading() {
  const bestellungAufgebenModal = useDisclosure();

  return (
    <main>
      <div className="grid grid-cols-2 items-center justify-between gap-2 lg:grid-cols-2">
        <p className="text-2xl font-bold mb-1">Bestellungen</p>
        <div className="flex flex-cols justify-end gap-2">
          <div className="flex gap-2">
            <Button
              color="primary"
              startContent={<Icon icon="hugeicons:package-add" width={18} />}
              variant="solid"
              onPress={bestellungAufgebenModal.onOpen}
            >
              Bestellung Aufgeben
            </Button>
          </div>
        </div>
      </div>
      <BestellungAufgebenModal disclosure={bestellungAufgebenModal} />
    </main>
  );
}
