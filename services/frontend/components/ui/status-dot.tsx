import { cn } from '@/lib/utils';

export type StatusDotTone = 'danger' | 'warning' | 'success' | 'accent' | 'neutral' | 'muted';

const toneClassName: Record<StatusDotTone, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  accent: 'bg-info',
  neutral: 'bg-muted-foreground',
  muted: 'bg-muted-foreground/30',
};

/** Small decorative status indicator. Always pair it with a text label. */
export function StatusDot({
  tone = 'neutral',
  className,
}: {
  tone?: StatusDotTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', toneClassName[tone], className)}
    />
  );
}

/** Dot + label, optionally followed by a muted detail line. */
export function StatusLabel({
  tone,
  label,
  detail,
  title,
  className,
}: {
  tone?: StatusDotTone;
  label: string;
  detail?: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-0.5', className)} title={title}>
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <StatusDot tone={tone} />
        {label}
      </p>
      {detail ? <div className="pl-4 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

/** Compact inline tag: optional dot + small muted text. Replaces soft chips in dense rows. */
export function StatusTag({
  tone,
  children,
  className,
}: {
  tone?: StatusDotTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground',
        className
      )}
    >
      {tone ? <StatusDot tone={tone} className="size-1.5" /> : null}
      {children}
    </span>
  );
}

/** Maps legacy Chip colors to a status tone (`default` has no tone). */
export function toneFromChipColor(color?: string): StatusDotTone | undefined {
  switch (color) {
    case 'success':
    case 'warning':
    case 'danger':
    case 'accent':
      return color;
    default:
      return undefined;
  }
}
