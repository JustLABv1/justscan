"use client";

import { Card, CardBody, Spacer } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useRouter } from "next/navigation";

export default function QuickNavigation() {
  const router = useRouter();

  return (
    <section>
      <div className="flex flex-cols items-center">
        <p className="text-2xl font-semibold">Willkommen&nbsp;</p>
        <p className="text-2xl font-bold text-primary">Justin!</p>
      </div>
      <Spacer y={4} />
      <div className="grid grid-cols-2 gap-4">
        <Card
          fullWidth
          isHoverable
          isPressable
          className="shadow-sm shadow-primary"
          onPress={() => {
            router.push("/lager");
          }}
        >
          <CardBody>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-small bg-default/30 text-foreground">
                <Icon icon="hugeicons:lift-truck" width={26} />
              </div>
              <div className="flex flex-col">
                <p className="text-md">Zum Lager</p>
                <p className="text-small text-default-500">
                  Erstelle Lieferscheine & Verwalte Artikel
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card
          fullWidth
          isHoverable
          isPressable
          className="shadow-sm shadow-primary"
          onPress={() => {
            router.push("/bestellungen");
          }}
        >
          <CardBody>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-small bg-default/30 text-foreground">
                <Icon icon="hugeicons:package" width={26} />
              </div>
              <div className="flex flex-col">
                <p className="text-md">Zu Bestellungen</p>
                <p className="text-small text-default-500">
                  Bestellungen Einsehen & Verwalten
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
