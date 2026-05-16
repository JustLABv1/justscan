'use client';

import { ChartSkeleton } from '@/components/ui/skeleton';
import { getAdminDashboard } from '@/lib/api/admin';
import type { AdminDashboard, AdminDashboardVulnerabilityTrendPoint } from '@/lib/api/types/admin';
import { APP_COPYRIGHT, APP_FRONTEND_VERSION } from '@/lib/build-info';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import { Button, Card, Chip, Link, Skeleton } from '@heroui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const SEVERITY_SERIES = [
  { key: 'critical', label: 'Critical', color: '#f87171' },
  { key: 'high', label: 'High', color: '#fb923c' },
  { key: 'medium', label: 'Medium', color: '#fbbf24' },
  { key: 'low', label: 'Low', color: '#60a5fa' },
  { key: 'unknown', label: 'Unknown', color: '#a1a1aa' },
] as const;

function formatCompact(value: number) {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatLatency(value: number) {
  return `${Math.round(value)}ms`;
}

type AdminChartTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  formatLabel?: (value: string) => string;
};

function AdminChartTooltip({ active, label, payload, formatLabel }: AdminChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      className="rounded-lg border px-3 py-2 shadow-lg"
      style={{
        background: 'rgba(24, 24, 27, 0.96)',
        borderColor: 'rgba(113, 113, 122, 0.45)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <p className="mb-1 text-xs text-foreground/70">
        {typeof label === 'string' ? (formatLabel ? formatLabel(label) : label) : ''}
      </p>
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div key={entry.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: entry.color ?? '#a1a1aa' }}
              />
              {entry.name ?? `Series ${index + 1}`}
            </span>
            <span className="font-semibold text-foreground">
              {Number(entry.value ?? 0).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
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
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="rgba(161,161,170,0.15)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) =>
              new Date(value).toLocaleDateString('en', { month: 'short', day: 'numeric' })
            }
            minTickGap={30}
            tick={{ fill: 'rgb(113 113 122)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'rgb(113 113 122)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={(props: any) => (
              <AdminChartTooltip
                active={props.active}
                label={props.label}
                payload={props.payload}
                formatLabel={(value: string) =>
                  new Date(value).toLocaleDateString('en', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                }
              />
            )}
            wrapperStyle={{ outline: 'none', zIndex: 30 }}
            contentStyle={{ background: 'transparent', border: 'none', padding: 0 }}
            cursor={{ stroke: 'rgba(124,58,237,0.45)', strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <Line
            type="monotone"
            dataKey="value"
            name="Scans"
            stroke="#7c3aed"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
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
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="rgba(161,161,170,0.15)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'rgb(113 113 122)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'rgb(113 113 122)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={(props: any) => (
                <AdminChartTooltip
                  active={props.active}
                  label={props.label}
                  payload={props.payload}
                />
              )}
              wrapperStyle={{ outline: 'none', zIndex: 30 }}
              contentStyle={{ background: 'transparent', border: 'none', padding: 0 }}
              cursor={{ fill: 'rgba(161,161,170,0.08)' }}
            />
            {SEVERITY_SERIES.map((severity) => (
              <Bar
                key={severity.key}
                dataKey={severity.key}
                name={severity.label}
                stackId="severity"
                fill={severity.color}
                radius={severity.key === 'critical' ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={96}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
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
      <Card className="border border-danger/30 bg-danger/10">
        <Card.Content>
          <p className="text-sm text-danger">{error}</p>
          <div>
            <Button size="sm" variant="danger" onPress={load}>
              Retry
            </Button>
          </div>
        </Card.Content>
      </Card>
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

  return (
    <div className="space-y-4">
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
