"use client";

import { useState } from "react";
import { Button, addToast, useDisclosure } from "@heroui/react";

import { PostCheckKostenstellen } from "@/lib/fetch/kostenstellen/POST/check";

import { FileUpload } from "../magic-ui/file-upload";
import KostenstellenUploadCheckModal from "../modals/kostenstellen/upload-check";

export default function SystemVerwaltungUploads() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const kostenstellenModal = useDisclosure();
  const [kostenstellenFiles, setKostenstellenFiles] = useState<File[]>([]);
  const handleKostenstellenFileUpload = (files: File[]) => {
    setKostenstellenFiles(files);
  };
  const [kostenstellenData, setKostenstellenData] = useState<any>(null);

  async function handleKostenstellenCheck() {
    if (kostenstellenFiles.length === 0) {
      addToast({
        title: "Keine Datei ausgewählt",
        description: "Bitte wählen Sie eine Datei aus, um fortzufahren.",
        color: "danger",
      });

      return;
    }

    setUploading(true);

    // Create FormData with the file and type
    const formData = new FormData();

    formData.append("csv", kostenstellenFiles[0]);
    formData.append("type", "csv");

    const res = await PostCheckKostenstellen(formData);

    if (!res) {
      setError(true);
      setErrorText("Fehler");
      setErrorMessage("Ein Fehler ist aufgetreten");
      setUploading(false);

      return;
    }

    if (res.success) {
      addToast({
        title: "Erfolgreich",
        description: "Die Datei wurde erfolgreich geprüft.",
        color: "success",
      });
      setKostenstellenFiles([]);
      setKostenstellenData(res.data);
      kostenstellenModal.onOpen();
    } else {
      setError(true);
      setErrorText("Fehler");
      setErrorMessage(res.error || "Ein Fehler ist aufgetreten");
      setUploading(false);
      addToast({
        title: "Fehler",
        description: res.error || "Ein Fehler ist aufgetreten",
        color: "danger",
      });

      return;
    }

    setUploading(false);

    return;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div className="flex flex-col gap-2">
        <p className="font-bold text-lg">Artikel</p>
        <div className="w-full max-w-4xl mx-auto min-h-96 border border-dashed bg-content1 border-default-200 rounded-lg">
          <FileUpload onChange={handleKostenstellenFileUpload} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            color="primary"
            disabled={uploading}
            isLoading={uploading}
            variant="solid"
            onPress={handleKostenstellenCheck}
          >
            Aktuallisieren
          </Button>
          <Button
            color="primary"
            disabled={uploading}
            isLoading={uploading}
            variant="flat"
            onPress={handleKostenstellenCheck}
          >
            Check
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-bold text-lg">Geräte</p>
        <div className="w-full max-w-4xl mx-auto min-h-96 border border-dashed bg-content1 border-default-200 rounded-lg">
          <FileUpload onChange={handleKostenstellenFileUpload} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            color="primary"
            disabled={uploading}
            isLoading={uploading}
            variant="solid"
            onPress={handleKostenstellenCheck}
          >
            Aktuallisieren
          </Button>
          <Button
            color="primary"
            disabled={uploading}
            isLoading={uploading}
            variant="flat"
            onPress={handleKostenstellenCheck}
          >
            Check
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-bold text-lg">Kostenstellen</p>
        <div className="w-full max-w-4xl mx-auto min-h-96 border border-dashed bg-content1 border-default-200 rounded-lg">
          <FileUpload onChange={handleKostenstellenFileUpload} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            color="primary"
            disabled={uploading}
            isLoading={uploading}
            variant="solid"
            onPress={handleKostenstellenCheck}
          >
            Aktuallisieren
          </Button>
          <Button
            color="primary"
            disabled={uploading}
            isLoading={uploading}
            variant="flat"
            onPress={handleKostenstellenCheck}
          >
            Check
          </Button>
        </div>
      </div>
      <KostenstellenUploadCheckModal
        data={kostenstellenData}
        disclosure={kostenstellenModal}
      />
    </div>
  );
}
