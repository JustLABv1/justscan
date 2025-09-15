"use client";

import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  Divider,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";

import DeleteModal from "../modals/delete";

export default function GeraeteList({ geraete }: { geraete: any }) {
  const deleteModal = useDisclosure();

  return (
    <main>
      {geraete.length === 0 && (
        <p className="text-center text-default-400">Keine Geräte vorhanden.</p>
      )}
      <div className="grid grid-cols-2 items-center justify-between gap-4 lg:grid-cols-3">
        {geraete.map((item: any) => (
          <Card key={item.geraetenummer}>
            <CardHeader className="flex items-center justify-between">
              <p className="font-bold">{item.anlagegut}</p>
              <Tooltip content="Löschen">
                <Button
                  isIconOnly
                  color="danger"
                  size="sm"
                  variant="flat"
                  onPress={deleteModal.onOpen}
                >
                  <Icon icon="hugeicons:delete-02" width={16} />
                </Button>
              </Tooltip>
            </CardHeader>
            <Divider />
            <CardFooter>
              <p className="text-sm text-default-400">
                Nummer: {item.geraetenummer}
              </p>
            </CardFooter>
          </Card>
        ))}
      </div>
      <DeleteModal disclosure={deleteModal} />
    </main>
  );
}
