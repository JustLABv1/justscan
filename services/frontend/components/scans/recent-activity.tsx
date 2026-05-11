'use client';

import { StatusBadge } from '@/components/ui/badges';
import type { Scan } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import Link from 'next/link';

export type RecentActivityRange = '6h' | '24h' | '7d' | '30d';

export const RECENT_ACTIVITY_RANGE_OPTIONS: Array<{
  id: RecentActivityRange;
  label: string;
  shortLabel: string;
}> = [
  { id: '6h', label: 'Last 6 hours', shortLabel: '6h' },
  { id: '24h', label: 'Last 24 hours', shortLabel: '24h' },
  { id: '7d', label: 'Last 7 days', shortLabel: '7d' },
  { id: '30d', label: 'Last 30 days', shortLabel: '30d' },
];

const XRAY_STEP_LABELS: Record<string, string> = {
  queued: 'Queued',
  warming_cache: 'Warming Cache',
  indexing_artifact: 'Indexing Artifact',
  queued_in_xray: 'Queued in Xray',
  waiting_for_xray: 'Waiting for Xray',
  importing_results: 'Importing Results',
  failed: 'Failed',
  completed: 'Completed',
};

export function normalizeRecentActivityRange(value?: string | null): RecentActivityRange {
  if (value === '6h' || value === '24h' || value === '7d' || value === '30d') {
    return value;
  }

  return '24h';
}

export function getRecentActivityBounds(range: RecentActivityRange, now = new Date()): { from: string; to: string } {
  const end = new Date(now);
  const start = new Date(now);

  if (range === '6h') {
    start.setHours(start.getHours() - 6);
  } else if (range === '24h') {
    start.setHours(start.getHours() - 24);
  } else if (range === '7d') {
    start.setDate(start.getDate() - 7);
  } else {
    start.setDate(start.getDate() - 30);
  }

  return { from: start.toISOString(), to: end.toISOString() };
}

export function buildRecentActivityHref(range: RecentActivityRange, image?: string): string {
  const params = new URLSearchParams({ range });
  if (image) params.set('image', image);
  return `/scans?${params.toString()}`;
}

function formatStepLabel(step?: string): string {
  if (!step) return XRAY_STEP_LABELS.queued;
  return XRAY_STEP_LABELS[step] ?? step.replace(/_/g, ' ');
}

export function scanContextLabel(scan: Scan): string {
  if (scan.scan_provider === 'artifactory_xray') {
    if (scan.status === 'failed' && scan.external_status === 'blocked_by_xray_policy') {
      return 'Artifactory Xray · blocked by policy';
    }
    if (scan.status === 'running' || scan.status === 'pending') {
      return `Artifactory Xray · ${formatStepLabel(scan.current_step)}`;
    }
    return 'Artifactory Xray';
  }
  return 'Built-in scanner';
}

function SeverityPill({ count, label, tone }: { count: number; label: string; tone: { color: string; background: string; border: string } }) {
  if (count <= 0) return null;

  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md" style={tone}>
      {label}:{count}
    </span>
  );
}

export function RecentActivityRangePicker({
  value,
  onChange,
  allowClear = false,
  clearLabel = 'Any time',
  onClear,
}: {
  value: RecentActivityRange | null;
  onChange: (range: RecentActivityRange) => void;
  allowClear?: boolean;
  clearLabel?: string;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowClear ? (
        <button
          type="button"
          onClick={() => onClear?.()}
          className="rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150"
          style={value == null
            ? { background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.28)' }
            : { background: 'var(--row-hover)', color: 'var(--text-muted)', border: '1px solid var(--surface-border)' }}
          aria-pressed={value == null}
          aria-label={clearLabel}
          title={clearLabel}
        >
          {clearLabel}
        </button>
      ) : null}

      {RECENT_ACTIVITY_RANGE_OPTIONS.map((option) => {
        const isActive = option.id === value;

        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className="rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150"
            style={isActive
              ? { background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.28)' }
              : { background: 'var(--row-hover)', color: 'var(--text-muted)', border: '1px solid var(--surface-border)' }}
            aria-pressed={isActive}
            aria-label={option.label}
            title={option.label}
          >
            {option.shortLabel}
          </button>
        );
      })}
    </div>
  );
}

export function RecentActivityRow({ scan }: { scan: Scan }) {
  const eventTime = scan.started_at ?? scan.created_at;

  return (
    <Link
      href={`/scans/${scan.id}`}
      className="flex items-start justify-between gap-3 rounded-xl p-3 transition-colors duration-150 group"
      onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
      onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm text-zinc-700 transition-colors group-hover:text-zinc-900 dark:text-zinc-300 dark:group-hover:text-white">
          {scan.image_name}:{scan.image_tag}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          <StatusBadge status={scan.status} externalStatus={scan.external_status} />
          <span className="text-zinc-500">{scanContextLabel(scan)}</span>
          <span className="text-zinc-400" title={fullDate(eventTime)}>{timeAgo(eventTime)}</span>
        </div>
        {scan.error_message ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-red-400">
            {scan.error_message}
          </p>
        ) : null}
      </div>

      <div className="ml-2 flex shrink-0 flex-wrap items-center justify-end gap-1">
        <SeverityPill
          count={scan.critical_count}
          label="C"
          tone={{
            color: '#f87171',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.18)',
          }}
        />
        <SeverityPill
          count={scan.high_count}
          label="H"
          tone={{
            color: '#fb923c',
            background: 'rgba(249,115,22,0.12)',
            border: '1px solid rgba(249,115,22,0.18)',
          }}
        />
        <SeverityPill
          count={scan.medium_count}
          label="M"
          tone={{
            color: '#fbbf24',
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.18)',
          }}
        />
      </div>
    </Link>
  );
}