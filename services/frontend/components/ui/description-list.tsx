import * as React from 'react';
import { cn } from '@/lib/utils';

export type DescriptionItem = {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Render the value in the monospace face, for paths, digests, and keys. */
  mono?: boolean;
  /** Let the item span the full width (long values such as URLs). */
  wide?: boolean;
  hidden?: boolean;
};

/**
 * Key/value facts for detail panels and modals. Labels sit above values in a
 * responsive grid, and long values wrap instead of overflowing.
 */
export function DescriptionList({
  items,
  columns = 2,
  className,
}: {
  items: DescriptionItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;
  return (
    <dl
      data-slot="description-list"
      className={cn(
        'grid gap-x-6 gap-y-4 text-sm',
        columns >= 2 && 'sm:grid-cols-2',
        columns === 3 && 'lg:grid-cols-3',
        className
      )}
    >
      {visible.map((item, index) => (
        <div
          key={index}
          className={cn('flex min-w-0 flex-col gap-1', item.wide && 'sm:col-span-full')}
        >
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd
            className={cn(
              'min-w-0 text-foreground [overflow-wrap:anywhere]',
              item.mono && 'font-mono text-xs leading-5'
            )}
          >
            {item.value ?? <span className="text-muted-foreground">Not set</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
