'use client';

import type { Collection } from '@/lib/api';
import { Chip } from '@heroui/react';

export function CollectionBadgeList({
  collections,
  emptyLabel,
}: {
  collections?: Collection[] | null;
  emptyLabel?: string;
}) {
  if (!collections || collections.length === 0) {
    return emptyLabel ? (
      <span className="text-xs text-zinc-500">{emptyLabel}</span>
    ) : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {collections.map((collection) => (
        <Chip key={collection.id} size="sm" variant="soft" color="accent">
          {collection.name}
        </Chip>
      ))}
    </div>
  );
}
