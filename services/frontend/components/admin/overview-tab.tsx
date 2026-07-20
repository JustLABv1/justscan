'use client';

import {
  Bar as EvilBar,
  EvilBarChart,
  Grid as EvilBarGrid,
  Tooltip as EvilBarTooltip,
  XAxis as EvilBarXAxis,
  YAxis as EvilBarYAxis,
} from '@/components/evilcharts/charts/bar-chart';
import {
  Line as EvilLine,
  EvilLineChart,
  Grid as EvilLineGrid,
  Tooltip as EvilLineTooltip,
  XAxis as EvilLineXAxis,
  YAxis as EvilLineYAxis,
} from '@/components/evilcharts/charts/line-chart';
import {
  CHART_TONES,
  SEVERITY_SERIES,
  formatChartDate,
  singleSeriesConfig,
  typedChartConfigFromSeries,
} from '@/components/ui/chart-adapter';
import { StatusAlert } from '@/components/ui/form-alert';
import { ChartSkeleton } from '@/components/ui/skeleton';
import { getAdminDashboard } from '@/lib/api/admin';
import type { AdminDashboard, AdminDashboardVulnerabilityTrendPoint } from '@/lib/api/types/admin';
import { APP_COPYRIGHT, APP_FRONTEND_VERSION } from '@/lib/build-info';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import { Button, Card, Chip, Link, Skeleton } from '@heroui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

function formatCompact(value: number) {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatLatency(value: number) {
  return `${Math.round(value)}ms`;
}

function ScanVolumeChart({ data }: { data: { date: string; value: number }[] }) {
  if (data.length < 2) {
    return (
      <div className="flex min-h-[176px] items-center justify-center text-sm text-muted-foreground">
        Not enough trend data yet.
      </div>
    );
  }

  return (
    <div className="h-[272px] w-full overflow-hidden rounded-lg">
      <EvilLineChart
        data={data}
        config={singleSeriesConfig('value', 'Scans', CHART_TONES.accent.dark)}
        className="h-full !aspect-auto"
        chartProps={{ margin: { top: 8, right: 8, left: -18, bottom: 0 } }}
      >
        <EvilLineGrid stroke="rgba(161,161,170,0.15)" />
        <EvilLineXAxis
          dataKey="date"
          tickFormatter={(value: string) => formatChartDate(value)}
          minTickGap={30}
        />
        <EvilLineYAxis />
        <EvilLineTooltip variant="frosted-glass" roundness="lg" />
        <EvilLine dataKey="value" curveType="monotone" />
      </EvilLineChart>
    </div>
  );
}

function VulnerabilityTrendBars({ data }: { data: AdminDashboardVulnerabilityTrendPoint[] }) {
  const series = data.slice(-12).map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
  }));

  if (series.length === 0) {
    return (
      <div className="flex min-h-[212px] items-center justify-center text-sm text-muted-foreground">
        No finalized vulnerability trend data yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-[272px] w-full overflow-hidden rounded-lg">
        <EvilBarChart
          data={series}
          config={typedChartConfigFromSeries(SEVERITY_SERIES)}
          className="h-full !aspect-auto"
          stackType="stacked"
        >
          <EvilBarGrid stroke="rgba(161,161,170,0.15)" vertical={false} />
          <EvilBarXAxis dataKey="label" />
          <EvilBarYAxis />
          <EvilBarTooltip variant="frosted-glass" roundness="lg" />
          {SEVERITY_SERIES.map((severity) => (
            <EvilBar key={severity.key} dataKey={severity.key} variant="default" />
          ))}
        </EvilBarChart>
      </div>

      <div className="flex flex-wrap gap-2">
        {SEVERITY_SERIES.map((severity) => (
          <Chip key={severity.key} variant="soft" size="sm" className="text-xs text-foreground/70">
            <span
              className="mr-1.5 inline-block size-2 rounded-full"
              style={{ background: severity.color }}
            />
            {severity.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  hintClassName,
}: {
  label: string;
  value: string;
  hint: string;
  hintClassName?: string;
}) {
  return (
    <Card variant="default" className="h-full border border-divider/70">
      <Card.Content className="gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="text-2xl font-bold tabular-nums tracking-tight">{value}</p>
        <p className={`text-xs ${hintClassName ?? 'text-muted-foreground'}`}>{hint}</p>
      </Card.Content>
    </Card>
  );
}

function AttentionRow({
  href,
  label,
  detail,
  count,
  tone,
}: {
  href: string;
  label: string;
  detail: string;
  count: number;
  tone: 'danger' | 'warning' | 'default';
}) {
  return (
    <Card variant="secondary" className="p-0">
      <Link href={href} className="flex items-center justify-between gap-4 px-4 py-3 no-underline">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <Chip color={tone === 'default' ? 'default' : tone} size="sm" variant="soft">
          {count}
        </Chip>
      </Link>
    </Card>
  );
}

function ConfigurationLink({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: number;
}) {
  return (
    <Card variant="secondary" className="p-0">
      <Link href={href} className="flex items-center justify-between gap-3 px-4 py-3 no-underline">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Chip size="sm" variant="soft">{value}</Chip>
      </Link>
    </Card>
  );
}

export function OverviewTab() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDashboard(await getAdminDashboard());
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load admin dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return deferEffect(load);
  }, [load]);

  const sparkData = useMemo(() => {
    if (!dashboard) return [] as { date: string; value: number }[];
    const byDate = new Map(dashboard.scan_trends.map((trend) => [trend.date, trend.total]));
    const output: { date: string; value: number }[] = [];
    const now = new Date();
    for (let index = 29; index >= 0; index--) {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - index);
      const key = date.toISOString().slice(0, 10);
      output.push({ date: key, value: byDate.get(key) ?? 0 });
    }
    return output;
  }, [dashboard]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border border-divider/70">
              <Card.Content className="space-y-2">
                <Skeleton className="h-3 w-20 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-lg" />
                <Skeleton className="h-3 w-24 rounded-full" />
              </Card.Content>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <StatusAlert
        status="danger"
        title="Admin overview failed to load"
        description={error}
        action={
          <Button size="sm" variant="danger" onPress={load}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!dashboard) return null;

  const totalFindings = Object.values(dashboard.severity_totals).reduce(
    (sum, value) => sum + value,
    0
  );
  const completedScans = dashboard.status_counts.completed ?? 0;
  const failedScans = dashboard.status_counts.failed ?? 0;
  const successRate =
    dashboard.total_scans > 0 ? Math.round((completedScans / dashboard.total_scans) * 100) : 0;
  const telemetryErrorRate =
    dashboard.insights.api_requests_24h > 0
      ? Math.round(
          (dashboard.insights.api_error_requests_24h / dashboard.insights.api_requests_24h) * 100
        )
      : 0;
  const workerIssues =
    dashboard.scanner_health.stale_workers + dashboard.scanner_health.error_workers;
  const attentionItems = [
    ...(failedScans > 0
      ? [
          {
            href: '/admin/scans?status=failed',
            label: 'Failed scans',
            detail: 'Review failed work and retry or investigate the affected jobs.',
            count: failedScans,
            tone: 'danger' as const,
          },
        ]
      : []),
    ...(dashboard.queues.blocked_policies > 0
      ? [
          {
            href: '/admin/scans',
            label: 'Blocked policies',
            detail: 'Review scans that require a policy decision or operational follow-up.',
            count: dashboard.queues.blocked_policies,
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(workerIssues > 0
      ? [
          {
            href: '/admin/scanner',
            label: 'Scanner workers need review',
            detail: 'One or more local workers are stale or reporting an error.',
            count: workerIssues,
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(dashboard.insights.api_error_requests_24h > 0
      ? [
          {
            href: '/admin/insights',
            label: 'API errors in the last 24 hours',
            detail: 'Inspect request telemetry and error patterns before they affect users.',
            count: dashboard.insights.api_error_requests_24h,
            tone: 'warning' as const,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <Card className="border border-divider/70">
        <Card.Header className="flex items-start justify-between gap-3">
          <div>
            <Card.Title>Platform health</Card.Title>
            <Card.Description>
              A concise view of what needs attention across the system right now.
            </Card.Description>
          </div>
          <Chip
            color={attentionItems.length === 0 ? 'success' : 'warning'}
            size="sm"
            variant="soft"
          >
            {attentionItems.length === 0 ? 'No immediate attention' : 'Attention needed'}
          </Chip>
        </Card.Header>
        <Card.Content className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Queue</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {dashboard.queues.running + dashboard.queues.pending} active
            </p>
            <p className="text-xs text-muted-foreground">{dashboard.queues.pending} pending</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Scanner workers</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {dashboard.scanner_health.healthy_workers} healthy
            </p>
            <p className="text-xs text-muted-foreground">{workerIssues} need review</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Public scanning</p>
            <p className="mt-1 text-xl font-semibold">
              {dashboard.public_scan_enabled ? 'Enabled' : 'Disabled'}
            </p>
            <p className="text-xs text-muted-foreground">System exposure setting</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">API error rate</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{telemetryErrorRate}%</p>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </div>
        </Card.Content>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="border border-divider/70">
          <Card.Header>
            <Card.Title>Needs attention</Card.Title>
            <Card.Description>Follow the highest-signal issues without hunting through pages.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2">
            {attentionItems.length > 0 ? (
              attentionItems.map((item) => <AttentionRow key={item.label} {...item} />)
            ) : (
              <div className="rounded-xl border border-divider/70 bg-surface-secondary px-3 py-5 text-sm text-muted-foreground">
                The scan queue, local workers, and API telemetry do not report an immediate issue.
              </div>
            )}
          </Card.Content>
        </Card>

        <Card className="border border-divider/70">
          <Card.Header>
            <Card.Title>Configuration coverage</Card.Title>
            <Card.Description>Open the service you want to manage directly.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2">
            <ConfigurationLink href="/admin/users" label="Users" value={dashboard.admin_counts.users} />
            <ConfigurationLink href="/admin/tokens" label="Service tokens" value={dashboard.admin_counts.tokens} />
            <ConfigurationLink href="/admin/identity" label="Identity providers" value={dashboard.admin_counts.identity_providers} />
            <ConfigurationLink href="/admin/notifications" label="Active channels" value={dashboard.admin_counts.active_channels} />
            <ConfigurationLink href="/admin/registries" label="Global registries" value={dashboard.admin_counts.global_registries} />
          </Card.Content>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Total Scans"
          value={dashboard.total_scans.toLocaleString()}
          hint={`${dashboard.queues.running + dashboard.queues.pending} active in queue`}
          hintClassName={
            dashboard.queues.running + dashboard.queues.pending > 0
              ? 'text-primary'
              : 'text-muted-foreground'
          }
        />
        <SummaryTile
          label="Findings"
          value={formatCompact(totalFindings)}
          hint={`${dashboard.severity_totals.critical ?? 0} critical`}
          hintClassName={
            (dashboard.severity_totals.critical ?? 0) > 0 ? 'text-danger' : 'text-muted-foreground'
          }
        />
        <SummaryTile
          label="Needs Attention"
          value={dashboard.queues.needs_attention.toLocaleString()}
          hint={`${failedScans} failed · ${dashboard.queues.blocked_policies} blocked`}
          hintClassName={
            dashboard.queues.needs_attention > 0 ? 'text-warning' : 'text-muted-foreground'
          }
        />
        <SummaryTile
          label="API Requests 24h"
          value={formatCompact(dashboard.insights.api_requests_24h)}
          hint={`${telemetryErrorRate}% error rate`}
          hintClassName={telemetryErrorRate > 0 ? 'text-warning' : 'text-muted-foreground'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="border border-divider/70">
          <Card.Header className="flex items-start justify-between gap-3">
            <div>
              <Card.Title>Scan volume</Card.Title>
              <Card.Description>
                Thirty-day scan throughput across the full platform.
              </Card.Description>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip variant="soft" color="success" size="sm">
                {completedScans} completed
              </Chip>
              <Chip variant="soft" color="danger" size="sm">
                {failedScans} failed
              </Chip>
              <Chip variant="soft" color="success" size="sm">
                {successRate}% success
              </Chip>
            </div>
          </Card.Header>
          <Card.Content className="pt-2 pb-3">
            <ScanVolumeChart data={sparkData} />
          </Card.Content>
        </Card>

        <Card className="border border-divider/70">
          <Card.Header className="flex items-start justify-between gap-3">
            <div>
              <Card.Title>Vulnerability trend</Card.Title>
              <Card.Description>
                Average finalized findings per day over the last thirty days.
              </Card.Description>
            </div>
            <Link href="/admin/insights">
              Open observability
              <Link.Icon />
            </Link>
          </Card.Header>
          <Card.Content className="pt-2 pb-3">
            <VulnerabilityTrendBars data={dashboard.vulnerability_trends} />
          </Card.Content>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <Card className="border border-divider/70">
            <Card.Header className="flex items-start justify-between gap-3">
              <div>
                <Card.Title>Platform telemetry</Card.Title>
                <Card.Description>
                  Short-horizon API and xRay signal for the last twenty-four hours.
                </Card.Description>
              </div>
              <Link href="/admin/insights">
                Open logs
                <Link.Icon />
              </Link>
            </Card.Header>
            <Card.Content className="grid gap-3 sm:grid-cols-2">
              <Card variant="secondary" className="border border-divider/70">
                <Card.Content>
                  <p className="text-xs text-muted-foreground">API traffic</p>
                  <p className="text-xl font-semibold">
                    {formatCompact(dashboard.insights.api_requests_24h)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dashboard.insights.api_error_requests_24h.toLocaleString()} errors ·{' '}
                    {formatLatency(dashboard.insights.api_p95_ms)} p95
                  </p>
                </Card.Content>
              </Card>
              <Card variant="secondary" className="border border-divider/70">
                <Card.Content>
                  <p className="text-xs text-muted-foreground">xRay traffic</p>
                  <p className="text-xl font-semibold">
                    {formatCompact(dashboard.insights.xray_requests_24h)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dashboard.insights.xray_error_requests_24h.toLocaleString()} errors ·{' '}
                    {formatLatency(dashboard.insights.api_average_ms)} avg API latency
                  </p>
                </Card.Content>
              </Card>
            </Card.Content>
          </Card>

          <Card className="border border-divider/70">
            <Card.Header>
              <Card.Title>System and legal</Card.Title>
              <Card.Description>Runtime build metadata and exposure posture.</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-2 text-sm">
              <Card variant="secondary" className="border border-divider/70">
                <Card.Content>
                  <p className="text-xs text-muted-foreground">Public scanning</p>
                  <p className="font-semibold">
                    {dashboard.public_scan_enabled ? 'Enabled' : 'Disabled'}
                  </p>
                </Card.Content>
              </Card>
              <Card variant="secondary" className="border border-divider/70">
                <Card.Content>
                  <p className="text-xs text-muted-foreground">Frontend version</p>
                  <p className="font-semibold">v{APP_FRONTEND_VERSION}</p>
                </Card.Content>
              </Card>
              <Card variant="secondary" className="border border-divider/70">
                <Card.Content>
                  <p className="text-xs text-muted-foreground">Dashboard generated</p>
                  <p>{fullDate(dashboard.generated_at)}</p>
                </Card.Content>
              </Card>
              <Card variant="secondary" className="border border-divider/70">
                <Card.Content>
                  <p className="text-xs text-muted-foreground">Copyright</p>
                  <p>{APP_COPYRIGHT}</p>
                </Card.Content>
              </Card>
            </Card.Content>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border border-divider/70">
            <Card.Header>
              <Card.Title>Worker health</Card.Title>
              <Card.Description>
                Snapshot of local scanner workers from the current backend instance.
              </Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    label: 'Healthy',
                    value: dashboard.scanner_health.healthy_workers,
                    className: 'text-success',
                  },
                  {
                    label: 'Stale',
                    value: dashboard.scanner_health.stale_workers,
                    className: 'text-warning',
                  },
                  {
                    label: 'Errors',
                    value: dashboard.scanner_health.error_workers,
                    className: 'text-danger',
                  },
                  {
                    label: 'Workers',
                    value: dashboard.scanner_health.total_workers,
                    className: 'text-primary',
                  },
                ].map((item) => (
                  <Card key={item.label} variant="secondary" className="border border-divider/70">
                    <Card.Content>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className={`text-xl font-semibold ${item.className}`}>{item.value}</p>
                    </Card.Content>
                  </Card>
                ))}
              </div>
              <Card variant="secondary" className="border border-divider/70">
                <Card.Content>
                  <p className="text-xs text-muted-foreground">
                    Scanner status generated {timeAgo(dashboard.scanner_health.generated_at)}.
                    Maximum allowed DB age: {dashboard.scanner_health.max_allowed_age_hours}h.
                  </p>
                </Card.Content>
              </Card>
            </Card.Content>
          </Card>

          <Card className="border border-divider/70">
            <Card.Header className="flex items-start justify-between gap-3">
              <div>
                <Card.Title>Recent audit activity</Card.Title>
                <Card.Description>The latest system-wide administrative changes.</Card.Description>
              </div>
              <Link href="/admin/audit">
                View all
                <Link.Icon />
              </Link>
            </Card.Header>
            <Card.Content className="space-y-2">
              {dashboard.recent_audit.length === 0 ? (
                <Card variant="secondary" className="border border-divider/70">
                  <Card.Content>
                    <p className="text-sm text-muted-foreground">No audit activity yet.</p>
                  </Card.Content>
                </Card>
              ) : (
                dashboard.recent_audit.map((entry) => (
                  <Card key={entry.id} variant="secondary" className="border border-divider/70">
                    <Card.Content>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{entry.operation}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {entry.username || entry.user_id}
                          </p>
                        </div>
                        <span
                          className="whitespace-nowrap text-xs text-muted-foreground"
                          title={fullDate(entry.created_at)}
                        >
                          {timeAgo(entry.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {entry.details || 'No details recorded.'}
                      </p>
                    </Card.Content>
                  </Card>
                ))
              )}
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  );
}
