import type { UseDisclosureReturn } from "@heroui/use-disclosure";

import {
  Autocomplete,
  AutocompleteItem,
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
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { useState } from "react";

import BarcodeScanner from "@/components/barcode-scanner";

export default function LieferscheinErstellenModal({
  disclosure,
  kostenstellen,
  artikel,
}: {
  disclosure: UseDisclosureReturn;
  kostenstellen: any;
  artikel: any;
}) {
  const { isOpen, onOpenChange } = disclosure;

  const [kostenstelleVon, setKostenstelleVon] = useState("");
  const [kostenstelleNeu, setKostenstelleNeu] = useState("");

  const [, setScannedCode] = useState<string>("");

  const [itemList, setItemList] = useState<
    { artikelnummer: string; kurzname: string; quantity: number }[]
  >([]);

  const handleScan = (code: string) => {
    setScannedCode(code);
    // search for icon in siteTempData.artikel
    const foundItem = artikel.find((item: any) => item.artikelnummer === code);

    // check if item is already in list
    const isInList = itemList.find((item) => item.artikelnummer === code);

    if (isInList) {
      // increase quantity by 1
      setItemList((prev) =>
        prev.map((item) =>
          item.artikelnummer === code
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        ),
      );

      return;
    }

    if (foundItem) {
      setItemList((prev) => [
        ...prev,
        {
          artikelnummer: foundItem.artikelnummer,
          kurzname: foundItem.kurzname,
          quantity: 1,
        },
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
              <Autocomplete
                endContent={
                  <Icon
                    className="text-default-400"
                    icon="hugeicons:euro-receive"
                    width={26}
                  />
                }
                itemHeight={50}
                label="Kostenstelle Von"
                placeholder="Wählen Sie eine Kostenstelle"
                selectedKey={kostenstelleVon}
                onSelectionChange={kostenstelleVonSelected}
              >
                {kostenstellen.map((kostenstelle: any) => (
                  <AutocompleteItem
                    key={kostenstelle.kostenstellenummer}
                    description={kostenstelle.bezeichnung}
                    isDisabled={
                      kostenstelle.kostenstellenummer === kostenstelleNeu
                    }
                  >
                    {kostenstelle.kostenstellenummer}
                  </AutocompleteItem>
                ))}
              </Autocomplete>
              <Autocomplete
                endContent={
                  <Icon
                    className="text-default-400"
                    icon="hugeicons:euro-send"
                    width={26}
                  />
                }
                itemHeight={50}
                label="Kostenstelle Neu"
                placeholder="Geben Sie die neue Kostenstelle ein"
                selectedKey={kostenstelleNeu}
                onSelectionChange={kostenstelleNeuSelected}
              >
                {kostenstellen.map((kostenstelle: any) => (
                  <AutocompleteItem
                    key={kostenstelle.kostenstellenummer}
                    description={kostenstelle.bezeichnung}
                    isDisabled={
                      kostenstelle.kostenstellenummer === kostenstelleVon
                    }
                  >
                    {kostenstelle.kostenstellenummer}
                  </AutocompleteItem>
                ))}
              </Autocomplete>
              <Divider />
              <p className="text-sm font-semibold">Artikel</p>
              <div className="flex flex-col gap-2">
                {itemList.map((item) => (
                  <Card key={item.artikelnummer}>
                    <CardBody className="bg-content2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-col">
                          <p>{item.kurzname}</p>
                          <p className="text-sm text-default-500">
                            {item.artikelnummer}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <NumberInput
                            className="w-32"
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
                                  i.artikelnummer === item.artikelnummer
                                    ? { ...i, quantity }
                                    : i,
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
                                prev.filter(
                                  (i) => i.artikelnummer !== item.artikelnummer,
                                ),
                              );
                            }}
                          >
                            <Icon icon="hugeicons:delete-02" width={18} />
                          </Button>
                        </div>
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
                        artikelnummer: newId,
                        kurzname: "Manuell Hinzugefügter Artikel",
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
