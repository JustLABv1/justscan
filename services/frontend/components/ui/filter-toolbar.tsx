'use client';

import { Card, Chip, Disclosure } from '@heroui/react';
import { FilterIcon } from 'hugeicons-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface FilterToolbarProps {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  activeFilters?: ReactNode;
  className?: string;
}

interface FilterDisclosureTriggerProps {
  activeCount?: number;
  label?: string;
}

export const filterDisclosureBodyClassName =
  'mt-3 grid gap-3 rounded-xl border border-divider bg-surface-secondary/60 p-3';

export function FilterDisclosureTrigger({
  activeCount = 0,
  label = 'Filters',
}: FilterDisclosureTriggerProps) {
  return (
    <Disclosure.Heading>
      <Disclosure.Trigger className="inline-flex h-10 items-center gap-2 rounded-xl border border-divider bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <FilterIcon size={15} aria-hidden />
        {label}
        {activeCount > 0 ? (
          <Chip color="accent" size="sm" variant="soft">
            {activeCount}
          </Chip>
        ) : null}
        <Disclosure.Indicator />
      </Disclosure.Trigger>
    </Disclosure.Heading>
  );
}

export function FilterToolbar({
  search,
  filters,
  actions,
  activeFilters,
  className,
}: FilterToolbarProps) {
  return (
    <Card className={cn('surface-card rounded-3xl border border-divider/70', className)}>
      <Card.Content className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center">
            {search ? <div className="min-w-0 flex-1">{search}</div> : null}
            {filters ? (
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                {filters}
              </div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">{actions}</div>
          ) : null}
        </div>
        {activeFilters ? (
          <div className="flex flex-wrap items-center gap-2">{activeFilters}</div>
        ) : null}
      </Card.Content>
    </Card>
  );
}
