import { cn } from '@/lib/utils';

/**
 * Thin stacked bar showing the share of critical, high, medium, and low
 * findings. Decorative: always pair it with the counts in text.
 */
export function SeverityBar({
  critical,
  high,
  medium,
  low,
  className,
}: {
  critical: number;
  high: number;
  medium: number;
  low: number;
  className?: string;
}) {
  const parts = [
    { count: critical, className: 'bg-destructive' },
    { count: high, className: 'bg-warning' },
    { count: medium, className: 'bg-info' },
    { count: low, className: 'bg-muted-foreground/40' },
  ];
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  if (total === 0) return null;
  return (
    <span
      aria-hidden
      className={cn('flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted', className)}
    >
      {parts
        .filter((part) => part.count > 0)
        .map((part) => (
          <span
            key={part.className}
            className={part.className}
            style={{ width: `${(part.count / total) * 100}%` }}
          />
        ))}
    </span>
  );
}
