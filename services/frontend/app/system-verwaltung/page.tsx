import { Divider } from "@heroui/react";

import SystemVerwaltungHeading from "@/components/system-verwaltung/heading";
import SystemVerwaltungUploads from "@/components/system-verwaltung/uploads";

export default function SystemVerwaltung() {
  return (
    <>
      <SystemVerwaltungHeading />
      <Divider className="my-4" />
      <SystemVerwaltungUploads />
    </>
  );
}
