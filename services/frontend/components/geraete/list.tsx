"use client";

import {
  getKeyValue,
  Input,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  useDisclosure,
} from "@heroui/react";
import React from "react";
import { Icon } from "@iconify/react";

import DeleteModal from "../modals/delete";

export default function GeraeteList({ geraete }: { geraete: any }) {
  const deleteModal = useDisclosure();

  const [filterValue, setFilterValue] = React.useState("");

  const [page, setPage] = React.useState(1);
  const rowsPerPage = 15;

  const pages = Math.ceil(geraete.length / rowsPerPage);
  const hasSearchFilter = Boolean(filterValue);

  const filteredItems = React.useMemo(() => {
    let filteredGeraete = [...geraete];

    if (hasSearchFilter) {
      filteredGeraete = filteredGeraete.filter(
        (geraet) =>
          geraet.gerätenummer
            .toLowerCase()
            .includes(filterValue.toLowerCase()) ||
          geraet.betriebsnummer
            .toLowerCase()
            .includes(filterValue.toLowerCase()),
      );
    }

    return filteredGeraete;
  }, [geraete, filterValue]);

  const items = React.useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;

    return filteredItems.slice(start, end);
  }, [page, filteredItems, rowsPerPage]);

  const onSearchChange = React.useCallback((value: any) => {
    if (value) {
      setFilterValue(value);
      setPage(1);
    } else {
      setFilterValue("");
    }
  }, []);

  return (
    <main>
      <Table
        aria-label="Example table with client side pagination"
        bottomContent={
          <div className="flex w-full justify-center">
            <Pagination
              isCompact
              showControls
              showShadow
              color="primary"
              isDisabled={hasSearchFilter}
              page={page}
              total={pages}
              onChange={(page) => setPage(page)}
            />
          </div>
        }
        classNames={{
          wrapper: "min-h-[222px]",
        }}
        topContent={
          <Input
            isClearable
            classNames={{
              base: "w-full sm:max-w-[44%]",
            }}
            placeholder="Suchen..."
            size="sm"
            startContent={
              <Icon className="text-default-300" icon="hugeicons:search-01" />
            }
            value={filterValue}
            variant="flat"
            onClear={() => setFilterValue("")}
            onValueChange={onSearchChange}
          />
        }
      >
        <TableHeader>
          <TableColumn key="betriebsnummer">Betriebsnummer</TableColumn>
          <TableColumn key="gerätenummer">Gerätenummer</TableColumn>
        </TableHeader>
        <TableBody emptyContent={"Keine Geräte vorhanden."} items={items}>
          {(item: any) => (
            <TableRow key={item.id}>
              {(columnKey) => (
                <TableCell>{getKeyValue(item, columnKey)}</TableCell>
              )}
            </TableRow>
          )}
        </TableBody>
      </Table>
      <DeleteModal disclosure={deleteModal} />
    </main>
  );
}
