"use client";

import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";

export default function BestellungenHeading() {
  // const createFolderModal = useDisclosure();
  // const createFlowModal = useDisclosure();

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
              // onPress={createFolderModal.onOpen}
            >
              Bestellung Aufgeben
            </Button>
          </div>
        </div>
      </div>
      {/* <CreateFolderModal
        disclosure={createFolderModal}
        folders={folders}
        projects={projects}
      /> */}
    </main>
  );
}
