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
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { useState } from "react";

import { siteTempData } from "@/config/data";

export default function BestellungOverviewModal({
  disclosure,
}: {
  disclosure: UseDisclosureReturn;
}) {
  const { isOpen, onOpenChange } = disclosure;

  const [itemList] = useState<{ id: string; name: string; quantity: number }[]>(
    siteTempData.artikel.map((item) => ({
      id: item.artikelnummer, // Map artikelnummer to id
      name: item.name, // Name stays the same
      quantity: item.lagernd, // Map lagernd to quantity
    })),
  );

  return (
    <Drawer
      backdrop="blur"
      isOpen={isOpen}
      size="xl"
      onOpenChange={onOpenChange}
    >
      <DrawerContent>
        {(onClose) => (
          <>
            <DrawerHeader className="flex flex-col gap-1">
              Bestellung #1234
            </DrawerHeader>
            <DrawerBody>
              <Input
                isReadOnly
                endContent={
                  <Icon
                    className="text-default-400"
                    icon="hugeicons:safe-delivery-01"
                    width={26}
                  />
                }
                label="Bestellt von"
                value={"Jason Neubert"}
                variant="flat"
              />
              <Input
                isReadOnly
                endContent={
                  <Icon
                    className="text-default-400"
                    icon="hugeicons:invoice-03"
                    width={26}
                  />
                }
                label="Kostenstelle"
                value={"Intern (999)"}
                variant="flat"
              />
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
                          readOnly
                          label="Stückzahl"
                          placeholder="Stückzahl"
                          size="sm"
                          value={item.quantity}
                          variant="bordered"
                        />
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </DrawerBody>
            <DrawerFooter className="flex flex-cols gap-4 items-end">
              <Button
                startContent={<Icon icon="hugeicons:cancel-01" width={18} />}
                variant="flat"
                onPress={onClose}
              >
                Schließen
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
