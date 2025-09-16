"use client";

import { useRef, useState } from "react";
import {
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Alert,
  Divider,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Result } from "@zxing/library";

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  onError?: (error: string) => void;
}

// Aspect ratio and crop size factor
const DESIRED_CROP_ASPECT_RATIO = 3 / 2;
const CROP_SIZE_FACTOR = 0.4;

export default function BarcodeScanner({
  onScan,
  onError,
}: BarcodeScannerProps) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [isScanning, setIsScanning] = useState(false);

  // eslint-disable-next-line no-undef
  const videoRef = useRef<HTMLVideoElement>(null);
  // eslint-disable-next-line no-undef
  const displayCroppedCanvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line no-undef
  const cropOverlayRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [barcodeResult, setBarcodeResult] = useState<string | null>(null);
  const codeReader = useRef(new BrowserMultiFormatReader());

  // eslint-disable-next-line no-undef
  let intervalId: NodeJS.Timeout | null = null;

  const captureFrameAndCrop = () => {
    if (
      !videoRef.current ||
      !displayCroppedCanvasRef.current ||
      !cropOverlayRef.current
    )
      return;

    const video = videoRef.current;
    const displayCanvas = displayCroppedCanvasRef.current;
    const displayContext = displayCanvas.getContext("2d");
    const overlayDiv = cropOverlayRef.current;

    if (!displayContext) return;

    // eslint-disable-next-line no-undef
    const tempCanvas = document.createElement("canvas");
    const tempContext = tempCanvas.getContext("2d");

    if (!tempContext) return;

    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    tempContext.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    let cropWidth, cropHeight;
    const videoRatio = video.videoWidth / video.videoHeight;

    if (videoRatio / DESIRED_CROP_ASPECT_RATIO > 1) {
      cropHeight = video.videoHeight * CROP_SIZE_FACTOR;
      cropWidth = cropHeight * DESIRED_CROP_ASPECT_RATIO;
    } else {
      cropWidth = video.videoWidth * CROP_SIZE_FACTOR;
      cropHeight = cropWidth / DESIRED_CROP_ASPECT_RATIO;
    }

    cropWidth = Math.min(cropWidth, video.videoWidth);
    cropHeight = Math.min(cropHeight, video.videoHeight);

    const MIN_CROP_WIDTH = 240;
    const MAX_CROP_WIDTH = 600;
    const MIN_CROP_HEIGHT = 80;
    const MAX_CROP_HEIGHT = 400;

    cropWidth = Math.max(MIN_CROP_WIDTH, Math.min(MAX_CROP_WIDTH, cropWidth));
    cropHeight = Math.max(
      MIN_CROP_HEIGHT,
      Math.min(MAX_CROP_HEIGHT, cropHeight),
    );

    const cropX = (video.videoWidth - cropWidth) / 2;
    const cropY = (video.videoHeight - cropHeight) / 2;

    displayCanvas.width = cropWidth;
    displayCanvas.height = cropHeight;

    displayContext.drawImage(
      tempCanvas,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );

    overlayDiv.style.position = "absolute";
    overlayDiv.style.left = `${(cropX / video.videoWidth) * 100}%`;
    overlayDiv.style.top = `${(cropY / video.videoHeight) * 100}%`;
    overlayDiv.style.width = `${(cropWidth / video.videoWidth) * 100}%`;
    overlayDiv.style.height = `${(cropHeight / video.videoHeight) * 100}%`;
    overlayDiv.style.border = "2px solid white";
    overlayDiv.style.borderRadius = "0.5rem";
    overlayDiv.style.pointerEvents = "none";
    overlayDiv.style.boxSizing = "border-box";

    const decodeCanvas = async () => {
      try {
        const result: Result =
          await codeReader.current.decodeFromCanvas(displayCanvas);

        setBarcodeResult(result.getText());

        onScan(result.getText());
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        setIsScanning(false);

        // Stop all video tracks
        if (videoRef.current && videoRef.current.srcObject) {
          // eslint-disable-next-line no-undef
          const stream = videoRef.current.srcObject as MediaStream;

          stream.getTracks().forEach((track) => track.stop());
        }

        onClose();
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "NotFoundException") {
          console.error("Decoding error:", err);
        }
      }
    };

    decodeCanvas(); // Call the async function
  };

  const startCamera = async () => {
    setIsScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          intervalId = setInterval(captureFrameAndCrop, 100);
        };
      }
    } catch (err) {
      setIsScanning(false);
      setError("Unable to access the camera. Please check permissions.");
    }
  };

  const startScanning = async () => {
    onOpen();
    setIsScanning(false); // Start with loading state
    // Small delay to ensure modal is fully opened and video element is ready
    setTimeout(() => {
      startCamera();
    }, 300);
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <>
      <Button
        color="primary"
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
        onClose={handleClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Icon icon="hugeicons:qr-code-01" width={24} />
              <span>Barcode Scanner</span>
            </div>
          </ModalHeader>
          <ModalBody className="p-4">
            <div className="w-full flex flex-col items-center justify-center">
              {isScanning ? (
                <>
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      maxWidth: "400px",
                      overflow: "hidden",
                    }}
                  >
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full max-w-md h-64 object-cover rounded-lg border-2 border-gray-300"
                    />
                    <div ref={cropOverlayRef} />
                  </div>

                  <Divider className="my-4 w-full" />

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      fontFamily: "sans-serif",
                    }}
                  >
                    <canvas
                      ref={displayCroppedCanvasRef}
                      style={{
                        border: "2px solid #3b82f6",
                        borderRadius: "0.5rem",
                        boxShadow:
                          "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.05)",
                        maxWidth: "100%",
                        height: "auto",
                        display: "block",
                        minWidth: "240px",
                        minHeight: "80px",
                      }}
                    >
                      Your browser does not support the canvas element.
                    </canvas>
                  </div>
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

              {error && (
                <Alert
                  className="mt-4"
                  color="danger"
                  description="Stellen Sie sicher, dass Kamera-Berechtigungen erteilt wurden."
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
              onPress={handleClose}
            >
              Scanner schließen
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
