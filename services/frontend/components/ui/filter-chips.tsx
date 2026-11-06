import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot';

export type FilterChipItem = {
  id: string;
  label: string;
  active: boolean;
  /** Per-item handler. Omit when the group provides `onSelect`. */
  onPress?: () => void;
  count?: number;
  /** Shows a leading status dot. */
  tone?: StatusDotTone;
};

/**
 * Horizontal row of toggle buttons used for quick filtering above a table.
 * `children` renders right-aligned (e.g. a result counter).
 */
export function FilterChips({
  label,
  items,
  onSelect,
  children,
  className,
}: {
  label: string;
  items: FilterChipItem[];
  /** Called with the item id; alternative to per-item `onPress`. */
  onSelect?: (id: string) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          aria-pressed={item.active}
          onClick={() => (item.onPress ?? (() => onSelect?.(item.id)))()}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            item.active
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          {item.tone ? <StatusDot tone={item.tone} /> : null}
          {item.label}
          {item.count !== undefined ? (
            <span className="tabular-nums text-xs text-muted-foreground">{item.count}</span>
          ) : null}
        </button>
      ))}
      {children ? <span className="ml-auto text-xs text-muted-foreground">{children}</span> : null}
    </div>
  );
}
