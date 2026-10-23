'use client';

import * as React from 'react';
import * as Aria from 'react-aria-components';
import { Check, ArrowDown, ArrowUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Indicator, Input } from './primitives';
import { useOverlayPortal } from './overlay-portal';

import {
  NOVA_SELECTTRIGGER,
  NOVA_DROPDOWNMENUITEM,
  NOVA_TABLEHEAD,
  NOVA_TABLECELL,
  NOVA_TABSTRIGGER,
} from './nova-styles';

const popupClass =
  'z-50 min-w-[var(--trigger-width)] overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none entering:animate-in entering:fade-in exiting:animate-out exiting:fade-out';
const triggerClass = NOVA_SELECTTRIGGER;
const itemClass = NOVA_DROPDOWNMENUITEM + ' justify-between data-[selected]:font-medium';
function collectionText(node: React.ReactNode): string {
  return React.Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (React.isValidElement<{ children?: React.ReactNode }>(child))
        return collectionText(child.props.children);
      return '';
    })
    .join(' ')
    .trim();
}
export const ListBox = Object.assign(
  function ListBox<T extends object>({ className, ...props }: Aria.ListBoxProps<T>) {
    return (
      <Aria.ListBox
        className={cn(
          'max-h-80 overflow-auto outline-none',
          typeof className === 'string' && className
        )}
        {...props}
      />
    );
  },
  {
    Item: function Item<T extends object>({ className, ...props }: Aria.ListBoxItemProps<T>) {
      return (
        <Aria.ListBoxItem
          className={cn('group', itemClass, typeof className === 'string' && className)}
          {...props}
          textValue={
            props.textValue ??
            (typeof props.children === 'function' ? undefined : collectionText(props.children))
          }
        />
      );
    },
    ItemIndicator: () => (
      <Check aria-hidden className="ml-auto size-4 opacity-0 group-data-[selected]:opacity-100" />
    ),
  }
);
export const Select = Object.assign(
  function Select<T extends object, M extends 'single' | 'multiple' = 'single'>({
    className,
    variant: _variant,
    ...props
  }: Aria.SelectProps<T, M> & { variant?: string }) {
    return (
      <Aria.Select<T, M>
        className={cn('flex min-w-0 flex-col gap-1.5', typeof className === 'string' && className)}
        {...props}
      />
    );
  },
  {
    Trigger: ({ className, ...props }: Aria.ButtonProps) => (
      <Aria.Button
        className={cn(triggerClass, typeof className === 'string' && className)}
        {...props}
      />
    ),
    Value: function Value<T extends object>({
      children,
      className,
      ...props
    }: Aria.SelectValueProps<T>) {
      return (
        <Aria.SelectValue
          className={cn('min-w-0 truncate text-left', typeof className === 'string' && className)}
          {...props}
        >
          {children ??
            (({ selectedText, isPlaceholder }) =>
              isPlaceholder ? 'Select an item' : selectedText)}
        </Aria.SelectValue>
      );
    },
    Indicator,
    Popover: ({ className, ...props }: Aria.PopoverProps) => (
      <Aria.Popover
        UNSTABLE_portalContainer={useOverlayPortal()}
        className={cn(popupClass, typeof className === 'string' && className)}
        {...props}
      />
    ),
  }
);
export const ComboBox = Object.assign(
  function ComboBox<T extends object>({ className, ...props }: Aria.ComboBoxProps<T>) {
    return (
      <Aria.ComboBox
        className={cn('flex flex-col gap-1.5', typeof className === 'string' && className)}
        {...props}
      />
    );
  },
  {
    InputGroup: ({ className, ...props }: React.ComponentProps<typeof Aria.Group>) => (
      <Aria.Group
        className={cn('flex items-center', typeof className === 'string' && className)}
        {...props}
      />
    ),
    Trigger: (props: Aria.ButtonProps) => (
      <Aria.Button
        aria-label="Show suggestions"
        className="-ml-9 flex size-8 items-center justify-center"
        {...props}
      >
        <Indicator />
      </Aria.Button>
    ),
    Popover: Select.Popover,
  }
);
export const Autocomplete = Object.assign(Select, {
  ...Select,
  ClearButton: ({ className }: { className?: string }) => {
    const state = React.useContext(Aria.SelectStateContext);
    return (
      <Aria.Button
        aria-label="Clear selection"
        className={className}
        onPress={() => state?.setSelectedKey(null)}
      >
        <X className="size-3" />
      </Aria.Button>
    );
  },
  Filter: function Filter({
    children,
    filter,
  }: {
    children: React.ReactNode;
    filter?: (text: string, input: string) => boolean;
  }) {
    const [inputValue, setInputValue] = React.useState('');
    return (
      <Aria.Autocomplete inputValue={inputValue} onInputChange={setInputValue} filter={filter}>
        <Aria.SearchField aria-label="Filter options" value={inputValue} onChange={setInputValue}>
          <Input placeholder="Search…" />
        </Aria.SearchField>
        {children}
      </Aria.Autocomplete>
    );
  },
});

const menuActionContext = React.createContext<((key: Aria.Key) => void) | undefined>(undefined);
export const Dropdown = Object.assign(Aria.MenuTrigger, {
  Trigger: ({ className, ...props }: Aria.ButtonProps) => (
    <Aria.Button
      className={cn(
        'inline-flex items-center justify-center',
        typeof className === 'string' && className
      )}
      {...props}
    />
  ),
  Popover: Select.Popover,
  Menu: function Menu<T extends object>({
    onAction,
    className,
    ...props
  }: Aria.MenuProps<T> & { onAction?: (key: Aria.Key) => void }) {
    return (
      <menuActionContext.Provider value={onAction}>
        <Aria.Menu
          className={cn('outline-none', typeof className === 'string' && className)}
          {...props}
        />
      </menuActionContext.Provider>
    );
  },
  Item: function Item<T extends object>({
    variant,
    onAction,
    id,
    className,
    ...props
  }: Aria.MenuItemProps<T> & { variant?: string }) {
    const action = React.useContext(menuActionContext);
    return (
      <Aria.MenuItem
        id={id}
        onAction={() => {
          onAction?.();
          if (id != null) action?.(id);
        }}
        className={cn(
          'group',
          itemClass,
          variant === 'danger' && 'text-destructive',
          typeof className === 'string' && className
        )}
        {...props}
      />
    );
  },
  Section: Aria.MenuSection,
  ItemIndicator: () => (
    <Check aria-hidden className="size-4 opacity-0 group-data-[selected]:opacity-100" />
  ),
});
export const TagGroup = Object.assign(Aria.TagGroup, { List: Aria.TagList });
export function Tag({
  children,
  className,
  variant: _variant,
  ...props
}: Aria.TagProps & { variant?: string }) {
  return (
    <Aria.Tag
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-xs outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring',
        typeof className === 'string' && className
      )}
      {...props}
    >
      {typeof children === 'function' ? (
        children
      ) : (
        <>
          {children}
          <Aria.Button slot="remove" aria-label="Remove value">
            <X className="size-3" />
          </Aria.Button>
        </>
      )}
    </Aria.Tag>
  );
}

const sortContext = React.createContext<{
  sortDescriptor?: Aria.SortDescriptor;
  onSortChange?: (sort: Aria.SortDescriptor) => void;
}>({});
export const Table = Object.assign(
  function Table({
    className,
    variant: _variant,
    ...props
  }: React.ComponentProps<'div'> & { variant?: string }) {
    return <div className={cn('w-full text-sm', className)} {...props} />;
  },
  {
    ScrollContainer: ({ className, ...props }: React.ComponentProps<'div'>) => (
      <div
        className={cn('w-full overflow-auto rounded-md border border-border', className)}
        {...props}
      />
    ),
    Content: function Content({
      className,
      sortDescriptor,
      onSortChange,
      ...props
    }: Aria.TableProps) {
      return (
        <sortContext.Provider value={{ sortDescriptor, onSortChange }}>
          <Aria.Table
            sortDescriptor={sortDescriptor}
            onSortChange={onSortChange}
            className={cn(
              'w-full caption-bottom text-sm outline-none',
              typeof className === 'string' && className
            )}
            {...props}
          />
        </sortContext.Provider>
      );
    },
    Header: function Header<T extends object>({ className, ...props }: Aria.TableHeaderProps<T>) {
      return (
        <Aria.TableHeader
          className={cn('[&_tr]:border-b', typeof className === 'string' && className)}
          {...props}
        />
      );
    },
    Column: function Column({ className, children, ...props }: Aria.ColumnProps) {
      return (
        <Aria.Column
          className={cn(
            NOVA_TABLEHEAD +
              ' outline-none data-[focus-visible]:ring-3 data-[focus-visible]:ring-ring/50',
            typeof className === 'string' && className
          )}
          {...props}
        >
          {children}
        </Aria.Column>
      );
    },
    Body: function Body<T extends object>(props: Aria.TableBodyProps<T>) {
      return <Aria.TableBody {...props} />;
    },
    Row: function Row<T extends object>({ className, ...props }: Aria.RowProps<T>) {
      return (
        <Aria.Row
          className={cn(
            'border-b border-border transition-colors last:border-0 hover:bg-muted/50 data-[selected]:bg-muted data-[focus-visible]:outline-2 data-[focus-visible]:outline-ring',
            typeof className === 'string' && className
          )}
          {...props}
        />
      );
    },
    Cell: ({ className, ...props }: Aria.CellProps) => (
      <Aria.Cell
        className={cn(
          NOVA_TABLECELL +
            ' outline-none data-[focus-visible]:ring-3 data-[focus-visible]:ring-ring/50',
          typeof className === 'string' && className
        )}
        {...props}
      />
    ),
    Collection: Aria.Collection,
    Footer: ({ className, ...props }: React.ComponentProps<'div'>) => (
      <div className={cn('border-t border-border p-4', className)} {...props} />
    ),
    SortableColumnHeader: function SortableColumnHeader({
      children,
      column,
      className,
      sortDirection,
    }: {
      children?: React.ReactNode;
      column?: Aria.Key;
      className?: string;
      sortDirection?: Aria.SortDescriptor['direction'];
    }) {
      const { sortDescriptor } = React.useContext(sortContext);
      return (
        <span className={cn('inline-flex items-center gap-1', className)}>
          {children}
          {sortDirection || (sortDescriptor && sortDescriptor.column === column) ? (
            (sortDirection ?? sortDescriptor?.direction) === 'ascending' ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )
          ) : null}
        </span>
      );
    },
    LoadMore: Aria.TableLoadMoreItem,
    LoadMoreContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  }
);
export const Tabs = Object.assign(
  function Tabs({ className, variant: _variant, ...props }: Aria.TabsProps & { variant?: string }) {
    return (
      <Aria.Tabs
        className={cn('flex flex-col gap-2', typeof className === 'string' && className)}
        {...props}
      />
    );
  },
  {
    ListContainer: ({ children, className }: React.ComponentProps<'div'>) => (
      <div className={className}>{children}</div>
    ),
    List: function List<T extends object>({ className, ...props }: Aria.TabListProps<T>) {
      return (
        <Aria.TabList
          className={cn(
            'inline-flex h-8 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground',
            typeof className === 'string' && className
          )}
          {...props}
        />
      );
    },
    Tab: ({ className, ...props }: Aria.TabProps) => (
      <Aria.Tab
        className={cn(
          NOVA_TABSTRIGGER +
            ' cursor-pointer data-[selected]:bg-background data-[selected]:text-foreground',
          typeof className === 'string' && className
        )}
        {...props}
      />
    ),
    Indicator: () => null,
    Panel: Aria.TabPanel,
  }
);
