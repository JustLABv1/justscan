'use client';

import { Card, Button } from '@/components/ui';
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
  /** @deprecated All statistics use the same compact surface. */
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
  onPress?: () => void;
  selected?: boolean;
}

export function StatCard({
  label,
  value,
  hint,
  trend,
  icon,
  iconTone,
  iconVariant: _iconVariant,
  tone = 'default',
  variant: _variant,
  aside,
  className,
  style,
  contentClassName,
  valueClassName,
  valueStyle,
  hintClassName,
  hintStyle,
  inline,
  onPress,
  selected,
}: StatCardProps) {
  const labelId = useId();
  const valueId = `${labelId}-value`;
  const hintId = `${labelId}-hint`;
  const resolvedTone =
    tone === 'neutral' || ((value === 0 || value === '0') && tone === 'danger') ? 'default' : tone;
  const valueTones: Record<SurfaceIconTone, string> = {
    default: 'text-foreground',
    danger: 'text-destructive',
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
        'relative flex h-full min-h-26 min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-none ring-0',
        selected && 'border-primary bg-muted/40',
        className
      )}
      style={style}
    >
      <div className="flex min-h-5 min-w-0 items-center justify-between gap-2">
        <p id={labelId} className="min-w-0 text-xs font-medium leading-5 text-muted-foreground">
          {label}
        </p>
        {icon ? <SurfaceIcon icon={icon} tone={iconTone ?? resolvedTone} size="xs" /> : null}
      </div>
      <Card.Content
        className={cn('flex min-w-0 flex-1 flex-col justify-start p-0', contentClassName)}
      >
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div
            id={valueId}
            className={cn(
              'min-w-0 break-words text-left font-semibold tabular-nums tracking-tight',
              valueTones[resolvedTone],
              'text-2xl leading-tight',
              valueClassName
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
            id={hintId}
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
      {onPress ? (
        <Button
          variant="ghost"
          onPress={onPress}
          aria-labelledby={`${labelId} ${valueId}`}
          aria-describedby={hint != null ? hintId : undefined}
          aria-pressed={selected}
          className="absolute inset-0 z-10 h-full w-full rounded-xl p-0 hover:bg-foreground/[0.025] focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      ) : null}
    </Card>
  );
}
