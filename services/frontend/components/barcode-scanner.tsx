"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Alert,
  Select,
  SelectItem,
} from "@heroui/react";
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
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string>("");
  const [hasCamera, setHasCamera] = useState<boolean>(true);
  const [availableCameras, setAvailableCameras] = useState<any[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [videoElement, setVideoElement] = useState<any>(null);
  const [focusSupported, setFocusSupported] = useState<boolean>(false);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivRef = useRef(null);

  useEffect(() => {
    // Only run on client side
    if (typeof window === "undefined") return;

    // Pre-check camera availability and request permissions immediately
    checkAndRequestCameraPermissions();

    // Cleanup function
    return () => {
      // Clean up video event listeners
      if (videoElement) {
        videoElement.removeEventListener("click", handleTapToFocus);
      }

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

      // Get available cameras after permissions are granted
      await getAvailableCameras();
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

        // Get available cameras after permissions are granted
        await getAvailableCameras();
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

  const getAvailableCameras = async () => {
    try {
      const cameras = await Html5Qrcode.getCameras();

      setAvailableCameras(cameras);

      // Auto-select the best camera if none selected
      if (!selectedCameraId && cameras.length > 0) {
        // Detect if we're on iPhone Pro with multiple cameras
        const isIPhonePro =
          /iPhone/.test(navigator.userAgent) && cameras.length >= 3;

        let bestCamera;

        if (isIPhonePro) {
          // For iPhone Pro models, prioritize main wide camera over zoom
          bestCamera = cameras.find((camera) => {
            const label = camera.label.toLowerCase();

            return (
              (label.includes("back") ||
                label.includes("rear") ||
                label.includes("environment") ||
                label.includes("facing back") ||
                label.includes("world")) &&
              !label.includes("zoom") &&
              !label.includes("telephoto") &&
              !label.includes("tele") &&
              !label.includes("2x") &&
              !label.includes("3x") &&
              !label.includes("5x")
            );
          });

          // If no specific main camera found, try to find wide camera
          if (!bestCamera) {
            bestCamera = cameras.find((camera) => {
              const label = camera.label.toLowerCase();

              return (
                label.includes("wide") &&
                (label.includes("back") || label.includes("rear"))
              );
            });
          }
        }

        // Fallback to general back camera detection
        if (!bestCamera) {
          bestCamera = cameras.find(
            (camera) =>
              camera.label.toLowerCase().includes("back") ||
              camera.label.toLowerCase().includes("rear") ||
              camera.label.toLowerCase().includes("environment") ||
              camera.label.toLowerCase().includes("facing back") ||
              camera.label.toLowerCase().includes("world"),
          );
        }

        // If no back camera found, use the last camera or first camera
        if (!bestCamera) {
          bestCamera =
            cameras.length > 1 ? cameras[cameras.length - 1] : cameras[0];
        }

        if (bestCamera) {
          setSelectedCameraId(bestCamera.id);
        }
      }
    } catch {
      // Silently handle camera enumeration errors
    }
  };

  const handleScan = (decodedText: string) => {
    onScan(decodedText);
    setIsScanning(false);
    setError("");

    // Stop the scanner and close the modal
    stopScanner();
    onClose();
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

  const setupFocusControls = () => {
    // Only run on client side
    if (
      typeof window === "undefined" ||
      typeof globalThis.document === "undefined"
    ) {
      return;
    }

    // Find the video element created by html5-qrcode
    const videoEl = globalThis.document.querySelector(
      "#barcode-scanner video",
    ) as any;

    if (videoEl) {
      setVideoElement(videoEl);

      // Check if the camera supports focus control
      const stream = videoEl.srcObject as any;

      if (stream) {
        const track = stream.getVideoTracks?.()?.[0];

        if (track) {
          // More thorough focus capability detection
          let hasFocusSupport = false;

          if (track.getCapabilities) {
            const capabilities = track.getCapabilities();

            hasFocusSupport = !!(
              (capabilities as any).focusMode ||
              (capabilities as any).focusDistance ||
              (capabilities as any).zoom ||
              track.applyConstraints
            );

            // Check for torch/flashlight support
            const hasTorchSupport = !!(capabilities as any).torch;

            setTorchSupported(hasTorchSupport);
          } else if (track.applyConstraints) {
            // Fallback: if we can apply constraints, assume focus might work
            hasFocusSupport = true;
          }

          setFocusSupported(hasFocusSupport);
        }
      }

      // Add tap-to-focus functionality
      videoEl.addEventListener("click", handleTapToFocus);
    }
  };

  const handleTapToFocus = async (event: any) => {
    if (!videoElement || typeof window === "undefined") return;

    const stream = videoElement.srcObject as any;

    if (!stream) return;

    const track = stream.getVideoTracks?.()?.[0];

    if (!track || !track.applyConstraints) return;

    try {
      // Get the click position relative to the video element
      const rect = videoElement.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;

      // Visual feedback for tap-to-focus (show immediately)
      showFocusIndicator(event.clientX - rect.left, event.clientY - rect.top);

      // Try multiple focus strategies
      let focusApplied = false;

      // Strategy 1: Try point-of-interest focus with advanced constraints
      try {
        await track.applyConstraints({
          advanced: [
            {
              focusMode: "single-shot",
              pointsOfInterest: [{ x, y }],
            },
          ],
        });
        focusApplied = true;
      } catch {
        // Strategy 2: Try basic single-shot focus
        try {
          await track.applyConstraints({
            focusMode: "single-shot",
          });
          focusApplied = true;
        } catch {
          // Strategy 3: Try continuous focus as fallback
          try {
            await track.applyConstraints({
              focusMode: "continuous",
            });
            focusApplied = true;
          } catch {
            // All focus methods failed
          }
        }
      }

      if (!focusApplied) {
        // Last resort: try to trigger manual focus
        triggerManualFocus();
      }
    } catch {
      // Fallback: try continuous autofocus
      try {
        await track.applyConstraints({
          advanced: [{ focusMode: "continuous" }],
        });
      } catch {
        // Focus control not supported, silently fail
      }
    }
  };

  const showFocusIndicator = (x: number, y: number) => {
    if (typeof globalThis.document === "undefined") return;

    const indicator = globalThis.document.createElement("div");

    indicator.style.position = "absolute";
    indicator.style.left = `${x - 25}px`;
    indicator.style.top = `${y - 25}px`;
    indicator.style.width = "50px";
    indicator.style.height = "50px";
    indicator.style.border = "2px solid #00ff00";
    indicator.style.borderRadius = "50%";
    indicator.style.pointerEvents = "none";
    indicator.style.zIndex = "1000";
    indicator.style.opacity = "0.8";

    const scannerElement =
      globalThis.document.querySelector("#barcode-scanner");

    if (scannerElement) {
      scannerElement.appendChild(indicator);

      // Remove indicator after animation
      setTimeout(() => {
        if (indicator.parentNode) {
          indicator.parentNode.removeChild(indicator);
        }
      }, 1000);
    }
  };

  const triggerManualFocus = async () => {
    if (!videoElement) {
      setError("Video element not found");

      return;
    }

    const stream = videoElement.srcObject as any;

    if (!stream) {
      setError("Camera stream not available");

      return;
    }

    const track = stream.getVideoTracks?.()?.[0];

    if (!track || !track.applyConstraints) {
      setError("Focus control not supported by this camera");

      return;
    }

    try {
      // Get current track capabilities to see what's supported
      const capabilities = track.getCapabilities?.() || {};

      // Clear any previous error
      setError("");

      // Try different focus strategies based on what's supported
      let focusApplied = false;

      // Strategy 1: Try basic focusMode constraints (most compatible)
      if (capabilities.focusMode) {
        try {
          await track.applyConstraints({
            focusMode: "single-shot",
          });
          focusApplied = true;
        } catch {
          try {
            await track.applyConstraints({
              focusMode: "continuous",
            });
            focusApplied = true;
          } catch {
            // Continue to next strategy
          }
        }
      }

      // Strategy 2: Try advanced constraints if basic didn't work
      if (!focusApplied) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: "single-shot" }],
          });
          focusApplied = true;
        } catch {
          try {
            await track.applyConstraints({
              advanced: [{ focusMode: "continuous" }],
            });
            focusApplied = true;
          } catch {
            // Continue to next strategy
          }
        }
      }

      // Strategy 3: Try to restart the track with focus settings
      if (!focusApplied) {
        try {
          const currentConstraints = track.getConstraints();

          await track.applyConstraints({
            ...currentConstraints,
            focusMode: { ideal: "continuous" },
          });
          focusApplied = true;
        } catch {
          // Final fallback attempt
        }
      }

      if (focusApplied) {
        // Give visual feedback that focus was triggered
        showFocusIndicator(
          videoElement.clientWidth / 2,
          videoElement.clientHeight / 2,
        );

        // Try to trigger a refresh of the constraints
        setTimeout(async () => {
          try {
            await track.applyConstraints({
              focusMode: "single-shot",
            });
          } catch {
            // Silent fail for refresh attempt
          }
        }, 500);
      } else {
        setError("Focus adjustment not supported by this camera");

        // Clear error after 3 seconds
        setTimeout(() => setError(""), 3000);
      }
    } catch (error: any) {
      const errorMsg = `Focus error: ${error.message || "Unknown error"}`;

      setError(errorMsg);

      // Clear error after 3 seconds
      setTimeout(() => setError(""), 3000);
    }
  };

  const toggleTorch = async () => {
    if (!videoElement) return;

    const stream = videoElement.srcObject as any;

    if (!stream) return;

    const track = stream.getVideoTracks?.()?.[0];

    if (!track || !track.applyConstraints) return;

    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchEnabled }],
      });
      setTorchEnabled(!torchEnabled);
    } catch {
      try {
        // Fallback approach
        await track.applyConstraints({
          torch: !torchEnabled,
        });
        setTorchEnabled(!torchEnabled);
      } catch {
        setError("Torch control not supported");
      }
    }
  };

  const startScanner = async () => {
    if (scannerDivRef.current && !scannerRef.current) {
      try {
        scannerRef.current = new Html5Qrcode("barcode-scanner");

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        };

        // If we have a specific camera ID, use it; otherwise use facingMode
        if (selectedCameraId) {
          await scannerRef.current.start(
            selectedCameraId,
            config,
            handleScan,
            handleError,
          );
        } else {
          // Use facingMode constraint for automatic back camera selection
          const facingModeConfig = {
            ...config,
            facingMode: "environment",
          };

          await scannerRef.current.start(
            { facingMode: "environment" },
            facingModeConfig,
            handleScan,
            handleError,
          );
        }

        // Set up focus controls after scanner starts
        setTimeout(() => {
          setupFocusControls();
        }, 500);
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
    onClose();
  };

  const restartScannerWithNewCamera = async (_cameraId: string) => {
    if (scannerRef.current) {
      try {
        // Stop current scanner
        await scannerRef.current.stop();
        scannerRef.current.clear();
        scannerRef.current = null;

        // Start new scanner with selected camera
        setTimeout(async () => {
          await startScanner();
        }, 100);
      } catch {
        // If restart fails, stop scanning
        setIsScanning(false);
        setError("Fehler beim Wechseln der Kamera");
      }
    }
  };

  const startScanning = async () => {
    // Open the modal first
    onOpen();

    if (hasCamera) {
      setIsScanning(true);
      setError("");
      // Start scanner in next tick to ensure DOM is updated
      setTimeout(async () => {
        await startScanner();
      }, 300);
    } else {
      // Try to request permissions again if they were initially denied
      await checkAndRequestCameraPermissions();
      if (hasCamera) {
        setIsScanning(true);
        setTimeout(async () => {
          await startScanner();
        }, 300);
      }
    }
  };

  return (
    <>
      <Button
        color="primary"
        isDisabled={!hasCamera && !error}
        startContent={<Icon icon="hugeicons:bar-code-02" width={18} />}
        onPress={startScanning}
      >
        Barcode Scannen
      </Button>

      <Modal
        backdrop="blur"
        isDismissable={true}
        isOpen={isOpen}
        size="lg"
        onClose={() => {
          stopScanner();
        }}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Icon icon="hugeicons:qr-code-01" width={24} />
              <span>Barcode Scanner</span>
            </div>
          </ModalHeader>
          <ModalBody className="p-4 overflow-y-auto">
            {/* Camera Selection */}
            {availableCameras.length > 1 && (
              <div className="mb-4 flex gap-2">
                <Select
                  className="flex-1"
                  label="Kamera auswählen"
                  placeholder="Wählen Sie eine Kamera"
                  selectedKeys={selectedCameraId ? [selectedCameraId] : []}
                  size="sm"
                  onSelectionChange={(keys) => {
                    const selectedKey = Array.from(keys)[0] as string;

                    setSelectedCameraId(selectedKey);

                    // Restart scanner with new camera if currently scanning
                    if (isScanning && scannerRef.current) {
                      restartScannerWithNewCamera(selectedKey);
                    }
                  }}
                >
                  {availableCameras.map((camera) => (
                    <SelectItem key={camera.id}>
                      {camera.label || `Kamera ${camera.id}`}
                    </SelectItem>
                  ))}
                </Select>
                <Button
                  isIconOnly
                  size="sm"
                  variant="flat"
                  onPress={getAvailableCameras}
                >
                  <Icon icon="hugeicons:refresh" width={16} />
                </Button>
              </div>
            )}

            <div className="w-full h-full flex flex-col items-center justify-center">
              {isScanning ? (
                <>
                  <div
                    ref={scannerDivRef}
                    id="barcode-scanner"
                    style={{ width: "60%", maxWidth: "700px" }}
                  />
                  <div className="mt-4 text-sm text-gray-600 text-center">
                    Richten Sie die Kamera auf den Barcode oder QR-Code
                    {focusSupported && (
                      <>
                        <br />
                        <span className="text-xs">
                          Tippen Sie auf das Video zum Fokussieren
                        </span>
                      </>
                    )}
                  </div>
                  {/* Focus and Torch Controls */}
                  {(focusSupported || torchSupported) && (
                    <div className="mt-2 flex gap-2 flex-wrap justify-center">
                      {focusSupported && (
                        <Button
                          size="sm"
                          startContent={
                            <Icon icon="hugeicons:focus" width={16} />
                          }
                          variant="flat"
                          onPress={triggerManualFocus}
                        >
                          Fokus
                        </Button>
                      )}
                      {torchSupported && (
                        <Button
                          color={torchEnabled ? "warning" : "default"}
                          size="sm"
                          startContent={
                            <Icon
                              icon={
                                torchEnabled
                                  ? "hugeicons:flash"
                                  : "hugeicons:flash-off"
                              }
                              width={16}
                            />
                          }
                          variant="flat"
                          onPress={toggleTorch}
                        >
                          {torchEnabled ? "Licht Aus" : "Licht An"}
                        </Button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center p-8">
                  <Icon
                    className="animate-spin mx-auto mb-4"
                    icon="hugeicons:loading-03"
                    width={48}
                  />
                  <p>Kamera wird initialisiert...</p>
                </div>
              )}

              {(!hasCamera || error) && (
                <Alert
                  color="danger"
                  description="Für mobile Geräte: Verwenden Sie HTTPS oder localhost.
                    Stellen Sie sicher, dass Kamera-Berechtigungen erteilt
                    wurden."
                  title={error}
                />
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              color="danger"
              startContent={<Icon icon="hugeicons:cancel-01" width={18} />}
              variant="flat"
              onPress={stopScanner}
            >
              Scanner schließen
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
