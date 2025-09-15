"use client";

import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Divider,
  Input,
  Pagination,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { useMemo, useState } from "react";
import React from "react";

import DeleteModal from "../modals/delete";

export default function ArtikelList({ artikel }: { artikel: any }) {
  const deleteModal = useDisclosure();

  const [search, setSearch] = React.useState("");

  const [page, setPage] = useState(1);
  const limit = 15;
  const totalPages = Math.max(1, Math.ceil(artikel.length / limit));
  const safePage = Math.min(page, totalPages);

  const items = useMemo(() => {
    const filtered = artikel.filter(
      (item: any) =>
        item.kurzname?.toLowerCase().includes(search.toLowerCase()) ||
        item.artikelnummer?.toLowerCase().includes(search.toLowerCase()),
    );

    const start = (safePage - 1) * limit;

    return filtered.slice(start, start + limit);
  }, [artikel, safePage, search]);

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xl font-bold mb-1">Artikel</p>
        <Input
          className="max-w-xs"
          placeholder="Suchen..."
          radius="sm"
          size="md"
          startContent={<Icon icon="hugeicons:search-01" width={16} />}
          type="text"
          value={search}
          onValueChange={setSearch}
        />
      </div>
      <Divider className="my-4" />
      {items.length === 0 && (
        <p className="text-center text-default-400">Keine Artikel vorhanden.</p>
      )}
      <div className="grid grid-cols-2 items-stretch justify-between gap-4 lg:grid-cols-3">
        {items.map((item: any) => (
          <Card key={item.artikelnummer}>
            <CardBody>
              <p>{item.kurzname}</p>
            </CardBody>
            <Divider />
            <CardFooter className="flex items-center justify-between">
              <p className="text-sm text-default-400">
                Nummer: {item.artikelnummer}
              </p>
              <Tooltip content="Löschen">
                <Button
                  isIconOnly
                  color="danger"
                  size="sm"
                  variant="flat"
                  onPress={deleteModal.onOpen}
                >
                  <Icon icon="hugeicons:delete-02" width={16} />
                </Button>
              </Tooltip>
            </CardFooter>
          </Card>
        ))}
      </div>
      <div className="flex justify-center mt-4 mb-4">
        <Pagination
          showControls
          page={safePage}
          total={totalPages}
          onChange={(newPage) => setPage(newPage)}
        />
      </div>
      <DeleteModal disclosure={deleteModal} />
    </main>
  );
}
