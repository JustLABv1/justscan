'use client';

import { Logo } from '@/components/logo';
import type { StatusPageUpdate } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { Alert, Button, Card, Chip } from '@heroui/react';
import {
  Clock01Icon,
  Globe02Icon,
  LockIcon,
  Moon02Icon,
  Refresh01Icon,
  SecurityLockIcon,
  Sun01Icon,
} from 'hugeicons-react';

type StatusTone = {
  label: string;
  color: string;
  description: string;
};

const METRIC_VALUE_CLASS = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  accent: 'text-accent',
  default: 'text-foreground',
};

export type StatusMetric = {
  key: string;
  label: string;
  value: number;
  color?: 'success' | 'warning' | 'danger' | 'accent' | 'default';
};

function visibilityIcon(visibility: 'private' | 'public' | 'authenticated') {
  if (visibility === 'public') return <Globe02Icon size={14} aria-hidden />;
  if (visibility === 'authenticated') return <SecurityLockIcon size={14} aria-hidden />;
  return <LockIcon size={14} aria-hidden />;
}

function updateStatus(level: StatusPageUpdate['level']) {
  if (level === 'incident') return 'danger' as const;
  if (level === 'maintenance') return 'warning' as const;
  return 'accent' as const;
}

export function PublicStatusHeader({
  pageName,
  visibility,
  latestObservedAt,
  refreshing,
  isDark,
  mounted,
  onRefresh,
  onToggleTheme,
}: {
  pageName: string;
  visibility: 'private' | 'public' | 'authenticated';
  latestObservedAt: string | null;
  refreshing: boolean;
  isDark: boolean;
  mounted: boolean;
  onRefresh: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-divider/70 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-divider bg-surface-secondary">
            <Logo size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted">JustScan Status</p>
            <p className="truncate text-sm font-semibold text-foreground">{pageName}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Chip className="hidden capitalize sm:inline-flex" size="sm" variant="secondary">
            {visibilityIcon(visibility)}
            <Chip.Label>{visibility}</Chip.Label>
          </Chip>
          <Chip className="hidden lg:inline-flex" size="sm" variant="secondary">
            <Clock01Icon size={14} aria-hidden />
            <Chip.Label>
              Updated {latestObservedAt ? timeAgo(latestObservedAt) : 'pending'}
            </Chip.Label>
          </Chip>
          {mounted ? (
            <Button
              isIconOnly
              aria-label="Toggle theme"
              size="sm"
              variant="tertiary"
              onPress={onToggleTheme}
            >
              {isDark ? <Sun01Icon size={16} aria-hidden /> : <Moon02Icon size={16} aria-hidden />}
            </Button>
          ) : null}
          <Button
            isIconOnly
            aria-label="Refresh status page"
            isPending={refreshing}
            size="sm"
            variant="secondary"
            onPress={onRefresh}
          >
            <Refresh01Icon size={16} aria-hidden />
          </Button>
        </div>
      </div>
    </header>
  );
}

export function OverallStatusBanner({
  tone,
  healthyCount,
  issueCount,
  exposedCount,
  runningCount,
  secondsRemaining,
  refreshing,
  autoRefreshPaused,
  staleAfterHours,
}: {
  tone: StatusTone;
  healthyCount: number;
  issueCount: number;
  exposedCount: number;
  runningCount: number;
  secondsRemaining: number;
  refreshing: boolean;
  autoRefreshPaused: boolean;
  staleAfterHours: number;
}) {
  return (
    <Card className="overflow-hidden border border-divider/70 bg-surface/70 p-0 shadow-sm">
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: `color-mix(in srgb, ${tone.color} 14%, transparent)` }}
          >
            <span className="size-2.5 rounded-full" style={{ background: tone.color }} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{tone.label}</h2>
            <p className="mt-0.5 text-sm leading-6 text-muted">{tone.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted lg:justify-end">
          <span>
            <strong className="font-semibold text-foreground">{healthyCount}</strong> healthy
          </span>
          <span>
            <strong className="font-semibold text-foreground">{issueCount}</strong> issues
          </span>
          <span>
            <strong className="font-semibold text-foreground">{exposedCount}</strong> exposed
          </span>
          <span>
            <strong className="font-semibold text-foreground">{runningCount}</strong> scanning
          </span>
          <span>
            {refreshing
              ? 'Refreshing now'
              : autoRefreshPaused
                ? 'Auto-refresh paused'
                : `Refresh in ${secondsRemaining}s`}
          </span>
          <span>Stale after {staleAfterHours}h</span>
        </div>
      </div>
    </Card>
  );
}

export function StatusMetrics({
  metrics,
  activeKey,
  onSelect,
}: {
  metrics: StatusMetric[];
  activeKey?: string;
  onSelect?: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {metrics.map((metric) => (
        <Card
          key={metric.key}
          className={`border bg-surface/60 p-0 shadow-sm transition-colors ${
            activeKey === metric.key ? 'border-accent' : 'border-divider/70'
          }`}
          variant="secondary"
        >
          <button
            type="button"
            aria-pressed={activeKey === metric.key}
            className="w-full rounded-[inherit] p-3 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent sm:p-4"
            onClick={() => onSelect?.(metric.key)}
          >
            <p
              className={`text-xl font-semibold tabular-nums ${METRIC_VALUE_CLASS[metric.color ?? 'default']}`}
            >
              {metric.value.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs font-medium text-muted">{metric.label}</p>
          </button>
        </Card>
      ))}
    </div>
  );
}

export function ActiveStatusUpdates({ updates }: { updates: StatusPageUpdate[] }) {
  if (updates.length === 0) return null;

  return (
    <section aria-labelledby="status-updates-heading" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id="status-updates-heading" className="text-sm font-semibold text-foreground">
          Active updates
        </h2>
        <span className="text-xs text-muted">
          {updates.length} active {updates.length === 1 ? 'notice' : 'notices'}
        </span>
      </div>
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
              <p className="mt-1 text-[11px] text-muted">
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
