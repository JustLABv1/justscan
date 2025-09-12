"use client";

import { Button, useDisclosure } from "@heroui/react";
import { Icon } from "@iconify/react";

import LieferscheinErstellenModal from "../modals/lieferschein/erstellen";

export default function KostenstellenHeading() {
  const lieferscheinErstellen = useDisclosure();

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xl font-bold mb-1">Kostenstellen</p>
        <div className="flex flex-cols justify-end gap-2">
          <Button
            color="primary"
            startContent={<Icon icon="hugeicons:invoice-03" width={18} />}
            variant="solid"
            onPress={lieferscheinErstellen.onOpen}
          >
            Kostenstelle Anlegen
          </Button>
        </div>
      </div>
      <LieferscheinErstellenModal disclosure={lieferscheinErstellen} />
    </main>
  );
}
