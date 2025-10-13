"use client";

import React, { useState } from "react";
import {
  Button,
  Input,
  Card,
  CardBody,
  CardHeader,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  addToast,
} from "@heroui/react";
import { Download, Upload, Wifi, Server } from "lucide-react";

interface CSVTransferProps {
  lieferscheinId: string;
  onTransferComplete?: () => void;
}

interface TransferConfig {
  targetUrl: string;
  authToken: string;
  fieldName: string;
  customHeaders: Record<string, string>;
}

export default function CSVTransfer({
  lieferscheinId,
  onTransferComplete,
}: CSVTransferProps) {
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [isTransferring, setIsTransferring] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [transferConfig, setTransferConfig] = useState<TransferConfig>({
    targetUrl: "",
    authToken: "",
    fieldName: "file",
    customHeaders: {},
  });

  // Download CSV file to device
  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(
        `/api/lieferschein/download/${lieferscheinId}`,
        {
          method: "GET",
          headers: {
            // eslint-disable-next-line no-undef
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to download CSV file");
      }

      // Create blob and download
      const blob = await response.blob();
      // eslint-disable-next-line no-undef
      const url = window.URL.createObjectURL(blob);
      // eslint-disable-next-line no-undef
      const a = document.createElement("a");

      a.href = url;
      a.download = `lieferschein_${lieferscheinId}.csv`;
      // eslint-disable-next-line no-undef
      document.body.appendChild(a);
      a.click();
      // eslint-disable-next-line no-undef
      window.URL.revokeObjectURL(url);
      // eslint-disable-next-line no-undef
      document.body.removeChild(a);
      addToast({
        title: "Erfolg",
        description: "CSV-Datei erfolgreich heruntergeladen",
        color: "success",
        variant: "flat",
      });
    } catch (error) {
      console.error("Download error:", error);
      addToast({
        title: "Fehler",
        description: "Fehler beim Herunterladen der CSV-Datei",
        color: "danger",
        variant: "flat",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  // Transfer CSV directly to customer server
  const handleTransfer = async () => {
    if (!transferConfig.targetUrl.trim()) {
      addToast({
        title: "Fehler",
        description: "Bitte geben Sie die Ziel-URL ein",
        color: "danger",
        variant: "flat",
      });

      return;
    }

    setIsTransferring(true);
    try {
      const response = await fetch("/api/lieferschein/transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // eslint-disable-next-line no-undef
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          lieferschein_id: lieferscheinId,
          target_url: transferConfig.targetUrl,
          auth_token: transferConfig.authToken || undefined,
          field_name: transferConfig.fieldName || "file",
          custom_headers:
            Object.keys(transferConfig.customHeaders).length > 0
              ? transferConfig.customHeaders
              : undefined,
        }),
      });

      const result = await response.json();

      if (response.ok && result.result === "success") {
        addToast({
          title: "Erfolg",
          description: "CSV-Datei erfolgreich übertragen",
          color: "success",
          variant: "flat",
        });
        onOpenChange(); // Close modal
        onTransferComplete?.();
      } else {
        throw new Error(result.message || "Transfer failed");
      }
    } catch (error) {
      console.error("Transfer error:", error);
      addToast({
        title: "Fehler",
        description:
          (error as Error).message ||
          "Fehler bei der Übertragung der CSV-Datei",
        color: "danger",
        variant: "flat",
      });
    } finally {
      setIsTransferring(false);
    }
  };

  const addCustomHeader = () => {
    // eslint-disable-next-line no-undef
    const key = prompt("Header-Name eingeben:");
    // eslint-disable-next-line no-undef
    const value = prompt("Header-Wert eingeben:");

    if (key && value) {
      setTransferConfig((prev) => ({
        ...prev,
        customHeaders: {
          ...prev.customHeaders,
          [key]: value,
        },
      }));
    }
  };

  const removeCustomHeader = (key: string) => {
    setTransferConfig((prev) => ({
      ...prev,
      customHeaders: Object.fromEntries(
        Object.entries(prev.customHeaders).filter(([k]) => k !== key),
      ),
    }));
  };

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        <Button
          color="primary"
          isLoading={isDownloading}
          size="sm"
          startContent={<Download size={16} />}
          variant="flat"
          onPress={handleDownload}
        >
          CSV herunterladen
        </Button>

        <Button
          color="secondary"
          size="sm"
          startContent={<Wifi size={16} />}
          variant="flat"
          onPress={onOpen}
        >
          Auf Server übertragen
        </Button>
      </div>

      <Modal
        isOpen={isOpen}
        scrollBehavior="inside"
        size="2xl"
        onOpenChange={onOpenChange}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Server size={20} />
                  CSV auf Kundenserver übertragen
                </div>
                <p className="text-sm text-default-500 font-normal">
                  Lieferschein ID: {lieferscheinId}
                </p>
              </ModalHeader>
              <ModalBody>
                <Card>
                  <CardHeader>
                    <h4 className="text-md font-semibold">
                      Server-Konfiguration
                    </h4>
                  </CardHeader>
                  <CardBody className="gap-4">
                    <Input
                      isRequired
                      description="Die Upload-URL auf dem Kundenserver"
                      label="Ziel-URL"
                      placeholder="https://customer-server.local/upload"
                      value={transferConfig.targetUrl}
                      onChange={(e) =>
                        setTransferConfig((prev) => ({
                          ...prev,
                          targetUrl: e.target.value,
                        }))
                      }
                    />

                    <Input
                      description="Falls der Server Authentifizierung benötigt"
                      label="Authentifizierung-Token"
                      placeholder="Optional: Bearer Token oder API Key"
                      value={transferConfig.authToken}
                      onChange={(e) =>
                        setTransferConfig((prev) => ({
                          ...prev,
                          authToken: e.target.value,
                        }))
                      }
                    />

                    <Input
                      description="Name des Formular-Feldes für die Datei"
                      label="Feld-Name"
                      placeholder="file"
                      value={transferConfig.fieldName}
                      onChange={(e) =>
                        setTransferConfig((prev) => ({
                          ...prev,
                          fieldName: e.target.value,
                        }))
                      }
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader className="flex justify-between">
                    <h4 className="text-md font-semibold">
                      Benutzerdefinierte Header
                    </h4>
                    <Button size="sm" onPress={addCustomHeader}>
                      Header hinzufügen
                    </Button>
                  </CardHeader>
                  <CardBody>
                    {Object.entries(transferConfig.customHeaders).length ===
                    0 ? (
                      <p className="text-sm text-default-500">
                        Keine benutzerdefinierten Header konfiguriert
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {Object.entries(transferConfig.customHeaders).map(
                          ([key, value]) => (
                            <div
                              key={key}
                              className="flex justify-between items-center p-2 border rounded"
                            >
                              <span className="text-sm">
                                <strong>{key}:</strong> {value}
                              </span>
                              <Button
                                color="danger"
                                size="sm"
                                variant="light"
                                onPress={() => removeCustomHeader(key)}
                              >
                                Entfernen
                              </Button>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </CardBody>
                </Card>
              </ModalBody>
              <ModalFooter>
                <Button color="danger" variant="light" onPress={onClose}>
                  Abbrechen
                </Button>
                <Button
                  color="primary"
                  isLoading={isTransferring}
                  startContent={<Upload size={16} />}
                  onPress={handleTransfer}
                >
                  Übertragen
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
