"use client";

import { FileUploadCard } from "../file-upload/file-upload-card";

export default function SystemVerwaltungUploads() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div className="flex flex-col gap-2">
        <p className="font-bold text-lg">Artikel</p>
        <FileUploadCard allowedTypes={[".csv"]} maxSizeMB={50} type="artikel" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-bold text-lg">Geräte</p>
        <FileUploadCard allowedTypes={[".csv"]} maxSizeMB={50} type="geräte" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-bold text-lg">Kostenstellen</p>
        <FileUploadCard
          allowedTypes={[".csv"]}
          maxSizeMB={50}
          type="kostenstellen"
        />
      </div>
    </div>
  );
}
