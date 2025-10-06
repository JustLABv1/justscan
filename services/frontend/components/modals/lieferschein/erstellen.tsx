import type { UseDisclosureReturn } from "@heroui/use-disclosure";

import {
  addToast,
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
import CreateLieferschein from "@/lib/fetch/lieferschein/POST/CreateLieferschein";
import ErrorCard from "@/components/error/ErrorCard";

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

  const [besteller, setBesteller] = useState("");
  const [kostenstelleVon, setKostenstelleVon] = useState("");
  const [kostenstelleNeu, setKostenstelleNeu] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [, setScannedCode] = useState<string>("");

  const [itemList, setItemList] = useState<
    {
      artikel: string;
      betriebsnummer: string;
      kurzname: string;
      anzahl: number;
    }[]
  >([]);

  const handleScan = (code: string) => {
    setScannedCode(code);
    // search for artikel
    const foundItem = artikel.find((item: any) => item.betriebsnummer === code);

    if (!foundItem) {
      addToast({
        title: "Artikel nicht gefunden",
        description: `Der Artikel mit der Nummer ${code} wurde nicht gefunden.`,
        color: "danger",
      });

      return;
    } else {
      addToast({
        title: "Artikel gefunden",
        description: `Der Artikel ${foundItem.kurzname} wurde zur Liste hinzugefügt.`,
        color: "success",
      });
    }

    // check if item is already in list
    const isInList = itemList.find((item) => item.betriebsnummer === code);

    if (isInList) {
      // increase quantity by 1
      setItemList((prev) =>
        prev.map((item) =>
          item.betriebsnummer === code
            ? { ...item, anzahl: item.anzahl + 1 }
            : item,
        ),
      );

      return;
    }

    if (foundItem) {
      setItemList((prev) => [
        ...prev,
        {
          artikel: foundItem.artikel,
          betriebsnummer: foundItem.betriebsnummer,
          kurzname: foundItem.kurzname,
          anzahl: 1,
        },
      ]);
    }
  };

  const handleError = (_error: string) => {
    // Handle scan errors silently or show user notification
  };

  async function erstellen() {
    setIsLoading(true);

    if (
      !besteller ||
      !kostenstelleVon ||
      !kostenstelleNeu ||
      itemList.length === 0
    ) {
      setError(true);
      setErrorText("Fehlende Angaben");
      setErrorMessage("Bitte füllen Sie alle Felder aus.");
      setIsLoading(false);

      return;
    }

    const response = (await CreateLieferschein(
      besteller,
      kostenstelleVon,
      kostenstelleNeu,
      itemList,
    )) as any;

    if (!response) {
      setError(true);
      setErrorText("Fehler beim Erstellen des Lieferscheins");
      setErrorMessage("Bitte versuchen Sie es erneut.");
      setIsLoading(false);

      return;
    }

    if (response.success) {
      setIsLoading(false);
      addToast({
        title: "Lieferschein erstellt",
        description: `Der Lieferschein wurde erfolgreich erstellt.`,
        color: "success",
      });
      onOpenChange();
      setBesteller("");
      setKostenstelleNeu("");
      setKostenstelleVon("");
      setError(false);
      setErrorText("");
      setErrorMessage("");
      setItemList([]);
    } else {
      setError(true);
      setErrorText(response.error || "Fehler beim Erstellen der Bestellung");
      setErrorMessage(response.message || "Bitte versuchen Sie es erneut.");
      setIsLoading(false);
    }
  }

  const kostenstelleVonSelected = async (e: any) => {
    setKostenstelleVon(e);
  };

  const kostenstelleNeuSelected = async (e: any) => {
    setKostenstelleNeu(e);
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
              {error && (
                <div>
                  <ErrorCard error={errorText} message={errorMessage} />
                </div>
              )}
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
                value={besteller}
                variant="flat"
                onValueChange={(value) => setBesteller(value)}
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
                    description={kostenstelle.kostenstellenummer}
                    isDisabled={
                      kostenstelle.kostenstellenummer === kostenstelleNeu
                    }
                  >
                    {kostenstelle.bezeichnung}
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
                label="Kostenstelle Zu"
                placeholder="Geben Sie die neue Kostenstelle ein"
                selectedKey={kostenstelleNeu}
                onSelectionChange={kostenstelleNeuSelected}
              >
                {kostenstellen.map((kostenstelle: any) => (
                  <AutocompleteItem
                    key={kostenstelle.kostenstellenummer}
                    description={kostenstelle.kostenstellenummer}
                    isDisabled={
                      kostenstelle.kostenstellenummer === kostenstelleVon
                    }
                  >
                    {kostenstelle.bezeichnung}
                  </AutocompleteItem>
                ))}
              </Autocomplete>
              <Divider />
              <p className="text-sm font-semibold">Artikel</p>
              <div className="flex flex-col gap-2">
                {itemList.map((item) => (
                  <Card key={item.betriebsnummer}>
                    <CardBody className="bg-content2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-col">
                          <p>{item.kurzname}</p>
                          <p className="text-sm text-default-500">
                            {item.betriebsnummer}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <NumberInput
                            className="w-32"
                            defaultValue={1}
                            label="Stückzahl"
                            placeholder="Stückzahl"
                            size="sm"
                            value={item.anzahl}
                            variant="bordered"
                            onValueChange={(value) => {
                              const anzahl = value || 1;

                              setItemList((prev) =>
                                prev.map((i) =>
                                  i.betriebsnummer === item.betriebsnummer
                                    ? { ...i, anzahl }
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
                                  (i) =>
                                    i.betriebsnummer !== item.betriebsnummer,
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
            <DrawerFooter className="grid grid-cols-1 lg:grid-cols-3 md:grid-cols-2 gap-4 items-center">
              <Button
                color="danger"
                startContent={<Icon icon="hugeicons:cancel-01" width={18} />}
                variant="flat"
                onPress={onClose}
              >
                Abbrechen
              </Button>

              <BarcodeScanner onError={handleError} onScan={handleScan} />

              <Button
                color="primary"
                isDisabled={
                  !besteller ||
                  !kostenstelleVon ||
                  !kostenstelleNeu ||
                  itemList.length === 0
                }
                isLoading={isLoading}
                startContent={<Icon icon="hugeicons:note-done" width={18} />}
                onPress={erstellen}
              >
                Erstellen
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
