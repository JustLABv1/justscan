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
} from "@heroui/react";
import { Icon } from "@iconify/react";

export default function BestellungOverviewModal({
  disclosure,
  bestellung,
}: {
  disclosure: UseDisclosureReturn;
  bestellung: any;
}) {
  const { isOpen, onOpenChange } = disclosure;

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
              Bestellung {bestellung.id}
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
                value={bestellung.bestellt_von}
                variant="flat"
              />
              <Divider />
              <p className="text-sm font-semibold">Artikel</p>
              <div className="flex flex-col gap-2">
                {bestellung.artikel.map((item: any) => (
                  <Card key={item.betriebsnummer}>
                    <CardBody className="bg-content2">
                      <div className="flex flex-cols items-center justify-between gap-2">
                        <div className="flex flex-col max-w-xs">
                          <p>{item.kurzname}</p>
                          <p className="text-sm text-default-500">
                            {item.betriebsnummer}
                          </p>
                        </div>

                        <p className="text-lg font-bold">{item.anzahl}x</p>
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
