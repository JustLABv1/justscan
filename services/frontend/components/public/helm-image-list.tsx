'use client';

import { ResourceList } from '@/components/ui';
import { SeverityCounts } from '@/components/ui/badges';
import { StatusDot, StatusTag, type StatusDotTone } from '@/components/ui/status-dot';
import type { Scan } from '@/lib/api';
import { pluralize, summarizeError } from '@/lib/labels';
import type { ReactNode } from 'react';
import { SeverityBar } from './severity-bar';

const SCAN_STATE: Record<string, { label: string; tone: StatusDotTone }> = {
  completed: { label: 'Scanned', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  running: { label: 'Scanning', tone: 'accent' },
  pending: { label: 'Queued', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
};

export function scanState(status: string) {
  return SCAN_STATE[status] ?? SCAN_STATE.pending;
}

/** Where in the chart an image reference came from, e.g. "values.yaml". */
export function helmSourceLabel(scan: Pick<Scan, 'helm_source_path'>) {
  return scan.helm_source_path ? scan.helm_source_path.split(' › ')[0] : '';
}

export type HelmImageListItem = {
  key: string;
  scan: Scan;
  /** Opens the image's full report. Omit when the report is not available. */
  href?: string;
  attempts?: number;
  action?: ReactNode;
};

/**
 * One row per image in a Helm chart: name and tag, the labelled severity
 * counts with a severity bar, the scan state, and one action.
 */
export function HelmImageList({
  items,
  showSourceLine = false,
  emptyLabel = 'No images match these filters.',
}: {
  items: HelmImageListItem[];
  /** Show the chart source as a line under the name instead of only on hover. */
  showSourceLine?: boolean;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ResourceList bordered={false}>
      {items.map(({ key, scan, href, attempts, action }) => {
        const state = scanState(scan.status);
        const reference = `${scan.image_name}:${scan.image_tag || 'latest'}`;
        const source = helmSourceLabel(scan);
        const active = scan.status === 'pending' || scan.status === 'running';
        return (
          <ResourceList.Item
            key={key}
            href={href}
            media={<StatusDot tone={state.tone} className={active ? 'animate-pulse' : undefined} />}
            title={<span className="font-mono">{reference}</span>}
            titleTooltip={source ? `${reference}\nFrom ${scan.helm_source_path}` : reference}
            description={showSourceLine && source ? `From ${source}` : undefined}
            tone={scan.status === 'failed' ? 'danger' : 'default'}
            meta={
              <>
                {attempts && attempts > 1 ? (
                  <StatusTag>{pluralize(attempts, 'attempt')}</StatusTag>
                ) : null}
                <StatusTag tone={state.tone}>{state.label}</StatusTag>
              </>
            }
            actions={action}
          >
            {scan.status === 'completed' ? (
              <div className="flex flex-wrap items-center gap-3">
                <SeverityCounts
                  critical={scan.critical_count ?? 0}
                  high={scan.high_count ?? 0}
                  medium={scan.medium_count ?? 0}
                  low={scan.low_count ?? 0}
                  emptyLabel="No known vulnerabilities"
                />
                <SeverityBar
                  critical={scan.critical_count ?? 0}
                  high={scan.high_count ?? 0}
                  medium={scan.medium_count ?? 0}
                  low={scan.low_count ?? 0}
                  className="hidden sm:flex"
                />
              </div>
            ) : scan.status === 'failed' ? (
              <p className="text-xs text-muted-foreground">
                {summarizeError(scan.error_message) || 'The scan did not finish.'}
              </p>
            ) : null}
          </ResourceList.Item>
        );
      })}
    </ResourceList>
  );
}

/** Totals across the latest scan of every image in a chart. */
export function helmTotals(scans: Scan[]) {
  const sum = (pick: (scan: Scan) => number | undefined) =>
    scans.reduce((total, scan) => total + (pick(scan) ?? 0), 0);
  return {
    images: scans.length,
    completed: scans.filter((scan) => scan.status === 'completed').length,
    failed: scans.filter((scan) => scan.status === 'failed').length,
    active: scans.filter((scan) => scan.status === 'pending' || scan.status === 'running').length,
    counts: {
      critical: sum((scan) => scan.critical_count),
      high: sum((scan) => scan.high_count),
      medium: sum((scan) => scan.medium_count),
      low: sum((scan) => scan.low_count),
    },
  };
}

/** Inline lifecycle status for a chart: "4 scanned · 1 scanning · 1 failed". */
export function HelmProgress({ totals }: { totals: ReturnType<typeof helmTotals> }) {
  return (
    <>
      <StatusTag tone="success">{totals.completed.toLocaleString()} scanned</StatusTag>
      {totals.active > 0 ? (
        <StatusTag tone="accent">{totals.active.toLocaleString()} still scanning</StatusTag>
      ) : null}
      {totals.failed > 0 ? (
        <StatusTag tone="danger">{totals.failed.toLocaleString()} failed</StatusTag>
      ) : null}
    </>
  );
}
