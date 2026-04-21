'use client';

import { ChartSkeleton } from '@/components/ui/skeleton';
import { getAdminDashboard } from '@/lib/api/admin';
import type { AdminDashboard, AdminDashboardVulnerabilityTrendPoint } from '@/lib/api/types/admin';
import { APP_COPYRIGHT, APP_FRONTEND_VERSION } from '@/lib/build-info';
import { fullDate, timeAgo } from '@/lib/time';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SEVERITY_SERIES = [
  { key: 'critical', label: 'Critical', color: '#f87171' },
  { key: 'high', label: 'High', color: '#fb923c' },
  { key: 'medium', label: 'Medium', color: '#fbbf24' },
  { key: 'low', label: 'Low', color: '#60a5fa' },
  { key: 'unknown', label: 'Unknown', color: '#a1a1aa' },
] as const;

function glassCard(tint?: string): CSSProperties {
  return {
    background: tint ? `linear-gradient(145deg, ${tint} 0%, var(--glass-bg-tint-end) 70%)` : 'var(--glass-bg)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'var(--glass-shadow)',
  };
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value);
}

function formatLatency(value: number) {
  return `${Math.round(value)}ms`;
}

function MiniSparkline({ data, color, id }: { data: { date: string; value: number }[]; color: string; id: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(200);

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  if (data.length < 2) {
    return <div className="flex min-h-[176px] items-center justify-center text-sm text-zinc-500">Not enough trend data yet.</div>;
  }

  const height = 176;
  const top = 28;
  const padding = 8;
  const sparkHeight = height - top;
  const values = data.map((point) => point.value);
  const max = Math.max(...values, 5);
  const baselineY = height - padding;
  const points = data.map((point, index) => [
    (index / (data.length - 1)) * width,
    baselineY - ((point.value / max) * (sparkHeight - padding * 2)),
  ] as const);

  let path = `M${points[0]![0].toFixed(1)},${points[0]![1].toFixed(1)}`;
  for (let index = 1; index < points.length; index++) {
    const control = ((points[index - 1]![0] + points[index]![0]) / 2).toFixed(1);
    path += ` C${control},${points[index - 1]![1].toFixed(1)} ${control},${points[index]![1].toFixed(1)} ${points[index]![0].toFixed(1)},${points[index]![1].toFixed(1)}`;
  }

  const lastPoint = points[points.length - 1]!;
  const gradientId = `admin-sg-${id}`;
  const hoveredPoint = hoverIdx !== null ? points[hoverIdx] : null;
  const hoveredData = hoverIdx !== null ? data[hoverIdx] : null;

  function handleMouseMove(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * width;
    setHoverIdx(Math.max(0, Math.min(data.length - 1, Math.round((x / width) * (data.length - 1)))));
  }

  return (
    <div ref={containerRef} className="h-full min-h-[176px] w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full cursor-crosshair"
        aria-hidden
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={`${path} L${width},${height} L0,${height} Z`} fill={`url(#${gradientId})`} />
        <line x1={0} x2={width} y1={baselineY} y2={baselineY} stroke={color} strokeOpacity="0.12" strokeWidth="1" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 2px ${color}88)` }} />

        {hoveredPoint && hoveredData ? (
          <>
            <line x1={hoveredPoint[0]} x2={hoveredPoint[0]} y1={top} y2={baselineY} stroke={color} strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={hoveredPoint[0]} cy={hoveredPoint[1]} r="3" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
            {(() => {
              const date = new Date(hoveredData.date).toLocaleDateString('en', { month: 'short', day: 'numeric' });
              const pillWidth = 96;
              const pillHeight = 22;
              const pillX = Math.max(1, Math.min(width - pillWidth - 1, hoveredPoint[0] - pillWidth / 2));
              return (
                <g>
                  <rect x={pillX} y={1.5} width={pillWidth} height={pillHeight} rx={6} fill="rgba(24,24,27,0.94)" stroke={color} strokeOpacity={0.6} strokeWidth={1} style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.4))' }} />
                  <text x={pillX + 10} y={15} fontSize={11} fontWeight="700" fill={color} fontFamily="ui-monospace,monospace">{hoveredData.value}</text>
                  <text x={pillX + pillWidth - 8} y={15.5} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.7)" fontFamily="ui-sans-serif,system-ui">{date}</text>
                </g>
              );
            })()}
          </>
        ) : (
          <circle cx={lastPoint[0]} cy={lastPoint[1]} r="2.5" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
        )}
      </svg>
    </div>
  );
}

function VulnerabilityTrendBars({ data }: { data: AdminDashboardVulnerabilityTrendPoint[] }) {
  const series = data.slice(-12);

  if (series.length === 0) {
    return <div className="flex min-h-[212px] items-center justify-center text-sm text-zinc-500">No finalized vulnerability trend data yet.</div>;
  }

  const totals = series.map((point) => point.critical + point.high + point.medium + point.low + point.unknown);
  const max = Math.max(...totals, 1);

  return (
    <div className="space-y-4">
      <div className="flex h-[212px] items-end gap-2">
        {series.map((point) => {
          const total = point.critical + point.high + point.medium + point.low + point.unknown;
          return (
            <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-2" title={`${point.date}: ${total} avg findings`}>
              <div className="flex h-full w-full flex-col justify-end overflow-hidden rounded-t-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)' }}>
                {SEVERITY_SERIES.map((severity) => {
                  const value = point[severity.key];
                  const height = total === 0 ? 0 : Math.max(6, (value / max) * 180);
                  return value > 0 ? <div key={severity.key} style={{ height, background: severity.color }} /> : null;
                })}
              </div>
              <span className="text-[10px] text-zinc-500">{new Date(point.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {SEVERITY_SERIES.map((severity) => (
          <span key={severity.key} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <span className="h-2 w-2 rounded-full" style={{ background: severity.color }} />
            {severity.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, hint, accent }: { label: string; value: string; hint: string; accent: string }) {
  return (
    <div className="px-5 py-4" style={{ borderRight: '1px solid var(--glass-border)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-white">{value}</p>
      <p className="mt-1.5 text-[11px]" style={{ color: accent }}>{hint}</p>
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
    load();
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
        <div className="skeleton h-24 w-full rounded-2xl" />
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="skeleton h-72 w-full rounded-2xl" />
          <div className="skeleton h-72 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
        {error}
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  const totalFindings = Object.values(dashboard.severity_totals).reduce((sum, value) => sum + value, 0);
  const completedScans = dashboard.status_counts.completed ?? 0;
  const failedScans = dashboard.status_counts.failed ?? 0;
  const successRate = dashboard.total_scans > 0 ? Math.round((completedScans / dashboard.total_scans) * 100) : 0;
  const telemetryErrorRate = dashboard.insights.api_requests_24h > 0
    ? Math.round((dashboard.insights.api_error_requests_24h / dashboard.insights.api_requests_24h) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl" style={glassCard()}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))' }}>
          <SummaryTile label="Total Scans" value={dashboard.total_scans.toLocaleString()} hint={`${dashboard.queues.running + dashboard.queues.pending} active in queue`} accent={dashboard.queues.running + dashboard.queues.pending > 0 ? '#60a5fa' : 'var(--text-faint)'} />
          <SummaryTile label="Findings" value={formatCompact(totalFindings)} hint={`${dashboard.severity_totals.critical ?? 0} critical`} accent={(dashboard.severity_totals.critical ?? 0) > 0 ? '#f87171' : 'var(--text-faint)'} />
          <SummaryTile label="Needs Attention" value={dashboard.queues.needs_attention.toLocaleString()} hint={`${failedScans} failed · ${dashboard.queues.blocked_policies} blocked`} accent={dashboard.queues.needs_attention > 0 ? '#fb923c' : 'var(--text-faint)'} />
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">API Requests 24h</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-white">{formatCompact(dashboard.insights.api_requests_24h)}</p>
            <p className="mt-1.5 text-[11px]" style={{ color: telemetryErrorRate > 0 ? '#f59e0b' : 'var(--text-faint)' }}>{telemetryErrorRate}% error rate</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="rounded-2xl p-5" style={glassCard()}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Scan volume</h2>
              <p className="mt-1 text-sm text-zinc-500">Thirty-day scan throughput across the full platform.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full px-3 py-1 text-xs text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>{completedScans} completed</span>
              <span className="rounded-full px-3 py-1 text-xs text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>{failedScans} failed</span>
              <span className="rounded-full px-3 py-1 text-xs text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>{successRate}% success</span>
            </div>
          </div>
          <div className="mt-4 min-h-[176px]">
            <MiniSparkline data={sparkData} color="#7c3aed" id="admin-scan-volume" />
          </div>
        </div>

        <div className="rounded-2xl p-5" style={glassCard()}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Vulnerability trend</h2>
              <p className="mt-1 text-sm text-zinc-500">Average finalized findings per day over the last thirty days.</p>
            </div>
            <Link href="/admin/insights" className="text-sm text-violet-500 hover:underline">Open observability</Link>
          </div>
          <div className="mt-4">
            <VulnerabilityTrendBars data={dashboard.vulnerability_trends} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={glassCard()}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Platform telemetry</h2>
                <p className="mt-1 text-sm text-zinc-500">Short-horizon API and xRay signal for the last twenty-four hours.</p>
              </div>
              <Link href="/admin/insights" className="text-sm text-violet-500 hover:underline">Open logs</Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs text-zinc-500">API traffic</p>
                <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-white">{formatCompact(dashboard.insights.api_requests_24h)}</p>
                <p className="mt-1 text-xs text-zinc-500">{dashboard.insights.api_error_requests_24h.toLocaleString()} errors · {formatLatency(dashboard.insights.api_p95_ms)} p95</p>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs text-zinc-500">xRay traffic</p>
                <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-white">{formatCompact(dashboard.insights.xray_requests_24h)}</p>
                <p className="mt-1 text-xs text-zinc-500">{dashboard.insights.xray_error_requests_24h.toLocaleString()} errors · {formatLatency(dashboard.insights.api_average_ms)} avg API latency</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl p-5" style={glassCard()}>
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-white">System and legal</h2>
              <p className="mt-1 text-sm text-zinc-500">Runtime build metadata and exposure posture.</p>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs text-zinc-500">Public scanning</p>
                <p className="mt-1 font-semibold text-zinc-900 dark:text-white">{dashboard.public_scan_enabled ? 'Enabled' : 'Disabled'}</p>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs text-zinc-500">Frontend version</p>
                <p className="mt-1 font-semibold text-zinc-900 dark:text-white">v{APP_FRONTEND_VERSION}</p>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs text-zinc-500">Dashboard generated</p>
                <p className="mt-1 text-zinc-700 dark:text-zinc-200">{fullDate(dashboard.generated_at)}</p>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs text-zinc-500">Copyright</p>
                <p className="mt-1 text-zinc-700 dark:text-zinc-200">{APP_COPYRIGHT}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={glassCard()}>
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Worker health</h2>
              <p className="mt-1 text-sm text-zinc-500">Snapshot of local scanner workers from the current backend instance.</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Healthy', value: dashboard.scanner_health.healthy_workers, color: '#34d399' },
                { label: 'Stale', value: dashboard.scanner_health.stale_workers, color: '#fbbf24' },
                { label: 'Errors', value: dashboard.scanner_health.error_workers, color: '#f87171' },
                { label: 'Workers', value: dashboard.scanner_health.total_workers, color: '#60a5fa' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  <p className="text-xs text-zinc-500">{item.label}</p>
                  <p className="mt-1 text-xl font-semibold" style={{ color: item.color }}>{item.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl px-4 py-3 text-xs text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              Scanner status generated {timeAgo(dashboard.scanner_health.generated_at)}. Maximum allowed DB age: {dashboard.scanner_health.max_allowed_age_hours}h.
            </div>
          </div>

          <div className="rounded-2xl p-5" style={glassCard()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Recent audit activity</h2>
                <p className="mt-1 text-sm text-zinc-500">The latest system-wide administrative changes.</p>
              </div>
              <Link href="/admin/audit" className="text-sm text-violet-500 hover:underline">View all</Link>
            </div>
            <div className="mt-4 space-y-2">
              {dashboard.recent_audit.length === 0 ? (
                <p className="rounded-xl px-4 py-3 text-sm text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>No audit activity yet.</p>
              ) : dashboard.recent_audit.map((entry) => (
                <div key={entry.id} className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{entry.operation}</p>
                      <p className="mt-1 text-xs text-zinc-500">{entry.username || entry.user_id}</p>
                    </div>
                    <span className="whitespace-nowrap text-xs text-zinc-400" title={fullDate(entry.created_at)}>{timeAgo(entry.created_at)}</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-500 line-clamp-2">{entry.details || 'No details recorded.'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}