'use client';

import { useId, type ReactNode } from 'react';
import Link from 'next/link';
import { ScanLine, ShieldAlert, ChevronRight } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui';
import { StatusAlert } from '@/components/ui/form-alert';
import {
  CHART_TONES,
  formatChartDate as formatChartDateShared,
} from '@/components/ui/chart-adapter';
import {
  DashboardChartPanel,
  ChartRangeSelect,
  ChartSummary,
  DashboardChartTooltip,
} from './chart-ui';
import {
  getRecentActivityBounds,
  RECENT_ACTIVITY_RANGE_OPTIONS,
  type RecentActivityRange,
} from '@/components/scans/recent-activity';
import type { DashboardTrendPoint, DashboardVulnTrendPoint } from '@/lib/api';

type ScanOutcomeSeries = {
  key:
    | 'completed'
    | 'org_policy_failed'
    | 'policy_blocked'
    | 'failed'
    | 'running'
    | 'pending'
    | 'cancelled';
  label: string;
  color: string;
  status?: string;
  policy?: 'fail';
};

const SCAN_OUTCOME_SERIES = [
  { key: 'completed', label: 'Succeeded', color: CHART_TONES.success.dark, status: 'completed' },
  {
    key: 'org_policy_failed',
    label: 'Org policy failed',
    color: CHART_TONES.danger.dark,
    policy: 'fail',
  },
  {
    key: 'policy_blocked',
    label: 'Blocked by policy',
    color: CHART_TONES.warning.dark,
    status: 'blocked_by_xray_policy',
  },
  { key: 'failed', label: 'Failed', color: CHART_TONES.danger.dark, status: 'failed' },
  { key: 'running', label: 'Running', color: CHART_TONES.accent.dark, status: 'running' },
  { key: 'pending', label: 'Queued', color: CHART_TONES.neutral.dark, status: 'pending' },
  { key: 'cancelled', label: 'Cancelled', color: CHART_TONES.neutral.light, status: 'cancelled' },
] as const satisfies readonly ScanOutcomeSeries[];

const HOUR_FORMATTER = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  hour12: false,
  timeZone: 'UTC',
});
const HOUR_TOOLTIP_FORMATTER = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});
const SCAN_OUTCOME_RANGE_DAYS: Record<Exclude<RecentActivityRange, '6h' | '24h'>, number> = {
  '7d': 7,
  '30d': 30,
};

function formatChartDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  if (options?.year) {
    return formatChartDateShared(date, true);
  }
  return formatChartDateShared(date);
}

function sumAvgFindings(point: DashboardVulnTrendPoint): number {
  return point.critical + point.high + point.medium + point.low + point.unknown;
}

export function ScanOutcomeChart({
  data,
  range,
  loading,
  error,
  onRangeChange,
  onDayPress,
  onStatusPress,
  onRetry,
}: {
  data: DashboardTrendPoint[];
  range: RecentActivityRange;
  loading: boolean;
  error?: string;
  onRangeChange: (range: RecentActivityRange) => void;
  onDayPress: (date: string) => void;
  onStatusPress: (filters: { status?: string; policy?: string }) => void;
  onRetry?: () => void;
}) {
  const filledData = fillScanOutcomeBuckets(data, range);
  const totalScans = filledData.reduce((sum, point) => sum + point.total, 0);
  const chartData: Array<Record<string, unknown>> = filledData.map((point) => ({
    ...point,
    ...Object.fromEntries(
      SCAN_OUTCOME_SERIES.map((series) => [series.key, point[series.key] ?? 0])
    ),
  }));
  const totals = SCAN_OUTCOME_SERIES.map((series) => ({
    ...series,
    total: filledData.reduce((sum, point) => sum + (point[series.key] ?? 0), 0),
  }));
  const openDayDates = new Set<string>();
  const openDayButtons = filledData.reduce<ReactNode[]>((buttons, point) => {
    if (point.total <= 0) {
      return buttons;
    }

    openDayDates.add(point.date);
    buttons.push(
      <Button
        key={point.date}
        aria-label={`Open ${point.total} scans from ${formatScanOutcomeTooltip(point.date, range)}`}
        onPress={() => onDayPress(point.date)}
        size="sm"
        variant="ghost"
      >
        {formatScanOutcomeBucket(point.date, range)}
      </Button>
    );
    return buttons;
  }, []);
  const rangeLabel =
    RECENT_ACTIVITY_RANGE_OPTIONS.find((option) => option.id === range)?.label ?? 'selected period';

  const patternId = useId().replace(/:/g, '');
  const completed = totals.find((series) => series.key === 'completed')?.total ?? 0;
  const failed = totals.find((series) => series.key === 'failed')?.total ?? 0;
  const unavailable = error || loading;
  return (
    <DashboardChartPanel
      title="Scan outcomes"
      description="Scan runs by outcome, across the selected window"
      actions={
        <ChartRangeSelect
          label="Scan outcomes time range"
          value={range}
          onChange={(value) => onRangeChange(value as RecentActivityRange)}
          options={RECENT_ACTIVITY_RANGE_OPTIONS.map((option) => ({
            id: option.id,
            label: option.label,
          }))}
        />
      }
      summary={
        <>
          <ChartSummary
            label="Scan runs"
            value={unavailable ? '—' : totalScans.toLocaleString()}
            detail={rangeLabel}
          />
          <ChartSummary
            label="Succeeded"
            value={unavailable ? '—' : completed.toLocaleString()}
            detail="Successful outcomes"
          />
          <ChartSummary
            label="Failed"
            value={unavailable ? '—' : failed.toLocaleString()}
            detail="Failed scan runs"
          />
        </>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {!error &&
              totals
                .filter((series) => series.total > 0)
                .map((series) => (
                  <Button
                    key={series.key}
                    size="sm"
                    variant="ghost"
                    aria-label={`View ${series.label.toLowerCase()} scans from the selected period`}
                    onPress={() =>
                      onStatusPress({
                        status: 'status' in series ? series.status : undefined,
                        policy: 'policy' in series ? series.policy : undefined,
                      })
                    }
                  >
                    <span className="size-2 rounded-sm" style={{ backgroundColor: series.color }} />
                    {series.label}
                    <span className="tabular-nums text-muted-foreground">
                      {series.total.toLocaleString()}
                    </span>
                  </Button>
                ))}
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/scans?range=${range}`}>
              View scans
              <ChevronRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      }
    >
      <ScanOutcomePlot
        {...{
          error,
          loading,
          totalScans,
          chartData,
          patternId,
          range,
          openDayDates,
          onDayPress,
          onRetry,
        }}
      />
      {!error && openDayButtons.length > 0 ? (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Browse scans by day
          </summary>
          <div className="mt-2 flex flex-wrap gap-1" aria-label="Open scans for a specific day">
            {openDayButtons}
          </div>
        </details>
      ) : null}
    </DashboardChartPanel>
  );
}

function ScanOutcomePlot({
  error,
  loading,
  totalScans,
  chartData,
  patternId,
  range,
  openDayDates,
  onDayPress,
  onRetry,
}: Pick<
  Parameters<typeof ScanOutcomeChart>[0],
  'error' | 'loading' | 'range' | 'onDayPress' | 'onRetry'
> & {
  totalScans: number;
  chartData: Array<Record<string, unknown>>;
  patternId: string;
  openDayDates: Set<string>;
}) {
  return error ? (
    <StatusAlert
      status="danger"
      title="Scan outcomes unavailable"
      description={error}
      action={
        onRetry ? (
          <Button size="sm" variant="outline" onPress={onRetry}>
            Retry
          </Button>
        ) : null
      }
    />
  ) : loading ? (
    <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
      Updating scan outcomes…
    </div>
  ) : totalScans === 0 ? (
    <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 text-center">
      <ScanLine className="size-7 text-muted-foreground" />
      <p className="text-sm font-medium">No scan activity in this window</p>
      <p className="max-w-sm px-4 text-xs text-muted-foreground">
        Select another period or start a scan to see outcomes.
      </p>
    </div>
  ) : (
    <div className="h-[300px] w-full text-xs text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          accessibilityLayer
          data={chartData}
          barCategoryGap="25%"
          margin={{ top: 12, right: 4, left: -18, bottom: 0 }}
          onClick={(state) => {
            const day = typeof state.activeLabel === 'string' ? state.activeLabel : null;
            if (day && openDayDates.has(day)) onDayPress(day);
          }}
        >
          <defs>
            {SCAN_OUTCOME_SERIES.map((series) => (
              <pattern
                key={series.key}
                id={`${patternId}-${series.key}`}
                patternUnits="userSpaceOnUse"
                width={6}
                height={6}
                patternTransform="rotate(45)"
              >
                <rect width={6} height={6} fill={series.color} fillOpacity={0.13} />
                <line x1={0} y1={0} x2={0} y2={6} stroke={series.color} strokeWidth={1.5} />
              </pattern>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            minTickGap={30}
            tickMargin={10}
            tickFormatter={(value) => formatScanOutcomeBucket(String(value), range)}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            width={42}
          />
          <ChartTooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
            content={(props) => (
              <DashboardChartTooltip
                {...props}
                colors={Object.fromEntries(
                  SCAN_OUTCOME_SERIES.map((series) => [series.key, series.color])
                )}
                formatLabel={(value) => formatScanOutcomeTooltip(value, range)}
              />
            )}
          />
          {SCAN_OUTCOME_SERIES.map((series) => (
            <Bar
              key={series.key}
              name={series.label}
              dataKey={series.key}
              stackId="outcomes"
              fill={`url(#${patternId}-${series.key})`}
              stroke={series.color}
              strokeWidth={1}
              radius={2}
              maxBarSize={36}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const STACK = [
  { key: 'unknown' as const, label: 'Unknown', color: 'var(--muted-foreground)', opacity: 0.72 },
  { key: 'low' as const, label: 'Low', color: 'var(--color-blue-500)', opacity: 0.82 },
  { key: 'medium' as const, label: 'Medium', color: 'var(--warning)', opacity: 0.85 },
  { key: 'high' as const, label: 'High', color: 'var(--color-orange-500)', opacity: 0.88 },
  { key: 'critical' as const, label: 'Critical', color: 'var(--destructive)', opacity: 0.92 },
];
const VULNERABILITY_TREND_PERIODS = [7, 14, 30] as const;

// Fill every calendar day in the period so gaps are visible as zeros
function fillDates(data: DashboardVulnTrendPoint[], days: number): DashboardVulnTrendPoint[] {
  const map = new Map(data.map((d) => [d.date, d]));
  const result: DashboardVulnTrendPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push(map.get(key) ?? { date: key, critical: 0, high: 0, medium: 0, low: 0, unknown: 0 });
  }
  return result;
}

function formatScanOutcomeBucket(value: string, range: RecentActivityRange): string {
  if (range === '6h' || range === '24h') {
    return HOUR_FORMATTER.format(new Date(value));
  }
  return formatChartDate(value);
}

function formatScanOutcomeTooltip(value: string, range: RecentActivityRange): string {
  if (range === '6h' || range === '24h') {
    return HOUR_TOOLTIP_FORMATTER.format(new Date(value));
  }
  return formatChartDate(value, { year: 'numeric' });
}

function fillScanOutcomeBuckets(
  data: DashboardTrendPoint[],
  range: RecentActivityRange
): DashboardTrendPoint[] {
  const pointsByDate = new Map(data.map((point) => [point.date, point]));
  if (range === '6h' || range === '24h') {
    const hours = range === '6h' ? 6 : 24;
    const currentHour = new Date();
    currentHour.setUTCMinutes(0, 0, 0);
    return Array.from({ length: hours + 1 }, (_, index) => {
      const bucket = new Date(currentHour);
      bucket.setUTCHours(bucket.getUTCHours() - (hours - index));
      const key = bucket.toISOString().slice(0, 13) + ':00:00Z';
      return (
        pointsByDate.get(key) ?? {
          date: key,
          total: 0,
          completed: 0,
          failed: 0,
          policy_blocked: 0,
          running: 0,
          pending: 0,
          cancelled: 0,
          org_policy_failed: 0,
          other: 0,
        }
      );
    });
  }

  const today = new Date();
  const days = SCAN_OUTCOME_RANGE_DAYS[range];
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const dateKeys: string[] = [];
  for (const date = new Date(start); date <= today; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    if (dateKeys.at(-1) !== key) dateKeys.push(key);
  }

  return dateKeys.map((key) => {
    return (
      pointsByDate.get(key) ?? {
        date: key,
        total: 0,
        completed: 0,
        failed: 0,
        policy_blocked: 0,
        running: 0,
        pending: 0,
        cancelled: 0,
        org_policy_failed: 0,
        other: 0,
      }
    );
  });
}

// Compute 4–5 human-readable Y-axis tick values that cover maxVal
function niceTicks(maxVal: number): number[] {
  if (maxVal === 0) return [0, 25, 50, 75, 100];
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const normalised = maxVal / magnitude;
  const niceMax =
    normalised <= 1
      ? magnitude
      : normalised <= 2
        ? 2 * magnitude
        : normalised <= 5
          ? 5 * magnitude
          : 10 * magnitude;
  const step = niceMax / 4;
  return [0, 1, 2, 3, 4].map((i) => Math.round(i * step));
}

function fmtTick(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export function VulnTrendChart({
  data,
  period,
  onPeriod,
  error,
  onRetry,
}: {
  data: DashboardVulnTrendPoint[];
  period: number;
  onPeriod: (d: number) => void;
  error?: string;
  onRetry?: () => void;
}) {
  const filled = fillDates(data, period);
  const hasData = data.length > 0;
  const hasUnknownFindings = filled.some((point) => point.unknown > 0);
  const series = hasUnknownFindings ? STACK : STACK.filter(({ key }) => key !== 'unknown');
  const sampleDates = new Set(data.map((point) => point.date));
  const chartData = filled.map((point) =>
    sampleDates.has(point.date)
      ? { ...point, total: sumAvgFindings(point) }
      : {
          date: point.date,
          ...Object.fromEntries(STACK.map((item) => [item.key, null])),
          total: null,
        }
  );
  const latestSample = [...data].sort((left, right) => right.date.localeCompare(left.date))[0];
  const latestActivePoint = latestSample
    ? { ...latestSample, total: sumAvgFindings(latestSample) }
    : null;
  const peakAverage = Math.max(...data.map((point) => sumAvgFindings(point)), 0);
  const ticks = niceTicks(peakAverage);

  return (
    <DashboardChartPanel
      title="Risk trend"
      description="Average findings per finalized scan, by severity"
      actions={
        <ChartRangeSelect
          label="Risk trend time range"
          value={String(period)}
          onChange={(value) => onPeriod(Number(value))}
          options={VULNERABILITY_TREND_PERIODS.map((days) => ({
            id: String(days),
            label: `Last ${days} days`,
          }))}
        />
      }
      summary={
        <>
          <ChartSummary
            label="Latest daily average"
            value={error || !latestActivePoint ? '—' : latestActivePoint.total.toLocaleString()}
            detail={
              latestActivePoint ? formatChartDate(latestActivePoint.date) : 'No finalized evidence'
            }
          />
          <ChartSummary
            label="Peak daily average"
            value={error || !hasData ? '—' : peakAverage.toLocaleString()}
            detail="Within this window"
          />
          <ChartSummary
            label="Days with evidence"
            value={error ? '—' : data.length}
            detail={`Last ${period} days`}
          />
        </>
      }
      footer={
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {[...series].reverse().map((item) => (
            <span key={item.key} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 rounded-sm" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      }
    >
      {error ? (
        <StatusAlert
          status="danger"
          title="Risk trend unavailable"
          description={error}
          action={
            onRetry ? (
              <Button size="sm" variant="outline" onPress={onRetry}>
                Retry
              </Button>
            ) : null
          }
        />
      ) : !hasData ? (
        <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 text-center">
          <ShieldAlert className="size-7 text-muted-foreground" />
          <p className="text-sm font-medium">No finalized evidence in this window</p>
          <p className="max-w-sm px-4 text-xs text-muted-foreground">
            Risk trends appear after scans finish. Choose a wider period to look further back.
          </p>
        </div>
      ) : (
        <div className="h-[300px] w-full text-xs">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              accessibilityLayer
              data={chartData}
              margin={{ top: 12, right: 4, left: -12, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                minTickGap={28}
                tickMargin={10}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickFormatter={(value) => formatChartDate(String(value))}
              />
              <YAxis
                ticks={ticks}
                width={42}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickFormatter={(value) => fmtTick(Number(value))}
              />
              <ChartTooltip
                cursor={{ stroke: 'var(--ring)', strokeDasharray: '3 3' }}
                content={(props) => (
                  <DashboardChartTooltip {...props} formatLabel={formatChartDate} />
                )}
              />
              {series.map((item) => (
                <Area
                  key={item.key}
                  name={item.label}
                  dataKey={item.key}
                  stackId="severity"
                  type="linear"
                  stroke={item.color}
                  fill={item.color}
                  fillOpacity={0.12}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, stroke: 'var(--background)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </DashboardChartPanel>
  );
}
