import { Divider } from "@heroui/react";

import KostenstellenHeading from "@/components/kostenstellen/heading";
import KostenstellenList from "@/components/kostenstellen/list";

export default function Lager() {
  return (
    <>
      <KostenstellenHeading />
      <Divider className="my-4" />
      <KostenstellenList />
    </>
  );
}
