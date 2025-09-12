import { Divider } from "@heroui/react";

import LagerHeading from "@/components/lager/heading";
import LagerList from "@/components/lager/list";

export default function Lager() {
  return (
    <>
      <LagerHeading />
      <Divider className="my-4" />
      <LagerList />
    </>
  );
}
