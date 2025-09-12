"use client";

import {
  Button,
  ButtonGroup,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Chip,
  Divider,
  Progress,
  Spacer,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";

import { siteTempData } from "@/config/data";

import DeleteModal from "../modals/delete";

export default function LagerList() {
  const deleteModal = useDisclosure();

  return (
    <main>
      <div className="grid grid-cols-2 items-stretch justify-between gap-4 lg:grid-cols-3">
        {siteTempData.artikel.map((item) => (
          <Card key={item.artikelnummer}>
            <CardHeader className="flex items-center justify-between">
              <p className="font-bold">{item.name}</p>
              <ButtonGroup size="sm" variant="flat">
                <Tooltip content="Details">
                  <Button isIconOnly>
                    <Icon icon="hugeicons:view" width={16} />
                  </Button>
                </Tooltip>
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
            <CardBody>
              <p>
                <span className="text-default-500">Lagernd:</span>{" "}
                {item.lagernd}
              </p>
              <p>
                <span className="text-default-500">Mind. Bedarf:</span>{" "}
                {item.min_bedarf}
              </p>
              <Spacer y={2} />
              <Progress
                aria-label="Loading..."
                size="sm"
                value={(item.lagernd / item.min_bedarf) * 100}
              />
            </CardBody>
            <CardFooter className="flex items-center justify-between">
              <p className="text-sm text-default-400">
                Artikelnummer: {item.artikelnummer}
              </p>
              {item.is_ordered && (
                <Chip color="warning" radius="sm" variant="flat">
                  Bestellt
                </Chip>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
      <DeleteModal disclosure={deleteModal} />
    </main>
  );
}
