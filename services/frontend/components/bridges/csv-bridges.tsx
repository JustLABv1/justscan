import { Card, CardBody, Chip } from "@heroui/react";
import { Icon } from "@iconify/react";

export default function CsvBridges({ bridges, user }: any) {
  function heartbeatColor(runner: any) {
    const timeAgo =
      (new Date(runner.last_heartbeat).getTime() - Date.now()) / 1000;

    if (timeAgo < 0 && timeAgo > -30) {
      return "success";
    } else if (timeAgo <= -30 && timeAgo > -60) {
      return "warning";
    } else if (timeAgo <= -60) {
      return "danger";
    }
  }

  function heartbeatStatus(bridge: any) {
    const timeAgo =
      (new Date(bridge.last_heartbeat).getTime() - Date.now()) / 1000;

    if (timeAgo < 0 && timeAgo > -30) {
      return true;
    } else if (timeAgo <= -30) {
      return false;
    }
  }

  return (
    <main>
      {bridges.map((bridge: any) => (
        <Card key={bridge.id} fullWidth>
          <CardBody className="p-5">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold">{bridge.service_name}</h3>
                <p className="text-small text-default-500 mt-1">
                  ID: {bridge.service_id}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Chip
                  color={bridge.is_active ? "success" : "danger"}
                  radius="sm"
                  variant="flat"
                >
                  {bridge.is_active ? "Aktiviert" : "Deaktiviert"}
                </Chip>

                <Chip color={heartbeatColor(bridge)} radius="sm" variant="flat">
                  {heartbeatStatus(bridge) ? "Online" : "Offline"}
                </Chip>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-5">
              <div className="flex items-center gap-2">
                <Icon
                  className={`text-default-500`}
                  icon={"hugeicons:catalogue"}
                  width={20}
                />
                <span className="text-sm">
                  Version:{" "}
                  <span className="font-medium">
                    {bridge.version || "Unbekannt"}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Icon
                  className={`text-default-500`}
                  icon={"hugeicons:upload-01"}
                  width={20}
                />
                <span className="text-sm">
                  Upload URL:{" "}
                  <span className="font-medium">
                    {bridge.upload_url || "Unbekannt"}
                  </span>
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
      ))}
    </main>
  );
}
