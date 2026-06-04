'use client';

import { Card } from '@heroui/react';
import type { CSSProperties, ReactNode } from 'react';

import { SurfaceIcon, type SurfaceIconTone } from '@/components/ui/surface-icon';

type StatCardTone = SurfaceIconTone | 'neutral';
type StatCardVariant = 'compact' | 'stacked';

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  iconTone?: SurfaceIconTone;
  tone?: StatCardTone;
  variant?: StatCardVariant;
  aside?: ReactNode;
  className?: string;
  style?: CSSProperties;
  contentClassName?: string;
  valueClassName?: string;
  valueStyle?: CSSProperties;
  hintClassName?: string;
  hintStyle?: CSSProperties;
  inline?: boolean;
}

function joinClassNames(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  iconTone,
  tone = 'default',
  variant = 'compact',
  aside,
  className,
  style,
  contentClassName,
  valueClassName,
  valueStyle,
  hintClassName,
  hintStyle,
  inline,
}: StatCardProps) {
  const resolvedTone = tone === 'neutral' ? 'default' : tone;
  const defaultValueToneClass =
    resolvedTone === 'danger'
      ? 'text-danger'
      : resolvedTone === 'warning'
        ? 'text-warning'
        : resolvedTone === 'success'
          ? 'text-success'
          : resolvedTone === 'accent'
            ? 'text-accent'
            : 'text-foreground';

  const labelNode = (
    <div className="flex min-w-0 items-center gap-2">
      {icon ? <SurfaceIcon icon={icon} tone={iconTone ?? resolvedTone} size="sm" /> : null}
      <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest text-muted">
        {label}
      </p>
    </div>
  );

  const valueNode = (
    <div
      className={joinClassNames(
        variant === 'stacked' ? 'text-left' : 'shrink-0 text-right',
        valueClassName ??
          joinClassNames(
            variant === 'stacked'
              ? 'text-2xl font-bold tabular-nums tracking-tight'
              : 'text-lg font-semibold tabular-nums tracking-tight',
            defaultValueToneClass
          )
      )}
      style={valueStyle}
    >
      {value}
    </div>
  );

  const hintNode = hint ? (
    <div
      className={joinClassNames(
        variant === 'stacked'
          ? 'text-xs leading-5'
          : inline
            ? 'truncate text-[11px]'
            : 'text-[11px]',
        hintClassName ?? 'text-muted'
      )}
      style={hintStyle}
    >
      {hint}
    </div>
  ) : null;

  if (variant === 'stacked') {
    return (
      <Card className={joinClassNames('px-3.5 py-3', className)} style={style}>
        <Card.Content className={joinClassNames('p-0', contentClassName)}>
          <div
            className={joinClassNames(
              'grid items-start gap-4',
              aside ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1'
            )}
          >
            <div className="min-w-0 space-y-2">
              {labelNode}
              {valueNode}
              {hintNode}
            </div>
            {aside ? <div className="flex min-w-[92px] flex-col items-end gap-2">{aside}</div> : null}
          </div>
        </Card.Content>
      </Card>
    );
  }

  if (inline) {
    return (
      <Card className={joinClassNames('px-3.5 py-3', className)} style={style}>
        <Card.Content className={joinClassNames('p-0', contentClassName)}>
          <div className="flex min-h-9 items-center justify-between gap-3">
            {labelNode}
            {valueNode}
          </div>
          {hintNode ? <div className="mt-1.5">{hintNode}</div> : null}
        </Card.Content>
      </Card>
    );
  }

  return (
    <Card className={joinClassNames('px-3.5 py-3', className)} style={style}>
      <Card.Content className={joinClassNames('p-0', contentClassName)}>
        <div className="flex min-h-9 items-center justify-between gap-3">
          {labelNode}
          {valueNode}
        </div>
        {hintNode ? <div className="mt-1.5">{hintNode}</div> : null}
      </Card.Content>
    </Card>
  );
}
