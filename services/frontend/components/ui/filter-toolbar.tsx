'use client';

import { Chip, Disclosure, Toolbar, buttonVariants } from '@/components/ui';
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
  'mt-2 flex flex-wrap items-center gap-2 border-t border-divider pt-2';

export function FilterDisclosureTrigger({
  activeCount = 0,
  label = 'More filters',
}: FilterDisclosureTriggerProps) {
  return (
    <Disclosure.Heading>
      <Disclosure.Trigger
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'w-auto justify-center py-0 hover:no-underline'
        )}
      >
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
    <Toolbar
      aria-label="Filters"
      className={cn(
        'flex w-full flex-col justify-start gap-2 xl:flex-row xl:items-center',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
        {search ? <div className="min-w-0 flex-1">{search}</div> : null}
        {filters ? (
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">{filters}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 xl:justify-end">{actions}</div>
      ) : null}
      {activeFilters ? (
        <div className="flex flex-wrap items-center gap-2">{activeFilters}</div>
      ) : null}
    </Toolbar>
  );
}
