'use client';
import { buildRecentActivityHref, getRecentActivityBounds, RECENT_ACTIVITY_RANGE_OPTIONS, RecentActivityRange, RecentActivityRangePicker, RecentActivityRow } from '@/components/scans/recent-activity';
import { PageHeader } from '@/components/ui/page-header';
import { ChartSkeleton, RecentScanRowSkeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { useWorkScope } from '@/hooks/use-work-scope';
import { DashboardStats, DashboardTrendPoint, DashboardVulnTrendPoint, getDashboardTrends, getDashboardVulnTrends, getScannerHealth, getStats, getTokenType, getUser, listScans, Scan, ScannerHealth } from '@/lib/api';
import { Activity01Icon, Add01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// ── severity config ──────────────────────────────────────────────────
const SEV = [
  { key: 'critical', label: 'Critical', hex: '#f87171', glow: 'rgba(239,68,68,0.35)',   grad: 'linear-gradient(90deg,#991b1b,#f87171)' },
  { key: 'high',     label: 'High',     hex: '#fb923c', glow: 'rgba(249,115,22,0.35)',  grad: 'linear-gradient(90deg,#c2410c,#fb923c)' },
  { key: 'medium',   label: 'Medium',   hex: '#fbbf24', glow: 'rgba(245,158,11,0.3)',   grad: 'linear-gradient(90deg,#b45309,#fbbf24)' },
  { key: 'low',      label: 'Low',      hex: '#60a5fa', glow: 'rgba(59,130,246,0.3)',   grad: 'linear-gradient(90deg,#1d4ed8,#60a5fa)' },
  { key: 'unknown',  label: 'Unknown',  hex: '#a1a1aa', glow: 'rgba(113,113,122,0.25)', grad: 'linear-gradient(90deg,#3f3f46,#a1a1aa)' },
];

// ── helpers ──────────────────────────────────────────────────────────
function glassCard(tint?: string): React.CSSProperties {
  return {
    background: tint
      ? `linear-gradient(145deg, ${tint} 0%, var(--glass-bg-tint-end) 70%)`
      : 'var(--glass-bg)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'var(--glass-shadow)',
  };
}

function formatDbAge(hours?: number | null): string {
  if (hours == null || Number.isNaN(hours)) return 'Unknown';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function buildScansHref(filters?: { status?: string; image?: string; range?: RecentActivityRange }): string {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.image) params.set('image', filters.image);
  if (filters?.range) params.set('range', filters.range);
  const query = params.toString();
  return query ? `/scans?${query}` : '/scans';
}

function formatChartDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en', options ?? { month: 'short', day: 'numeric' });
}

function buildTrendSeries(
  trends: DashboardTrendPoint[],
  days: number,
  selectValue: (point: DashboardTrendPoint) => number,
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

// ── Mini Sparkline ────────────────────────────────────────────────────
function MiniSparkline({
  data,
  color,
  id,
  compact = false,
  valueLabel = 'events',
  showArea = true,
}: {
  data: { date: string; value: number }[];
  color: string;
  id: string;
  compact?: boolean;
  valueLabel?: string;
  showArea?: boolean;
}) {
  if (data.length < 2) return null;

  const gradientId = `sg-${id}`;

  return (
    <div className={compact ? 'h-8 w-18 shrink-0' : 'h-full min-h-[208px] w-full'}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={compact ? { top: 1, right: 0, left: 0, bottom: 1 } : { top: 12, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={compact ? 0.18 : 0.24} />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {!compact && (
            <CartesianGrid vertical={false} stroke="rgba(161,161,170,0.16)" strokeDasharray="4 4" />
          )}

          {!compact && (
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              minTickGap={28}
              tick={{ fontSize: 10, fill: 'rgba(113,113,122,0.78)' }}
              tickFormatter={(value: string) => formatChartDate(value)}
            />
          )}

          {!compact && (
            <Tooltip
              cursor={{ stroke: color, strokeOpacity: 0.18, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as { date: string; value: number } | undefined;
                if (!active || !point) return null;

                return (
                  <div
                    className="rounded-xl px-3 py-2"
                    style={{
                      background: 'rgba(10,10,15,0.94)',
                      border: `1px solid ${color}44`,
                      boxShadow: '0 12px 28px rgba(0,0,0,0.28)',
                    }}
                  >
                    <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.46)' }}>
                      {formatChartDate(point.date)}
                    </p>
                    <p className="mt-1 text-xs font-semibold tabular-nums" style={{ color }}>
                      {point.value.toLocaleString()} {valueLabel}
                    </p>
                  </div>
                );
              }}
            />
          )}

          {showArea && (
            <Area
              type="monotone"
              dataKey="value"
              stroke="none"
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          )}

          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={compact ? 2 : 2.25}
            dot={false}
            isAnimationActive={false}
            activeDot={compact ? false : { r: 4, fill: color, stroke: '#fff', strokeWidth: 1.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}


// ── Vulnerability Trend Chart ─────────────────────────────────────────

// Stack order: low at bottom, critical at top (most severe is most visible)
const STACK = [
  { key: 'unknown'  as const, label: 'Unknown',  color: '#a1a1aa', opacity: 0.72 },
  { key: 'low'      as const, label: 'Low',      color: '#60a5fa', opacity: 0.82 },
  { key: 'medium'   as const, label: 'Medium',   color: '#fbbf24', opacity: 0.85 },
  { key: 'high'     as const, label: 'High',     color: '#fb923c', opacity: 0.88 },
  { key: 'critical' as const, label: 'Critical', color: '#f87171', opacity: 0.92 },
];

// Fill every calendar day in the period so gaps are visible as zeros
function fillDates(data: DashboardVulnTrendPoint[], days: number): DashboardVulnTrendPoint[] {
  const map = new Map(data.map(d => [d.date, d]));
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
    normalised <= 1 ? magnitude :
    normalised <= 2 ? 2 * magnitude :
    normalised <= 5 ? 5 * magnitude :
    10 * magnitude;
  const step = niceMax / 4;
  return [0, 1, 2, 3, 4].map(i => Math.round(i * step));
}

function fmtTick(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

function VulnTrendChart({ data, period, onPeriod }: {
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
    <div className="relative rounded-2xl p-5 z-10" style={glassCard()}>
      <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.2), transparent)' }} />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(124,58,237,0.2)', boxShadow: '0 0 14px rgba(124,58,237,0.3)' }}>
            <Activity01Icon size={17} color="#a78bfa" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Avg. Findings per Scan</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Average vulnerabilities per finalized scan, by day</p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {latestActivePoint
                ? <><span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{latestActivePoint.total}</span> on {formatChartDate(latestActivePoint.date)}</>
                : `No finalized scans in the last ${period} days`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {PERIODS.map(d => (
            <button
              key={d}
              onClick={() => onPeriod(d)}
              className="px-2.5 py-1 text-xs font-medium rounded-lg transition-all duration-150"
              style={period === d
                ? { background: 'rgba(124,58,237,0.25)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.3)' }
                : { background: 'var(--row-hover)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}
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
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(161,161,170,0.16)" strokeDasharray="4 4" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                minTickGap={28}
                tick={{ fontSize: 10, fill: 'rgba(113,113,122,0.78)' }}
                tickFormatter={(value: string) => formatChartDate(value)}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                ticks={ticks}
                width={36}
                tick={{ fontSize: 10, fill: 'rgba(113,113,122,0.78)' }}
                tickFormatter={(value: number) => fmtTick(value)}
              />
              <Tooltip
                cursor={{ stroke: '#a78bfa', strokeOpacity: 0.22, strokeDasharray: '3 3' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length || typeof label !== 'string') return null;

                  const total = payload.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0);

                  return (
                    <div
                      className="rounded-xl px-3 py-2.5"
                      style={{
                        background: 'rgba(10,10,15,0.94)',
                        border: '1px solid rgba(167,139,250,0.24)',
                        boxShadow: '0 14px 30px rgba(0,0,0,0.3)',
                      }}
                    >
                      <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.46)' }}>
                        {formatChartDate(label)}
                      </p>
                      {total === 0 ? (
                        <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>No finalized scans</p>
                      ) : (
                        <>
                          <div className="mt-2 space-y-1.5">
                            {[...series].reverse().map(({ key, label: seriesLabel, color: seriesColor }) => {
                              const entry = payload.find((item) => item.dataKey === key);
                              const value = Number(entry?.value ?? 0);
                              if (value === 0) return null;

                              return (
                                <div key={key} className="flex items-center justify-between gap-3 text-[11px]">
                                  <span className="flex items-center gap-1.5" style={{ color: seriesColor }}>
                                    <span className="size-2 rounded-full" style={{ background: seriesColor }} />
                                    {seriesLabel}
                                  </span>
                                  <span className="tabular-nums" style={{ color: 'rgba(255,255,255,0.88)' }}>{value}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-2 flex items-center justify-between border-t pt-2 text-[11px]" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                            <span style={{ color: 'rgba(255,255,255,0.52)' }}>Total avg</span>
                            <span className="font-semibold tabular-nums" style={{ color: '#fff' }}>{total}</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                }}
              />

              {series.map(({ key, color, opacity }) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stackId="avg-findings"
                  stroke={color}
                  fill={color}
                  fillOpacity={opacity}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 1.5 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      </div>

      {hasData && (
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Peak daily average in this window: <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{peakAverage}</span>
        </p>
      )}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trends, setTrends] = useState<DashboardTrendPoint[]>([]);
  const [vulnTrends, setVulnTrends] = useState<DashboardVulnTrendPoint[]>([]);
  const [vulnTrendPeriod, setVulnTrendPeriod] = useState(30);
  const [scannerHealth, setScannerHealth] = useState<ScannerHealth | null>(null);
  const [scannerHealthError, setScannerHealthError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attentionFilter, setAttentionFilter] = useState<'all' | 'failed' | 'blocked' | 'running'>('all');
  const [recentActivityRange, setRecentActivityRange] = useState<RecentActivityRange>('24h');
  const [recentActivityScans, setRecentActivityScans] = useState<Scan[]>([]);
  const [recentActivityTotal, setRecentActivityTotal] = useState(0);
  const [recentActivityLoading, setRecentActivityLoading] = useState(true);
  const [recentActivityError, setRecentActivityError] = useState('');
  const currentUser = getUser() as { role?: string } | null;
  const isAdmin = currentUser?.role === 'admin' || getTokenType() === 'admin';

  const scanVolumeTrend = useMemo(() => buildTrendSeries(trends, 30, (point) => point.total), [trends]);
  const completedTrend = useMemo(() => buildTrendSeries(trends, 14, (point) => point.completed), [trends]);
  const attentionTrend = useMemo(() => buildTrendSeries(trends, 14, (point) => point.failed), [trends]);

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
    const { from, to } = getRecentActivityBounds(recentActivityRange);

    setRecentActivityLoading(true);
    setRecentActivityError('');

    listScans(1, 8, undefined, undefined, undefined, undefined, undefined, from, to)
      .then((result) => {
        setRecentActivityScans(result.data ?? []);
        setRecentActivityTotal(result.total ?? 0);
      })
      .catch((recentError: Error) => {
        setRecentActivityScans([]);
        setRecentActivityTotal(0);
        setRecentActivityError(recentError.message);
      })
      .finally(() => setRecentActivityLoading(false));
  }, [recentActivityRange, scopeKey]);

  function handleVulnPeriodChange(days: number) {
    setVulnTrendPeriod(days);
    getDashboardVulnTrends(days)
      .then(setVulnTrends)
      .catch(() => setVulnTrends([]));
  }

  if (loading) return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="skeleton h-7 w-32 rounded-lg" />
          <div className="skeleton h-3.5 w-48 rounded" />
        </div>
        <div className="skeleton h-9 w-28 rounded-xl" />
      </div>
      <div className="skeleton h-20 w-full rounded-xl" />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
        <div className="rounded-2xl p-5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="skeleton h-4 w-32 rounded mb-4" />
          {Array.from({ length: 5 }).map((_, i) => <RecentScanRowSkeleton key={i} />)}
        </div>
        <div className="flex flex-col gap-3">
          <div className="skeleton h-44 w-full rounded-2xl" />
          <div className="skeleton h-28 w-full rounded-2xl" />
        </div>
      </div>
      <ChartSkeleton />
    </div>
  );

  if (error) return (
    <div className="p-8">
      <div className="rounded-xl px-4 py-3 text-sm"
        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
        {error}
      </div>
    </div>
  );

  if (!stats) return null;

  const totalVulns = Object.values(stats.severity_totals).reduce((a, b) => a + b, 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const startedTodayCount = [...trends].reverse().find((point) => point.date === todayKey)?.total ?? 0;
  const failedStatusCount = stats.status_counts['failed'] ?? 0;
  const activeQueueCount = (stats.status_counts['running'] ?? 0) + (stats.status_counts['pending'] ?? 0);
  const blockedPolicyCount = stats.operations?.blocked_policy_count ?? stats.status_counts['blocked_by_xray_policy'] ?? 0;
  const genericFailedCount = Math.max(0, failedStatusCount - blockedPolicyCount);
  const activeXrayCount = stats.operations?.active_xray_count ?? 0;
  const completedCount = stats.status_counts['completed'] ?? 0;
  const needsAttentionTotal = genericFailedCount + blockedPolicyCount;
  const successRate = stats.total_scans > 0 ? Math.round((completedCount / stats.total_scans) * 100) : 0;
  const recentWindowAverage = scanVolumeTrend.reduce((sum, point) => sum + point.value, 0) / Math.max(scanVolumeTrend.length, 1);
  const recentCompletedTotal = completedTrend.reduce((sum, point) => sum + point.value, 0);
  const attentionPeak = Math.max(...attentionTrend.map((point) => point.value), 0);
  const attentionScans = stats.attention_scans ?? stats.recent_scans ?? [];

  const allAttentionScans = attentionScans.filter((scan) => {
    const isFailed = scan.status === 'failed';
    const isBlocked = scan.external_status === 'blocked_by_xray_policy';
    const isRunning = scan.status === 'running' || scan.status === 'pending';
    if (attentionFilter === 'failed') return isFailed && !isBlocked;
    if (attentionFilter === 'blocked') return isBlocked;
    if (attentionFilter === 'running') return isRunning;
    return isFailed || isBlocked;
  });
  const totalAttentionForFilter = attentionFilter === 'failed'
    ? genericFailedCount
    : attentionFilter === 'blocked'
      ? blockedPolicyCount
      : attentionFilter === 'running'
        ? activeQueueCount
        : needsAttentionTotal;
  const displayedAttentionScans = allAttentionScans.slice(0, 5);
  const moreAttentionCount = Math.max(0, totalAttentionForFilter - displayedAttentionScans.length);
  const triageHref = attentionFilter === 'running' ? buildScansHref({ status: 'running' }) : buildScansHref({ status: 'failed' });
  const recentActivityRangeLabel = RECENT_ACTIVITY_RANGE_OPTIONS.find((option) => option.id === recentActivityRange)?.label ?? 'Last 24 hours';
  const recentActivityHref = buildRecentActivityHref(recentActivityRange);

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">

      <PageHeader
        eyebrow="Operations overview"
        title="Dashboard"
        description={new Date().toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        actions={(
          <Link
            href="/scans"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 active:scale-95"
            style={{ background: '#7c3aed' }}
          >
            <Add01Icon size={14} />
            New Scan
          </Link>
        )}
      />

      {/* ── Stat strip ── */}
      <div className="overflow-x-auto rounded-xl" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))' }}>
          <StatCard
            label="Total Scans"
            value={(
              <div className="flex w-full items-end justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-bold tabular-nums tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    {stats.total_scans.toLocaleString()}
                  </p>
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {recentWindowAverage >= 10 ? recentWindowAverage.toFixed(0) : recentWindowAverage.toFixed(1)} avg/day
                  </p>
                </div>
                <MiniSparkline data={scanVolumeTrend.slice(-14)} color="#a78bfa" id="stat-total-scans" compact showArea={false} valueLabel="scans" />
              </div>
            )}
            hint={<span className="flex items-center gap-1.5">{activeQueueCount > 0 && <span className="size-1.5 rounded-full inline-block shrink-0 animate-pulse" style={{ background: '#60a5fa' }} />} {activeQueueCount > 0 ? `${activeQueueCount} running` : 'none running'}</span>}
            className="rounded-none px-5 py-4"
            style={{ borderRight: '1px solid var(--glass-border)' }}
            valueClassName=""
            hintStyle={{ color: activeQueueCount > 0 ? '#60a5fa' : 'var(--text-faint)' }}
          />
          <StatCard
            label="Completed"
            value={(
              <div className="flex w-full items-end justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-bold tabular-nums tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    {completedCount.toLocaleString()}
                  </p>
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {recentCompletedTotal.toLocaleString()} in last 14d
                  </p>
                </div>
                <MiniSparkline data={completedTrend} color="#34d399" id="stat-completed" compact showArea={false} valueLabel="completed" />
              </div>
            )}
            hint={`${successRate}% success rate`}
            className="rounded-none px-5 py-4"
            style={{ borderRight: '1px solid var(--glass-border)' }}
            valueClassName=""
          />
          <StatCard
            label="Needs Attention"
            value={(
              <div className="flex w-full items-end justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-bold tabular-nums tracking-tight" style={{ color: needsAttentionTotal > 0 ? '#f87171' : 'var(--text-primary)' }}>
                    {needsAttentionTotal}
                  </p>
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {attentionPeak.toLocaleString()} peak failed/day in last 14d
                  </p>
                </div>
                <MiniSparkline data={attentionTrend} color="#f87171" id="stat-attention" compact showArea={false} valueLabel="failed" />
              </div>
            )}
            hint={
              <span className="flex items-center gap-2">
                {genericFailedCount > 0 && <span style={{ color: '#f87171' }}>{genericFailedCount} failed</span>}
                {blockedPolicyCount > 0 && <span style={{ color: '#fb923c' }}>{blockedPolicyCount} blocked</span>}
                {needsAttentionTotal === 0 && <span style={{ color: 'var(--text-faint)' }}>all clear</span>}
              </span>
            }
            className="rounded-none px-5 py-4"
            style={{ borderRight: '1px solid var(--glass-border)' }}
            valueClassName=""
          />
          <StatCard
            label="Watchlist"
            value={stats.watchlist_count.toLocaleString()}
            hint={`${startedTodayCount} started today`}
            className="rounded-none px-5 py-4"
            valueStyle={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      {/* ── Zone 2: Action + Context ── */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">

        <div className="flex flex-col gap-3">
          <div className="rounded-2xl p-5" style={glassCard()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Needs Attention</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  {needsAttentionTotal > 0
                    ? `${needsAttentionTotal} scan${needsAttentionTotal !== 1 ? 's' : ''} require intervention`
                    : 'No items require intervention right now'}
                </p>
              </div>
              <Link
                href={triageHref}
                className="text-xs shrink-0 transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                Triage all →
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              {([
                { key: 'all' as const,     label: 'All',           count: needsAttentionTotal, activeBg: 'rgba(124,58,237,0.12)', activeBorder: 'rgba(124,58,237,0.3)',  activeColor: '#a78bfa' },
                { key: 'failed' as const,  label: 'Failed',        count: genericFailedCount,  activeBg: 'rgba(239,68,68,0.1)',   activeBorder: 'rgba(239,68,68,0.3)',   activeColor: '#f87171' },
                { key: 'blocked' as const, label: 'Policy blocked', count: blockedPolicyCount,  activeBg: 'rgba(249,115,22,0.1)',  activeBorder: 'rgba(249,115,22,0.3)',  activeColor: '#fb923c' },
                { key: 'running' as const, label: 'Running',       count: activeQueueCount,    activeBg: 'rgba(59,130,246,0.1)',  activeBorder: 'rgba(59,130,246,0.3)',  activeColor: '#60a5fa' },
              ] as const).map(({ key, label, count, activeBg, activeBorder, activeColor }) => {
                const isActive = attentionFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAttentionFilter(key)}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all"
                    style={isActive
                      ? { background: activeBg, border: `1px solid ${activeBorder}`, color: activeColor }
                      : { background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-faint)' }
                    }
                  >
                    {label}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            {displayedAttentionScans.length === 0 ? (
              <p className="py-10 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                {attentionFilter === 'all' ? 'No failed or blocked scans.' : `No ${attentionFilter === 'blocked' ? 'policy-blocked' : attentionFilter} scans.`}
              </p>
            ) : (
              <>
                <div className="mb-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  Showing latest {displayedAttentionScans.length} of {totalAttentionForFilter}
                </div>
                <div className="max-h-[308px] space-y-0.5 overflow-y-auto pr-1 -mx-1">
                  {displayedAttentionScans.map((scan) => <RecentActivityRow key={scan.id} scan={scan} />)}
                </div>
              </>
            )}

            {moreAttentionCount > 0 && (
              <div className="mt-3 text-center">
                <Link
                  href={triageHref}
                  className="text-xs transition-colors"
                  style={{ color: 'var(--text-faint)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}
                >
                  {moreAttentionCount} more →
                </Link>
              </div>
            )}
          </div>

          <div className="rounded-2xl p-5" style={glassCard()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Activity</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  What got scanned in {recentActivityRangeLabel.toLowerCase()}
                </p>
              </div>
              <Link
                href={recentActivityHref}
                className="text-xs shrink-0 transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                Open feed →
              </Link>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <RecentActivityRangePicker value={recentActivityRange} onChange={setRecentActivityRange} />
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {recentActivityTotal} event{recentActivityTotal !== 1 ? 's' : ''}
              </span>
            </div>

            {recentActivityError ? (
              <p className="py-8 text-center text-sm" style={{ color: '#f87171' }}>
                {recentActivityError}
              </p>
            ) : recentActivityLoading ? (
              <div className="space-y-1.5">
                {Array.from({ length: 4 }).map((_, index) => <RecentScanRowSkeleton key={index} />)}
              </div>
            ) : recentActivityScans.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                No scans started in {recentActivityRangeLabel.toLowerCase()}.
              </p>
            ) : (
              <>
                <div className="space-y-0.5 -mx-1">
                  {recentActivityScans.map((scan) => <RecentActivityRow key={scan.id} scan={scan} />)}
                </div>
                {recentActivityTotal > recentActivityScans.length ? (
                  <div className="mt-3 text-center">
                    <Link
                      href={recentActivityHref}
                      className="text-xs transition-colors"
                      style={{ color: 'var(--text-faint)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}
                    >
                      {recentActivityTotal - recentActivityScans.length} more →
                    </Link>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Right column: Exposure + Scanner */}
        <div className="flex flex-col gap-3">

          {/* Exposure Snapshot */}
          <div className="rounded-2xl p-5" style={glassCard()}>
            <div className="flex items-start justify-between gap-2 mb-4">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Exposure Snapshot</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>Across all finalized scan results</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{totalVulns.toLocaleString()}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>total</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {SEV.map(({ key, label, hex }) => {
                const count = stats.severity_totals[key] ?? 0;
                const pct = totalVulns > 0 ? (count / totalVulns) * 100 : 0;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-[11px] font-medium w-12 shrink-0" style={{ color: hex }}>{label}</span>
                    <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'var(--row-divider)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: hex, transition: 'width 0.6s ease' }} />
                    </div>
                    <span className="text-[11px] font-mono w-10 text-right shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>{count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scanner */}
          <div className="rounded-2xl p-5" style={glassCard()}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Scanner</h2>
              {activeXrayCount > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums" style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.24)', color: '#60a5fa' }}>
                  {activeXrayCount} Xray in flight
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-[12px]">
                <span style={{ color: 'var(--text-muted)' }}>In-flight</span>
                <span style={{ color: activeQueueCount > 0 ? '#60a5fa' : 'var(--text-muted)' }}>{activeQueueCount}</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span style={{ color: 'var(--text-muted)' }}>Started today</span>
                <span style={{ color: 'var(--text-secondary)' }}>{startedTodayCount}</span>
              </div>
              {isAdmin && scannerHealthError && (
                <p className="text-xs pt-1" style={{ color: '#f87171' }}>{scannerHealthError}</p>
              )}
              {isAdmin && !scannerHealthError && scannerHealth && (
                scannerHealth.local_scanner_enabled ? (
                  <>
                    <div className="flex items-center justify-between text-[12px]">
                      <span style={{ color: 'var(--text-muted)' }}>Workers</span>
                      <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                        <span className="size-1.5 rounded-full shrink-0" style={{ background: '#34d399' }} />
                        {scannerHealth.healthy_workers} healthy{scannerHealth.stale_workers > 0 ? `, ${scannerHealth.stale_workers} stale` : ''}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[12px]">
                      <span style={{ color: 'var(--text-muted)' }}>Vuln DB</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{formatDbAge(scannerHealth.oldest_vuln_db_age_hours)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[12px]">
                      <span style={{ color: 'var(--text-muted)' }}>Java DB</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{formatDbAge(scannerHealth.oldest_java_db_age_hours)}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs pt-1" style={{ color: 'var(--text-faint)' }}>{scannerHealth.message || 'Local scanner disabled.'}</p>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Zone 3: History ── */}
      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>History</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {/* Scan volume */}
          <div className="flex min-h-[280px] flex-col rounded-2xl p-5" style={glassCard()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Scan Volume</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>Total scans per day - last 30 days</p>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {scanVolumeTrend.reduce((sum, point) => sum + point.value, 0).toLocaleString()}
                  </span>{' '}
                  total over 30 days
                </p>
              </div>
              <Link
                href="/scans"
                className="text-xs transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                View all →
              </Link>
            </div>
            {scanVolumeTrend.length >= 2
              ? <div className="flex-1"><MiniSparkline data={scanVolumeTrend} color="#a78bfa" id="scan-volume" valueLabel="scans" /></div>
              : <div className="flex items-center justify-center py-8 text-sm" style={{ color: 'var(--text-faint)' }}>No trend data yet</div>
            }
          </div>

          {/* Avg findings per scan */}
          <VulnTrendChart data={vulnTrends} period={vulnTrendPeriod} onPeriod={handleVulnPeriodChange} />
        </div>
      </div>

    </div>
  );
}

