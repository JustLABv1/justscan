'use client';

import type { Tag } from '@/lib/api';
import { Chip } from '@heroui/react';

export function ScanTagBadgeList({
  emptyLabel = 'No labels',
  tags,
}: {
  emptyLabel?: string;
  tags?: Tag[];
}) {
  if (!tags?.length) {
    return <span className="text-xs text-muted">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Chip key={tag.id} color="accent" size="sm" variant="soft">
          {tag.name}
        </Chip>
      ))}
    </div>
  );
}
