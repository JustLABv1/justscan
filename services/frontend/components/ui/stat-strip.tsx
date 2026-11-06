import type { ReactNode } from 'react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot';

/** One bordered card containing divided statistic cells. */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div
        className={cn(
          'grid grid-cols-2 gap-px bg-border md:grid-cols-3 lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child:nth-child(odd)]:col-span-1',
          className
        )}
      >
        {children}
      </div>
    </Card>
  );
}

export function StatStripItem({
  label,
  value,
  hint,
  tone,
  mono,
  selected,
  onPress,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatusDotTone | 'default';
  mono?: boolean;
  selected?: boolean;
  onPress?: () => void;
}) {
  const className =
    'flex min-w-0 flex-col gap-1 bg-card px-4 py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
  const content = (
    <>
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <StatusDot tone={!tone || tone === 'default' ? 'muted' : tone} className="size-1.5" />
        {label}
      </span>
      <span
        className={cn(
          'truncate text-2xl font-semibold tabular-nums text-foreground',
          mono && 'font-mono'
        )}
      >
        {value}
      </span>
      {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
    </>
  );
  return onPress ? (
    <button
      type="button"
      onClick={onPress}
      className={cn(className, 'hover:bg-muted/50', selected && 'bg-muted')}
      aria-pressed={selected}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
