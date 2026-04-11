'use client';
import { StatusBadge } from '@/components/ui/badges';
import { ChartSkeleton, RecentScanRowSkeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import { DashboardStats, DashboardTrendPoint, DashboardVulnTrendPoint, getDashboardTrends, getDashboardVulnTrends, getScannerHealth, getStats, getTokenType, getUser, Scan, ScannerHealth } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Activity01Icon,
  Add01Icon,
  AlertDiamondIcon,
  CheckmarkBadge01Icon,
  Clock01Icon,
  EyeIcon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// ── severity config ──────────────────────────────────────────────────
const SEV = [
  { key: 'critical', label: 'Critical', hex: '#f87171', glow: 'rgba(239,68,68,0.35)',   grad: 'linear-gradient(90deg,#991b1b,#f87171)' },
  { key: 'high',     label: 'High',     hex: '#fb923c', glow: 'rgba(249,115,22,0.35)',  grad: 'linear-gradient(90deg,#c2410c,#fb923c)' },
  { key: 'medium',   label: 'Medium',   hex: '#fbbf24', glow: 'rgba(245,158,11,0.3)',   grad: 'linear-gradient(90deg,#b45309,#fbbf24)' },
  { key: 'low',      label: 'Low',      hex: '#60a5fa', glow: 'rgba(59,130,246,0.3)',   grad: 'linear-gradient(90deg,#1d4ed8,#60a5fa)' },
  { key: 'unknown',  label: 'Unknown',  hex: '#a1a1aa', glow: 'rgba(113,113,122,0.25)', grad: 'linear-gradient(90deg,#3f3f46,#a1a1aa)' },
];

// ── stat card config ─────────────────────────────────────────────────
type TrendKey = 'total' | 'completed' | 'failed';

type StatSub = {
  text: string;
  pulse?: boolean;
} | null;

type StatCardConfig = {
  key: string;
  trendKey: TrendKey | null;
  invertTrend: boolean;
  label: string;
  Icon: typeof Shield01Icon;
  tint: string;
  iconColor: string;
  iconBg: string;
  glow: string;
  getValue: (s: DashboardStats) => number;
  getSub: (s: DashboardStats) => StatSub;
};

const STATS: StatCardConfig[] = [
  {
    key: 'total',
    trendKey: 'total' as TrendKey | null,
    invertTrend: false,
    label: 'Total Scans',
    Icon: Shield01Icon,
    tint: 'rgba(124,58,237,0.14)',
    iconColor: '#a78bfa',
    iconBg: 'rgba(124,58,237,0.22)',
    glow: 'rgba(124,58,237,0.4)',
    getValue: (s: DashboardStats) => s.total_scans,
    getSub:   (s: DashboardStats) => {
      const r = s.status_counts['running'] ?? 0;
      return r > 0 ? { text: `${r} running`, pulse: true } : null;
    },
  },
  {
    key: 'completed',
    trendKey: 'completed' as TrendKey | null,
    invertTrend: false,
    label: 'Completed',
    Icon: CheckmarkBadge01Icon,
    tint: 'rgba(16,185,129,0.11)',
    iconColor: '#34d399',
    iconBg: 'rgba(16,185,129,0.2)',
    glow: 'rgba(16,185,129,0.35)',
    getValue: (s: DashboardStats) => s.status_counts['completed'] ?? 0,
    getSub:   () => null,
  },
  {
    key: 'failed',
    trendKey: 'failed' as TrendKey | null,
    invertTrend: true,
    label: 'Failed',
    Icon: AlertDiamondIcon,
    tint: 'rgba(239,68,68,0.11)',
    iconColor: '#f87171',
    iconBg: 'rgba(239,68,68,0.2)',
    glow: 'rgba(239,68,68,0.35)',
    getValue: (s: DashboardStats) => s.status_counts['failed'] ?? 0,
	getSub:   (s: DashboardStats) => {
	  const blocked = s.operations?.blocked_policy_count ?? s.status_counts['blocked_by_xray_policy'] ?? 0;
	  return blocked > 0 ? { text: `${blocked} blocked by policy` } : null;
	},
  },
  {
    key: 'watchlist',
    trendKey: null as TrendKey | null,
    invertTrend: false,
    label: 'Watchlist',
    Icon: EyeIcon,
    tint: 'rgba(59,130,246,0.11)',
    iconColor: '#60a5fa',
    iconBg: 'rgba(59,130,246,0.2)',
    glow: 'rgba(59,130,246,0.35)',
    getValue: (s: DashboardStats) => s.watchlist_count,
    getSub:   () => null,
  },
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

function insetCard(): React.CSSProperties {
  return {
    background: 'var(--card-bg)',
  };
}

const XRAY_STEP_LABELS: Record<string, string> = {
  queued: 'Queued',
  warming_cache: 'Warming Cache',
  indexing_artifact: 'Indexing Artifact',
  queued_in_xray: 'Queued in Xray',
  waiting_for_xray: 'Waiting for Xray',
  importing_results: 'Importing Results',
  failed: 'Failed',
  completed: 'Completed',
};

const XRAY_PIPELINE_STEPS = [
  'warming_cache',
  'indexing_artifact',
  'queued_in_xray',
  'waiting_for_xray',
  'importing_results',
] as const;

function formatStepLabel(step?: string): string {
  if (!step) return XRAY_STEP_LABELS.queued;
  return XRAY_STEP_LABELS[step] ?? step.replace(/_/g, ' ');
}

function scanContextLabel(scan: Scan): string {
  if (scan.scan_provider === 'artifactory_xray') {
    if (scan.status === 'failed' && scan.external_status === 'blocked_by_xray_policy') {
      return 'Artifactory Xray · blocked by policy';
    }
    if (scan.status === 'running' || scan.status === 'pending') {
      return `Artifactory Xray · ${formatStepLabel(scan.current_step)}`;
    }
    return 'Artifactory Xray';
  }
  return 'Built-in scanner';
}

function formatDbAge(hours?: number | null): string {
  if (hours == null || Number.isNaN(hours)) return 'Unknown';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function buildScansHref(filters?: { status?: string; image?: string }): string {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.image) params.set('image', filters.image);
  const query = params.toString();
  return query ? `/scans?${query}` : '/scans';
}


function calcTrend(data: number[]): { pct: number; dir: 'up' | 'down' | 'flat' } {
  if (data.length < 4) return { pct: 0, dir: 'flat' };
  const half = Math.floor(data.length / 2);
  const prev = data.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const curr = data.slice(half).reduce((a, b) => a + b, 0) / (data.length - half);
  if (prev === 0 && curr === 0) return { pct: 0, dir: 'flat' };
  if (prev === 0) return { pct: 100, dir: 'up' };
  const rawPct = ((curr - prev) / prev) * 100;
  const absPct = Math.abs(Math.round(rawPct));
  return { pct: absPct, dir: absPct < 3 ? 'flat' : rawPct > 0 ? 'up' : 'down' };
}

function RecentScanRow({ scan }: { scan: Scan }) {
	const eventTime = scan.started_at ?? scan.created_at;
  return (
    <Link
      href={`/scans/${scan.id}`}
      className="flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors duration-150 group"
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="flex items-center gap-2.5 min-w-0">
    <div className="shrink-0 pt-0.5">
      <StatusBadge status={scan.status} externalStatus={scan.external_status} />
    </div>
        <div className="min-w-0">
          <p className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">
            {scan.image_name}:{scan.image_tag}
          </p>
      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
        <p className="text-[11px] text-zinc-500">{scanContextLabel(scan)}</p>
        <span className="text-[11px] text-zinc-400" title={fullDate(eventTime)}>{timeAgo(eventTime)}</span>
      </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {scan.critical_count > 0 && (
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md"
            style={{ color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.18)' }}>
            C:{scan.critical_count}
          </span>
        )}
        {scan.high_count > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
            style={{ color: '#fb923c', background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.18)' }}>
            H:{scan.high_count}
          </span>
        )}
        {scan.medium_count > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
            style={{ color: '#fbbf24', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.18)' }}>
            M:{scan.medium_count}
          </span>
        )}
      </div>
    </Link>
  );
}

function OperationTile({
  href,
  label,
  value,
  description,
  color,
  background,
  border,
}: {
  href: string;
  label: string;
  value: number;
  description: string;
  color: string;
  background: string;
  border: string;
}) {
  return (
    <Link href={href} className="rounded-2xl p-4 transition-transform hover:-translate-y-0.5" style={{ background, border: `1px solid ${border}` }}>
    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color }}>{label}</p>
    <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">{value}</p>
    <p className="mt-3 text-xs text-zinc-500">{description}</p>
    </Link>
  );
}

// ── Mini Sparkline ────────────────────────────────────────────────────
function MiniSparkline({ data, color, id }: { data: { date: string; value: number }[]; color: string; id: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(200);
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => setW(entry!.contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);
  if (data.length < 2) return null;

  const H = 52, SPARK_TOP = 18, PAD = 3;
  const sparkH = H - SPARK_TOP;
  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = data.map((_, i) => [
    (i / (data.length - 1)) * W,
    SPARK_TOP + sparkH - PAD - ((values[i]! - min) / range) * (sparkH - PAD * 2),
  ] as [number, number]);

  let path = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const cpx = ((pts[i - 1]![0] + pts[i]![0]) / 2).toFixed(1);
    path += ` C${cpx},${pts[i - 1]![1].toFixed(1)} ${cpx},${pts[i]![1].toFixed(1)} ${pts[i]![0].toFixed(1)},${pts[i]![1].toFixed(1)}`;
  }

  const last = pts[pts.length - 1]!;
  const gradId = `sg-${id}`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setHoverIdx(Math.max(0, Math.min(data.length - 1, Math.round((x / W) * (data.length - 1)))));
  };

  const hp = hoverIdx !== null ? pts[hoverIdx] : null;
  const hd = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div ref={containerRef} className="w-full">
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full cursor-crosshair"
      style={{ height: H }}
      aria-hidden
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={`${path} L${W},${H} L0,${H} Z`} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 2px ${color}88)` }} />

      {hp && hd ? (
        <>
          <line x1={hp[0]} x2={hp[0]} y1={SPARK_TOP} y2={H}
            stroke={color} strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 3" />
          <circle cx={hp[0]} cy={hp[1]} r="3" fill={color}
            style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
          {(() => {
            const dateStr = new Date(hd.date).toLocaleDateString('en', { month: 'short', day: 'numeric' });
            const pillW = 78;
            const pillX = Math.max(1, Math.min(W - pillW - 1, hp[0] - pillW / 2));
            return (
              <g>
                <rect x={pillX} y={1.5} width={pillW} height={14} rx={3.5}
                  fill="rgba(10,10,15,0.82)" stroke={color} strokeOpacity={0.4} strokeWidth={0.75} />
                <text x={pillX + 8} y={11.5} fontSize={9} fontWeight="700" fill={color} fontFamily="ui-monospace,monospace">
                  {hd.value}
                </text>
                <text x={pillX + pillW - 6} y={11.5} textAnchor="end" fontSize={8.5} fill="rgba(255,255,255,0.5)" fontFamily="ui-sans-serif,system-ui">
                  {dateStr}
                </text>
              </g>
            );
          })()}
        </>
      ) : (
        <circle cx={last[0]} cy={last[1]} r="2.5" fill={color}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      )}
    </svg>
    </div>
  );
}


// ── Vulnerability Trend Chart ─────────────────────────────────────────

// Stack order: low at bottom, critical at top (most severe is most visible)
const STACK = [
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => setW(entry!.contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const filled = fillDates(data, period);
  const hasData = filled.some(d => d.critical + d.high + d.medium + d.low > 0);

  // SVG layout
  const H = 160;
  const PAD_L = 42, PAD_R = 8, PAD_T = 10, PAD_B = 26;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // Y scale
  const stackMax = Math.max(...filled.map(d => d.critical + d.high + d.medium + d.low), 1);
  const ticks = niceTicks(stackMax);
  const topTick = ticks[ticks.length - 1]!;

  function yVal(v: number) {
    return PAD_T + chartH - (v / topTick) * chartH;
  }

  // Bar dimensions
  const n = filled.length;
  const barSlot = chartW / n;
  const barW = Math.min(28, barSlot * 0.68);

  function barX(i: number) {
    return PAD_L + (i + 0.5) * barSlot - barW / 2;
  }

  // Hover detection: convert SVG x to bar index
  function svgXtoIdx(svgX: number) {
    const rel = svgX - PAD_L;
    return Math.max(0, Math.min(n - 1, Math.floor(rel / barSlot)));
  }

  // X-axis labels: show at most 7, evenly distributed
  const xLabelStep = Math.max(1, Math.ceil(n / 7));
  const xLabelIndices = new Set<number>();
  for (let i = 0; i < n; i += xLabelStep) xLabelIndices.add(i);
  xLabelIndices.add(n - 1);

  const hoverPoint = hoverIdx !== null ? filled[hoverIdx] : null;
  const PERIODS = [7, 14, 30] as const;

  return (
    <div className="relative rounded-2xl p-5 z-10" style={glassCard()}>
      <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.2), transparent)' }} />

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(124,58,237,0.2)', boxShadow: '0 0 14px rgba(124,58,237,0.3)' }}>
            <Activity01Icon size={17} color="#a78bfa" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Avg. Findings per Scan</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Average vulnerabilities per finalized scan, by day</p>
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
        {[...STACK].reverse().map(({ key, label, color }) => (
          <span key={key} className="flex items-center gap-1.5 text-xs" style={{ color }}>
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="w-full">
      {!hasData ? (
        <div className="flex items-center justify-center text-sm text-zinc-500 py-10">
          No finalized scans in this period
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full cursor-crosshair select-none"
          style={{ height: H }}
          aria-label={`Average vulnerabilities per scan — last ${period} days`}
          onMouseMove={e => {
            const r = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - r.left) / r.width) * W;
            setHoverIdx(svgXtoIdx(svgX));
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Y-axis gridlines + labels */}
          {ticks.map(t => {
            const y = yVal(t);
            const isBase = t === 0;
            return (
              <g key={t}>
                <line
                  x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                  stroke="var(--row-divider)"
                  strokeWidth={isBase ? 1 : 0.5}
                  strokeDasharray={isBase ? undefined : '4 4'}
                />
                <text
                  x={PAD_L - 5} y={y + 3.5}
                  textAnchor="end" fontSize={8}
                  fill="rgba(113,113,122,0.75)"
                  fontFamily="ui-sans-serif,system-ui"
                >
                  {fmtTick(t)}
                </text>
              </g>
            );
          })}

          {/* Stacked bars */}
          {filled.map((d, i) => {
            const isHovered = hoverIdx === i;
            let baseline = PAD_T + chartH; // start at bottom

            return (
              <g key={d.date}>
                {/* Hover highlight background */}
                {isHovered && (
                  <rect
                    x={PAD_L + i * barSlot} y={PAD_T}
                    width={barSlot} height={chartH}
                    fill="rgba(167,139,250,0.06)"
                  />
                )}

                {/* Bar segments, bottom → top */}
                {STACK.map(({ key, color, opacity }) => {
                  const val = d[key];
                  if (val <= 0) return null;
                  const segH = (val / topTick) * chartH;
                  const y = baseline - segH;
                  baseline = y;
                  return (
                    <rect
                      key={key}
                      x={barX(i)} y={y}
                      width={barW} height={segH}
                      fill={color} fillOpacity={isHovered ? 1 : opacity}
                      rx={i === 0 || val === d[key] ? 1 : 0}
                    />
                  );
                })}

                {/* Top rounded cap on hovered bar */}
                {isHovered && (() => {
                  const total = d.critical + d.high + d.medium + d.low;
                  if (total === 0) return null;
                  const topY = PAD_T + chartH - (total / topTick) * chartH;
                  return <rect x={barX(i)} y={topY} width={barW} height={2} rx={1} fill="rgba(255,255,255,0.4)" />;
                })()}
              </g>
            );
          })}

          {/* X-axis date labels */}
          {filled.map((d, i) => {
            if (!xLabelIndices.has(i)) return null;
            const dateStr = new Date(d.date + 'T12:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric' });
            return (
              <text
                key={d.date}
                x={PAD_L + (i + 0.5) * barSlot}
                y={H - 5}
                textAnchor="middle" fontSize={8}
                fill="rgba(113,113,122,0.7)"
                fontFamily="ui-sans-serif,system-ui"
              >
                {dateStr}
              </text>
            );
          })}

          {/* Hover tooltip */}
          {hoverIdx !== null && hoverPoint && (() => {
            const total = hoverPoint.critical + hoverPoint.high + hoverPoint.medium + hoverPoint.low;
            const dateStr = new Date(hoverPoint.date + 'T12:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric' });
            const tipW = 122, tipH = total === 0 ? 36 : 94;
            const tipX = Math.max(PAD_L + 2, Math.min(W - PAD_R - tipW - 2, PAD_L + (hoverIdx + 0.5) * barSlot - tipW / 2));
            const tipY = PAD_T + 2;

            return (
              <g>
                <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={5}
                  fill="rgba(10,10,15,0.9)" stroke="rgba(167,139,250,0.25)" strokeWidth="0.75" />
                {/* Date */}
                <text x={tipX + 10} y={tipY + 14} fontSize={9} fontWeight="600"
                  fill="rgba(255,255,255,0.55)" fontFamily="ui-sans-serif,system-ui">
                  {dateStr}
                </text>
                {total === 0 ? (
                  <text x={tipX + 10} y={tipY + 27} fontSize={9} fill="rgba(113,113,122,0.8)" fontFamily="ui-sans-serif,system-ui">
                    No scans
                  </text>
                ) : (
                  <>
                    {[...STACK].reverse().map(({ key, label, color }, li) => (
                      <g key={key}>
                        <rect x={tipX + 10} y={tipY + 21 + li * 14} width={6} height={6} rx={1.5} fill={color} />
                        <text x={tipX + 20} y={tipY + 28 + li * 14} fontSize={9} fill={color} fontFamily="ui-monospace,monospace">
                          {label}: {hoverPoint[key]}
                        </text>
                      </g>
                    ))}
                    {/* Total */}
                    <line x1={tipX + 10} x2={tipX + tipW - 10}
                      y1={tipY + 78} y2={tipY + 78}
                      stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
                    <text x={tipX + 10} y={tipY + 89} fontSize={9} fontWeight="600"
                      fill="rgba(255,255,255,0.45)" fontFamily="ui-monospace,monospace">
                      Total: {total}
                    </text>
                  </>
                )}
              </g>
            );
          })()}
        </svg>
      )}
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trends, setTrends] = useState<DashboardTrendPoint[]>([]);
  const [vulnTrends, setVulnTrends] = useState<DashboardVulnTrendPoint[]>([]);
  const [vulnTrendPeriod, setVulnTrendPeriod] = useState(30);
  const [scannerHealth, setScannerHealth] = useState<ScannerHealth | null>(null);
  const [scannerHealthError, setScannerHealthError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentUser = getUser() as { role?: string } | null;
  const isAdmin = currentUser?.role === 'admin' || getTokenType() === 'admin';

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
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleVulnPeriodChange(days: number) {
    setVulnTrendPeriod(days);
    getDashboardVulnTrends(days)
      .then(setVulnTrends)
      .catch(() => setVulnTrends([]));
  }

  if (loading) return (
    <div className="relative p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header skeleton */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="skeleton h-8 w-36 rounded-lg" />
          <div className="skeleton h-4 w-52 rounded" />
        </div>
        <div className="skeleton h-9 w-28 rounded-xl" />
      </div>
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      {/* Recent scans + severity */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
        <div className="rounded-2xl p-5"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="skeleton w-9 h-9 rounded-xl" />
            <div className="space-y-1.5">
              <div className="skeleton h-4 w-28 rounded" />
              <div className="skeleton h-3 w-36 rounded" />
            </div>
          </div>
          {Array.from({ length: 6 }).map((_, i) => <RecentScanRowSkeleton key={i} />)}
        </div>
        <div className="rounded-2xl p-5"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
          <div className="skeleton h-4 w-36 rounded mb-4" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="mb-3">
              <div className="flex justify-between mb-1.5">
                <div className="skeleton h-3 w-16 rounded" />
                <div className="skeleton h-3 w-12 rounded" />
              </div>
              <div className="skeleton h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
      {/* Chart skeleton */}
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
  const hasCriticals = (stats.severity_totals['critical'] ?? 0) > 0;
  const priorityScans = (stats.recent_scans ?? [])
    .filter((scan) => scan.status === 'failed' || scan.status === 'running' || scan.status === 'pending' || scan.external_status === 'blocked_by_xray_policy')
    .slice(0, 5);
  const todayKey = new Date().toISOString().slice(0, 10);
  const startedTodayCount = [...trends].reverse().find((point) => point.date === todayKey)?.total ?? 0;
  const failedCount = stats.status_counts['failed'] ?? 0;
  const activeQueueCount = (stats.status_counts['running'] ?? 0) + (stats.status_counts['pending'] ?? 0);
  const blockedPolicyCount = stats.operations?.blocked_policy_count ?? stats.status_counts['blocked_by_xray_policy'] ?? 0;
  const activeXrayCount = stats.operations?.active_xray_count ?? 0;
  const activeXrayScans = stats.operations?.active_xray_scans ?? [];
  const activeXraySteps = stats.operations?.active_xray_step_counts ?? {};

  return (
    <div className="relative p-6 space-y-5 max-w-7xl mx-auto">
      {/* Ambient background orbs */}
      <div className="pointer-events-none" aria-hidden>
        <div className="fixed top-0 right-0 w-[560px] h-[560px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.09) 0%, transparent 70%)', filter: 'blur(48px)', zIndex: 0 }} />
        <div className="fixed bottom-0 left-64 w-[480px] h-[480px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(29,78,216,0.07) 0%, transparent 70%)', filter: 'blur(48px)', zIndex: 0 }} />
        {hasCriticals && (
          <div className="fixed top-1/2 right-1/3 w-[360px] h-[360px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(239,68,68,0.05) 0%, transparent 70%)', filter: 'blur(48px)', zIndex: 0 }} />
        )}
      </div>

      {/* ── Header ── */}
      <div className="relative flex items-start justify-between z-10">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">Security scan activity overview</p>
        </div>
        <Link
          href="/scans"
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
            boxShadow: '0 0 24px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
          }}
        >
          <Add01Icon size={15} />
          New Scan
        </Link>
      </div>

      {/* ── Stat cards ── */}
      <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 z-10">
        {STATS.map(({ key, trendKey, invertTrend, label, Icon, tint, iconColor, iconBg, glow, getValue, getSub }) => {
          const value = getValue(stats);
          const sub = getSub(stats);
          const sparkData = trendKey ? trends.slice(-14).map(d => ({ date: d.date, value: d[trendKey] })) : null;
          const trend = sparkData && sparkData.length >= 4 ? calcTrend(sparkData.map(d => d.value)) : null;
          const trendColor = trend && trend.dir !== 'flat'
            ? ((invertTrend ? trend.dir === 'down' : trend.dir === 'up') ? '#34d399' : '#f87171')
            : null;
          return (
            <div key={key} className="relative flex flex-col rounded-xl px-4 pt-3 pb-2 overflow-hidden gap-1.5" style={glassCard(tint)}>
              {/* Watermark */}
              <div className="absolute -right-2 -bottom-2 opacity-[0.05] pointer-events-none">
                <Icon size={56} color={iconColor} />
              </div>
              {/* Top row: icon + value + trend badge */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: iconBg, boxShadow: `0 0 14px ${glow}` }}>
                    <Icon size={17} color={iconColor} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight tabular-nums leading-none">{value}</p>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{label}</p>
                    {sub && (
                      <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: '#60a5fa' }}>
                        {sub.pulse && <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse shrink-0" />}
                        {sub.text}
                      </p>
                    )}
                  </div>
                </div>
                {trend && trend.dir !== 'flat' && trendColor && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 mt-0.5 tabular-nums"
                    style={{ color: trendColor, background: `${trendColor}1a`, border: `1px solid ${trendColor}30` }}>
                    {trend.dir === 'up' ? '↑' : '↓'} {trend.pct}%
                  </span>
                )}
              </div>
              {/* Sparkline */}
              {sparkData && sparkData.length >= 2 && (
                <div className="-mx-1">
                  <MiniSparkline data={sparkData} color={iconColor} id={key} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.95fr)] z-10">
        <div className="rounded-2xl p-5" style={glassCard('rgba(239,68,68,0.04)')}>
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Action Center</h2>
              <p className="text-xs text-zinc-500 mt-0.5">The scans most likely to need intervention right now.</p>
            </div>
            <Link href={buildScansHref({ status: 'failed' })} className="text-xs text-zinc-500 hover:text-violet-500 transition-colors">Open triage →</Link>
          </div>
          {priorityScans.length === 0 ? (
            <p className="text-sm text-zinc-500 py-10 text-center">No active triage items right now.</p>
          ) : (
            <div className="space-y-2">
              {priorityScans.map((scan) => (
                <RecentScanRow key={scan.id} scan={scan} />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl p-5" style={glassCard('rgba(59,130,246,0.04)')}>
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Quick Queues</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Direct links into the most common follow-up paths.</p>
            </div>
            <Link href="/scans" className="text-xs text-zinc-500 hover:text-violet-500 transition-colors">All scans →</Link>
          </div>
          <div className="space-y-2.5">
            <Link href={buildScansHref({ status: 'failed' })} className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-violet-500/5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              <div>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Failed scans</p>
                <p className="text-xs text-zinc-500 mt-0.5">General scan failures that likely need investigation.</p>
              </div>
              <span className="text-lg font-semibold" style={{ color: failedCount > 0 ? '#f87171' : 'var(--text-primary)' }}>{failedCount}</span>
            </Link>
            <Link href={buildScansHref({ status: 'failed' })} className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-violet-500/5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              <div>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Blocked by policy</p>
                <p className="text-xs text-zinc-500 mt-0.5">Xray policy blocks surfaced separately from generic failures.</p>
              </div>
              <span className="text-lg font-semibold" style={{ color: blockedPolicyCount > 0 ? '#f59e0b' : 'var(--text-primary)' }}>{blockedPolicyCount}</span>
            </Link>
            <Link href={buildScansHref({ status: 'running' })} className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-violet-500/5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              <div>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">In-flight queue</p>
                <p className="text-xs text-zinc-500 mt-0.5">Running and pending scans that are still moving through the system.</p>
              </div>
              <span className="text-lg font-semibold" style={{ color: activeQueueCount > 0 ? '#60a5fa' : 'var(--text-primary)' }}>{activeQueueCount}</span>
            </Link>
            <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Started today</p>
                  <p className="text-xs text-zinc-500 mt-0.5">New scan requests created since 00:00 UTC.</p>
                </div>
                <span className="text-lg font-semibold" style={{ color: '#a78bfa' }}>{startedTodayCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10">
        <div className="rounded-2xl p-5" style={glassCard('rgba(124,58,237,0.04)')}>
          <div className="flex items-center justify-between mb-4">
            <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Live Operations</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Provider-specific work that is still in motion, kept separate from triage.</p>
            </div>
            <Link href="/scans" className="text-xs text-zinc-500 hover:text-violet-500 transition-colors">Open scans →</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
      <OperationTile
        href="/scans"
        label="Started Today"
        value={startedTodayCount}
        description="New scan requests created since 00:00 UTC."
        color="#60a5fa"
        background="rgba(59,130,246,0.12)"
        border="rgba(59,130,246,0.2)"
      />
      <OperationTile
        href="/scans?status=running"
        label="Xray In Flight"
        value={activeXrayCount}
        description="Pending or running scans still moving through the Xray pipeline."
        color="#a78bfa"
        background="rgba(124,58,237,0.12)"
        border="rgba(124,58,237,0.2)"
      />
      <OperationTile
        href="/scans?status=failed"
        label="Policy Blocked"
        value={blockedPolicyCount}
        description="Scans blocked by Xray policy, surfaced separately from generic failures."
        color="#f59e0b"
        background="rgba(245,158,11,0.12)"
        border="rgba(245,158,11,0.2)"
      />
          </div>
      <div className="rounded-2xl p-4" style={insetCard()}>
        <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Active Xray Pipeline</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Current provider step for scans still in-flight.</p>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style={{ color: '#a78bfa', background: 'rgba(124,58,237,0.16)', border: '1px solid rgba(124,58,237,0.24)' }}>
          {activeXrayCount} live
        </span>
        </div>
        {activeXrayScans.length === 0 ? (
        <p className="text-sm text-zinc-500 py-10 text-center">No active Xray scans right now.</p>
        ) : (
        <div className="space-y-1.5">
          {activeXrayScans.map((scan) => (
          <RecentScanRow key={scan.id} scan={scan} />
          ))}
        </div>
        )}
        <details className="mt-4 group rounded-2xl p-4" style={insetCard()}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Live Step Breakdown</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Expand only when you need provider-specific pipeline detail.</p>
            </div>
            <span className="text-xs font-medium text-zinc-500 group-open:text-violet-500">{activeXrayCount} live</span>
          </summary>
          <div className="mt-4 space-y-2.5">
          {XRAY_PIPELINE_STEPS.map((step) => {
            const count = activeXraySteps[step] ?? 0;
            const pct = activeXrayCount > 0 ? (count / activeXrayCount) * 100 : 0;
            return (
            <div key={step}>
              <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-xs text-zinc-600 dark:text-zinc-300">{formatStepLabel(step)}</span>
              <span className="text-[11px] font-mono text-zinc-500">{count}</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: 'var(--row-divider)' }}>
              <div className="h-1.5 rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, rgba(124,58,237,0.85), rgba(96,165,250,0.85))' }} />
              </div>
            </div>
            );
          })}
          </div>
          <p className="text-[11px] text-zinc-500 mt-4 leading-5">
          Findings widgets below count finalized results from completed scans and Xray policy-blocked scans that still imported findings. In-flight work is intentionally separated here so the top of the dashboard stays focused on decisions, not pipeline internals.
          </p>
        </details>
        </div>
        </div>
      </div>

      {isAdmin && (
        <div className="relative flex items-center flex-wrap gap-x-5 gap-y-2 rounded-xl px-4 py-2.5 z-10" style={glassCard('rgba(59,130,246,0.05)')}>
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 shrink-0">Scanner Health</span>
          {scannerHealthError ? (
            <span className="text-xs" style={{ color: '#f87171' }}>{scannerHealthError}</span>
          ) : scannerHealth ? (
            scannerHealth.local_scanner_enabled ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#34d399', boxShadow: '0 0 5px #34d399' }} />
                    {scannerHealth.healthy_workers} healthy
                  </span>
                  {scannerHealth.stale_workers > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#fbbf24', boxShadow: '0 0 5px #fbbf24' }} />
                      {scannerHealth.stale_workers} stale
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-500 ml-auto">
                  <span>Vuln DB <span className="font-semibold text-zinc-700 dark:text-zinc-300">{formatDbAge(scannerHealth.oldest_vuln_db_age_hours)}</span></span>
                  <span>Java DB <span className="font-semibold text-zinc-700 dark:text-zinc-300">{formatDbAge(scannerHealth.oldest_java_db_age_hours)}</span></span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.18)' }}>
                    Max {scannerHealth.max_allowed_age_hours}h
                  </span>
                </div>
              </>
            ) : (
              <span className="text-xs text-zinc-500">{scannerHealth.message || 'Local scanner disabled for this deployment.'}</span>
            )
          ) : (
            <span className="text-xs text-zinc-500">No data available</span>
          )}
        </div>
      )}

      <div className="relative z-10 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Security Landscape</p>
          <p className="text-sm text-zinc-500 mt-1">Longer-horizon distribution and trend data lives below the action-oriented sections.</p>
        </div>
        <Link href="/scans" className="text-xs text-zinc-500 hover:text-violet-500 transition-colors">Open scans →</Link>
      </div>

      {/* ── Vulnerability landscape ── */}
      <div className="relative rounded-2xl p-5 z-10" style={glassCard()}>
        {/* Top edge shimmer */}
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.2), transparent)' }} />

        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(124,58,237,0.2)', boxShadow: '0 0 14px rgba(124,58,237,0.3)' }}>
              <Activity01Icon size={17} color="#a78bfa" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Vulnerability Landscape</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Across all finalized scan results</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-zinc-900 dark:text-white tabular-nums">{totalVulns.toLocaleString()}</p>
            <p className="text-xs text-zinc-500">total findings</p>
          </div>
        </div>

        <div className="space-y-3">
          {SEV.map(({ key, label, hex, glow, grad }) => {
            const count = stats.severity_totals[key] ?? 0;
            const pct   = totalVulns > 0 ? (count / totalVulns) * 100 : 0;
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs font-medium w-14 shrink-0 tabular-nums" style={{ color: hex }}>
                  {label}
                </span>
                <div className="flex-1 rounded-full h-2 overflow-hidden"
                  style={{ background: 'var(--row-divider)' }}>
                  <div
                    className="h-2 rounded-full transition-all duration-700"
                    style={{
                      width: `${pct}%`,
                      background: grad,
                      boxShadow: pct > 2 ? `0 0 10px ${glow}` : undefined,
                    }}
                  />
                </div>
                <span
                  className="text-xs font-mono font-bold w-14 text-right shrink-0 px-2 py-0.5 rounded-lg tabular-nums"
                  style={{
                    color: hex,
                    background: glow.replace('0.35', '0.1').replace('0.3', '0.08').replace('0.25', '0.07'),
                    border: `1px solid ${glow.replace('0.35', '0.18').replace('0.3', '0.15').replace('0.25', '0.12')}`,
                  }}
                >
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Vulnerability Trend Chart ── */}
      <VulnTrendChart data={vulnTrends} period={vulnTrendPeriod} onPeriod={handleVulnPeriodChange} />

      <div className="relative z-10 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Recent Activity</p>
          <p className="text-sm text-zinc-500 mt-1">Keep the most recent work visible, and collapse the lower-value frequency view by default.</p>
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div className="relative grid md:grid-cols-2 gap-4 z-10">
        {/* Recent scans */}
        <div className="relative rounded-2xl p-5" style={glassCard()}>
          <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.15), transparent)' }} />
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <Clock01Icon size={14} color="#71717a" />
              </div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Recent Scans</h2>
            </div>
            <Link href="/scans" className="text-xs text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
              View all →
            </Link>
          </div>
          {(stats.recent_scans ?? []).length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">No scans yet</p>
          ) : (
            <div className="space-y-0.5 -mx-1">
              {(stats.recent_scans ?? []).map((s) => <RecentScanRow key={s.id} scan={s} />)}
            </div>
          )}
        </div>

        {/* Top scanned images */}
        <div className="relative rounded-2xl p-5" style={glassCard()}>
          <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.15), transparent)' }} />
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  <Shield01Icon size={14} color="#71717a" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Top Scanned Images</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Frequency view for repeated scan activity.</p>
                </div>
              </div>
              <span className="text-xs font-medium text-zinc-500 group-open:text-violet-500">Expand</span>
            </summary>
            {(stats.top_images ?? []).length === 0 ? (
              <p className="text-sm text-zinc-500 py-8 text-center">No data yet</p>
            ) : (
              <div className="space-y-1.5 pt-4">
                {(stats.top_images ?? []).map((img, i) => (
                  <div
                    key={img.image_name}
                    className="flex items-center gap-3 px-2.5 py-2 rounded-xl"
                    style={{ background: 'var(--row-hover)', border: '1px solid var(--row-divider)' }}
                  >
                    <span
                      className="text-xs font-bold w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                      style={i === 0
                        ? { background: 'rgba(124,58,237,0.25)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }
                        : { background: 'var(--row-divider)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }
                      }
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 font-mono text-xs text-zinc-700 dark:text-zinc-300 truncate">{img.image_name}</span>
                    <span
                      className="text-xs font-mono shrink-0 px-2 py-0.5 rounded-lg"
                      style={{ color: 'var(--text-muted)', background: 'var(--row-divider)', border: '1px solid var(--glass-border)' }}
                    >
                      {img.count}×
                    </span>
                  </div>
                ))}
              </div>
            )}
          </details>
        </div>
      </div>
    </div>
  );
}
