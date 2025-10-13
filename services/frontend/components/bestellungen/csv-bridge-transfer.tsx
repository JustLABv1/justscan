"use client";

import React, { useState, useEffect } from "react";
import {
  Button,
  Select,
  SelectItem,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Spinner,
} from "@heroui/react";
import {
  Download,
  Upload,
  Server,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

interface CSVBridgeTransferProps {
  lieferscheinId: string;
  onTransferComplete?: () => void;
}

interface BridgeService {
  id: string;
  service_id: string;
  service_name: string;
  version: string;
  upload_url: string;
  health_url: string;
  max_file_size: number;
  is_active: boolean;
  is_healthy: boolean;
  last_heartbeat: string;
}

export default function CSVBridgeTransfer({
  lieferscheinId,
  onTransferComplete,
}: CSVBridgeTransferProps) {
  const [bridges, setBridges] = useState<BridgeService[]>([]);
  const [selectedBridge, setSelectedBridge] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string>("");

  // Fetch available bridge services
  useEffect(() => {
    fetchBridgeServices();
  }, []);

  const fetchBridgeServices = async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/v1/bridge/active", {
        headers: {
          // eslint-disable-next-line no-undef
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch bridge services");
      }

      const data = await response.json();

      setBridges(data.bridges || []);
    } catch (err) {
      console.error("Error fetching bridge services:", err);
      setError("Fehler beim Laden der Bridge-Services");
      setBridges([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(
        `/api/v1/lieferschein/download/${lieferscheinId}`,
        {
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

      // Show success notification (assuming you have a toast system)
      console.log("CSV file downloaded successfully");
    } catch (err) {
      console.error("Download error:", err);
      setError("Fehler beim Herunterladen der CSV-Datei");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleTransfer = async () => {
    if (!selectedBridge) {
      setError("Bitte wählen Sie einen Bridge-Service aus");

      return;
    }

    setIsTransferring(true);
    setError("");

    try {
      const response = await fetch("/api/v1/lieferschein/transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // eslint-disable-next-line no-undef
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          lieferschein_id: lieferscheinId,
          bridge_service_id: selectedBridge,
          field_name: "file",
        }),
      });

      const result = await response.json();

      if (response.ok && result.result === "success") {
        console.log("CSV file transferred successfully");
        onTransferComplete?.();
      } else {
        throw new Error(result.message || "Transfer failed");
      }
    } catch (err) {
      console.error("Transfer error:", err);
      setError("Fehler bei der Übertragung der CSV-Datei");
    } finally {
      setIsTransferring(false);
    }
  };

  const getHealthyBridges = () => bridges.filter((bridge) => bridge.is_healthy);

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Server size={20} />
          <h3 className="text-lg font-semibold">CSV-Datei übertragen</h3>
        </div>
        <p className="text-sm text-default-500">
          Lieferschein ID: {lieferscheinId}
        </p>
      </CardHeader>

      <CardBody className="gap-4">
        {error && (
          <div className="p-3 bg-danger-50 border border-danger-200 rounded-lg">
            <div className="flex items-center gap-2">
              <AlertCircle className="text-danger-600" size={16} />
              <span className="text-danger-700 text-sm">{error}</span>
            </div>
          </div>
        )}

        {/* Download Option */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <h4 className="font-medium">CSV herunterladen</h4>
            <p className="text-sm text-default-500">
              Datei auf das Gerät herunterladen für manuellen Upload
            </p>
          </div>
          <Button
            color="primary"
            isLoading={isDownloading}
            startContent={<Download size={16} />}
            variant="flat"
            onPress={handleDownload}
          >
            Herunterladen
          </Button>
        </div>

        {/* Bridge Transfer Option */}
        <div className="border rounded-lg p-4 space-y-4">
          <div>
            <h4 className="font-medium">Automatische Übertragung</h4>
            <p className="text-sm text-default-500">
              Direkte Übertragung an einen registrierten Server im Netzwerk
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Spinner size="sm" />
              <span className="ml-2 text-sm">Lade Bridge-Services...</span>
            </div>
          ) : (
            <>
              {bridges.length === 0 ? (
                <div className="text-center p-4 text-default-500">
                  <Server className="mx-auto mb-2 opacity-50" size={32} />
                  <p className="text-sm">
                    Keine aktiven Bridge-Services verfügbar
                  </p>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="light"
                    onPress={fetchBridgeServices}
                  >
                    Erneut laden
                  </Button>
                </div>
              ) : (
                <>
                  <Select
                    label="Bridge-Service auswählen"
                    placeholder="Wählen Sie einen verfügbaren Service"
                    value={selectedBridge}
                    onChange={(e) => setSelectedBridge(e.target.value)}
                  >
                    {getHealthyBridges().map((bridge) => (
                      <SelectItem
                        key={bridge.service_id}
                        value={bridge.service_id}
                      >
                        <div className="flex items-center justify-between w-full">
                          <div>
                            <span className="font-medium">
                              {bridge.service_name}
                            </span>
                            <span className="text-xs text-default-400 ml-2">
                              v{bridge.version}
                            </span>
                          </div>
                          <Chip
                            color="success"
                            size="sm"
                            startContent={<CheckCircle size={12} />}
                          >
                            Online
                          </Chip>
                        </div>
                      </SelectItem>
                    ))}
                  </Select>

                  {selectedBridge && (
                    <div className="text-xs text-default-500">
                      {(() => {
                        const bridge = bridges.find(
                          (b) => b.service_id === selectedBridge,
                        );

                        return bridge ? (
                          <div>
                            <p>Ziel: {bridge.upload_url}</p>
                            <p>
                              Max. Dateigröße:{" "}
                              {Math.round(bridge.max_file_size / 1024 / 1024)}{" "}
                              MB
                            </p>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    color="secondary"
                    isDisabled={!selectedBridge}
                    isLoading={isTransferring}
                    startContent={<Upload size={16} />}
                    onPress={handleTransfer}
                  >
                    {isTransferring ? "Übertrage..." : "Übertragen"}
                  </Button>
                </>
              )}
            </>
          )}
        </div>

        {/* Bridge Status Summary */}
        {bridges.length > 0 && (
          <div className="text-xs text-default-500 border-t pt-4">
            <p>
              {getHealthyBridges().length} von {bridges.length} Bridge-Services
              verfügbar
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
