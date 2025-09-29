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
import React from "react";

import DeleteModal from "../modals/delete";

export default function KostenstellenList({
  kostenstellen,
}: {
  kostenstellen: any;
}) {
  const deleteModal = useDisclosure();

  const [filterValue, setFilterValue] = React.useState("");

  const [page, setPage] = React.useState(1);
  const rowsPerPage = 15;

  const pages = Math.ceil(kostenstellen.length / rowsPerPage);
  const hasSearchFilter = Boolean(filterValue);

  const filteredItems = React.useMemo(() => {
    let filteredKostenstellen = [...kostenstellen];

    if (hasSearchFilter) {
      filteredKostenstellen = filteredKostenstellen.filter(
        (kostenstelle) =>
          kostenstelle.kostenstellenummer
            .toLowerCase()
            .includes(filterValue.toLowerCase()) ||
          kostenstelle.bezeichnung
            .toLowerCase()
            .includes(filterValue.toLowerCase()),
      );
    }

    return filteredKostenstellen;
  }, [kostenstellen, filterValue]);

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
          <TableColumn key="kostenstellenummer">
            Kostenstellennummer
          </TableColumn>
          <TableColumn key="bezeichnung">Bezeichnung</TableColumn>
        </TableHeader>
        <TableBody
          emptyContent={"Keine Kostenstellen vorhanden."}
          items={items}
        >
          {(item: any) => (
            <TableRow key={item.kostenstellenummer}>
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
