import {
  Button,
  Card,
  CardBody,
  Chip,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { useState } from "react";

import DeleteBridgeModal from "../modals/admin/bridge/delete";

export default function CsvBridges({ bridges }: any) {
  const deleteBridgeModal = useDisclosure();
  const [targetBridge, setTargetBridge] = useState({} as any);

  function heartbeatColor(bridge: any) {
    const timeAgo =
      (new Date(bridge.last_heartbeat).getTime() - Date.now()) / 1000;

    if (bridge.reachable === false) {
      return "danger";
    }

    if (timeAgo < 0 && timeAgo > -30) {
      return "success";
    } else if (timeAgo <= -30 && timeAgo > -60) {
      return "warning";
    } else if (timeAgo <= -60) {
      return "danger";
    }
  }

  function heartbeatStatus(bridge: any, skipReachableCheck = false) {
    const timeAgo =
      (new Date(bridge.last_heartbeat).getTime() - Date.now()) / 1000;

    if (bridge.reachable === false && !skipReachableCheck) {
      return false;
    }

    if (timeAgo < 0 && timeAgo > -35) {
      return true;
    } else if (timeAgo <= -35) {
      return false;
    }
  }

  return (
    <main className="flex flex-col gap-4">
      {bridges &&
        bridges.map((bridge: any) => (
          <Card key={bridge.id} fullWidth>
            <CardBody className="p-5">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold">
                    {bridge.bridge_name}
                  </h3>
                  <p className="text-small text-default-500 mt-1">
                    ID: {bridge.bridge_id}
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

                  <Tooltip
                    content={
                      <div className="flex flex-col gap-1">
                        <p>
                          Backend -&gt; Bridge:{" "}
                          {bridge.reachable ? (
                            <span className="text-success">Erreichbar</span>
                          ) : (
                            <span className="text-danger">
                              Nicht erreichbar
                            </span>
                          )}
                        </p>
                        <p>
                          Bridge -&gt; Backend:{" "}
                          {heartbeatStatus(bridge, true) ? (
                            <span className="text-success">Online</span>
                          ) : (
                            <span className="text-danger">Offline</span>
                          )}
                        </p>
                        <p>
                          Letzter Heartbeat:{" "}
                          {new Date(bridge.last_heartbeat).toLocaleString()}
                        </p>
                      </div>
                    }
                    placement="top"
                  >
                    <Chip
                      color={heartbeatColor(bridge)}
                      radius="sm"
                      variant="flat"
                    >
                      {heartbeatStatus(bridge) ? "Online" : "Offline"}
                    </Chip>
                  </Tooltip>
                  <Tooltip color="danger" content="Löschen">
                    <Button
                      isIconOnly
                      color="danger"
                      variant="light"
                      onPress={() => {
                        setTargetBridge(bridge);
                        deleteBridgeModal.onOpen();
                      }}
                    >
                      <Icon icon="hugeicons:delete-02" width={20} />
                    </Button>
                  </Tooltip>
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
      <DeleteBridgeModal bridge={targetBridge} disclosure={deleteBridgeModal} />
    </main>
  );
}
