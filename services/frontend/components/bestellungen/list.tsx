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
  Spacer,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";

import DeleteModal from "../modals/delete";
import BestellungOverviewModal from "../modals/bestellung/overview";

export default function BestellungenList() {
  const deleteModal = useDisclosure();
  const bestellungModal = useDisclosure();

  return (
    <main>
      <div className="grid grid-cols-2 items-center justify-between gap-2 lg:grid-cols-2">
        <p className="text-lg font-semibold">Wartend</p>
      </div>
      <Spacer y={2} />
      <div className="grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <Chip color="warning" radius="sm" variant="dot">
              Offen
            </Chip>
            <ButtonGroup size="sm" variant="flat">
              <Tooltip content="Abschließen">
                <Button isIconOnly color="success">
                  <Icon icon="hugeicons:tick-01" width={16} />
                </Button>
              </Tooltip>
              <Tooltip content="Bearbeiten">
                <Button isIconOnly>
                  <Icon icon="hugeicons:edit-03" width={16} />
                </Button>
              </Tooltip>
              <Tooltip content="Löschen">
                <Button isIconOnly color="danger" onPress={deleteModal.onOpen}>
                  <Icon icon="hugeicons:delete-02" width={16} />
                </Button>
              </Tooltip>
            </ButtonGroup>
          </CardHeader>
          <Divider />
          <CardBody>
            <p className="text-sm text-gray-500">Bestellnummer: 12345</p>
            <p className="text-sm text-gray-500">Kostenstelle: 999</p>
            <p className="text-sm text-gray-500">
              Aufgegeben von: Jason Neubert
            </p>
            <Spacer y={2} />
            <div className="grid grid-cols-2 gap-2">
              <Button
                color="primary"
                startContent={<Icon icon="hugeicons:file-export" width={18} />}
              >
                Exportieren
              </Button>
              <Button
                startContent={<Icon icon="hugeicons:file-02" width={18} />}
                onPress={bestellungModal.onOpen}
              >
                Details
              </Button>
            </div>
          </CardBody>
          <Divider />
          <CardFooter className="flex flex-wrap gap-2">
            <Chip radius="sm" size="sm" variant="flat">
              Aufgegeben: 01.01.2024
            </Chip>
          </CardFooter>
        </Card>
      </div>

      <Spacer y={6} />

      <div className="grid grid-cols-2 items-center justify-between gap-2 lg:grid-cols-2">
        <p className="text-lg font-semibold">Erledigt</p>
      </div>
      <Spacer y={2} />
      <div className="grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <Chip color="success" radius="sm" variant="dot">
              Abgeschlossen
            </Chip>
            <ButtonGroup size="sm" variant="flat">
              <Tooltip content="Abschließen">
                <Button isDisabled isIconOnly color="success">
                  <Icon icon="hugeicons:tick-01" width={16} />
                </Button>
              </Tooltip>
              <Tooltip content="Bearbeiten">
                <Button isDisabled isIconOnly>
                  <Icon icon="hugeicons:edit-03" width={16} />
                </Button>
              </Tooltip>
              <Tooltip content="Löschen">
                <Button isIconOnly color="danger" onPress={deleteModal.onOpen}>
                  <Icon icon="hugeicons:delete-02" width={16} />
                </Button>
              </Tooltip>
            </ButtonGroup>
          </CardHeader>
          <Divider />
          <CardBody>
            <p className="text-sm text-gray-500">Bestellnummer: 12345</p>
            <p className="text-sm text-gray-500">Kostenstelle: 999</p>
            <p className="text-sm text-gray-500">
              Aufgegeben von: Jason Neubert
            </p>
            <Spacer y={2} />
            <Button
              startContent={<Icon icon="hugeicons:file-02" width={18} />}
              onPress={bestellungModal.onOpen}
            >
              Details
            </Button>
          </CardBody>
          <Divider />
          <CardFooter className="flex flex-wrap gap-2">
            <Chip radius="sm" size="sm" variant="flat">
              Abgeschlossen: 02.01.2024
            </Chip>
            <Chip radius="sm" size="sm" variant="flat">
              Aufgegeben: 01.01.2024
            </Chip>
          </CardFooter>
        </Card>
      </div>
      <DeleteModal disclosure={deleteModal} />
      <BestellungOverviewModal disclosure={bestellungModal} />
    </main>
  );
}
