"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Icon } from "@iconify/react";
import { Html5Qrcode } from "html5-qrcode";

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  onError?: (error: string) => void;
}

export default function BarcodeScanner({
  onScan,
  onError,
}: BarcodeScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string>("");
  const [hasCamera, setHasCamera] = useState<boolean>(true);
  const [isPWA, setIsPWA] = useState<boolean>(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivRef = useRef(null);

  useEffect(() => {
    // Only run on client side
    if (typeof window === "undefined") return;

    // Detect if running as PWA
    let isPWAMode = false;

    try {
      // eslint-disable-next-line no-undef
      const win = window as any;

      isPWAMode =
        win.matchMedia("(display-mode: standalone)").matches ||
        win.navigator.standalone ||
        (typeof document !== "undefined" &&
          // eslint-disable-next-line no-undef
          document.referrer.includes("android-app://"));
    } catch {
      isPWAMode = false;
    }

    setIsPWA(isPWAMode);

    // Pre-check camera availability and request permissions immediately
    checkAndRequestCameraPermissions();

    // Cleanup function
    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => {
            scannerRef.current?.clear();
            scannerRef.current = null;
          })
          .catch(() => {
            // Ignore cleanup errors
          });
      }
    };
  }, []);

  const checkAndRequestCameraPermissions = async () => {
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setHasCamera(false);
        setError("Kamera API wird nicht unterstützt");

        return;
      }

      // iOS Safari specific checks
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

      // Request camera permissions with back camera preference
      const constraints = isIOS
        ? {
            video: {
              facingMode: { exact: "environment" }, // Force back camera
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
            },
          }
        : {
            video: {
              facingMode: { exact: "environment" }, // Force back camera
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
          };

      // Test camera access and immediately stop it (just to get permissions)
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      stream.getTracks().forEach((track) => track.stop());

      setHasCamera(true);
      setError("");
    } catch {
      // If exact back camera fails, try with ideal constraint
      try {
        const fallbackConstraints = {
          video: {
            facingMode: "environment", // Prefer back camera but allow fallback
          },
        };

        const stream =
          await navigator.mediaDevices.getUserMedia(fallbackConstraints);

        stream.getTracks().forEach((track) => track.stop());

        setHasCamera(true);
        setError("");
      } catch (fallbackError: any) {
        setHasCamera(false);

        if (fallbackError.name === "NotAllowedError") {
          setError(
            "Kamera-Zugriff verweigert. Bitte erlauben Sie den Zugriff.",
          );
        } else if (fallbackError.name === "NotFoundError") {
          setError("Keine Kamera gefunden");
        } else {
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

          if (isIOS) {
            setError("iOS: HTTPS erforderlich oder Kamera nicht verfügbar.");
          } else {
            setError(`Kamera-Fehler: ${fallbackError.message || "Unbekannt"}`);
          }
        }
      }
    }
  };

  const handleScan = (decodedText: string) => {
    onScan(decodedText);
    setIsScanning(false);
    setError("");

    // Stop the scanner
    stopScanner();
  };

  const handleError = (error: string) => {
    // Only log actual errors, not common scanning states like "NotFoundException"
    if (
      !error.includes("NotFoundException") &&
      !error.includes("No MultiFormat Readers")
    ) {
      // Silently ignore common scanning errors
    }
  };

  const startScanner = async () => {
    if (scannerDivRef.current && !scannerRef.current) {
      try {
        scannerRef.current = new Html5Qrcode("barcode-scanner");

        // Get available cameras and find back camera
        const cameras = await Html5Qrcode.getCameras();
        let selectedCamera = cameras[0]?.id; // Default to first camera

        // Try multiple strategies to find back camera
        let backCamera = cameras.find(
          (camera) =>
            camera.label.toLowerCase().includes("back") ||
            camera.label.toLowerCase().includes("rear") ||
            camera.label.toLowerCase().includes("environment") ||
            camera.label.toLowerCase().includes("facing back") ||
            camera.label.toLowerCase().includes("world"),
        );

        // If no back camera found by label, try to use the last camera (often back camera on mobile)
        if (!backCamera && cameras.length > 1) {
          backCamera = cameras[cameras.length - 1];
        }

        // If still no back camera, try using facingMode constraint instead of camera ID
        if (!backCamera) {
          // Use facingMode constraint instead of specific camera ID
          const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
            facingMode: "environment", // This should force back camera
          };

          await scannerRef.current.start(
            { facingMode: "environment" },
            config,
            handleScan,
            handleError,
          );

          return;
        }

        selectedCamera = backCamera.id;

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        };

        await scannerRef.current.start(
          selectedCamera,
          config,
          handleScan,
          handleError,
        );
      } catch (err: any) {
        const errorMessage = `Scanner-Fehler: ${err.message}`;

        setError(errorMessage);
        if (onError) onError(errorMessage);
        scannerRef.current = null;
      }
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
        scannerRef.current = null;
      } catch {
        // Silently handle scanner stop errors
      }
    }
    setIsScanning(false);
  };

  const startScanning = async () => {
    if (hasCamera) {
      setIsScanning(true);
      setError("");
      // Start scanner in next tick to ensure DOM is updated
      setTimeout(async () => {
        await startScanner();
      }, 100);
    } else {
      // Try to request permissions again if they were initially denied
      await checkAndRequestCameraPermissions();
      if (hasCamera) {
        setIsScanning(true);
        setTimeout(async () => {
          await startScanner();
        }, 100);
      }
    }
  };

  return (
    <div className="mb-6 p-4 border rounded-lg">
      <div className="flex items-center gap-4 mb-4">
        <Button
          color="primary"
          isDisabled={!hasCamera && !error}
          startContent={<Icon icon="hugeicons:qr-code-01" width={18} />}
          onPress={() => (isScanning ? stopScanner() : startScanning())}
        >
          {isScanning ? "Scanner schließen" : "Barcode scannen"}
        </Button>
        {error && (
          <Chip color="danger" variant="flat">
            {error}
          </Chip>
        )}
      </div>

      {isScanning && (
        <div className="w-full max-w-md mx-auto">
          <div
            ref={scannerDivRef}
            id="barcode-scanner"
            style={{ width: "100%" }}
          />
          <div className="mt-2 text-sm text-gray-600 text-center">
            Richten Sie die Kamera auf den Barcode oder QR-Code
          </div>
          <Button
            className="mt-2"
            color="danger"
            variant="flat"
            onPress={stopScanner}
          >
            Scanner stoppen
          </Button>
          {!hasCamera && error && (
            <div className="mt-2 p-3 bg-orange-100 text-orange-800 rounded text-sm">
              <strong>Hinweis:</strong> {error}
              <br />
              <small>
                Für mobile Geräte: Verwenden Sie HTTPS oder localhost. Stellen
                Sie sicher, dass Kamera-Berechtigungen erteilt wurden.
              </small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
