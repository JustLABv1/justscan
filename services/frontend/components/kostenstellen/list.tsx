"use client";

import {
  Button,
  ButtonGroup,
  Card,
  CardFooter,
  CardHeader,
  Divider,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";

import DeleteModal from "../modals/delete";

export default function KostenstellenList({
  kostenstellen,
}: {
  kostenstellen: any;
}) {
  const deleteModal = useDisclosure();

  return (
    <main>
      <div className="grid grid-cols-2 items-center justify-between gap-4 lg:grid-cols-3">
        {kostenstellen.map((item: any) => (
          <Card key={item.nummer}>
            <CardHeader className="flex items-center justify-between">
              <p className="font-bold">{item.bezeichnung}</p>
              <ButtonGroup size="sm" variant="flat">
                <Tooltip content="Bearbeiten">
                  <Button isIconOnly>
                    <Icon icon="hugeicons:edit-03" width={16} />
                  </Button>
                </Tooltip>
                <Tooltip content="Löschen">
                  <Button
                    isIconOnly
                    color="danger"
                    onPress={deleteModal.onOpen}
                  >
                    <Icon icon="hugeicons:delete-02" width={16} />
                  </Button>
                </Tooltip>
              </ButtonGroup>
            </CardHeader>
            <Divider />
            <CardFooter>
              <p className="text-sm text-default-400">
                Nummer: {item.kostenstellenummer}
              </p>
            </CardFooter>
          </Card>
        ))}
      </div>
      <DeleteModal disclosure={deleteModal} />
    </main>
  );
}
