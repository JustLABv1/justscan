"use client";

import { Card, CardBody } from "@heroui/react";
import { Icon } from "@iconify/react";

import { FileUploadCard } from "../file-upload/file-upload-card";

export default function SystemVerwaltungUploads({
  artikel,
  geraete,
  kostenstellen,
}: {
  artikel: any;
  geraete: any;
  kostenstellen: any;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div className="flex flex-col gap-2">
        <p className="font-bold text-lg">Artikel</p>
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-small bg-default/30 text-foreground">
                <Icon icon="hugeicons:package" width={26} />
              </div>
              <div className="flex flex-col">
                <p className="text-md">{artikel.length}</p>
                <p className="text-small text-default-500">Artikel im System</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <FileUploadCard allowedTypes={[".csv"]} maxSizeMB={50} type="artikel" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-bold text-lg">Geräte</p>
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-small bg-default/30 text-foreground">
                <Icon icon="hugeicons:smart-phone-02" width={26} />
              </div>
              <div className="flex flex-col">
                <p className="text-md">{geraete.length}</p>
                <p className="text-small text-default-500">Geräte im System</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <FileUploadCard allowedTypes={[".csv"]} maxSizeMB={50} type="geräte" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-bold text-lg">Kostenstellen</p>

        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-small bg-default/30 text-foreground">
                <Icon icon="hugeicons:save-money-euro" width={26} />
              </div>
              <div className="flex flex-col">
                <p className="text-md">{kostenstellen.length}</p>
                <p className="text-small text-default-500">
                  Kostenstellen im System
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
        <FileUploadCard
          allowedTypes={[".csv"]}
          maxSizeMB={50}
          type="kostenstellen"
        />
      </div>
    </div>
  );
}
