'use client';

import { StatStrip, StatStripItem } from '@/components/ui/stat-strip';
import { StatusDot, StatusTag } from '@/components/ui/status-dot';
import { auditActor, parseAuditDetails } from '@/components/admin/audit-format';
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
import { Button, Card, DescriptionList, Link, ResourceList, Skeleton } from '@/components/ui';
import { eventLabel, pluralize } from '@/lib/labels';
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
        <EvilLineGrid stroke="var(--border)" />
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
          <EvilBarGrid stroke="var(--border)" vertical={false} />
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
          <StatusTag key={severity.key} className="text-xs text-muted-foreground">
            <span
              className="mr-1.5 inline-block size-2 rounded-full"
              style={{ background: severity.color }}
            />
            {severity.label}
          </StatusTag>
        ))}
      </div>
    </div>
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
        <StatStrip>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2 bg-card px-4 py-3.5">
              <Skeleton className="h-3 w-20 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-lg" />
              <Skeleton className="h-3 w-24 rounded-full" />
            </div>
          ))}
        </StatStrip>
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
  const attentionItems: Array<{
    href: string;
    label: string;
    detail: string;
    count: number;
    tone: 'danger' | 'warning';
  }> = [
    ...(failedScans > 0
      ? [
          {
            href: '/admin/scans?status=failed',
            label: 'Failed scans',
            detail: 'Retry or investigate the affected jobs.',
            count: failedScans,
            tone: 'danger' as const,
          },
        ]
      : []),
    ...(dashboard.queues.blocked_policies > 0
      ? [
          {
            href: '/admin/scans',
            label: 'Scans blocked by policy',
            detail: 'These scans need a policy decision or operational follow-up.',
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
            detail: 'Inspect request logs before the errors affect users.',
            count: dashboard.insights.api_error_requests_24h,
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(dashboard.insights.xray_error_requests_24h > 0
      ? [
          {
            href: '/admin/insights?section=xray',
            label: 'Xray request errors in the last 24 hours',
            detail: 'Calls to Artifactory Xray failed; check credentials and connectivity.',
            count: dashboard.insights.xray_error_requests_24h,
            tone: 'warning' as const,
          },
        ]
      : []),
  ];
  const activeScans = dashboard.queues.running + dashboard.queues.pending;
  const criticalFindings = dashboard.severity_totals.critical ?? 0;

  return (
    <div className="space-y-4">
      <StatStrip>
        <StatStripItem
          label="Scans"
          value={dashboard.total_scans.toLocaleString()}
          hint={
            activeScans > 0
              ? `${activeScans.toLocaleString()} in progress · ${dashboard.queues.pending.toLocaleString()} queued`
              : `${successRate}% completed successfully`
          }
          tone={activeScans > 0 ? 'accent' : undefined}
        />
        <StatStripItem
          label="Findings"
          value={formatCompact(totalFindings)}
          hint={`${criticalFindings.toLocaleString()} critical`}
          tone={criticalFindings > 0 ? 'danger' : undefined}
        />
        <StatStripItem
          label="Scanner workers"
          value={`${dashboard.scanner_health.healthy_workers}/${dashboard.scanner_health.total_workers}`}
          hint={workerIssues > 0 ? `${workerIssues} need review` : 'All healthy'}
          tone={workerIssues > 0 ? 'warning' : 'success'}
        />
        <StatStripItem
          label="API requests, 24 h"
          value={formatCompact(dashboard.insights.api_requests_24h)}
          hint={`${telemetryErrorRate}% errors · ${formatLatency(dashboard.insights.api_p95_ms)} p95`}
          tone={dashboard.insights.api_error_requests_24h > 0 ? 'warning' : undefined}
        />
        <StatStripItem
          label="Xray requests, 24 h"
          value={formatCompact(dashboard.insights.xray_requests_24h)}
          hint={`${pluralize(dashboard.insights.xray_error_requests_24h, 'error')}`}
          tone={dashboard.insights.xray_error_requests_24h > 0 ? 'warning' : undefined}
        />
      </StatStrip>

      <section className="space-y-2" aria-labelledby="admin-attention-heading">
        <h2 id="admin-attention-heading" className="text-base font-medium">
          Needs attention
        </h2>
        <ResourceList>
          {attentionItems.length > 0 ? (
            attentionItems.map((item) => (
              <ResourceList.Item
                key={item.label}
                href={item.href}
                tone={item.tone}
                media={<StatusDot tone={item.tone} />}
                title={item.label}
                description={item.detail}
                meta={
                  <span className="text-sm font-medium tabular-nums">
                    {item.count.toLocaleString()}
                  </span>
                }
              />
            ))
          ) : (
            <ResourceList.Item
              media={<StatusDot tone="success" />}
              title="Nothing needs attention"
              description="The scan queue, scanner workers, and request logs report no issues."
            />
          )}
        </ResourceList>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <Card.Header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Card.Title>Scan volume</Card.Title>
              <Card.Description>Scans per day over the last thirty days.</Card.Description>
            </div>
            <div className="flex flex-wrap gap-3">
              <StatusTag tone="success">{completedScans.toLocaleString()} completed</StatusTag>
              <StatusTag tone={failedScans > 0 ? 'danger' : 'muted'}>
                {failedScans.toLocaleString()} failed
              </StatusTag>
            </div>
          </Card.Header>
          <Card.Content className="pb-3 pt-2">
            <ScanVolumeChart data={sparkData} />
          </Card.Content>
        </Card>

        <Card>
          <Card.Header className="flex items-start justify-between gap-3">
            <div>
              <Card.Title>Vulnerability trend</Card.Title>
              <Card.Description>
                Average findings per day from completed scans, last thirty days.
              </Card.Description>
            </div>
            <Link href="/admin/insights">
              Observability
              <Link.Icon />
            </Link>
          </Card.Header>
          <Card.Content className="pb-3 pt-2">
            <VulnerabilityTrendBars data={dashboard.vulnerability_trends} />
          </Card.Content>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="space-y-2" aria-labelledby="admin-audit-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="admin-audit-heading" className="text-base font-medium">
              Recent activity
            </h2>
            <Link href="/admin/audit">
              Audit log
              <Link.Icon />
            </Link>
          </div>
          <ResourceList>
            {dashboard.recent_audit.length === 0 ? (
              <ResourceList.Item title="No activity yet" />
            ) : (
              dashboard.recent_audit.map((entry) => {
                const { summary } = parseAuditDetails(entry.details);
                return (
                  <ResourceList.Item
                    key={entry.id}
                    title={eventLabel(entry.operation)}
                    description={summary ? `${auditActor(entry)} · ${summary}` : auditActor(entry)}
                    meta={
                      <span
                        className="whitespace-nowrap text-xs text-muted-foreground"
                        title={fullDate(entry.created_at)}
                      >
                        {timeAgo(entry.created_at)}
                      </span>
                    }
                  />
                );
              })
            )}
          </ResourceList>
        </section>

        <div className="space-y-4">
          <section className="space-y-2" aria-labelledby="admin-config-heading">
            <h2 id="admin-config-heading" className="text-base font-medium">
              Configuration
            </h2>
            <ResourceList>
              {[
                { href: '/admin/users', label: 'Users', value: dashboard.admin_counts.users },
                {
                  href: '/admin/tokens',
                  label: 'Service tokens',
                  value: dashboard.admin_counts.tokens,
                },
                {
                  href: '/admin/identity',
                  label: 'Identity providers',
                  value: dashboard.admin_counts.identity_providers,
                },
                {
                  href: '/admin/notifications',
                  label: 'Active notification channels',
                  value: dashboard.admin_counts.active_channels,
                },
                {
                  href: '/admin/registries',
                  label: 'Global registries',
                  value: dashboard.admin_counts.global_registries,
                },
              ].map((item) => (
                <ResourceList.Item
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  meta={
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {item.value.toLocaleString()}
                    </span>
                  }
                />
              ))}
            </ResourceList>
          </section>

          <Card>
            <Card.Header>
              <Card.Title>System</Card.Title>
            </Card.Header>
            <Card.Content>
              <DescriptionList
                items={[
                  {
                    label: 'Public scanning',
                    value: dashboard.public_scan_enabled ? 'Enabled' : 'Disabled',
                  },
                  { label: 'Frontend version', value: `v${APP_FRONTEND_VERSION}` },
                  {
                    label: 'Database freshness limit',
                    value: `${dashboard.scanner_health.max_allowed_age_hours} hours`,
                  },
                  {
                    label: 'Data generated',
                    value: (
                      <span title={fullDate(dashboard.generated_at)}>
                        {timeAgo(dashboard.generated_at)}
                      </span>
                    ),
                  },
                  { label: 'Copyright', value: APP_COPYRIGHT, wide: true },
                ]}
              />
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  );
}
