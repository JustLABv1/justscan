import React from "react";
import { Card, CardBody, Button, Progress, useDisclosure } from "@heroui/react";
import { Icon } from "@iconify/react";

import { PostCheckKostenstellen } from "@/lib/fetch/kostenstellen/POST/check";
import { PostUploadKostenstellen } from "@/lib/fetch/kostenstellen/POST/upload";
import { PostCheckGeraete } from "@/lib/fetch/geraete/POST/check";
import { PostUploadGeraete } from "@/lib/fetch/geraete/POST/upload";
import { PostUploadArtikel } from "@/lib/fetch/artikel/POST/upload";
import { PostCheckArtikel } from "@/lib/fetch/artikel/POST/check";

import UploadCheckModal from "../modals/upload/upload-check";

interface FileUploadCardProps {
  type: "artikel" | "geräte" | "kostenstellen";
  maxSizeMB?: number;
  allowedTypes?: string[];
  onUploadComplete?: (file: File) => void;
}

export const FileUploadCard: React.FC<FileUploadCardProps> = ({
  type,
  maxSizeMB = 50,
  allowedTypes = ["*/*"],
  onUploadComplete,
}) => {
  const [dragActive, setDragActive] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [uploadStatus, setUploadStatus] = React.useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const checkModal = useDisclosure();
  const [checkData, setCheckData] = React.useState<any>(null);

  // eslint-disable-next-line no-undef
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const validateFile = (file: File): boolean => {
    // Check file size
    if (file.size > maxSizeMB * 1024 * 1024) {
      setErrorMessage(`File size exceeds the ${maxSizeMB}MB limit`);

      return false;
    }

    // Check file type if specific types are allowed
    if (allowedTypes[0] !== "*/*") {
      const fileType = file.type;
      const fileExtension = `.${file.name.split(".").pop()}`;

      const isAllowed = allowedTypes.some((type) => {
        if (type.startsWith(".")) {
          // Extension check
          return fileExtension.toLowerCase() === type.toLowerCase();
        } else if (type.endsWith("/*")) {
          // MIME type category check
          const category = type.split("/")[0];

          return fileType.startsWith(`${category}/`);
        } else {
          // Exact MIME type check
          return fileType === type;
        }
      });

      if (!isAllowed) {
        setErrorMessage("File type not supported");

        return false;
      }
    }

    setErrorMessage(null);

    return true;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];

      if (validateFile(droppedFile)) {
        setFile(droppedFile);
        setUploadStatus("idle");
      }
    }
  };

  // eslint-disable-next-line no-undef
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();

    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];

      if (validateFile(selectedFile)) {
        setFile(selectedFile);
        setUploadStatus("idle");
      }
    }
  };

  const resetUpload = () => {
    setFile(null);
    setUploadStatus("idle");
    setUploadProgress(0);
    setErrorMessage(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " bytes";
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    else return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  const getFileIcon = (fileName: string) => {
    const extension = fileName.split(".").pop()?.toLowerCase();

    switch (extension) {
      case "pdf":
        return "lucide:file-type-pdf";
      case "doc":
      case "docx":
        return "lucide:file-type-word";
      case "xls":
      case "xlsx":
        return "lucide:file-type-spreadsheet";
      case "ppt":
      case "pptx":
        return "lucide:file-type-presentation";
      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "webp":
        return "lucide:image";
      case "mp4":
      case "mov":
      case "avi":
        return "lucide:video";
      case "mp3":
      case "wav":
      case "ogg":
        return "lucide:audio";
      case "zip":
      case "rar":
      case "7z":
        return "lucide:archive";
      default:
        return "lucide:file";
    }
  };

  async function handleCheck() {
    // Create FormData with the file and type
    const formData = new FormData();

    formData.append("csv", file as Blob);
    formData.append("type", "csv");

    let res: any = null;

    if (type === "kostenstellen") {
      res = await PostCheckKostenstellen(formData);
    }

    if (type === "geräte") {
      res = await PostCheckGeraete(formData);
    }

    if (type === "artikel") {
      res = await PostCheckArtikel(formData);
    }

    if (!res) {
      setErrorMessage("Ein Fehler ist aufgetreten");

      return false;
    }

    if (res.success) {
      setCheckData(res.data);
      checkModal.onOpen();
    } else {
      setErrorMessage(res.error || "Ein Fehler ist aufgetreten");

      return false;
    }

    return true;
  }

  async function handleUpload() {
    if (!file) return;

    setUploadStatus("uploading");
    setUploadProgress(0);

    const newFormData = new FormData();

    newFormData.append("csv", file);
    newFormData.append("type", "csv");

    let res: any = null;

    if (type === "kostenstellen") {
      res = await PostUploadKostenstellen(newFormData);
    }

    if (type === "geräte") {
      res = await PostUploadGeraete(newFormData);
    }

    if (type === "artikel") {
      res = await PostUploadArtikel(newFormData);
    }

    if (!res) {
      setUploadStatus("error");
      setErrorMessage("Ein Fehler ist aufgetreten");
      setUploadProgress(0);

      return;
    }

    if (res.success) {
      setUploadStatus("success");
      setUploadProgress(100);
      if (onUploadComplete) onUploadComplete(file);
    } else {
      setUploadStatus("error");
      setErrorMessage(res.error || "Ein Fehler ist aufgetreten");
      setUploadProgress(0);

      return;
    }

    return;
  }

  return (
    <>
      <Card className="shadow-sm">
        <CardBody className="p-6 space-y-4">
          <h3 className="text-lg font-medium text-foreground">
            Datei Hochladen
          </h3>

          {!file ? (
            <div
              className={`border-2 border-dashed rounded-medium p-8 text-center transition-all duration-200 ${
                dragActive
                  ? "border-primary bg-primary-50/50"
                  : errorMessage
                    ? "border-danger bg-danger-50/50"
                    : "border-default-200 hover:border-primary-200 hover:bg-default-50"
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center justify-center gap-2">
                <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mb-2">
                  <Icon
                    className="text-primary w-6 h-6"
                    icon="lucide:upload-cloud"
                  />
                </div>
                <p className="text-foreground-600 mb-1">
                  <span className="font-medium">
                    Klicken Sie hier, um hochzuladen
                  </span>{" "}
                  oder ziehen Sie die Datei hierher
                </p>
                <p className="text-foreground-400 text-small">
                  {allowedTypes[0] === "*/*"
                    ? `Max file size: ${maxSizeMB}MB`
                    : `${allowedTypes.join(", ")} (Max: ${maxSizeMB}MB)`}
                </p>

                {errorMessage && (
                  <div className="mt-3 text-danger text-small flex items-center gap-1">
                    <Icon className="w-4 h-4" icon="lucide:alert-circle" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <input
                  ref={inputRef}
                  accept={allowedTypes.join(",")}
                  className="hidden"
                  type="file"
                  onChange={handleChange}
                />

                <Button
                  className="mt-2"
                  color="primary"
                  variant="flat"
                  onPress={() => inputRef.current?.click()}
                >
                  Datei Auswählen
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center p-3 border rounded-medium bg-content2">
                <div className="w-10 h-10 rounded-medium bg-primary-50 flex items-center justify-center mr-3">
                  <Icon
                    className="text-primary w-5 h-5"
                    icon={getFileIcon(file.name)}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground font-medium text-small truncate">
                    {file.name}
                  </p>
                  <p className="text-foreground-400 text-tiny">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <Button
                  isIconOnly
                  className="ml-2"
                  color="danger"
                  size="sm"
                  variant="light"
                  onPress={resetUpload}
                >
                  <Icon className="w-4 h-4" icon="lucide:x" />
                </Button>
              </div>

              {uploadStatus === "uploading" && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-small">
                    <span className="text-foreground-600">Hochladen...</span>
                    <span className="text-foreground-500">
                      {uploadProgress}%
                    </span>
                  </div>
                  <Progress
                    aria-label="Upload progress"
                    className="w-full"
                    color="primary"
                    size="sm"
                    value={uploadProgress}
                  />
                </div>
              )}

              {uploadStatus === "success" && (
                <div className="flex items-center gap-2 text-success p-2 bg-success-50 rounded-medium">
                  <Icon className="w-5 h-5" icon="lucide:check-circle" />
                  <span className="text-small font-medium">
                    Hochladen abgeschlossen
                  </span>
                </div>
              )}

              {uploadStatus === "error" && (
                <div className="flex items-center gap-2 text-danger p-2 bg-danger-50 rounded-medium">
                  <Icon className="w-5 h-5" icon="lucide:alert-circle" />
                  <span className="text-small font-medium">
                    Hochladen fehlgeschlagen. Bitte versuchen Sie es erneut.
                  </span>
                </div>
              )}

              {uploadStatus !== "success" && (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button color="default" variant="flat" onPress={resetUpload}>
                    Abbrechen
                  </Button>
                  <Button
                    color="primary"
                    isDisabled={uploadStatus === "uploading"}
                    isLoading={uploadStatus === "uploading"}
                    variant="flat"
                    onPress={() => {
                      handleCheck();
                    }}
                  >
                    Überprüfen
                  </Button>
                  <Button
                    color="primary"
                    isDisabled={uploadStatus === "uploading"}
                    isLoading={uploadStatus === "uploading"}
                    onPress={() => {
                      handleUpload();
                    }}
                  >
                    Datei Hochladen
                  </Button>
                </div>
              )}

              {uploadStatus === "success" && (
                <div className="flex justify-end">
                  <Button color="primary" variant="flat" onPress={resetUpload}>
                    Weitere Datei hochladen
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
      <UploadCheckModal data={checkData} disclosure={checkModal} type={type} />
    </>
  );
};
