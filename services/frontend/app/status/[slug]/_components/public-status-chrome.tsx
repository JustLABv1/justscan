'use client';

import { Alert, Card } from '@/components/ui';
import { StatStrip, StatStripItem } from '@/components/ui/stat-strip';
import type { StatusDotTone } from '@/components/ui/status-dot';
import type { StatusPageUpdate } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';

export type OverallStatusTone = {
  label: string;
  tone: StatusDotTone;
  description: string;
};

export type StatusMetric = {
  key: string;
  label: string;
  value: number;
  color?: 'success' | 'warning' | 'danger' | 'accent';
};

const TONE_RING: Record<StatusDotTone, string> = {
  danger: 'bg-destructive/15 text-destructive',
  warning: 'bg-warning/15 text-warning',
  success: 'bg-success/15 text-success',
  accent: 'bg-info/15 text-info',
  neutral: 'bg-muted text-muted-foreground',
  muted: 'bg-muted text-muted-foreground/60',
};

function updateStatus(level: StatusPageUpdate['level']) {
  if (level === 'incident') return 'danger' as const;
  if (level === 'maintenance') return 'warning' as const;
  return 'accent' as const;
}

/** Overall verdict for the page, with only the non-zero image counts. */
export function OverallStatusBanner({
  tone,
  facts,
}: {
  tone: OverallStatusTone;
  facts: Array<{ label: string; value: number }>;
}) {
  const visibleFacts = facts.filter((fact) => fact.value > 0);
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
              TONE_RING[tone.tone]
            )}
          >
            <span className="size-2.5 rounded-full bg-current" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{tone.label}</h2>
            <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{tone.description}</p>
          </div>
        </div>
        {visibleFacts.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground lg:justify-end">
            {visibleFacts.map((fact) => (
              <span key={fact.label}>
                <strong className="font-semibold tabular-nums text-foreground">
                  {fact.value.toLocaleString()}
                </strong>{' '}
                {fact.label}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export function StatusMetrics({
  metrics,
  selectedKey,
  onSelect,
}: {
  metrics: StatusMetric[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  return (
    <StatStrip>
      {metrics.map((metric) => (
        <StatStripItem
          key={metric.key}
          label={metric.label}
          value={metric.value.toLocaleString()}
          tone={metric.value > 0 ? metric.color : undefined}
          selected={selectedKey === metric.key}
          onPress={
            onSelect && metric.key.startsWith('status:') ? () => onSelect(metric.key) : undefined
          }
        />
      ))}
    </StatStrip>
  );
}

export function ActiveStatusUpdates({ updates }: { updates: StatusPageUpdate[] }) {
  if (updates.length === 0) return null;

  return (
    <section aria-labelledby="status-updates-heading" className="space-y-2">
      <h2 id="status-updates-heading" className="text-sm font-semibold text-foreground">
        {updates.length === 1 ? 'Current update' : 'Current updates'}
      </h2>
      <div className="grid gap-2 lg:grid-cols-2">
        {updates.map((update) => (
          <Alert
            key={update.id ?? `${update.level}:${update.title}`}
            status={updateStatus(update.level)}
          >
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{update.title}</Alert.Title>
              {update.body ? <Alert.Description>{update.body}</Alert.Description> : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {update.created_at || update.updated_at
                  ? `Posted ${timeAgo(update.created_at ?? update.updated_at ?? '')}`
                  : 'Recently posted'}
              </p>
            </Alert.Content>
          </Alert>
        ))}
      </div>
    </section>
  );
}
