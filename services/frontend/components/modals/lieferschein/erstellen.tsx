import type { UseDisclosureReturn } from "@heroui/use-disclosure";

import {
  Button,
  Card,
  CardBody,
  Divider,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  Input,
  NumberInput,
  Select,
  SelectItem,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { useState } from "react";

import BarcodeScanner from "@/components/barcode-scanner";
import { siteTempData } from "@/config/data";

export default function LieferscheinErstellenModal({
  disclosure,
}: {
  disclosure: UseDisclosureReturn;
}) {
  const { isOpen, onOpenChange } = disclosure;

  const [kostenstelleVon, setKostenstelleVon] = useState("");
  const [kostenstelleNeu, setKostenstelleNeu] = useState("");

  const [, setScannedCode] = useState<string>("");

  const [itemList, setItemList] = useState<
    { id: string; name: string; quantity: number }[]
  >([]);

  const handleScan = (code: string) => {
    setScannedCode(code);
    // search for icon in siteTempData.artikel
    const foundItem = siteTempData.artikel.find(
      (item) => item.artikelnummer === code,
    );

    // check if item is already in list
    const isInList = itemList.find((item) => item.id === code);

    if (isInList) {
      // increase quantity by 1
      setItemList((prev) =>
        prev.map((item) =>
          item.id === code ? { ...item, quantity: item.quantity + 1 } : item,
        ),
      );

      return;
    }

    if (foundItem) {
      setItemList((prev) => [
        ...prev,
        { id: foundItem.artikelnummer, name: foundItem.name, quantity: 1 },
      ]);
    }
  };

  const handleError = (_error: string) => {
    // Handle scan errors silently or show user notification
  };

  function erstellen() {
    onOpenChange();
  }

  const kostenstelleVonSelected = async (e: any) => {
    setKostenstelleVon(e.currentKey);
  };

  const kostenstelleNeuSelected = async (e: any) => {
    setKostenstelleNeu(e.currentKey);
  };

  return (
    <Drawer
      backdrop="blur"
      isDismissable={false}
      isKeyboardDismissDisabled={true}
      isOpen={isOpen}
      size="xl"
      onOpenChange={onOpenChange}
    >
      <DrawerContent>
        {(onClose) => (
          <>
            <DrawerHeader className="flex flex-col gap-1">
              Lieferschein Erstellen
            </DrawerHeader>
            <DrawerBody>
              <Input
                classNames={{
                  inputWrapper: [
                    "data-[focus=true]:border-2 data-[focus=true]:border-primary",
                  ],
                }}
                endContent={
                  <Icon
                    className="text-default-400"
                    icon="hugeicons:safe-delivery-01"
                    width={26}
                  />
                }
                label="Abholer"
                placeholder="Geben Sie den Namen des Abholers ein"
                variant="flat"
              />
              <Select
                endContent={
                  <Icon
                    className="text-default-400"
                    icon="hugeicons:euro-receive"
                    width={26}
                  />
                }
                label="Kostenstelle Von"
                placeholder="Wählen Sie eine Kostenstelle"
                selectedKeys={[kostenstelleVon]}
                onSelectionChange={kostenstelleVonSelected}
              >
                {siteTempData.kostenstellen.map((kostenstelle) => (
                  <SelectItem
                    key={kostenstelle.nummer}
                    isDisabled={kostenstelle.nummer === kostenstelleNeu}
                  >
                    {kostenstelle.bezeichnung}
                  </SelectItem>
                ))}
              </Select>
              <Select
                endContent={
                  <Icon
                    className="text-default-400"
                    icon="hugeicons:euro-send"
                    width={26}
                  />
                }
                label="Kostenstelle Neu"
                placeholder="Geben Sie die neue Kostenstelle ein"
                selectedKeys={[kostenstelleNeu]}
                onSelectionChange={kostenstelleNeuSelected}
              >
                {siteTempData.kostenstellen.map((kostenstelle) => (
                  <SelectItem
                    key={kostenstelle.nummer}
                    isDisabled={kostenstelle.nummer === kostenstelleVon}
                  >
                    {kostenstelle.bezeichnung}
                  </SelectItem>
                ))}
              </Select>
              <Divider />
              <p className="text-sm font-semibold">Artikel</p>
              <div className="flex flex-col gap-2">
                {itemList.map((item) => (
                  <Card key={item.id}>
                    <CardBody className="bg-content2">
                      <div className="flex items-center gap-2">
                        <Input
                          readOnly
                          label="Artikelbezeichnung"
                          size="sm"
                          value={item.name}
                          variant="bordered"
                        />
                        <NumberInput
                          defaultValue={1}
                          label="Stückzahl"
                          placeholder="Stückzahl"
                          size="sm"
                          value={item.quantity}
                          variant="bordered"
                          onValueChange={(value) => {
                            const quantity = value || 1;

                            setItemList((prev) =>
                              prev.map((i) =>
                                i.id === item.id ? { ...i, quantity } : i,
                              ),
                            );
                          }}
                        />
                        <Button
                          isIconOnly
                          color="danger"
                          variant="flat"
                          onPress={() => {
                            setItemList((prev) =>
                              prev.filter((i) => i.id !== item.id),
                            );
                          }}
                        >
                          <Icon icon="hugeicons:delete-02" width={18} />
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </DrawerBody>
            <DrawerFooter className="flex flex-cols gap-4 justify-between">
              <div className="flex flex-col gap-2">
                <Button
                  color="primary"
                  startContent={<Icon icon="hugeicons:layer-add" width={18} />}
                  variant="flat"
                  onPress={() => {
                    const newId = `manual-${Math.random()
                      .toString(36)
                      .substring(2, 9)}`;

                    setItemList((prev) => [
                      ...prev,
                      {
                        id: newId,
                        name: "Manuell Hinzugefügter Artikel",
                        quantity: 1,
                      },
                    ]);
                  }}
                >
                  Manuell Hinzufügen
                </Button>
                <BarcodeScanner onError={handleError} onScan={handleScan} />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  color="danger"
                  startContent={<Icon icon="hugeicons:cancel-01" width={18} />}
                  variant="flat"
                  onPress={onClose}
                >
                  Abbrechen
                </Button>
                <Button
                  color="primary"
                  startContent={<Icon icon="hugeicons:note-done" width={18} />}
                  onPress={erstellen}
                >
                  Erstellen
                </Button>
              </div>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
