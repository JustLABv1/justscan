'use client';
import {
  DashboardDrilldownKey,
  DashboardDrilldownModal,
} from '@/components/dashboard/dashboard-drilldown-modal';
import {
  Area as EvilArea,
  EvilAreaChart,
  Grid as EvilAreaGrid,
  Tooltip as EvilAreaTooltip,
  XAxis as EvilAreaXAxis,
  YAxis as EvilAreaYAxis,
} from '@/components/evilcharts/charts/area-chart';
import {
  buildRecentActivityHref,
  getRecentActivityBounds,
  RECENT_ACTIVITY_RANGE_OPTIONS,
  RecentActivityRange,
  RecentActivityRow,
} from '@/components/scans/recent-activity';
import { StatusBadge } from '@/components/ui/badges';
import { StatusAlert } from '@/components/ui/form-alert';
import {
  formatChartDate as formatChartDateShared,
  singleSeriesConfig,
  typedChartConfigFromSeries,
} from '@/components/ui/chart-adapter';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { SurfaceIcon } from '@/components/ui/surface-icon';
import { DashboardLoadingSkeleton, RecentScanRowSkeleton } from '@/components/ui/skeleton';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  DashboardStats,
  DashboardTrendPoint,
  DashboardVulnTrendPoint,
  getDashboardTrends,
  getDashboardVulnTrends,
  getScannerHealth,
  getStats,
  getTokenType,
  getUser,
  listScans,
  listWatchlist,
  Scan,
  ScannerHealth,
  WatchlistItem,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import { getWatchlistPolicyAttentionItems } from '@/lib/watchlist-posture';
import { Alert, Button, Card, Chip, useOverlayState } from '@heroui/react';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  ChartIcon,
  Clock01Icon,
  GitBranchIcon,
  PackageIcon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

// ── severity config ──────────────────────────────────────────────────
const SEV = [
  {
    key: 'critical',
    label: 'Critical',
    hex: '#f87171',
    glow: 'rgba(239,68,68,0.35)',
    grad: 'linear-gradient(90deg,#991b1b,#f87171)',
  },
  {
    key: 'high',
    label: 'High',
    hex: '#fb923c',
    glow: 'rgba(249,115,22,0.35)',
    grad: 'linear-gradient(90deg,#c2410c,#fb923c)',
  },
  {
    key: 'medium',
    label: 'Medium',
    hex: '#fbbf24',
    glow: 'rgba(245,158,11,0.3)',
    grad: 'linear-gradient(90deg,#b45309,#fbbf24)',
  },
  {
    key: 'low',
    label: 'Low',
    hex: '#60a5fa',
    glow: 'rgba(59,130,246,0.3)',
    grad: 'linear-gradient(90deg,#1d4ed8,#60a5fa)',
  },
  {
    key: 'unknown',
    label: 'Unknown',
    hex: '#a1a1aa',
    glow: 'rgba(113,113,122,0.25)',
    grad: 'linear-gradient(90deg,#3f3f46,#a1a1aa)',
  },
];

function formatChartDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  if (options?.year) {
    return formatChartDateShared(date, true);
  }
  return formatChartDateShared(date);
}

function toTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildTrendSeries(
  trends: DashboardTrendPoint[],
  days: number,
  selectValue: (point: DashboardTrendPoint) => number
): { date: string; value: number }[] {
  const result: { date: string; value: number }[] = [];
  const valuesByDate = new Map(trends.map((point) => [point.date, selectValue(point)]));
  const now = new Date();

  for (let index = days - 1; index >= 0; index--) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - index);
    const key = date.toISOString().slice(0, 10);
    result.push({ date: key, value: valuesByDate.get(key) ?? 0 });
  }

  return result;
}

function sumAvgFindings(point: DashboardVulnTrendPoint): number {
  return point.critical + point.high + point.medium + point.low + point.unknown;
}

type PostureTone = 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

type WatchlistCoverage = {
  enabledCount: number;
  scanned24hCount: number;
  scanned7dCount: number;
  staleItems: WatchlistItem[];
  neverScannedCount: number;
  coverage7d: number;
  topSchedule: [string, number] | null;
};

type TrendChip = {
  label: string;
  tone: PostureTone;
};

const TONE_STYLES: Record<
  PostureTone,
  { color: string; bg: string; border: string; softBg: string }
> = {
  success: {
    color: '#34d399',
    bg: 'rgba(52,211,153,0.14)',
    border: 'rgba(52,211,153,0.28)',
    softBg: 'rgba(52,211,153,0.07)',
  },
  warning: {
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.14)',
    border: 'rgba(251,191,36,0.28)',
    softBg: 'rgba(251,191,36,0.07)',
  },
  danger: {
    color: '#f87171',
    bg: 'rgba(248,113,113,0.14)',
    border: 'rgba(248,113,113,0.28)',
    softBg: 'rgba(248,113,113,0.07)',
  },
  accent: {
    color: 'color-mix(in srgb, var(--accent) 78%, white)',
    bg: 'color-mix(in srgb, var(--accent) 14%, transparent)',
    border: 'color-mix(in srgb, var(--accent) 28%, transparent)',
    softBg: 'color-mix(in srgb, var(--accent) 7%, transparent)',
  },
  neutral: {
    color: 'var(--text-muted)',
    bg: 'var(--row-hover)',
    border: 'var(--surface-border)',
    softBg: 'rgba(161,161,170,0.07)',
  },
};

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}

function getWatchlistCoverage(items: WatchlistItem[]): WatchlistCoverage {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const enabledItems = items.filter((item) => item.enabled);
  const scanned24hCount = enabledItems.filter((item) => {
    const scannedAt = toTimestamp(item.last_scanned_at);
    return scannedAt != null && now - scannedAt <= dayMs;
  }).length;
  const scanned7dCount = enabledItems.filter((item) => {
    const scannedAt = toTimestamp(item.last_scanned_at);
    return scannedAt != null && now - scannedAt <= weekMs;
  }).length;
  const staleItems = enabledItems
    .filter((item) => {
      const scannedAt = toTimestamp(item.last_scanned_at);
      return scannedAt == null || now - scannedAt > weekMs;
    })
    .sort((left, right) => {
      const leftTime = toTimestamp(left.last_scanned_at) ?? 0;
      const rightTime = toTimestamp(right.last_scanned_at) ?? 0;
      return leftTime - rightTime;
    });
  const neverScannedCount = enabledItems.filter(
    (item) => !toTimestamp(item.last_scanned_at)
  ).length;
  const scheduleCounts = enabledItems.reduce<Record<string, number>>((acc, item) => {
    const schedule = item.schedule?.trim() || 'unscheduled';
    acc[schedule] = (acc[schedule] ?? 0) + 1;
    return acc;
  }, {});
  let topSchedule: [string, number] | null = null;
  for (const entry of Object.entries(scheduleCounts)) {
    if (!topSchedule || entry[1] > topSchedule[1]) {
      topSchedule = entry;
    }
  }

  return {
    enabledCount: enabledItems.length,
    scanned24hCount,
    scanned7dCount,
    staleItems,
    neverScannedCount,
    coverage7d:
      enabledItems.length > 0 ? Math.round((scanned7dCount / enabledItems.length) * 100) : 0,
    topSchedule,
  };
}

function buildVulnerabilityTrendSeries(
  data: DashboardVulnTrendPoint[],
  days: number,
  selectValue: (point: DashboardVulnTrendPoint) => number
): { date: string; value: number }[] {
  return fillDates(data, days).map((point) => ({
    date: point.date,
    value: selectValue(point),
  }));
}

function getSeriesWindowAverage(
  series: { date: string; value: number }[],
  start: number,
  end: number
): number {
  const slice = series.slice(start, end);
  if (slice.length === 0) return 0;
  return slice.reduce((sum, point) => sum + point.value, 0) / slice.length;
}

function getTrendChip(
  series: { date: string; value: number }[],
  options?: {
    higherIsBetter?: boolean;
    stableLabel?: string;
    noDataLabel?: string;
    usePercent?: boolean;
  }
): TrendChip {
  const higherIsBetter = options?.higherIsBetter ?? false;
  const stableLabel = options?.stableLabel ?? 'Stable';
  const noDataLabel = options?.noDataLabel ?? 'No trend yet';
  const usePercent = options?.usePercent ?? true;

  if (series.length < 2) {
    return { label: noDataLabel, tone: 'neutral' };
  }

  const midpoint = Math.max(1, Math.floor(series.length / 2));
  const previousAvg = getSeriesWindowAverage(series, 0, midpoint);
  const recentAvg = getSeriesWindowAverage(series, midpoint, series.length);
  const delta = recentAvg - previousAvg;

  if (Math.abs(delta) < 0.5) {
    return { label: stableLabel, tone: 'neutral' };
  }

  const tone =
    delta > 0 ? (higherIsBetter ? 'success' : 'danger') : higherIsBetter ? 'danger' : 'success';
  const direction = delta > 0 ? '↑' : '↓';

  if (usePercent && previousAvg > 0) {
    const percentChange = Math.round((Math.abs(delta) / previousAvg) * 100);
    return {
      label: `${direction} ${percentChange}%`,
      tone,
    };
  }

  if (usePercent && previousAvg === 0 && recentAvg > 0) {
    return {
      label: `${direction} +${Math.round(recentAvg)}`,
      tone,
    };
  }

  const roundedDelta = Math.round(Math.abs(delta) * 10) / 10;

  return {
    label: `${direction} ${roundedDelta}`,
    tone,
  };
}

function isFlatSeries(series: { date: string; value: number }[]) {
  if (series.length < 2) return true;
  return series.every((point) => point.value === series[0]?.value);
}

function isScannerReady({
  isAdmin,
  scannerHealth,
  scannerHealthError,
}: {
  isAdmin: boolean;
  scannerHealth: ScannerHealth | null;
  scannerHealthError: string;
}) {
  return (
    !isAdmin ||
    (!scannerHealthError &&
      (!scannerHealth?.local_scanner_enabled ||
        (scannerHealth.healthy_workers > 0 &&
          scannerHealth.stale_workers === 0 &&
          scannerHealth.error_workers === 0)))
  );
}

function BriefingMetric({
  label,
  value,
  detail,
  icon,
  tone = 'neutral',
  trend,
  sparkline,
  href,
  onPress,
  className,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  icon?: ReactNode;
  tone?: PostureTone;
  trend?: TrendChip;
  sparkline?: { data: { date: string; value: number }[]; valueLabel?: string };
  href?: string;
  onPress?: () => void;
  className?: string;
}) {
  const toneStyle = TONE_STYLES[tone];
  const statTone = tone === 'neutral' ? 'default' : tone;
  const sparklineIsFlat = sparkline ? isFlatSeries(sparkline.data) : false;
  const content = (
    <StatCard
      label={label}
      value={value}
      hint={detail}
      icon={icon}
      iconTone="default"
      iconVariant="repository"
      tone={statTone}
      variant="stacked"
      className={['h-full', className].filter(Boolean).join(' ')}
      valueClassName="text-lg font-semibold tabular-nums"
      valueStyle={{ color: toneStyle.color }}
      hintClassName="text-[11px] leading-4 text-muted"
      aside={
        <>
          <div className="flex items-center gap-2">
            {trend ? (
              <Chip
                size="sm"
                variant="soft"
                color={
                  trend.tone === 'danger'
                    ? 'danger'
                    : trend.tone === 'warning'
                      ? 'warning'
                      : trend.tone === 'success'
                        ? 'success'
                        : trend.tone === 'accent'
                          ? 'accent'
                          : 'default'
                }
              >
                {trend.label}
              </Chip>
            ) : null}
            <span
              className="size-1.5 rounded-full"
              style={{ background: toneStyle.color, opacity: 0.9 }}
            />
          </div>
          {sparkline ? (
            sparklineIsFlat ? (
              <div className="flex h-8 w-20 items-center justify-end">
                <span className="block h-px w-20 rounded-full bg-default-500/60" />
              </div>
            ) : (
              <MiniSparkline
                data={sparkline.data}
                color={toneStyle.color}
                compact
                showArea={false}
                valueLabel={sparkline.valueLabel ?? 'events'}
              />
            )
          ) : null}
        </>
      }
    />
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group block h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/70"
      >
        {content}
      </Link>
    );
  }

  if (!onPress) return content;

  return (
    <button
      type="button"
      onClick={onPress}
      className="group h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/70"
      aria-haspopup="dialog"
    >
      {content}
    </button>
  );
}

function DashboardSectionHeader({
  title,
  icon,
  description,
  action,
}: {
  title: string;
  icon?: ReactNode;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <SurfaceIcon icon={icon} variant="repository" /> : null}
          <h2 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
        </div>
        {description && (
          <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function ScanActivityCard({
  activeScans,
  recentResults,
}: {
  activeScans: Scan[];
  recentResults: Scan[];
}) {
  return (
    <Card className="p-4">
      <DashboardSectionHeader
        title="Scan activity"
        icon={<Shield01Icon size={16} />}
        description={
          activeScans.length > 0
            ? 'Running work and the latest finalized results'
            : 'Latest finalized results for this workspace'
        }
        action={
          <Link
            href="/scans"
            className="text-xs font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/70"
          >
            View all scans →
          </Link>
        }
      />

      <div className={`mt-4 grid gap-4${activeScans.length > 0 ? ' xl:grid-cols-2' : ''}`}>
        {activeScans.length > 0 ? (
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2 px-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Active</p>
              <Chip color="accent" size="sm" variant="soft">
                {activeScans.length}
              </Chip>
            </div>
            <div className="mt-2 space-y-1">
              {activeScans.slice(0, 3).map((scan) => (
                <RecentActivityRow key={scan.id} scan={scan} />
              ))}
            </div>
          </div>
        ) : null}

        <div className="min-w-0">
          <p className="px-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Recent results
          </p>
          {recentResults.length > 0 ? (
            <div className="mt-2 space-y-1">
              {recentResults.slice(0, 3).map((scan) => (
                <RecentActivityRow key={scan.id} scan={scan} />
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-xl border border-surface-border bg-surface-secondary px-3 py-4 text-sm text-muted">
              No finalized scans yet.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function isProblemScan(scan: Scan): boolean {
  return scan.status === 'failed' || scan.external_status === 'blocked_by_xray_policy';
}

function problemScanTime(scan: Scan): string {
  return scan.completed_at ?? scan.started_at ?? scan.created_at;
}

function RecentProblemScansCard({
  scans,
  loading,
  error,
  href,
}: {
  scans: Scan[];
  loading: boolean;
  error: string;
  href: string;
}) {
  return (
    <Card className="h-full p-4">
      <DashboardSectionHeader
        title="Recent problem scans"
        icon={<Shield01Icon size={16} />}
        description="Latest failed or policy-blocked runs"
        action={
          <Link href={href}>
            <Button size="sm" variant="secondary">
              Open scan activity
              <ArrowRight01Icon />
            </Button>
          </Link>
        }
      />

      {loading ? (
        <div className="mt-4 space-y-1.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <RecentScanRowSkeleton key={index} />
          ))}
        </div>
      ) : error ? (
        <StatusAlert
          className="mt-4"
          status="danger"
          title="Scan activity failed to load"
          description={error}
        />
      ) : scans.length === 0 ? (
        <StatusAlert
          className="mt-4"
          title="No recent failed or blocked scans"
          description="When scans fail or Xray blocks a result, it will appear here first."
        />
      ) : (
        <div className="mt-3 grid gap-2">
          {scans.map((scan) => (
            <Link
              key={scan.id}
              href={`/scans/details/${scan.id}`}
              className="grid min-w-0 gap-2 rounded-xl border border-surface-border bg-surface-secondary px-3 py-2.5 transition-colors hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/70 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center 2xl:grid-cols-[minmax(150px,0.9fr)_auto_minmax(160px,1.2fr)_auto]"
            >
              <p
                className="truncate font-mono text-sm font-medium text-foreground"
                title={`${scan.image_name}:${scan.image_tag}`}
              >
                {scan.image_name}:{scan.image_tag}
              </p>
              <div className="flex items-center gap-2 text-[11px]">
                <StatusBadge status={scan.status} externalStatus={scan.external_status} />
                <span
                  className="whitespace-nowrap text-muted"
                  title={fullDate(problemScanTime(scan))}
                >
                  {timeAgo(problemScanTime(scan))}
                </span>
              </div>
              <p className="truncate text-xs text-muted" title={scan.error_message || undefined}>
                {scan.error_message || 'No error details reported'}
              </p>
              <div className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
                <span className="text-sm font-semibold tabular-nums text-danger">
                  {scan.critical_count + scan.high_count}
                </span>
                <span className="text-[11px] text-muted">critical + high</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Mini Sparkline ────────────────────────────────────────────────────
function MiniSparkline({
  data,
  color,
  compact = false,
  valueLabel = 'events',
  showArea = true,
}: {
  data: { date: string; value: number }[];
  color: string;
  compact?: boolean;
  valueLabel?: string;
  showArea?: boolean;
}) {
  if (data.length < 2) return null;

  return (
    <div className={compact ? 'h-8 w-18 shrink-0' : 'h-full min-h-[208px] w-full'}>
      <EvilAreaChart
        data={data}
        config={singleSeriesConfig('value', valueLabel, color)}
        className="h-full !aspect-auto"
        chartProps={{
          margin: compact
            ? { top: 1, right: 0, left: 0, bottom: 1 }
            : { top: 12, right: 8, left: 0, bottom: 0 },
        }}
      >
        {!compact && <EvilAreaGrid vertical={false} stroke="rgba(161,161,170,0.16)" />}
        {!compact && (
          <EvilAreaXAxis
            dataKey="date"
            minTickGap={28}
            tickFormatter={(value: string) => formatChartDate(value)}
          />
        )}
        {!compact && <EvilAreaTooltip variant="frosted-glass" roundness="xl" />}
        <EvilArea
          dataKey="value"
          curveType="monotone"
          variant={showArea ? 'gradient' : 'solid'}
          strokeVariant="solid"
        />
      </EvilAreaChart>
    </div>
  );
}

// ── Vulnerability Trend Chart ─────────────────────────────────────────

// Stack order: low at bottom, critical at top (most severe is most visible)
const STACK = [
  { key: 'unknown' as const, label: 'Unknown', color: '#a1a1aa', opacity: 0.72 },
  { key: 'low' as const, label: 'Low', color: '#60a5fa', opacity: 0.82 },
  { key: 'medium' as const, label: 'Medium', color: '#fbbf24', opacity: 0.85 },
  { key: 'high' as const, label: 'High', color: '#fb923c', opacity: 0.88 },
  { key: 'critical' as const, label: 'Critical', color: '#f87171', opacity: 0.92 },
];

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

function VulnTrendChart({
  data,
  period,
  onPeriod,
}: {
  data: DashboardVulnTrendPoint[];
  period: number;
  onPeriod: (d: number) => void;
}) {
  const filled = fillDates(data, period);
  const hasData = filled.some((point) => sumAvgFindings(point) > 0);
  const hasUnknownFindings = filled.some((point) => point.unknown > 0);
  const series = hasUnknownFindings ? STACK : STACK.filter(({ key }) => key !== 'unknown');
  const chartData = filled.map((point) => ({ ...point, total: sumAvgFindings(point) }));
  const latestActivePoint = [...chartData].reverse().find((point) => point.total > 0) ?? null;
  const peakAverage = Math.max(...chartData.map((point) => point.total), 0);
  const ticks = niceTicks(peakAverage);
  const PERIODS = [7, 14, 30] as const;

  return (
    <Card className="relative z-10 rounded-2xl p-4">
      <div
        className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 20%, transparent), transparent)',
        }}
      />

      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <SurfaceIcon icon={<Shield01Icon size={17} />} variant="repository" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Risk trend</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Historical average findings per finalized scan, by severity
            </p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {latestActivePoint ? (
                <>
                  <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {latestActivePoint.total}
                  </span>{' '}
                  on {formatChartDate(latestActivePoint.date)}
                </>
              ) : (
                `No finalized scans in the last ${period} days`
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onPeriod(d)}
              className="px-2.5 py-1 text-xs font-medium rounded-lg transition-all duration-150"
              style={
                period === d
                  ? {
                      background: 'color-mix(in srgb, var(--accent) 25%, transparent)',
                      color: 'color-mix(in srgb, var(--accent) 78%, white)',
                      border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                    }
                  : {
                      background: 'var(--row-hover)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--surface-border)',
                    }
              }
              aria-pressed={period === d}
              aria-label={`Show last ${d} days`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 flex-wrap">
        {[...series].reverse().map(({ key, label, color }) => (
          <span key={key} className="flex items-center gap-1.5 text-xs" style={{ color }}>
            <span className="size-2.5 rounded-sm inline-block" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>

      <div className="w-full">
        {!hasData ? (
          <div className="flex items-center justify-center text-sm text-zinc-500 py-10">
            No finalized scans in this period
          </div>
        ) : (
          <div className="h-[240px] w-full">
            <EvilAreaChart
              data={chartData}
              config={typedChartConfigFromSeries(
                series.map((item) => ({
                  key: item.key,
                  label: item.label,
                  color: item.color,
                })) as Array<{
                  key: (typeof STACK)[number]['key'];
                  label: string;
                  color: string;
                }>
              )}
              className="h-full !aspect-auto"
              stackType="stacked"
            >
              <EvilAreaGrid vertical={false} stroke="rgba(161,161,170,0.16)" />
              <EvilAreaXAxis
                dataKey="date"
                minTickGap={28}
                tickFormatter={(value: string) => formatChartDate(value)}
              />
              <EvilAreaYAxis
                ticks={ticks}
                width={36}
                tickFormatter={(value: number) => fmtTick(value)}
              />
              <EvilAreaTooltip variant="frosted-glass" roundness="xl" />
              {series.map(({ key }) => (
                <EvilArea
                  key={key}
                  dataKey={key}
                  curveType="monotone"
                  variant="gradient"
                  strokeVariant="solid"
                />
              ))}
            </EvilAreaChart>
          </div>
        )}
      </div>

      {hasData && (
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Peak daily average in this window:{' '}
          <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            {peakAverage}
          </span>
        </p>
      )}
    </Card>
  );
}

// ── page ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const drilldownModal = useOverlayState();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trends, setTrends] = useState<DashboardTrendPoint[]>([]);
  const [vulnTrends, setVulnTrends] = useState<DashboardVulnTrendPoint[]>([]);
  const [vulnTrendPeriod, setVulnTrendPeriod] = useState(30);
  const [scannerHealth, setScannerHealth] = useState<ScannerHealth | null>(null);
  const [scannerHealthError, setScannerHealthError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeDrilldown, setActiveDrilldown] = useState<DashboardDrilldownKey | null>(null);
  const [recentActivityRange, setRecentActivityRange] = useState<RecentActivityRange>('24h');
  const [modalScans, setModalScans] = useState<Scan[]>([]);
  const [modalScansLoading, setModalScansLoading] = useState(false);
  const [modalScansError, setModalScansError] = useState('');
  const [watchlistOverviewItems, setWatchlistOverviewItems] = useState<WatchlistItem[]>([]);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState('');
  const currentUser = getUser() as { role?: string } | null;
  const isAdmin = currentUser?.role === 'admin' || getTokenType() === 'admin';

  const scanVolumeTrend = useMemo(
    () => buildTrendSeries(trends, 30, (point) => point.total),
    [trends]
  );
  const severeFindingsTrend = useMemo(
    () => buildVulnerabilityTrendSeries(vulnTrends, 7, (point) => point.critical + point.high),
    [vulnTrends]
  );
  const hasActiveScans = (stats?.attention_scans ?? []).some(
    (scan) => scan.status === 'pending' || scan.status === 'running'
  );
  const refreshStats = useCallback(() => {
    getStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  useConditionalInterval(refreshStats, hasActiveScans, 5000);

  useEffect(() => {
    const healthPromise = isAdmin
      ? getScannerHealth()
          .then((health) => ({ health, error: '' }))
          .catch((e: Error) => ({ health: null, error: e.message }))
      : Promise.resolve({ health: null, error: '' });

    Promise.all([
      getStats(),
      getDashboardTrends().catch(() => [] as DashboardTrendPoint[]),
      getDashboardVulnTrends(vulnTrendPeriod).catch(() => [] as DashboardVulnTrendPoint[]),
      healthPromise,
    ])
      .then(([s, t, vt, healthResult]) => {
        setStats(s);
        setTrends(t);
        setVulnTrends(vt);
        setScannerHealth(healthResult.health);
        setScannerHealthError(healthResult.error);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isAdmin, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return deferEffect(() => {
      listWatchlist()
        .then((items) => setWatchlistOverviewItems(items))
        .catch((watchlistLoadError: Error) => {
          setWatchlistOverviewItems([]);
          console.warn('Failed to load watchlist overview', watchlistLoadError);
        });
    });
  }, [scopeKey]);

  useEffect(() => {
    if (!activeDrilldown || !drilldownModal.isOpen) return;

    if (activeDrilldown === 'watchlist') {
      listWatchlist()
        .then((items) => setWatchlistItems(items))
        .catch((watchlistLoadError: Error) => {
          setWatchlistItems([]);
          setWatchlistError(watchlistLoadError.message);
        })
        .finally(() => setWatchlistLoading(false));
      return;
    }

    const { from, to } = getRecentActivityBounds(recentActivityRange);

    const request = listScans(
      1,
      50,
      undefined,
      activeDrilldown === 'completed' ? 'completed' : undefined,
      undefined,
      undefined,
      undefined,
      from,
      to
    ).then((result) => result.data ?? []);

    request
      .then((scans) => setModalScans(scans))
      .catch((modalError: Error) => {
        setModalScans([]);
        setModalScansError(modalError.message);
      })
      .finally(() => setModalScansLoading(false));
  }, [activeDrilldown, drilldownModal.isOpen, recentActivityRange, scopeKey]);

  function handleVulnPeriodChange(days: number) {
    setVulnTrendPeriod(days);
    getDashboardVulnTrends(days)
      .then(setVulnTrends)
      .catch(() => setVulnTrends([]));
  }

  if (loading) return <DashboardLoadingSkeleton />;

  if (error)
    return (
      <div className="p-8">
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.18)',
            color: '#f87171',
          }}
        >
          {error}
        </div>
      </div>
    );

  if (!stats) return null;

  const totalVulns = Object.values(stats.severity_totals).reduce((a, b) => a + b, 0);
  const criticalHighCount =
    (stats.severity_totals.critical ?? 0) + (stats.severity_totals.high ?? 0);
  const completedCount = stats.status_counts['completed'] ?? 0;
  const watchlistCoverage = getWatchlistCoverage(watchlistOverviewItems);
  const watchlistAttentionCount = getWatchlistPolicyAttentionItems(watchlistOverviewItems).length;
  const scannerReady = isScannerReady({
    isAdmin,
    scannerHealth,
    scannerHealthError,
  });
  const displayedModalScans = modalScans;
  const recentActivityRangeLabel =
    RECENT_ACTIVITY_RANGE_OPTIONS.find((option) => option.id === recentActivityRange)?.label ??
    'Last 24 hours';
  const recentActivityHref = buildRecentActivityHref(recentActivityRange);
  const coverageTrendChip: TrendChip =
    watchlistCoverage.coverage7d >= 90 && watchlistCoverage.staleItems.length === 0
      ? { label: 'Fresh', tone: 'success' }
      : watchlistCoverage.coverage7d === 0 && watchlistCoverage.enabledCount === 0
        ? { label: 'No schedules', tone: 'neutral' }
        : watchlistCoverage.staleItems.length > 0 || watchlistCoverage.neverScannedCount > 0
          ? { label: 'Needs review', tone: 'warning' }
          : { label: 'Monitoring', tone: 'accent' };
  const coverageTone: PostureTone = !scannerReady
    ? 'warning'
    : coverageTrendChip.tone === 'success'
      ? 'success'
      : coverageTrendChip.tone === 'warning'
        ? 'warning'
        : coverageTrendChip.tone === 'accent'
          ? 'accent'
          : 'neutral';
  const activeScans = (stats.attention_scans ?? []).filter(
    (scan) => scan.status === 'pending' || scan.status === 'running'
  );
  const activeScanIds = new Set(activeScans.map((scan) => scan.id));
  const recentResults = (stats.recent_scans ?? []).filter((scan) => !activeScanIds.has(scan.id));
  const dashboardActivity = stats.activity ?? { images_scanned_today: 0 };
  const policyFailures = stats.policy_failures ?? { today: 0, last_3_days: 0, last_7_days: 0 };
  const gitRepositories = stats.git_repositories ?? {
    total: 0,
    enabled: 0,
    healthy: 0,
    needs_attention: 0,
    in_progress: 0,
  };
  const activityWorkspaceLabel =
    workScope.kind === 'org' ? 'Organization workspace' : 'Personal workspace';
  const policyFailureTone: PostureTone = policyFailures.today > 0 ? 'danger' : 'neutral';
  const gitRepositoryTone: PostureTone =
    gitRepositories.needs_attention > 0
      ? 'danger'
      : gitRepositories.in_progress > 0
        ? 'accent'
        : gitRepositories.enabled > 0
          ? 'success'
          : 'neutral';
  const gitRepositoryDetail =
    gitRepositories.total === 0
      ? 'No repositories configured'
      : [
          `${gitRepositories.healthy} healthy`,
          gitRepositories.needs_attention > 0
            ? `${gitRepositories.needs_attention} need attention`
            : null,
          gitRepositories.in_progress > 0 ? `${gitRepositories.in_progress} in progress` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  function prepareDrilldown(card: DashboardDrilldownKey) {
    if (card === 'watchlist') {
      setWatchlistLoading(true);
      setWatchlistError('');
      return;
    }

    setModalScansLoading(true);
    setModalScansError('');
  }

  function openDrilldown(card: DashboardDrilldownKey) {
    setActiveDrilldown(card);
    prepareDrilldown(card);
    drilldownModal.open();
  }

  function handleRecentActivityRangeChange(range: RecentActivityRange) {
    setRecentActivityRange(range);
    if (activeDrilldown === 'total' || activeDrilldown === 'completed') {
      setModalScansLoading(true);
      setModalScansError('');
    }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Dashboard"
        description="Scan activity and security posture for the current workspace."
        actions={
          <Button
            className="inline-flex items-center gap-2"
            onPress={() => router.push('/scans/new')}
          >
            Start scan
            <ArrowRight01Icon size={15} />
          </Button>
        }
      />

      {!scannerReady ? (
        <StatusAlert
          status="warning"
          title="Scanner health needs attention"
          description={
            scannerHealthError ||
            'One or more local scanner workers are stale or unavailable, so new results may be delayed.'
          }
          action={
            <Button onPress={() => router.push('/admin/scanner')} size="sm" variant="secondary">
              Review scanner
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <BriefingMetric
          label="Images scanned today"
          icon={<PackageIcon size={16} />}
          value={dashboardActivity.images_scanned_today.toLocaleString()}
          detail={`${activityWorkspaceLabel} · finalized image targets`}
          tone={dashboardActivity.images_scanned_today > 0 ? 'accent' : 'neutral'}
          href="/scans"
        />
        <BriefingMetric
          label="Policy failures today"
          icon={<AlertCircleIcon size={16} />}
          value={policyFailures.today.toLocaleString()}
          detail={`${policyFailures.last_3_days} in last 3 days · ${policyFailures.last_7_days} in last 7 days`}
          tone={policyFailureTone}
          href="/scans?status=failed"
        />
        <BriefingMetric
          label="Git repositories"
          icon={<GitBranchIcon size={16} />}
          value={gitRepositories.total.toLocaleString()}
          detail={gitRepositoryDetail}
          tone={gitRepositoryTone}
          href="/git-repositories"
        />
        <BriefingMetric
          label="Historical severe findings"
          icon={<Shield01Icon size={16} />}
          value={formatCompactNumber(criticalHighCount)}
          detail={`${formatCompactNumber(totalVulns)} findings across scan history`}
          tone={criticalHighCount > 0 ? 'danger' : 'neutral'}
          sparkline={{ data: severeFindingsTrend, valueLabel: 'critical and high findings' }}
          href="/scans?critical=yes&sort=risk_desc"
        />
        <BriefingMetric
          label="Watchlist attention"
          icon={<AlertCircleIcon size={16} />}
          value={watchlistAttentionCount.toLocaleString()}
          detail="Current scheduled scans with a policy or scan failure"
          tone={watchlistAttentionCount > 0 ? 'danger' : 'neutral'}
          href="/watchlist?focus=attention"
        />
        <BriefingMetric
          label="Coverage freshness"
          icon={<Clock01Icon size={16} />}
          value={`${watchlistCoverage.coverage7d}%`}
          detail={`${watchlistCoverage.staleItems.length.toLocaleString()} stale · ${watchlistCoverage.neverScannedCount.toLocaleString()} never scanned`}
          tone={coverageTone}
          trend={coverageTrendChip}
          href={
            watchlistCoverage.staleItems.length > 0
              ? '/watchlist?focus=stale'
              : watchlistCoverage.neverScannedCount > 0
                ? '/watchlist?focus=never_scanned'
                : '/watchlist'
          }
        />
      </div>

      <ScanActivityCard activeScans={activeScans} recentResults={recentResults} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.55fr)]">
        <VulnTrendChart
          data={vulnTrends}
          period={vulnTrendPeriod}
          onPeriod={handleVulnPeriodChange}
        />
        <Card className="flex min-h-[240px] flex-col p-5">
          <DashboardSectionHeader
            title="Scan volume"
            icon={<ChartIcon size={16} />}
            description="Secondary throughput view for the last 30 days"
            action={
              <Link
                href="/scans"
                className="text-xs font-medium"
                style={{ color: 'color-mix(in srgb, var(--accent) 78%, white)' }}
              >
                View all →
              </Link>
            }
          />
          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {scanVolumeTrend.reduce((sum, point) => sum + point.value, 0).toLocaleString()}
            </span>{' '}
            total scans over 30 days
          </p>
          {scanVolumeTrend.length >= 2 ? (
            <div className="mt-4 flex-1">
              <MiniSparkline
                data={scanVolumeTrend}
                color="color-mix(in srgb, var(--accent) 78%, white)"
                valueLabel="scans"
              />
            </div>
          ) : (
            <div
              className="flex flex-1 items-center justify-center py-8 text-sm"
              style={{ color: 'var(--text-faint)' }}
            >
              No trend data yet
            </div>
          )}
        </Card>
      </div>

      <DashboardDrilldownModal
        state={drilldownModal}
        activeCard={activeDrilldown}
        totalScans={stats.total_scans}
        completedCount={completedCount}
        watchlistCount={stats.watchlist_count}
        recentActivityRange={recentActivityRange}
        onRecentActivityRangeChange={handleRecentActivityRangeChange}
        recentActivityRangeLabel={recentActivityRangeLabel}
        scans={displayedModalScans}
        scansLoading={modalScansLoading}
        scansError={modalScansError}
        watchlistItems={watchlistItems}
        watchlistLoading={watchlistLoading}
        watchlistError={watchlistError}
        recentActivityHref={recentActivityHref}
      />
    </div>
  );
}
