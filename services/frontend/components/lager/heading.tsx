"use client";

import { Button, Chip, Input, useDisclosure } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useState } from "react";

import BarcodeScanner from "../barcode-scanner";
import LieferscheinErstellenModal from "../modals/lieferschein/erstellen";

export default function LagerHeading() {
  const lieferscheinErstellen = useDisclosure();

  const [scannedCode, setScannedCode] = useState<string>("");

  const handleScan = (code: string) => {
    setScannedCode(code);
  };

  const handleError = (_error: string) => {
    // Handle scan errors silently or show user notification
  };

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xl font-bold mb-1">Lager</p>
        <div className="flex flex-cols justify-end gap-2">
          {scannedCode && (
            <div className="mb-4">
              <Chip color="success" variant="flat">
                Gescannt: {scannedCode}
              </Chip>
            </div>
          )}
          <BarcodeScanner onError={handleError} onScan={handleScan} />
          <Button
            color="primary"
            startContent={<Icon icon="hugeicons:note-add" width={18} />}
            variant="solid"
            onPress={lieferscheinErstellen.onOpen}
          >
            Lieferschein Erstellen
          </Button>
        </div>
      </div>
      <LieferscheinErstellenModal disclosure={lieferscheinErstellen} />
    </main>
  );
}
