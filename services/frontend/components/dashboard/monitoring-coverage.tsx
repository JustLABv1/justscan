'use client';

import Link from 'next/link';
import { Pie, PieChart, Cell, ResponsiveContainer } from 'recharts';
import { Activity, ChevronRight, GitBranch, Radar } from 'lucide-react';
import { Button, Card, Skeleton } from '@/components/ui';
import { StatusAlert } from '@/components/ui/form-alert';

export function MonitoringCoverage({
  enabled,
  fresh,
  neverScanned,
  scannedToday,
  repositories,
  activeXray,
  loading,
  error,
  onRetry,
}: {
  enabled: number;
  fresh: number;
  neverScanned: number;
  scannedToday: number;
  repositories: { healthy: number; total: number; needs_attention: number };
  activeXray: number;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const percentage = enabled ? Math.round((fresh / enabled) * 100) : 0;
  const stale = Math.max(0, enabled - fresh);
  const slices = [
    { value: fresh, color: 'var(--success)' },
    { value: stale, color: 'var(--warning)' },
  ];
  return (
    <Card className="min-w-0 overflow-hidden gap-0 py-0">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-medium">Monitoring coverage</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Scan freshness across enabled watchlist images
        </p>
      </div>
      {error ? (
        <div className="p-4">
          <StatusAlert
            status="danger"
            title="Coverage unavailable"
            description={error}
            action={
              <Button size="sm" variant="outline" onPress={onRetry}>
                Retry
              </Button>
            }
          />
        </div>
      ) : loading ? (
        <div className="p-4">
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : enabled === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-4 text-center">
          <Radar className="size-7 text-muted-foreground" />
          <p className="text-sm font-medium">No monitored images yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Enable watchlist images to start measuring freshness.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[152px_minmax(0,1fr)] items-center gap-2 p-4">
            <div
              className="relative size-[152px]"
              role="img"
              aria-label={`${fresh} of ${enabled} enabled images scanned within seven days`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    innerRadius={57}
                    outerRadius={72}
                    startAngle={90}
                    endAngle={-270}
                    stroke="var(--card)"
                    strokeWidth={4}
                    isAnimationActive={false}
                  >
                    {slices.map((slice, i) => (
                      <Cell key={i} fill={slice.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
              >
                <strong className="text-2xl font-semibold tabular-nums">{percentage}%</strong>
                <span className="text-xs text-muted-foreground">fresh in 7d</span>
              </div>
            </div>
            <dl className="space-y-4 text-xs">
              <div>
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-success" />
                  Fresh
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {fresh.toLocaleString()}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    / {enabled.toLocaleString()}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-warning" />
                  Overdue or unscanned
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {stale.toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>
          <div className="grid grid-cols-2 divide-x divide-border border-y border-border">
            <div className="p-3">
              <p className="text-xs text-muted-foreground">Never scanned</p>
              <p className="mt-1 text-lg font-medium tabular-nums">
                {neverScanned.toLocaleString()}
              </p>
            </div>
            <div className="p-3">
              <p className="text-xs text-muted-foreground">Images scanned today</p>
              <p className="mt-1 text-lg font-medium tabular-nums">
                {scannedToday.toLocaleString()}
              </p>
            </div>
          </div>
        </>
      )}
      <div className="divide-y divide-border">
        <Link
          href="/git-repositories"
          className="flex items-center gap-2 p-3 text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <GitBranch className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            Repositories
            <span className="block text-xs text-muted-foreground">
              {repositories.needs_attention} need attention
            </span>
          </span>
          <span className="text-xs tabular-nums">
            {repositories.healthy} / {repositories.total} healthy
          </span>
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </Link>
        <Link
          href="/scans?status=running"
          className="flex items-center gap-2 p-3 text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Activity className="size-4 text-muted-foreground" />
          <span className="flex-1">Active Xray scans</span>
          <span className="tabular-nums">{activeXray}</span>
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </Link>
      </div>
      <div className="border-t border-border p-3">
        <Button asChild variant="outline" fullWidth size="sm">
          <Link href="/watchlist">
            Manage watchlist
            <ChevronRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}
