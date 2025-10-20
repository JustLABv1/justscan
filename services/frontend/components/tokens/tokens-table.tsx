import { Icon } from "@iconify/react";
import {
  addToast,
  Button,
  ButtonGroup,
  Chip,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import React from "react";

import CreateBridgeTokenModal from "../modals/admin/tokens/create_bridge";
import DeleteTokenModal from "../modals/admin/tokens/delete";
import ChangeTokenStatusModal from "../modals/admin/tokens/change_status";

export default function TokensTable({
  tokens,
  showTokenGenerate,
  showCopyToClipboard,
}: {
  tokens: any[];
  showTokenGenerate?: boolean;
  showCopyToClipboard?: boolean;
}) {
  const [targetToken, setTargetToken] = React.useState({} as any);

  // project tokens
  const createBridgeTokenModal = useDisclosure();
  const changeTokenStatusModal = useDisclosure();

  const deleteTokenModal = useDisclosure();

  // pagination
  const [page, setPage] = React.useState(1);
  const rowsPerPage = 7;
  const pages = Math.ceil(tokens.length / rowsPerPage);
  const items = React.useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;

    return tokens.slice(start, end);
  }, [page, tokens]);

  const copyTokentoClipboard = (key: string) => {
    navigator.clipboard.writeText(key);
    addToast({
      title: "Token",
      description: "Token copied to clipboard",
      color: "success",
      variant: "flat",
    });
  };

  function getStatus(key: any) {
    if (key.disabled) {
      return "Deaktiviert";
    }

    if (new Date(key.expires_at) < new Date()) {
      return "Abgelaufen";
    }

    return "Aktiv";
  }

  const renderCell = React.useCallback((key: any, columnKey: any) => {
    const cellValue = key[columnKey];

    switch (columnKey) {
      case "actions":
        return (
          <ButtonGroup variant="light">
            {showCopyToClipboard && (
              <Tooltip content="In Zwischenablage kopieren">
                <Button
                  isIconOnly
                  onPress={() => {
                    copyTokentoClipboard(key.key);
                  }}
                >
                  <Icon icon="hugeicons:copy-02" width={20} />
                </Button>
              </Tooltip>
            )}
            {!key.disabled && (
              <Tooltip content="Deaktivieren">
                <Button
                  isIconOnly
                  color="danger"
                  onPress={() => {
                    key.disabled = true;
                    setTargetToken(key);
                    changeTokenStatusModal.onOpen();
                  }}
                >
                  <Icon icon="hugeicons:square-lock-01" width={20} />
                </Button>
              </Tooltip>
            )}
            {key.disabled && (
              <Tooltip content="Aktivieren">
                <Button
                  isIconOnly
                  color="success"
                  onPress={() => {
                    key.disabled = false;
                    setTargetToken(key);
                    changeTokenStatusModal.onOpen();
                  }}
                >
                  <Icon icon="hugeicons:square-unlock-01" width={20} />
                </Button>
              </Tooltip>
            )}
            <Tooltip color="danger" content="Löschen">
              <Button
                isIconOnly
                color="danger"
                onPress={() => {
                  setTargetToken(key);
                  deleteTokenModal.onOpen();
                }}
              >
                <Icon icon="hugeicons:delete-02" width={20} />
              </Button>
            </Tooltip>
          </ButtonGroup>
        );
      case "description":
        return (
          <div>
            <p className="max-w-xs truncate" title={cellValue}>
              {cellValue}
            </p>
            <p className="text-sm text-default-500">{key.id}</p>
          </div>
        );
      case "expires_at":
        return new Date(key.expires_at).toLocaleString();
      case "created_at":
        return new Date(key.created_at).toLocaleString();
      case "status":
        return (
          <div>
            <Chip
              className="capitalize"
              color={
                getStatus(key) === "Abgelaufen"
                  ? "warning"
                  : getStatus(key) === "Deaktiviert"
                    ? "danger"
                    : "success"
              }
              radius="sm"
              size="sm"
              variant="flat"
            >
              {getStatus(key)}
            </Chip>
            {key.disabled && (
              <p className="text-sm text-default-400">{key.disabled_reason}</p>
            )}
          </div>
        );
      case "type":
        return <p>{key.type}</p>;
      default:
        return cellValue;
    }
  }, []);

  const topContent = React.useMemo(() => {
    return (
      <div className="flex flex-col items-end justify-center gap-4">
        <Button
          color="primary"
          startContent={<Icon icon="hugeicons:plus-sign" width={18} />}
          onPress={() => createBridgeTokenModal.onOpen()}
        >
          Token generieren
        </Button>
      </div>
    );
  }, []);

  return (
    <div>
      <Table
        aria-label="Example table with custom cells"
        bottomContent={
          <div className="flex w-full justify-center">
            <Pagination
              showControls
              color="primary"
              page={page}
              total={pages}
              onChange={(page) => setPage(page)}
            />
          </div>
        }
        classNames={{
          wrapper: "min-h-[222px]",
        }}
        topContent={showTokenGenerate ? topContent : undefined}
      >
        <TableHeader>
          <TableColumn key="description" align="start">
            Beschreibung
          </TableColumn>
          <TableColumn key="status" align="center">
            Status
          </TableColumn>
          <TableColumn key="type" align="center">
            Typ
          </TableColumn>
          <TableColumn key="expires_at" align="center">
            Ablaufdatum
          </TableColumn>
          <TableColumn key="created_at" align="center">
            Erstellungsdatum
          </TableColumn>
          <TableColumn key="actions" align="center">
            Aktionen
          </TableColumn>
        </TableHeader>
        <TableBody emptyContent="Keine Daten verfügbar." items={items}>
          {(item: any) => (
            <TableRow key={item.id}>
              {(columnKey) => (
                <TableCell>{renderCell(item, columnKey)}</TableCell>
              )}
            </TableRow>
          )}
        </TableBody>
      </Table>
      <CreateBridgeTokenModal disclosure={createBridgeTokenModal} />
      <ChangeTokenStatusModal
        disabled={targetToken.disabled}
        disclosure={changeTokenStatusModal}
        token={targetToken}
      />
      <DeleteTokenModal disclosure={deleteTokenModal} token={targetToken} />
    </div>
  );
}
