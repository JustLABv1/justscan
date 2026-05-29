'use client';
import SplitText from '@/components/SplitText';
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
} from '@/components/scans/recent-activity';
import {
  formatChartDate as formatChartDateShared,
  singleSeriesConfig,
  typedChartConfigFromSeries,
} from '@/components/ui/chart-adapter';
import { PageHeader } from '@/components/ui/page-header';
import { ChartSkeleton, RecentScanRowSkeleton } from '@/components/ui/skeleton';
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
import { Button, Card, useOverlayState } from '@heroui/react';
import { Add01Icon, ArrowRight01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

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

function buildTriageHref(filters?: {
  kind?: 'scan' | 'policy' | 'fix' | 'watchlist';
  priority?: 'critical' | 'high' | 'medium';
  query?: string;
}): string {
  const params = new URLSearchParams();
  if (filters?.kind) params.set('kind', filters.kind);
  if (filters?.priority) params.set('priority', filters.priority);
  if (filters?.query) params.set('q', filters.query);
  const query = params.toString();
  return query ? `/triage?${query}` : '/triage';
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

type PostureSummary = {
  label: string;
  title: string;
  description: string;
  tone: PostureTone;
};

type WatchlistCoverage = {
  enabledCount: number;
  scanned24hCount: number;
  scanned7dCount: number;
  staleItems: WatchlistItem[];
  neverScannedCount: number;
  coverage7d: number;
  topSchedule: [string, number] | null;
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

function getWatchlistCoverage(
  items: WatchlistItem[],
  activeWatchlistCount: number
): WatchlistCoverage {
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
      activeWatchlistCount > 0 ? Math.round((scanned7dCount / activeWatchlistCount) * 100) : 0,
    topSchedule,
  };
}

function getCriticalHighTrend(data: DashboardVulnTrendPoint[]): number {
  let previous: { date: string; value: number } | null = null;
  let latest: { date: string; value: number } | null = null;

  for (const point of data) {
    const value = point.critical + point.high;
    if (value <= 0) continue;

    if (!latest || point.date > latest.date) {
      previous = latest;
      latest = { date: point.date, value };
    } else if (!previous || point.date > previous.date) {
      previous = { date: point.date, value };
    }
  }

  return latest && previous ? latest.value - previous.value : 0;
}

function getRiskSummary({
  criticalHighCount,
  needsAttentionTotal,
  blockedPolicyCount,
  criticalHighTrend,
}: {
  criticalHighCount: number;
  needsAttentionTotal: number;
  blockedPolicyCount: number;
  criticalHighTrend: number;
}): PostureSummary {
  if (criticalHighCount === 0 && needsAttentionTotal === 0) {
    return {
      label: 'Low risk',
      title: 'No critical or high exposure is visible',
      description: 'Current finalized scan data is not showing urgent vulnerability exposure.',
      tone: 'success',
    };
  }

  if (blockedPolicyCount > 0 || criticalHighCount >= 1000 || criticalHighTrend > 0) {
    return {
      label: 'Elevated risk',
      title: 'Critical/high exposure needs review',
      description:
        blockedPolicyCount > 0
          ? 'Policy-blocked scans and severe findings should be reviewed first.'
          : 'Severe findings are present and the latest risk signal is moving up.',
      tone: 'danger',
    };
  }

  return {
    label: 'Managed risk',
    title: 'Severe findings exist but are not accelerating',
    description: 'Keep an eye on critical and high findings while current coverage remains active.',
    tone: 'warning',
  };
}

function getReadinessSummary({
  coverage7d,
  successRate,
  activeQueueCount,
  scannerHealth,
  scannerHealthError,
  staleCount,
}: {
  coverage7d: number;
  successRate: number;
  activeQueueCount: number;
  scannerHealth: ScannerHealth | null;
  scannerHealthError: string;
  staleCount: number;
}): PostureSummary {
  const scannerDegraded =
    Boolean(scannerHealthError) ||
    Boolean(scannerHealth?.local_scanner_enabled && scannerHealth.stale_workers > 0) ||
    Boolean(scannerHealth?.local_scanner_enabled && scannerHealth.error_workers > 0);

  if (scannerDegraded || staleCount > 0 || successRate < 70) {
    return {
      label: 'Readiness degraded',
      title: 'Coverage confidence needs attention',
      description:
        'Stale schedules, scanner health, or scan failures may reduce trust in coverage.',
      tone: 'warning',
    };
  }

  if (coverage7d >= 90 && successRate >= 85 && activeQueueCount === 0) {
    return {
      label: 'Ready',
      title: 'Coverage is current and stable',
      description: 'Watchlist scans are fresh and the scanner queue is clear.',
      tone: 'success',
    };
  }

  return {
    label: 'Monitoring',
    title: 'Coverage is active with some movement',
    description: 'Scanning is running, but the readiness signal is not fully settled yet.',
    tone: 'accent',
  };
}

function PosturePill({ summary }: { summary: PostureSummary }) {
  const tone = TONE_STYLES[summary.tone];

  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: tone.bg, borderColor: tone.border, color: tone.color }}
    >
      {summary.label}
    </span>
  );
}

function BriefingMetric({
  label,
  value,
  detail,
  tone = 'neutral',
  href,
  onPress,
  className,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  tone?: PostureTone;
  href?: string;
  onPress?: () => void;
  className?: string;
}) {
  const toneStyle = TONE_STYLES[tone];
  const content = (
    <Card className={`${className ?? ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase">{label}</p>
          <p
            className="mt-0.5 text-lg font-semibold tabular-nums"
            style={{ color: toneStyle.color }}
          >
            {value}
          </p>
        </div>
        <span
          className="mt-1.5 size-1.5 rounded-full"
          style={{ background: toneStyle.color, opacity: 0.9 }}
        />
      </div>
      <p className="text-[11px] leading-4 text-muted">{detail}</p>
    </Card>
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

function ExecutivePostureCard({
  risk,
  readiness,
  criticalHighCount,
  totalVulns,
  needsAttentionTotal,
  watchlistPolicyAttentionCount,
  coverage7d,
  successRate,
  triageDefaultHref,
  triageCriticalHighHref,
  triageAttentionHref,
  onOpenWatchlist,
  onOpenCompleted,
}: {
  risk: PostureSummary;
  readiness: PostureSummary;
  criticalHighCount: number;
  totalVulns: number;
  needsAttentionTotal: number;
  watchlistPolicyAttentionCount: number;
  coverage7d: number;
  successRate: number;
  triageDefaultHref: string;
  triageCriticalHighHref: string;
  triageAttentionHref: string;
  onOpenWatchlist: () => void;
  onOpenCompleted: () => void;
}) {
  const riskTone = TONE_STYLES[risk.tone];
  const readinessTone = TONE_STYLES[readiness.tone];

  return (
    <section className="space-y-3 rounded-2xl p-1">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <BriefingMetric
          label="Critical + high"
          value={formatCompactNumber(criticalHighCount)}
          detail={`${formatCompactNumber(totalVulns)} total findings`}
          tone={risk.tone}
          href={triageCriticalHighHref}
        />
        <BriefingMetric
          label="Attention"
          value={needsAttentionTotal.toLocaleString()}
          detail="failed or policy-blocked scans"
          tone={needsAttentionTotal > 0 ? 'danger' : 'success'}
          href={triageAttentionHref}
        />
        <BriefingMetric
          label="Watched policy"
          value={watchlistPolicyAttentionCount.toLocaleString()}
          detail="images non-compliant"
          tone={watchlistPolicyAttentionCount > 0 ? 'danger' : 'success'}
          onPress={onOpenWatchlist}
        />
        <BriefingMetric
          label="Freshness"
          value={`${coverage7d}%`}
          detail="watchlist scanned in 7 days"
          tone={coverage7d >= 90 ? 'success' : 'warning'}
          onPress={onOpenWatchlist}
        />
        <BriefingMetric
          label="Success"
          value={`${successRate}%`}
          detail="completed scans overall"
          tone={successRate >= 85 ? 'success' : 'warning'}
          onPress={onOpenCompleted}
        />
      </div>
    </section>
  );
}
function DashboardSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>
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

function AttentionQueueCard({
  genericFailedCount,
  blockedPolicyCount,
  watchlistPolicyAttentionCount,
  activeQueueCount,
  staleItems,
  triageDefaultHref,
  triageWatchlistPolicyHref,
  triageWatchlistStaleHref,
  triagePolicyHref,
  triageFailedHref,
  triageRunningHref,
}: {
  genericFailedCount: number;
  blockedPolicyCount: number;
  watchlistPolicyAttentionCount: number;
  activeQueueCount: number;
  staleItems: WatchlistItem[];
  triageDefaultHref: string;
  triageWatchlistPolicyHref: string;
  triageWatchlistStaleHref: string;
  triagePolicyHref: string;
  triageFailedHref: string;
  triageRunningHref: string;
}) {
  const items = [
    {
      key: 'watchlist-policy',
      label: 'Watched policy issues',
      value: watchlistPolicyAttentionCount,
      detail: 'Watched images blocked or failing org policy',
      tone: 'danger' as const,
      href: triageWatchlistPolicyHref,
    },
    {
      key: 'blocked',
      label: 'Policy blocks',
      value: blockedPolicyCount,
      detail: 'Xray policy decisions awaiting review',
      tone: 'danger' as const,
      href: triagePolicyHref,
    },
    {
      key: 'failed',
      label: 'Failed scans',
      value: genericFailedCount,
      detail: 'Scans that did not complete cleanly',
      tone: 'danger' as const,
      href: triageFailedHref,
    },
    {
      key: 'stale',
      label: 'Stale watchlist',
      value: staleItems.length,
      detail: 'Scheduled images not scanned in 7 days',
      tone: 'warning' as const,
      href: triageWatchlistStaleHref,
    },
    {
      key: 'running',
      label: 'In flight',
      value: activeQueueCount,
      detail: 'Queued or running scan work',
      tone: 'accent' as const,
      href: triageRunningHref,
    },
  ].filter((item) => item.value > 0);

  return (
    <Card>
      <DashboardSectionHeader
        title="Needs attention"
        description="Open the triage queue for the next best action"
        action={
          <Link href={triageDefaultHref}>
            <Button variant="secondary">
              Open triage
              <ArrowRight01Icon />
            </Button>
          </Link>
        }
      />

      {items.length === 0 ? (
        <div
          className="mt-4 rounded-2xl border px-4 py-5"
          style={{
            background: TONE_STYLES.success.softBg,
            borderColor: TONE_STYLES.success.border,
          }}
        >
          <p className="text-sm font-medium" style={{ color: '#34d399' }}>
            No urgent scan or coverage items right now.
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
            Failed scans, policy blocks, and stale schedules will surface here.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((item) => {
            const tone = TONE_STYLES[item.tone];
            return (
              <Link
                key={item.key}
                href={item.href}
                className="group flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/70"
                style={{ background: tone.softBg, borderColor: tone.border }}
              >
                <span>
                  <span
                    className="block text-sm font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-faint)' }}>
                    {item.detail}
                  </span>
                </span>
                <span
                  className="text-base font-semibold tabular-nums"
                  style={{ color: tone.color }}
                >
                  {item.value.toLocaleString()}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ReadinessPanel({
  coverage,
  watchlistPolicyAttentionCount,
  activeQueueCount,
  startedTodayCount,
  scannerHealth,
  scannerHealthError,
  isAdmin,
  watchlistLoading,
  watchlistError,
}: {
  coverage: WatchlistCoverage;
  watchlistPolicyAttentionCount: number;
  activeQueueCount: number;
  startedTodayCount: number;
  scannerHealth: ScannerHealth | null;
  scannerHealthError: string;
  isAdmin: boolean;
  watchlistLoading: boolean;
  watchlistError: string;
}) {
  const scannerReady =
    !isAdmin ||
    (!scannerHealthError &&
      (!scannerHealth?.local_scanner_enabled ||
        (scannerHealth.healthy_workers > 0 &&
          scannerHealth.stale_workers === 0 &&
          scannerHealth.error_workers === 0)));

  return (
    <Card className="p-4">
      <DashboardSectionHeader
        title="Readiness confidence"
        description="Signals that determine how much trust to place in current coverage"
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card variant="secondary">
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Watchlist freshness
          </p>
          <p
            className="mt-2 text-2xl font-semibold tabular-nums"
            style={{ color: coverage.coverage7d >= 90 ? '#34d399' : '#fbbf24' }}
          >
            {coverage.coverage7d}%
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {watchlistLoading
              ? 'Refreshing watchlist coverage'
              : watchlistError
                ? watchlistError
                : `${coverage.scanned7dCount} of ${coverage.enabledCount || 0} active schedules scanned in 7d`}
          </p>
        </Card>
        <Card variant="secondary">
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Watchlist posture
          </p>
          <p
            className="mt-2 text-2xl font-semibold tabular-nums"
            style={{ color: watchlistPolicyAttentionCount > 0 ? '#f87171' : '#34d399' }}
          >
            {watchlistPolicyAttentionCount.toLocaleString()}
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            watched images failing policy checks
          </p>
        </Card>
        <Card variant="secondary">
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Scanner state
          </p>
          <p
            className="mt-2 text-lg font-semibold"
            style={{ color: scannerReady ? '#34d399' : '#fbbf24' }}
          >
            {scannerReady ? 'Healthy' : 'Needs review'}
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {scannerHealthError ||
              scannerHealth?.message ||
              (scannerHealth?.local_scanner_enabled
                ? `${scannerHealth.healthy_workers} healthy workers`
                : 'External scanner coverage')}
          </p>
        </Card>
        <Card variant="secondary">
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            In-flight work
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums" style={{ color: '#60a5fa' }}>
            {activeQueueCount.toLocaleString()}
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            queued or running scans
          </p>
        </Card>
        <Card variant="secondary">
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Started today
          </p>
          <p
            className="mt-2 text-2xl font-semibold tabular-nums"
            style={{ color: 'var(--text-primary)' }}
          >
            {startedTodayCount.toLocaleString()}
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {coverage.neverScannedCount > 0
              ? `${coverage.neverScannedCount} watchlist items never scanned`
              : coverage.topSchedule
                ? `Common schedule ${coverage.topSchedule[0]}`
                : 'recent scan volume signal'}
          </p>
        </Card>
      </div>
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
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Risk trend</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Average findings per finalized scan, by severity
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
  const [watchlistOverviewLoading, setWatchlistOverviewLoading] = useState(true);
  const [watchlistOverviewError, setWatchlistOverviewError] = useState('');
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState('');
  const currentUser = getUser() as { role?: string } | null;
  const isAdmin = currentUser?.role === 'admin' || getTokenType() === 'admin';

  const scanVolumeTrend = useMemo(
    () => buildTrendSeries(trends, 30, (point) => point.total),
    [trends]
  );

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
      setWatchlistOverviewLoading(true);
      setWatchlistOverviewError('');
      listWatchlist()
        .then((items) => setWatchlistOverviewItems(items))
        .catch((watchlistLoadError: Error) => {
          setWatchlistOverviewItems([]);
          setWatchlistOverviewError(watchlistLoadError.message);
        })
        .finally(() => setWatchlistOverviewLoading(false));
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

  if (loading)
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="skeleton h-7 w-32 rounded-lg" />
            <div className="skeleton h-3.5 w-48 rounded" />
          </div>
          <div className="skeleton h-9 w-28 rounded-xl" />
        </div>
        <div className="skeleton h-20 w-full rounded-xl" />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
          <div
            className="rounded-2xl p-5"
            style={{ background: 'var(--surface-bg)', border: '1px solid var(--surface-border)' }}
          >
            <div className="skeleton h-4 w-32 rounded mb-4" />
            {Array.from({ length: 5 }).map((_, i) => (
              <RecentScanRowSkeleton key={i} />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <div className="skeleton h-44 w-full rounded-2xl" />
            <div className="skeleton h-28 w-full rounded-2xl" />
          </div>
        </div>
        <ChartSkeleton />
      </div>
    );

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
  const todayKey = new Date().toISOString().slice(0, 10);
  const startedTodayCount =
    [...trends].reverse().find((point) => point.date === todayKey)?.total ?? 0;
  const failedStatusCount = stats.status_counts['failed'] ?? 0;
  const activeQueueCount =
    (stats.status_counts['running'] ?? 0) + (stats.status_counts['pending'] ?? 0);
  const blockedPolicyCount =
    stats.operations?.blocked_policy_count ?? stats.status_counts['blocked_by_xray_policy'] ?? 0;
  const genericFailedCount = Math.max(0, failedStatusCount - blockedPolicyCount);
  const activeXrayCount = stats.operations?.active_xray_count ?? 0;
  const completedCount = stats.status_counts['completed'] ?? 0;
  const needsAttentionTotal = genericFailedCount + blockedPolicyCount;
  const successRate =
    stats.total_scans > 0 ? Math.round((completedCount / stats.total_scans) * 100) : 0;
  const watchlistCoverage = getWatchlistCoverage(watchlistOverviewItems, stats.watchlist_count);
  const watchlistPolicyAttentionItems = getWatchlistPolicyAttentionItems(watchlistOverviewItems);
  const watchlistPolicyAttentionCount = watchlistPolicyAttentionItems.length;
  const criticalHighTrend = getCriticalHighTrend(vulnTrends);
  const riskSummary = getRiskSummary({
    criticalHighCount,
    needsAttentionTotal,
    blockedPolicyCount,
    criticalHighTrend,
  });
  const readinessSummary = getReadinessSummary({
    coverage7d: watchlistCoverage.coverage7d,
    successRate,
    activeQueueCount,
    scannerHealth,
    scannerHealthError,
    staleCount: watchlistCoverage.staleItems.length,
  });
  const triageDefaultHref = buildTriageHref();
  const triageWatchlistPolicyHref = buildTriageHref({ kind: 'watchlist', priority: 'high', query: 'policy' });
  const triageWatchlistStaleHref = buildTriageHref({ kind: 'watchlist', priority: 'medium', query: 'stale' });
  const triagePolicyHref = buildTriageHref({ kind: 'policy', priority: 'critical', query: 'xray blocked' });
  const triageFailedHref = buildTriageHref({ kind: 'scan', query: 'failed' });
  const triageRunningHref = buildTriageHref({ kind: 'scan', priority: 'medium', query: 'in flight' });
  const triageCriticalHighHref = buildTriageHref({ kind: 'fix', priority: 'high' });
  const triageAttentionHref = buildTriageHref({ query: 'failed' });
  const displayedModalScans = modalScans;
  const recentActivityRangeLabel =
    RECENT_ACTIVITY_RANGE_OPTIONS.find((option) => option.id === recentActivityRange)?.label ??
    'Last 24 hours';
  const recentActivityHref = buildRecentActivityHref(recentActivityRange);

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
        title={`Welcome back, `}
        titleCom={
          <SplitText
            text={getUser()?.username ? getUser()?.username : 'User'}
            delay={50}
            duration={1.25}
            ease="power3.out"
            splitType="chars"
            from={{ opacity: 0, y: 40 }}
            to={{ opacity: 1, y: 0 }}
            threshold={0.1}
            rootMargin="-100px"
            textAlign="center"
            onLetterAnimationComplete={false}
          />
        }
        description={new Date().toLocaleDateString('en', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
        actions={
          <Link href="/scans">
            <Button>
              <Add01Icon size={14} />
              New Scan
            </Button>
          </Link>
        }
      />

      <ExecutivePostureCard
        risk={riskSummary}
        readiness={readinessSummary}
        criticalHighCount={criticalHighCount}
        totalVulns={totalVulns}
        needsAttentionTotal={needsAttentionTotal}
        watchlistPolicyAttentionCount={watchlistPolicyAttentionCount}
        coverage7d={watchlistCoverage.coverage7d}
        successRate={successRate}
        triageDefaultHref={triageDefaultHref}
        triageCriticalHighHref={triageCriticalHighHref}
        triageAttentionHref={triageAttentionHref}
        onOpenWatchlist={() => openDrilldown('watchlist')}
        onOpenCompleted={() => openDrilldown('completed')}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <VulnTrendChart
          data={vulnTrends}
          period={vulnTrendPeriod}
          onPeriod={handleVulnPeriodChange}
        />
        <AttentionQueueCard
          genericFailedCount={genericFailedCount}
          blockedPolicyCount={blockedPolicyCount}
          watchlistPolicyAttentionCount={watchlistPolicyAttentionCount}
          activeQueueCount={activeQueueCount}
          staleItems={watchlistCoverage.staleItems}
          triageDefaultHref={triageDefaultHref}
          triageWatchlistPolicyHref={triageWatchlistPolicyHref}
          triageWatchlistStaleHref={triageWatchlistStaleHref}
          triagePolicyHref={triagePolicyHref}
          triageFailedHref={triageFailedHref}
          triageRunningHref={triageRunningHref}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.45fr)]">
        <ReadinessPanel
          coverage={watchlistCoverage}
          watchlistPolicyAttentionCount={watchlistPolicyAttentionCount}
          activeQueueCount={activeQueueCount}
          startedTodayCount={startedTodayCount}
          scannerHealth={scannerHealth}
          scannerHealthError={scannerHealthError}
          isAdmin={isAdmin}
          watchlistLoading={watchlistOverviewLoading}
          watchlistError={watchlistOverviewError}
        />

        <Card className="flex min-h-[240px] flex-col p-5">
          <DashboardSectionHeader
            title="Scan volume"
            description="Total scans per day, last 30 days"
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
            total over 30 days
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
          {activeXrayCount > 0 && (
            <p className="mt-3 text-xs" style={{ color: '#60a5fa' }}>
              {activeXrayCount} Xray scan{activeXrayCount === 1 ? '' : 's'} in flight
            </p>
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
