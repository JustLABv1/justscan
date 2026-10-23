'use client';

import { Card } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import {
  SurfaceIcon,
  type SurfaceIconTone,
  type SurfaceIconVariant,
} from '@/components/ui/surface-icon';

type StatCardTone = SurfaceIconTone | 'neutral';
type StatCardVariant = 'compact' | 'stacked';

export interface StatCardTrend {
  /** Formatted comparison, e.g. "3.82%". Only supply actual comparison data. */
  value: string;
  direction: 'up' | 'down' | 'flat';
  /** Direction and desirability differ: fewer vulnerabilities can be positive. */
  tone: 'success' | 'danger' | 'neutral';
  label: string;
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  trend?: StatCardTrend;
  icon?: ReactNode;
  iconTone?: SurfaceIconTone;
  iconVariant?: SurfaceIconVariant;
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

export function StatCard({
  label,
  value,
  hint,
  trend,
  icon,
  iconTone,
  iconVariant,
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
  const labelId = useId();
  const resolvedTone = tone === 'neutral' ? 'default' : tone;
  const valueTones: Record<SurfaceIconTone, string> = {
    default: 'text-foreground',
    danger: 'text-danger',
    warning: 'text-warning-foreground',
    success: 'text-success-foreground',
    accent: 'text-primary',
  };
  const TrendIcon =
    trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : Minus;

  return (
    <Card
      aria-labelledby={labelId}
      data-slot="stat-card"
      className={cn(
        'flex h-full min-w-0 flex-col gap-0 rounded-xl bg-muted/50 p-1 shadow-none ring-0 border border-border',
        className
      )}
      style={style}
    >
      <div className="flex min-h-8 min-w-0 items-center justify-between gap-2 px-2 py-1">
        <p id={labelId} className="min-w-0 text-sm font-medium leading-5 text-foreground">
          {label}
        </p>
        {icon ? (
          <SurfaceIcon
            icon={icon}
            tone={iconTone ?? resolvedTone}
            size="xs"
            variant={iconVariant}
          />
        ) : null}
      </div>
      <Card.Content
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-center rounded-lg border border-border bg-card px-3 py-2',
          variant === 'stacked' ? 'min-h-20 py-3' : 'min-h-17',
          contentClassName
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div
            className={cn(
              'min-w-0 break-words text-left font-semibold tabular-nums tracking-tight',
              valueClassName ??
                cn(
                  variant === 'stacked' ? 'text-2xl leading-tight' : 'text-2xl leading-tight',
                  valueTones[resolvedTone]
                )
            )}
            style={valueStyle}
          >
            {value}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
        {trend ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <Badge
              radius="default"
              variant={
                trend.tone === 'success'
                  ? 'success-light'
                  : trend.tone === 'danger'
                    ? 'destructive-light'
                    : 'secondary'
              }
              size="lg"
              className="gap-1 border px-1.5 tabular-nums"
            >
              <TrendIcon aria-hidden className="size-3.5" />
              <span className="sr-only">
                {trend.direction === 'up'
                  ? 'Increase: '
                  : trend.direction === 'down'
                    ? 'Decrease: '
                    : 'Unchanged: '}
              </span>
              {trend.value}
            </Badge>
            <span className="text-xs leading-5 text-muted-foreground">{trend.label}</span>
          </div>
        ) : null}
        {hint != null ? (
          <div
            className={cn(
              trend ? 'mt-1.5' : 'mt-1',
              'min-w-0 text-xs leading-4',
              inline && 'truncate',
              hintClassName ?? 'text-muted-foreground'
            )}
            style={hintStyle}
          >
            {hint}
          </div>
        ) : null}
      </Card.Content>
    </Card>
  );
}
