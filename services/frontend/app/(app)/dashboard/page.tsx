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
  Bar as EvilBar,
  EvilBarChart,
  Grid as EvilBarGrid,
  Tooltip as EvilBarTooltip,
  XAxis as EvilBarXAxis,
  YAxis as EvilBarYAxis,
} from '@/components/evilcharts/charts/bar-chart';
import {
  buildRecentActivityHref,
  getRecentActivityBounds,
  RECENT_ACTIVITY_RANGE_OPTIONS,
  RecentActivityRange,
} from '@/components/scans/recent-activity';
import {
  CHART_TONES,
  formatChartDate as formatChartDateShared,
  singleSeriesConfig,
  typedChartConfigFromSeries,
} from '@/components/ui/chart-adapter';
import { StatusAlert } from '@/components/ui/form-alert';
import { PageHeader } from '@/components/ui/page-header';
import { DashboardLoadingSkeleton } from '@/components/ui/skeleton';
import { SurfaceIcon } from '@/components/ui/surface-icon';
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
import { getWatchlistPolicyAttentionItems } from '@/lib/watchlist-posture';
import { Button, Card, Chip, ProgressBar, Separator, useOverlayState } from '@heroui/react';
import {
  ArrowRight01Icon,
  ChartIcon,
  GitBranchIcon,
  PackageIcon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

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

const SCAN_OUTCOME_SERIES = [
  { key: 'completed', label: 'Succeeded', color: CHART_TONES.success.dark, status: 'completed' },
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
] as const;

const SCAN_OUTCOME_CONFIG = typedChartConfigFromSeries(SCAN_OUTCOME_SERIES);
const SCAN_OUTCOME_RANGE_DAYS: Record<RecentActivityRange, number> = {
  '6h': 1,
  '24h': 1,
  '7d': 7,
  '30d': 30,
};

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

function ScanOutcomeChart({
  data,
  range,
  loading,
  onRangeChange,
  onDayPress,
  onStatusPress,
}: {
  data: DashboardTrendPoint[];
  range: RecentActivityRange;
  loading: boolean;
  onRangeChange: (range: RecentActivityRange) => void;
  onDayPress: (date: string) => void;
  onStatusPress: (status: string) => void;
}) {
  const filledData = fillScanOutcomeDates(data, range);
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

  return (
    <Card className="p-5">
      <Card.Header className="!flex !flex-row !flex-nowrap items-start justify-between gap-4 p-0">
        <div className="min-w-0">
          <Card.Title>Scan outcomes</Card.Title>
          <Card.Description>
            Every scan run in the selected period, grouped by its current outcome.
          </Card.Description>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-surface-secondary p-1">
          {RECENT_ACTIVITY_RANGE_OPTIONS.map((option) => (
            <Button
              key={option.id}
              aria-pressed={range === option.id}
              onPress={() => onRangeChange(option.id)}
              size="sm"
              variant={range === option.id ? 'secondary' : 'ghost'}
            >
              {option.shortLabel}
            </Button>
          ))}
        </div>
      </Card.Header>

      <Card.Content className="p-0 pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-muted">
            <span className="font-semibold tabular-nums text-foreground">
              {totalScans.toLocaleString()}
            </span>{' '}
            total scans
          </p>
          <Link
            href={`/scans?range=${range}`}
            className="text-xs font-medium text-accent hover:text-accent/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            View all scans →
          </Link>
        </div>

        {loading ? (
          <div className="mt-5 flex h-[280px] items-center justify-center text-sm text-muted">
            Updating scan outcomes…
          </div>
        ) : (
          <div className="mt-5 h-[280px] w-full overflow-hidden rounded-xl bg-surface-secondary p-2">
            <EvilBarChart
              data={chartData}
              config={SCAN_OUTCOME_CONFIG}
              stackType="stacked"
              className="h-full !aspect-auto"
              barCategoryGap={8}
              chartProps={{
                margin: { top: 12, right: 8, left: -18, bottom: 0 },
                onClick: ({ activeLabel }) => {
                  const day = typeof activeLabel === 'string' ? activeLabel : null;
                  if (day && filledData.some((point) => point.date === day && point.total > 0)) {
                    onDayPress(day);
                  }
                },
              }}
            >
              <EvilBarGrid stroke="rgba(161,161,170,0.15)" vertical={false} />
              <EvilBarXAxis
                dataKey="date"
                minTickGap={30}
                tickFormatter={(value: string) => formatChartDate(value)}
              />
              <EvilBarYAxis allowDecimals={false} width={28} />
              <EvilBarTooltip variant="frosted-glass" roundness="lg" />
              {SCAN_OUTCOME_SERIES.map((series) => (
                <EvilBar key={series.key} bufferBar dataKey={series.key} variant="gradient" />
              ))}
            </EvilBarChart>
          </div>
        )}

        <div className="mt-4 flex min-w-0 gap-1 overflow-x-auto pb-1">
          {totals.map((series) => (
            <Button
              key={series.key}
              aria-label={`View ${series.label.toLowerCase()} scans from the selected period`}
              className="h-8 shrink-0 justify-between gap-2 px-2.5 text-left"
              onPress={() => onStatusPress(series.status)}
              size="sm"
              variant="ghost"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: series.color }}
                />
                <span className="truncate">{series.label}</span>
              </span>
              <span className="tabular-nums text-muted">{series.total.toLocaleString()}</span>
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          Select an outcome to open the matching scans for this time range.
        </p>
      </Card.Content>
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

function fillScanOutcomeDates(
  data: DashboardTrendPoint[],
  range: RecentActivityRange
): DashboardTrendPoint[] {
  const pointsByDate = new Map(data.map((point) => [point.date, point]));
  const days = SCAN_OUTCOME_RANGE_DAYS[range];
  const today = new Date();

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    const key = date.toISOString().slice(0, 10);
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
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-surface-secondary p-1">
          {VULNERABILITY_TREND_PERIODS.map((d) => (
            <Button
              key={d}
              aria-pressed={period === d}
              aria-label={`Show last ${d} days`}
              onPress={() => onPeriod(d)}
              size="sm"
              variant={period === d ? 'secondary' : 'ghost'}
            >
              {d}d
            </Button>
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
  const [chartRefreshKey, setChartRefreshKey] = useState(0);
  const [vulnTrendPeriod, setVulnTrendPeriod] = useState(30);
  const [scanOutcomeRange, setScanOutcomeRange] = useState<RecentActivityRange>('30d');
  const [scanOutcomeLoading, setScanOutcomeLoading] = useState(false);
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

  const severeFindingsTrend = useMemo(
    () =>
      buildVulnerabilityTrendSeries(
        vulnTrends,
        vulnTrendPeriod,
        (point) => point.critical + point.high
      ),
    [vulnTrendPeriod, vulnTrends]
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
      getDashboardTrends(scanOutcomeRange).catch(() => [] as DashboardTrendPoint[]),
      getDashboardVulnTrends(vulnTrendPeriod).catch(() => [] as DashboardVulnTrendPoint[]),
      healthPromise,
    ])
      .then(([s, t, vt, healthResult]) => {
        setStats(s);
        setTrends(t);
        setVulnTrends(vt);
        setScannerHealth(healthResult.health);
        setScannerHealthError(healthResult.error);
        setChartRefreshKey((current) => current + 1);
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

  function handleScanOutcomeRangeChange(range: RecentActivityRange) {
    if (range === scanOutcomeRange) return;
    setScanOutcomeRange(range);
    setScanOutcomeLoading(true);
    getDashboardTrends(range)
      .then(setTrends)
      .catch(() => setTrends([]))
      .finally(() => setScanOutcomeLoading(false));
  }

  function openScanOutcomeStatus(status: string) {
    const params = new URLSearchParams({ range: scanOutcomeRange, status });
    router.push(`/scans?${params.toString()}`);
  }

  function openScanOutcomeDay(date: string) {
    router.push(`/scans?date=${encodeURIComponent(date)}`);
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
  const coverageTone: PostureTone = !scannerReady
    ? 'warning'
    : watchlistCoverage.coverage7d >= 90 && watchlistCoverage.staleItems.length === 0
      ? 'success'
      : watchlistCoverage.staleItems.length > 0 || watchlistCoverage.neverScannedCount > 0
        ? 'warning'
        : watchlistCoverage.enabledCount === 0
          ? 'neutral'
          : 'accent';
  const dashboardActivity = stats.activity ?? { images_scanned_today: 0 };
  const policyFailures = stats.policy_failures ?? { today: 0, last_3_days: 0, last_7_days: 0 };
  const gitRepositories = stats.git_repositories ?? {
    total: 0,
    enabled: 0,
    healthy: 0,
    needs_attention: 0,
    in_progress: 0,
  };
  const operations = stats.operations ?? {
    blocked_policy_count: 0,
    xray_blocked_count: 0,
    org_policy_fail_count: 0,
    active_xray_count: 0,
    active_xray_step_counts: {},
    active_xray_scans: [],
  };
  const activePolicySignals =
    operations.blocked_policy_count +
    operations.xray_blocked_count +
    operations.org_policy_fail_count;
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
    <div className="space-y-6 p-6">
      <PageHeader
        title="Security posture"
        description="Vulnerability exposure, organizational policy signals, and scan coverage for the current workspace."
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

      <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.58fr)]">
        <Card className="overflow-hidden p-0" variant="tertiary">
          <Card.Content className="grid min-h-[308px] p-0 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
            <div className="flex flex-col justify-between p-6 sm:p-7">
              <div>
                <Chip color={criticalHighCount > 0 ? 'warning' : 'success'} variant="soft">
                  Organization policy context
                </Chip>
                <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-[1.1] tracking-[-0.035em] text-foreground sm:text-4xl">
                  {criticalHighCount > 0
                    ? `${formatCompactNumber(criticalHighCount)} severe findings need context.`
                    : 'No severe findings are recorded in this workspace history.'}
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
                  Review vulnerability exposure alongside the organizational policies that apply to
                  this workspace—such as configured severity or CVSS thresholds. Policy results
                  provide evidence; they do not decide release readiness.
                </p>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3 text-sm">
                <span className="text-muted">
                  <strong className="font-semibold text-danger">
                    {(stats.severity_totals.critical ?? 0).toLocaleString()}
                  </strong>{' '}
                  critical
                </span>
                <span className="text-muted">
                  <strong className="font-semibold text-warning">
                    {(stats.severity_totals.high ?? 0).toLocaleString()}
                  </strong>{' '}
                  high
                </span>
                <span className="text-muted">
                  <strong className="font-semibold text-foreground">
                    {formatCompactNumber(totalVulns)}
                  </strong>{' '}
                  findings
                </span>
                <Link
                  className="font-medium text-accent hover:text-accent/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  href="/scans?critical=yes&sort=risk_desc"
                >
                  Explore findings →
                </Link>
              </div>
            </div>

            <div className="flex min-h-[230px] flex-col justify-between border-t border-divider bg-surface-secondary p-6 lg:border-t-0 lg:border-l">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                    Severe finding trend
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                    {formatCompactNumber(criticalHighCount)}
                  </p>
                  <p className="mt-1 text-xs text-muted">Critical and high in scan history</p>
                </div>
                <div className="flex rounded-xl bg-surface p-1">
                  {[7, 14, 30].map((days) => (
                    <Button
                      key={days}
                      onPress={() => handleVulnPeriodChange(days)}
                      size="sm"
                      variant={vulnTrendPeriod === days ? 'secondary' : 'ghost'}
                    >
                      {days}d
                    </Button>
                  ))}
                </div>
              </div>
              {severeFindingsTrend.length >= 2 ? (
                <div className="mt-5 h-28">
                  <MiniSparkline
                    key={`severe-findings-${chartRefreshKey}`}
                    data={severeFindingsTrend}
                    color="var(--success)"
                    showArea={false}
                    valueLabel="critical and high findings"
                  />
                </div>
              ) : (
                <p className="py-8 text-sm text-muted">
                  No trend data is available for this period.
                </p>
              )}
              <p className="mt-3 text-xs text-muted">Historical average per finalized scan</p>
            </div>
          </Card.Content>
        </Card>

        <Card className="flex min-h-[308px] flex-col p-6">
          <Card.Header className="p-0">
            <div className="flex items-center justify-between gap-4">
              <Chip
                color={policyFailures.today > 0 || activePolicySignals > 0 ? 'warning' : 'success'}
                variant="soft"
              >
                Policy signals
              </Chip>
              <span className="text-xs tabular-nums text-muted">Today</span>
            </div>
            <Card.Title className="mt-4">What merits review</Card.Title>
            <Card.Description>
              Signals from organization and scanner policy evaluation
            </Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-1 flex-col justify-center gap-5 p-0 py-6">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-xs font-semibold text-warning">
                1
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {policyFailures.today.toLocaleString()} policy failures today
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {policyFailures.last_7_days.toLocaleString()} recorded in the last 7 days across
                  the current workspace.
                </p>
              </div>
            </div>
            <Separator variant="tertiary" />
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-xs font-semibold text-danger">
                2
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {activePolicySignals.toLocaleString()} active policy signals
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {operations.org_policy_fail_count.toLocaleString()} organization policy ·{' '}
                  {operations.xray_blocked_count.toLocaleString()} Xray policy ·{' '}
                  {operations.blocked_policy_count.toLocaleString()} blocked policy
                </p>
              </div>
            </div>
            <Separator variant="tertiary" />
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-xs font-semibold text-accent">
                3
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {watchlistAttentionCount.toLocaleString()} watchlist items need attention
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Scheduled scans with a policy outcome or scan issue stay visible here.
                </p>
              </div>
            </div>
          </Card.Content>
          <Card.Footer className="flex-col items-stretch gap-2 p-0">
            <Button onPress={() => openDrilldown('total')} variant="secondary">
              Review scan outcomes
              <ArrowRight01Icon size={15} />
            </Button>
            <Button onPress={() => openDrilldown('watchlist')} variant="ghost">
              Open watchlist attention
            </Button>
          </Card.Footer>
        </Card>
      </section>

      <section aria-labelledby="posture-facts-heading">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Evidence snapshot
          </p>
          <h2 id="posture-facts-heading" className="mt-1 text-lg font-semibold text-foreground">
            The facts behind the posture
          </h2>
          <p className="mt-1 text-sm text-muted">
            Scan outcomes and coverage evidence for the selected workspace.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.52fr)]">
          <ScanOutcomeChart
            key={`scan-outcomes-${chartRefreshKey}`}
            data={trends}
            range={scanOutcomeRange}
            loading={scanOutcomeLoading}
            onRangeChange={handleScanOutcomeRangeChange}
            onDayPress={openScanOutcomeDay}
            onStatusPress={openScanOutcomeStatus}
          />

          <Card className="p-6">
            <Card.Header className="p-0">
              <Card.Title>Coverage and confidence</Card.Title>
              <Card.Description>
                How much of the monitored estate has fresh evidence
              </Card.Description>
            </Card.Header>
            <Card.Content className="mt-6 space-y-6 p-0">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                    {watchlistCoverage.coverage7d}%
                  </p>
                  <p className="mt-1 text-[11px] text-muted">fresh in 7 days</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight text-warning">
                    {watchlistCoverage.staleItems.length}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">overdue</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight text-accent">
                    {dashboardActivity.images_scanned_today}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">scanned today</p>
                </div>
              </div>
              <ProgressBar
                aria-label="Fresh scan coverage"
                color={
                  coverageTone === 'success'
                    ? 'success'
                    : coverageTone === 'warning'
                      ? 'warning'
                      : 'accent'
                }
                value={watchlistCoverage.coverage7d}
              >
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
              <Separator variant="tertiary" />
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-muted">
                    <GitBranchIcon size={16} /> Git repositories
                  </span>
                  <span
                    className={
                      gitRepositoryTone === 'success'
                        ? 'text-success'
                        : gitRepositoryTone === 'danger'
                          ? 'text-danger'
                          : 'text-foreground'
                    }
                  >
                    {gitRepositoryDetail}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-muted">
                    <ChartIcon size={16} /> Active Xray scans
                  </span>
                  <span className="tabular-nums text-foreground">
                    {operations.active_xray_count}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-muted">
                    <PackageIcon size={16} /> Scheduled items
                  </span>
                  <span className="tabular-nums text-foreground">
                    {watchlistCoverage.enabledCount}
                  </span>
                </div>
              </div>
            </Card.Content>
            <Card.Footer className="px-0 pt-6">
              <Link
                className="text-xs font-medium text-accent hover:text-accent/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                href="/watchlist"
              >
                Manage coverage →
              </Link>
            </Card.Footer>
          </Card>
        </div>
      </section>

      <VulnTrendChart
        key={`vulnerability-trend-${chartRefreshKey}`}
        data={vulnTrends}
        period={vulnTrendPeriod}
        onPeriod={handleVulnPeriodChange}
      />

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
