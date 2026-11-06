'use client';

import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOverlayPortal } from './overlay-portal';

export type SearchableSelectItem = { value: string; label: string; description?: string };

/**
 * A select you can type into to narrow the list. Looks like PanelUI's Select
 * (PanelUI has no combobox) and is built on Base UI's Combobox.
 */
export function SearchableSelect({
  items,
  value,
  onValueChange,
  placeholder = 'Search…',
  emptyText = 'No matches',
  clearable = false,
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
}: {
  items: SearchableSelectItem[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  emptyText?: string;
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}) {
  const container = useOverlayPortal();
  const selected = items.find((item) => item.value === value) ?? null;

  return (
    <Combobox.Root
      items={items}
      value={selected}
      onValueChange={(next: SearchableSelectItem | null) => onValueChange(next?.value ?? null)}
      itemToStringLabel={(item: SearchableSelectItem) => item.label}
      itemToStringValue={(item: SearchableSelectItem) => item.value}
      isItemEqualToValue={(a: SearchableSelectItem, b: SearchableSelectItem) => a.value === b.value}
      disabled={disabled}
    >
      <div className={cn('relative', className)}>
        <Combobox.Input
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 pr-16 text-sm text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
        />
        <div className="absolute inset-y-0 right-1 flex items-center">
          {clearable && selected ? (
            <Combobox.Clear
              aria-label="Clear selection"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden className="size-3.5" />
            </Combobox.Clear>
          ) : null}
          <Combobox.Trigger
            aria-label="Show options"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <ChevronsUpDown aria-hidden className="size-4" />
          </Combobox.Trigger>
        </div>
      </div>
      <Combobox.Portal container={container}>
        <Combobox.Positioner sideOffset={6} align="start" className="z-50 outline-none">
          <Combobox.Popup className="w-(--anchor-width) min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Combobox.Empty className="px-3 py-3 text-sm text-muted-foreground empty:hidden">
              {emptyText}
            </Combobox.Empty>
            <Combobox.List className="max-h-72 scroll-py-1 overflow-y-auto p-1">
              {(item: SearchableSelectItem) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="flex cursor-default select-none items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.label}</span>
                    {item.description ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  <Combobox.ItemIndicator className="flex size-4 items-center justify-center">
                    <Check aria-hidden className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
