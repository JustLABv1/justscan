"use client";
/* eslint-env browser */

import {
  addToast,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Chip,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Spacer,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { useState } from "react";

import { useRefreshCache } from "@/lib/swr/hooks/useRefreshCache";
import UpdateBestellung from "@/lib/fetch/bestellungen/PUT/update";
import GetBestellungPDF from "@/lib/fetch/bestellungen/export";

import BestellungOverviewModal from "../modals/bestellung/overview";
import DeleteBestellungModal from "../modals/bestellung/delete";

export function BestellungCard({
  deleteModal,
  bestellungModal,
  bestellung,
  setTargetBestellung,
  updateBestellung,
  downloadBestellungPDF,
}: {
  deleteModal: any;
  bestellungModal: any;
  bestellung: any;
  setTargetBestellung: (bestellung: any) => void; // Add this type
  updateBestellung: (bestellung: any, status: string) => Promise<void>;
  downloadBestellungPDF: (bestellung: any) => void;
}) {
  function getChipColor(status: string) {
    switch (status) {
      case "offen":
        return "warning";
      case "bestellt":
        return "primary";
      case "abgeschlossen":
        return "success";
      default:
        return "default";
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <Chip
          className="capitalize"
          color={getChipColor(bestellung.status)}
          radius="sm"
          variant="dot"
        >
          {bestellung.status}
        </Chip>
        <Dropdown>
          <DropdownTrigger>
            <Button isIconOnly variant="light">
              <Icon icon="hugeicons:more-horizontal-circle-01" width={22} />
            </Button>
          </DropdownTrigger>
          <DropdownMenu aria-label="Static Actions">
            <DropdownItem
              key="status_offen"
              isDisabled={bestellung.status === "offen"}
              onPress={() => {
                updateBestellung(bestellung, "offen");
              }}
            >
              Offen
            </DropdownItem>
            <DropdownItem
              key="status_bestellt"
              isDisabled={bestellung.status === "bestellt"}
              onPress={() => {
                updateBestellung(bestellung, "bestellt");
              }}
            >
              Bestellt
            </DropdownItem>
            <DropdownItem
              key="status_abgeschlossen"
              isDisabled={bestellung.status === "abgeschlossen"}
              onPress={() => {
                updateBestellung(bestellung, "abgeschlossen");
              }}
            >
              Abgeschlossen
            </DropdownItem>
            <DropdownItem
              key="delete"
              className="text-danger"
              color="danger"
              onPress={() => {
                setTargetBestellung(bestellung);
                deleteModal.onOpen();
              }}
            >
              Löschen
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </CardHeader>
      <Divider />
      <CardBody>
        <p className="text-sm text-gray-500">Best.-Nr: {bestellung.id}</p>
        <p className="text-sm text-gray-500">
          Aufgegeben von: {bestellung.bestellt_von}
        </p>
        <Spacer y={2} />
        <div className="grid grid-cols-2 gap-2">
          <Button
            color="primary"
            startContent={<Icon icon="hugeicons:file-export" width={18} />}
            onPress={() => {
              downloadBestellungPDF(bestellung.id);
            }}
          >
            Exportieren
          </Button>
          <Button
            startContent={<Icon icon="hugeicons:file-02" width={18} />}
            onPress={() => {
              setTargetBestellung(bestellung);
              bestellungModal.onOpen();
            }}
          >
            Details
          </Button>
        </div>
      </CardBody>
      <Divider />
      <CardFooter className="flex flex-wrap gap-2">
        <Chip radius="sm" size="sm" variant="flat">
          Bestellt am: {new Date(bestellung.bestellt_am).toLocaleString()}
        </Chip>
      </CardFooter>
    </Card>
  );
}

export default function BestellungenList({
  bestellungen,
}: {
  bestellungen: any;
}) {
  const { refreshBestellungen } = useRefreshCache();
  const deleteModal = useDisclosure();
  const bestellungModal = useDisclosure();

  const [targetBestellung, setTargetBestellung] = useState<any>(null);

  async function downloadBestellungPDF(bestellungId: string) {
    const result = await GetBestellungPDF(bestellungId);

    if (!result.success) {
      addToast({
        title: "Fehler",
        description: result.message || "PDF konnte nicht erstellt werden.",
        color: "danger",
        variant: "flat",
      });

      return;
    }

    // Create download link for the PDF blob
    if (typeof window !== "undefined") {
      const url = URL.createObjectURL(result.blob);
      // eslint-disable-next-line no-undef
      const link = document.createElement("a");

      link.href = url;
      link.download = `bestellung_${bestellungId.substring(0, 8)}.pdf`;
      // eslint-disable-next-line no-undef
      document.body.appendChild(link);
      link.click();

      // Cleanup
      // eslint-disable-next-line no-undef
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      addToast({
        title: "Erfolg",
        description: "PDF wurde erfolgreich heruntergeladen.",
        color: "success",
        variant: "flat",
      });
    }
  }

  async function updateBestellung(bestellung: any, status: string) {
    const response = (await UpdateBestellung(bestellung.id, status)) as any;

    if (!response) {
      addToast({
        title: "Fehler",
        description: "Bestellung konnte nicht aktualisiert werden.",
        color: "danger",
        variant: "flat",
      });

      return;
    }

    if (response.success) {
      refreshBestellungen();
      addToast({
        title: "Erfolg",
        description: "Bestellung wurde erfolgreich aktualisiert.",
        color: "success",
        variant: "flat",
      });
    } else {
      addToast({
        title: "Fehler",
        description: `Bestellung konnte nicht aktualisiert werden: ${response.error}`,
        color: "danger",
        variant: "flat",
      });
    }
  }

  return (
    <main>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-semibold">Wartend</p>
        <Chip color="warning" radius="sm" variant="flat">
          {bestellungen.filter((b: any) => b.status === "offen").length}{" "}
          Bestellungen
        </Chip>
      </div>
      <Spacer y={2} />
      <div className="grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
        {bestellungen
          .filter((b: any) => b.status === "offen")
          .map((bestellung: any) => (
            <BestellungCard
              key={bestellung.id}
              bestellung={bestellung}
              bestellungModal={bestellungModal}
              deleteModal={deleteModal}
              downloadBestellungPDF={downloadBestellungPDF}
              setTargetBestellung={setTargetBestellung}
              updateBestellung={updateBestellung}
            />
          ))}
      </div>

      <Divider className="my-4" />

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-semibold">Bestellt</p>
        <Chip color="primary" radius="sm" variant="flat">
          {bestellungen.filter((b: any) => b.status === "bestellt").length}{" "}
          Bestellungen
        </Chip>
      </div>
      <Spacer y={2} />
      <div className="grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
        {bestellungen
          .filter((b: any) => b.status === "bestellt")
          .map((bestellung: any) => (
            <BestellungCard
              key={bestellung.id}
              bestellung={bestellung}
              bestellungModal={bestellungModal}
              deleteModal={deleteModal}
              downloadBestellungPDF={downloadBestellungPDF}
              setTargetBestellung={setTargetBestellung}
              updateBestellung={updateBestellung}
            />
          ))}
      </div>

      <Divider className="my-4" />

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-semibold">Abgeschlossen</p>
        <Chip color="success" radius="sm" variant="flat">
          {bestellungen.filter((b: any) => b.status === "abgeschlossen").length}{" "}
          Bestellungen
        </Chip>
      </div>
      <Spacer y={2} />
      <div className="grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
        {bestellungen
          .filter((b: any) => b.status === "abgeschlossen")
          .map((bestellung: any) => (
            <BestellungCard
              key={bestellung.id}
              bestellung={bestellung}
              bestellungModal={bestellungModal}
              deleteModal={deleteModal}
              downloadBestellungPDF={downloadBestellungPDF}
              setTargetBestellung={setTargetBestellung}
              updateBestellung={updateBestellung}
            />
          ))}
      </div>
      <DeleteBestellungModal
        bestellung={targetBestellung}
        disclosure={deleteModal}
      />
      <BestellungOverviewModal
        bestellung={targetBestellung}
        disclosure={bestellungModal}
      />
    </main>
  );
}
