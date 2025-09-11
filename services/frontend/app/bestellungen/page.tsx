import { Divider } from "@heroui/react";

import BestellungenHeading from "@/components/bestellungen/heading";
import BestellungenList from "@/components/bestellungen/list";

export default function Bestellungen() {
  return (
    <>
      <BestellungenHeading />
      <Divider className="my-4" />
      <BestellungenList />
    </>
  );
}
