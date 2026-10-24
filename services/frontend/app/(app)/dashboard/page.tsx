'use client';
import { DashboardImageReview } from '@/components/dashboard/dashboard-image-review';
import {
  Activity,
  ShieldAlert,
  ScanLine,
  CalendarCheck,
  Radar,
  ChevronRight,
  CircleAlert,
  GitBranch,
  ShieldCheck,
} from 'lucide-react';
import {
  DashboardDrilldownKey,
  DashboardDrilldownModal,
} from '@/components/dashboard/dashboard-drilldown-modal';
import dynamic from 'next/dynamic';
import {
  buildRecentActivityHref,
  getRecentActivityBounds,
  RECENT_ACTIVITY_RANGE_OPTIONS,
  RecentActivityRange,
} from '@/components/scans/recent-activity';
import { StatusAlert } from '@/components/ui/form-alert';
import { PageHeader } from '@/components/ui/page-header';
import { DashboardLoadingSkeleton } from '@/components/ui/skeleton';
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
  openBackgroundProcessCenter,
  getTokenType,
  getUser,
  listScans,
  listWatchlist,
  Scan,
  ScannerHealth,
  WatchlistItem,
} from '@/lib/api';
import { getWatchlistPolicyAttentionItems } from '@/lib/watchlist-posture';
import { Button, Card, useOverlayState } from '@/components/ui';
import { ArrowRight01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError } from '@/lib/utils';

const ScanOutcomeChart = dynamic(
  () => import('@/components/dashboard/dashboard-trends').then((module) => module.ScanOutcomeChart),
  {
    loading: () => (
      <div className="h-96 animate-pulse rounded-xl border border-border bg-muted/20" />
    ),
  }
);
const VulnTrendChart = dynamic(
  () => import('@/components/dashboard/dashboard-trends').then((module) => module.VulnTrendChart),
  {
    loading: () => (
      <div className="h-96 animate-pulse rounded-xl border border-border bg-muted/20" />
    ),
  }
);
const MonitoringCoverage = dynamic(
  () =>
    import('@/components/dashboard/monitoring-coverage').then(
      (module) => module.MonitoringCoverage
    ),
  {
    loading: () => (
      <div className="h-96 animate-pulse rounded-xl border border-border bg-muted/20" />
    ),
  }
);

function toTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

type WatchlistCoverage = {
  enabledCount: number;
  scanned24hCount: number;
  scanned7dCount: number;
  staleItems: WatchlistItem[];
  neverScannedCount: number;
  coverage7d: number;
  topSchedule: [string, number] | null;
};

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

// ── page ─────────────────────────────────────────────────────────────
function DashboardMetric({
  label,
  value,
  hint,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onPress={onPress}
      className="h-auto min-w-0 flex-col items-start gap-3 whitespace-normal rounded-lg border border-border/60 p-3 text-left"
    >
      <span className="flex items-center gap-2 text-sm">
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted">{icon}</span>
        {label}
      </span>
      <span className="block text-2xl font-semibold tabular-nums">{value}</span>
      <span className="-mt-2 text-xs font-normal text-muted-foreground">{hint}</span>
    </Button>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const drilldownModal = useOverlayState();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trends, setTrends] = useState<DashboardTrendPoint[]>([]);
  const [trendError, setTrendError] = useState('');
  const [vulnTrends, setVulnTrends] = useState<DashboardVulnTrendPoint[]>([]);
  const [vulnTrendError, setVulnTrendError] = useState('');
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [vulnTrendRefreshKey, setVulnTrendRefreshKey] = useState(0);
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
  const [watchlistOverviewLoading, setWatchlistOverviewLoading] = useState(true);
  const [watchlistOverviewError, setWatchlistOverviewError] = useState('');
  const [watchlistOverviewRefreshKey, setWatchlistOverviewRefreshKey] = useState(0);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState('');
  const dashboardRequestRef = useRef<{
    controller: AbortController;
    version: number;
  } | null>(null);
  const dashboardRequestVersionRef = useRef(0);
  const vulnTrendRequestRef = useRef<{
    controller: AbortController;
    version: number;
  } | null>(null);
  const vulnTrendRequestVersionRef = useRef(0);
  const statsRefreshRequestRef = useRef<{
    controller: AbortController;
    version: number;
  } | null>(null);
  const statsRefreshVersionRef = useRef(0);
  const drilldownRequestRef = useRef<{
    controller: AbortController;
    version: number;
  } | null>(null);
  const drilldownRequestVersionRef = useRef(0);
  const currentUser = getUser() as { role?: string } | null;
  const isAdmin = currentUser?.role === 'admin' || getTokenType() === 'admin';

  const hasActiveScans = (stats?.attention_scans ?? []).some(
    (scan) => scan.status === 'pending' || scan.status === 'running'
  );
  const refreshStats = useCallback(() => {
    statsRefreshRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const version = ++statsRefreshVersionRef.current;
    statsRefreshRequestRef.current = { controller, version };
    getStats({ signal: controller.signal })
      .then((nextStats) => {
        if (statsRefreshRequestRef.current?.version === version) {
          setStats(nextStats);
        }
      })
      .catch((reason: unknown) => {
        if (statsRefreshRequestRef.current?.version !== version || isAbortError(reason)) return;
      })
      .finally(() => {
        if (statsRefreshRequestRef.current?.version === version) {
          statsRefreshRequestRef.current = null;
        }
      });
  }, []);

  useConditionalInterval(refreshStats, hasActiveScans, 5000);

  useEffect(() => {
    statsRefreshRequestRef.current?.controller.abort();
    statsRefreshRequestRef.current = null;
    dashboardRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestVersion = ++dashboardRequestVersionRef.current;
    dashboardRequestRef.current = { controller, version: requestVersion };
    const healthPromise = isAdmin
      ? getScannerHealth({ signal: controller.signal })
          .then((health) => ({ health, error: '' }))
          .catch((reason: unknown) => {
            if (isAbortError(reason)) throw reason;
            return {
              health: null,
              error: reason instanceof Error ? reason.message : 'Failed to load scanner health',
            };
          })
      : Promise.resolve({ health: null, error: '' });

    Promise.allSettled([
      getStats({ signal: controller.signal }),
      getDashboardTrends(scanOutcomeRange, { signal: controller.signal }),
      healthPromise,
    ])
      .then(([statsResult, trendsResult, healthResult]) => {
        if (dashboardRequestRef.current?.version !== requestVersion) return;

        if (statsResult.status === 'rejected') {
          if (!isAbortError(statsResult.reason)) {
            setError(
              statsResult.reason instanceof Error
                ? statsResult.reason.message
                : 'Failed to load dashboard data'
            );
          }
        } else {
          setStats(statsResult.value);
          setError('');
        }

        if (trendsResult.status === 'rejected') {
          if (!isAbortError(trendsResult.reason)) {
            setTrendError(
              trendsResult.reason instanceof Error
                ? trendsResult.reason.message
                : 'Failed to load scan outcomes'
            );
          }
        } else {
          setTrends(trendsResult.value);
          setTrendError('');
        }

        if (healthResult.status === 'fulfilled') {
          setScannerHealth(healthResult.value.health);
          setScannerHealthError(healthResult.value.error);
        } else if (!isAbortError(healthResult.reason)) {
          setScannerHealth(null);
          setScannerHealthError(
            healthResult.reason instanceof Error
              ? healthResult.reason.message
              : 'Failed to load scanner health'
          );
        }
        setChartRefreshKey((current) => current + 1);
      })
      .finally(() => {
        if (dashboardRequestRef.current?.version !== requestVersion) return;
        dashboardRequestRef.current = null;
        setScanOutcomeLoading(false);
        setLoading(false);
      });

    return () => {
      if (dashboardRequestRef.current?.version === requestVersion) {
        controller.abort();
      }
    };
  }, [dashboardRefreshKey, isAdmin, scanOutcomeRange, scopeKey]);

  useEffect(() => {
    vulnTrendRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestVersion = ++vulnTrendRequestVersionRef.current;
    vulnTrendRequestRef.current = { controller, version: requestVersion };
    getDashboardVulnTrends(vulnTrendPeriod, { signal: controller.signal })
      .then((nextTrends) => {
        if (vulnTrendRequestRef.current?.version === requestVersion) {
          setVulnTrends(nextTrends);
          setVulnTrendError('');
        }
      })
      .catch((reason: unknown) => {
        if (vulnTrendRequestRef.current?.version !== requestVersion || isAbortError(reason)) return;
        setVulnTrendError(
          reason instanceof Error ? reason.message : 'Failed to load vulnerability trend'
        );
      })
      .finally(() => {
        if (vulnTrendRequestRef.current?.version === requestVersion) {
          vulnTrendRequestRef.current = null;
        }
      });

    return () => {
      if (vulnTrendRequestRef.current?.version === requestVersion) {
        controller.abort();
      }
    };
  }, [scopeKey, vulnTrendPeriod, vulnTrendRefreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void listWatchlist({ signal: controller.signal })
      .then((items) => {
        if (!cancelled) {
          setWatchlistOverviewItems(items);
          setWatchlistOverviewError('');
        }
      })
      .catch((reason: unknown) => {
        if (cancelled || isAbortError(reason)) return;
        setWatchlistOverviewError(
          reason instanceof Error ? reason.message : 'Failed to load watchlist coverage'
        );
      })
      .finally(() => {
        if (!cancelled) setWatchlistOverviewLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scopeKey, watchlistOverviewRefreshKey]);

  useEffect(() => {
    drilldownRequestRef.current?.controller.abort();
    if (!activeDrilldown || !drilldownModal.isOpen) {
      drilldownRequestRef.current = null;
      return;
    }

    const controller = new AbortController();
    const requestVersion = ++drilldownRequestVersionRef.current;
    drilldownRequestRef.current = { controller, version: requestVersion };

    if (activeDrilldown === 'watchlist' || activeDrilldown === 'watchlist_attention') {
      listWatchlist({ signal: controller.signal })
        .then((items) => {
          if (drilldownRequestRef.current?.version !== requestVersion) return;
          setWatchlistItems(
            activeDrilldown === 'watchlist_attention'
              ? getWatchlistPolicyAttentionItems(items)
              : items
          );
        })
        .catch((reason: unknown) => {
          if (drilldownRequestRef.current?.version !== requestVersion || isAbortError(reason)) {
            return;
          }
          setWatchlistItems([]);
          setWatchlistError(
            reason instanceof Error ? reason.message : 'Failed to load watchlist items'
          );
        })
        .finally(() => {
          if (drilldownRequestRef.current?.version !== requestVersion) return;
          drilldownRequestRef.current = null;
          setWatchlistLoading(false);
        });
      return () => {
        if (drilldownRequestRef.current?.version === requestVersion) {
          controller.abort();
        }
      };
    }

    const { from, to } = getRecentActivityBounds(recentActivityRange);

    listScans(
      1,
      50,
      undefined,
      activeDrilldown === 'completed' ? 'completed' : undefined,
      undefined,
      undefined,
      undefined,
      from,
      to,
      undefined,
      undefined,
      undefined,
      { signal: controller.signal }
    )
      .then((result) => {
        if (drilldownRequestRef.current?.version === requestVersion) {
          setModalScans(result.data ?? []);
        }
      })
      .catch((reason: unknown) => {
        if (drilldownRequestRef.current?.version !== requestVersion || isAbortError(reason)) return;
        setModalScans([]);
        setModalScansError(reason instanceof Error ? reason.message : 'Failed to load scans');
      })
      .finally(() => {
        if (drilldownRequestRef.current?.version !== requestVersion) return;
        drilldownRequestRef.current = null;
        setModalScansLoading(false);
      });

    return () => {
      if (drilldownRequestRef.current?.version === requestVersion) {
        controller.abort();
      }
    };
  }, [activeDrilldown, drilldownModal.isOpen, recentActivityRange, scopeKey]);

  function handleVulnPeriodChange(days: number) {
    setVulnTrendError('');
    setVulnTrendPeriod(days);
  }

  function handleScanOutcomeRangeChange(range: RecentActivityRange) {
    if (range === scanOutcomeRange) return;
    setTrendError('');
    setScanOutcomeRange(range);
    setScanOutcomeLoading(true);
  }

  function openScanOutcomeStatus(filters: { status?: string; policy?: string }) {
    const params = new URLSearchParams({ range: scanOutcomeRange });
    if (filters.status) params.set('status', filters.status);
    if (filters.policy) params.set('policy', filters.policy);
    router.push(`/scans?${params.toString()}`);
  }

  function openScanOutcomeDay(date: string) {
    router.push(`/scans?date=${encodeURIComponent(date)}`);
  }

  if (loading) return <DashboardLoadingSkeleton />;

  if (error)
    return (
      <div className="p-8">
        <StatusAlert
          status="danger"
          title="Dashboard unavailable"
          description={error}
          action={
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                setLoading(true);
                setDashboardRefreshKey((current) => current + 1);
              }}
            >
              Retry
            </Button>
          }
        />
      </div>
    );

  if (!stats) return null;

  const criticalHighCount =
    (stats.severity_totals.critical ?? 0) + (stats.severity_totals.high ?? 0);
  const completedCount = stats.status_counts['completed'] ?? 0;
  const watchlistCoverage = getWatchlistCoverage(watchlistOverviewItems);
  const watchlistAttentionCount = getWatchlistPolicyAttentionItems(watchlistOverviewItems).length;
  const watchlistOverviewUnavailable = Boolean(watchlistOverviewError);
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
    intelligence_changed_count: 0,
    intelligence_pending_count: 0,
  };
  const activePolicySignals =
    operations.blocked_policy_count +
    operations.xray_blocked_count +
    operations.org_policy_fail_count;
  const intelligencePendingCount = operations.intelligence_pending_count ?? 0;
  function prepareDrilldown(card: DashboardDrilldownKey) {
    if (card === 'watchlist' || card === 'watchlist_attention') {
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
    <div className="mx-auto w-full max-w-[1800px] space-y-4 p-4 md:p-5">
      <PageHeader
        title="Overview"
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

      <Card className="grid grid-cols-2 gap-1 p-1 md:grid-cols-3 lg:grid-cols-5">
        <DashboardMetric
          label="Scan runs"
          value={stats.total_scans.toLocaleString()}
          hint="Across workspace history"
          icon={<ScanLine className="size-4" />}
          onPress={() => router.push('/scans')}
        />
        <DashboardMetric
          label="Critical + high"
          value={criticalHighCount.toLocaleString()}
          hint="Findings in scan history"
          icon={<ShieldAlert className="size-4 text-destructive" />}
          onPress={() => router.push('/scans?sort=risk_desc')}
        />
        <DashboardMetric
          label="Policy failures"
          value={policyFailures.today.toLocaleString()}
          hint="Recorded today"
          icon={<CircleAlert className="size-4 text-warning-foreground" />}
          onPress={() => router.push('/scans?policy=fail')}
        />
        <DashboardMetric
          label="Active scans"
          value={(
            (stats.status_counts.running ?? 0) + (stats.status_counts.pending ?? 0)
          ).toLocaleString()}
          hint="Running or queued"
          icon={<Activity className="size-4 text-info-foreground" />}
          onPress={() => openBackgroundProcessCenter()}
        />
        <DashboardMetric
          label="Fresh coverage"
          value={
            watchlistOverviewLoading ||
            watchlistOverviewUnavailable ||
            watchlistCoverage.enabledCount === 0
              ? '—'
              : `${watchlistCoverage.coverage7d}%`
          }
          hint={
            watchlistOverviewUnavailable
              ? 'Coverage unavailable'
              : watchlistOverviewLoading
                ? 'Loading monitored images'
                : watchlistCoverage.enabledCount
                  ? 'Enabled watchlist · last 7 days'
                  : 'No enabled watchlist images'
          }
          icon={<Radar className="size-4 text-success-foreground" />}
          onPress={() => openDrilldown('watchlist')}
        />
      </Card>

      <section
        className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]"
        aria-label="Workspace review"
      >
        <DashboardImageReview
          refreshKey={dashboardRefreshKey}
          activeScans={(stats.status_counts.running ?? 0) + (stats.status_counts.pending ?? 0)}
        />
        <Card className="min-w-0 overflow-hidden gap-0 py-0">
          <div className="p-4">
            <h2 className="text-sm font-medium">Action queue</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Security and monitoring signals to review
            </p>
          </div>
          <div className="divide-y divide-border border-t border-border">
            {[
              {
                label: 'Severe findings',
                detail: 'Critical + high across scan history',
                value: criticalHighCount,
                icon: <ShieldAlert className="size-4 text-destructive" />,
                href: '/scans?sort=risk_desc',
              },
              {
                label: 'CVE confirmation',
                detail: 'Images awaiting confirmation',
                value: intelligencePendingCount,
                icon: <Radar className="size-4 text-info-foreground" />,
                href: '/scans?intelligence=confirmation_pending',
              },
              {
                label: 'Policy signals',
                detail: 'Organization and scanner policy signals',
                value: activePolicySignals,
                icon: <ShieldCheck className="size-4 text-warning-foreground" />,
                href: '/scans?policy=fail',
              },
              {
                label: 'Watchlist attention',
                detail: 'Monitoring policy and scan issues',
                value:
                  watchlistOverviewUnavailable || watchlistOverviewLoading
                    ? null
                    : watchlistAttentionCount,
                icon: <CalendarCheck className="size-4 text-warning-foreground" />,
                href: '/watchlist',
              },
              {
                label: 'Repository attention',
                detail: 'Git repositories needing review',
                value: gitRepositories.needs_attention,
                icon: <GitBranch className="size-4 text-info-foreground" />,
                href: '/git-repositories',
              },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex min-w-0 items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {item.value === null ? '—' : item.value.toLocaleString()}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <ScanOutcomeChart
        key={`scan-outcomes-${chartRefreshKey}`}
        data={trends}
        range={scanOutcomeRange}
        loading={scanOutcomeLoading}
        error={trendError}
        onRangeChange={handleScanOutcomeRangeChange}
        onDayPress={openScanOutcomeDay}
        onStatusPress={openScanOutcomeStatus}
        onRetry={() => {
          setTrendError('');
          setDashboardRefreshKey((current) => current + 1);
        }}
      />
      <section
        className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]"
        aria-label="Risk and monitoring trends"
      >
        <VulnTrendChart
          key={`vulnerability-trend-${chartRefreshKey}`}
          data={vulnTrends}
          period={vulnTrendPeriod}
          onPeriod={handleVulnPeriodChange}
          error={vulnTrendError}
          onRetry={() => {
            setVulnTrendError('');
            setVulnTrendRefreshKey((current) => current + 1);
          }}
        />
        <MonitoringCoverage
          enabled={watchlistCoverage.enabledCount}
          fresh={watchlistCoverage.scanned7dCount}
          neverScanned={watchlistCoverage.neverScannedCount}
          scannedToday={dashboardActivity.images_scanned_today}
          repositories={gitRepositories}
          activeXray={operations.active_xray_count}
          loading={watchlistOverviewLoading}
          error={watchlistOverviewError}
          onRetry={() => {
            setWatchlistOverviewError('');
            setWatchlistOverviewLoading(true);
            setWatchlistOverviewRefreshKey((value) => value + 1);
          }}
        />
      </section>

      <DashboardDrilldownModal
        state={drilldownModal}
        activeCard={activeDrilldown}
        totalScans={stats.total_scans}
        completedCount={completedCount}
        watchlistCount={
          activeDrilldown === 'watchlist_attention'
            ? watchlistOverviewUnavailable
              ? 0
              : watchlistAttentionCount
            : stats.watchlist_count
        }
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
