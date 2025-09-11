"use client";

import { Button, Chip } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useState } from "react";

import BarcodeScanner from "../barcode-scanner";

export default function LagerHeading() {
  // const createFolderModal = useDisclosure();
  // const createFlowModal = useDisclosure();

  const [scannedCode, setScannedCode] = useState<string>("");

  const handleScan = (code: string) => {
    setScannedCode(code);
  };

  const handleError = (_error: string) => {
    // Handle scan errors silently or show user notification
  };

  return (
    <main>
      {/* Barcode Scanner Section */}
      <BarcodeScanner onError={handleError} onScan={handleScan} />

      {scannedCode && (
        <div className="mb-4">
          <Chip color="success" variant="flat">
            Gescannt: {scannedCode}
          </Chip>
        </div>
      )}
      <div className="grid grid-cols-2 items-center justify-between gap-2 lg:grid-cols-2">
        <p className="text-2xl font-bold mb-1">Lager</p>
        <div className="flex flex-cols justify-end gap-2">
          <div className="flex gap-2">
            <Button
              color="primary"
              startContent={<Icon icon="hugeicons:note-add" width={18} />}
              variant="solid"
              // onPress={createFolderModal.onOpen}
            >
              Lieferschein Erstellen
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
