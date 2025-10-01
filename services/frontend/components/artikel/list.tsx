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
import { Icon } from "@iconify/react";
import { useMemo, useState } from "react";
import React from "react";

import DeleteModal from "../modals/delete";

export default function ArtikelList({ artikel }: { artikel: any }) {
  const deleteModal = useDisclosure();

  const [filterValue, setFilterValue] = React.useState("");
  const hasSearchFilter = Boolean(filterValue);

  const [page, setPage] = useState(1);
  const rowsPerPage = 15;
  const pages = Math.ceil(artikel.length / rowsPerPage);
  const totalPages = Math.max(1, Math.ceil(artikel.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);

  const items = useMemo(() => {
    const filtered = artikel.filter(
      (item: any) =>
        item.artikel?.toLowerCase().includes(filterValue.toLowerCase()) ||
        item.kurzname?.toLowerCase().includes(filterValue.toLowerCase()) ||
        item.betriebsnummer?.toLowerCase().includes(filterValue.toLowerCase()),
    );

    const start = (safePage - 1) * rowsPerPage;

    return filtered.slice(start, start + rowsPerPage);
  }, [artikel, safePage, filterValue]);

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
          <TableColumn key="artikel">Artikel</TableColumn>
          <TableColumn key="betriebsnummer">Betriebsnummer</TableColumn>
          <TableColumn key="kurzname">Kurzname</TableColumn>
        </TableHeader>
        <TableBody emptyContent={"Keine Artikel vorhanden."} items={items}>
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
