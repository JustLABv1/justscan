'use client';
import { StatusBadge } from '@/components/ui/badges';
import { ChartSkeleton, RecentScanRowSkeleton } from '@/components/ui/skeleton';
import { DashboardStats, DashboardTrendPoint, DashboardVulnTrendPoint, getDashboardTrends, getDashboardVulnTrends, getScannerHealth, getStats, getTokenType, getUser, Scan, ScannerHealth } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { Activity01Icon, Add01Icon } from 'hugeicons-react';
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
  const [attentionFilter, setAttentionFilter] = useState<'all' | 'failed' | 'blocked' | 'running'>('all');
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
  const failedCount = stats.status_counts['failed'] ?? 0;
  const activeQueueCount = (stats.status_counts['running'] ?? 0) + (stats.status_counts['pending'] ?? 0);
  const blockedPolicyCount = stats.operations?.blocked_policy_count ?? stats.status_counts['blocked_by_xray_policy'] ?? 0;
  const activeXrayCount = stats.operations?.active_xray_count ?? 0;
  const completedCount = stats.status_counts['completed'] ?? 0;
  const needsAttentionTotal = failedCount + blockedPolicyCount;
  const successRate = stats.total_scans > 0 ? Math.round((completedCount / stats.total_scans) * 100) : 0;

  const allAttentionScans = (stats.recent_scans ?? []).filter((scan) => {
    const isFailed = scan.status === 'failed';
    const isBlocked = scan.external_status === 'blocked_by_xray_policy';
    const isRunning = scan.status === 'running' || scan.status === 'pending';
    if (attentionFilter === 'failed') return isFailed && !isBlocked;
    if (attentionFilter === 'blocked') return isBlocked;
    if (attentionFilter === 'running') return isRunning;
    return isFailed || isBlocked;
  });
  const displayedAttentionScans = allAttentionScans.slice(0, 7);
  const moreAttentionCount = allAttentionScans.length - displayedAttentionScans.length;
  const triageHref = attentionFilter === 'running' ? buildScansHref({ status: 'running' }) : buildScansHref({ status: 'failed' });
  const sparkTrends = trends.slice(-30).map((d) => ({ date: d.date, value: d.total }));

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Dashboard</h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
            {new Date().toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Link
          href="/scans"
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 active:scale-95"
          style={{ background: '#7c3aed' }}
        >
          <Add01Icon size={14} />
          New Scan
        </Link>
      </div>

      {/* ── Stat strip ── */}
      <div className="overflow-x-auto rounded-xl" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))' }}>
          <div className="px-5 py-4" style={{ borderRight: '1px solid var(--glass-border)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>Total Scans</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight" style={{ color: 'var(--text-primary)' }}>{stats.total_scans.toLocaleString()}</p>
            <p className="mt-1.5 text-[11px] flex items-center gap-1.5" style={{ color: activeQueueCount > 0 ? '#60a5fa' : 'var(--text-faint)' }}>
              {activeQueueCount > 0 && <span className="h-1.5 w-1.5 rounded-full inline-block shrink-0 animate-pulse" style={{ background: '#60a5fa' }} />}
              {activeQueueCount > 0 ? `${activeQueueCount} running` : 'none running'}
            </p>
          </div>
          <div className="px-5 py-4" style={{ borderRight: '1px solid var(--glass-border)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>Completed</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight" style={{ color: 'var(--text-primary)' }}>{completedCount.toLocaleString()}</p>
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>{successRate}% success rate</p>
          </div>
          <div className="px-5 py-4" style={{ borderRight: '1px solid var(--glass-border)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>Needs Attention</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight" style={{ color: needsAttentionTotal > 0 ? '#f87171' : 'var(--text-primary)' }}>{needsAttentionTotal}</p>
            <p className="mt-1.5 text-[11px] flex items-center gap-2">
              {failedCount > 0 && <span style={{ color: '#f87171' }}>{failedCount} failed</span>}
              {blockedPolicyCount > 0 && <span style={{ color: '#fb923c' }}>{blockedPolicyCount} blocked</span>}
              {needsAttentionTotal === 0 && <span style={{ color: 'var(--text-faint)' }}>all clear</span>}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>Watchlist</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight" style={{ color: 'var(--text-primary)' }}>{stats.watchlist_count.toLocaleString()}</p>
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>{startedTodayCount} started today</p>
          </div>
        </div>
      </div>

      {/* ── Zone 2: Action + Context ── */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">

        {/* Needs Attention */}
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

          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {([
              { key: 'all' as const,     label: 'All',           count: needsAttentionTotal, activeBg: 'rgba(124,58,237,0.12)', activeBorder: 'rgba(124,58,237,0.3)',  activeColor: '#a78bfa' },
              { key: 'failed' as const,  label: 'Failed',        count: failedCount,         activeBg: 'rgba(239,68,68,0.1)',   activeBorder: 'rgba(239,68,68,0.3)',   activeColor: '#f87171' },
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

          {/* Scan list */}
          {displayedAttentionScans.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
              {attentionFilter === 'all' ? 'No failed or blocked scans.' : `No ${attentionFilter === 'blocked' ? 'policy-blocked' : attentionFilter} scans.`}
            </p>
          ) : (
            <div className="space-y-0.5 -mx-1">
              {displayedAttentionScans.map((scan) => <RecentScanRow key={scan.id} scan={scan} />)}
            </div>
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
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: '#34d399' }} />
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
          <div className="rounded-2xl p-5" style={glassCard()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Scan Volume</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>Total scans per day — last 30 days</p>
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
            {sparkTrends.length >= 2
              ? <MiniSparkline data={sparkTrends} color="#a78bfa" id="scan-volume" />
              : <div className="flex items-center justify-center py-8 text-sm" style={{ color: 'var(--text-faint)' }}>No trend data yet</div>
            }
          </div>

          {/* Avg findings per scan */}
          <VulnTrendChart data={vulnTrends} period={vulnTrendPeriod} onPeriod={handleVulnPeriodChange} />
        </div>
      </div>

      {/* ── Recent Scans (collapsible) ── */}
      <details className="group">
        <summary
          className="flex cursor-pointer list-none items-center justify-between rounded-xl px-5 py-3.5 transition-colors"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--glass-bg)')}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Scans</h2>
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
            <span className="group-open:hidden">Expand ▸</span>
            <span className="hidden group-open:inline">Collapse ▾</span>
          </span>
        </summary>
        {(stats.recent_scans ?? []).length > 0 && (
          <div className="mt-1 rounded-xl p-4" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
            <div className="space-y-0.5 -mx-1">
              {(stats.recent_scans ?? []).map((scan) => <RecentScanRow key={scan.id} scan={scan} />)}
            </div>
            <div className="mt-3 text-center">
              <Link
                href="/scans"
                className="text-xs transition-colors"
                style={{ color: 'var(--text-faint)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}
              >
                View all scans →
              </Link>
            </div>
          </div>
        )}
        {(stats.recent_scans ?? []).length === 0 && (
          <p className="mt-3 text-center text-sm" style={{ color: 'var(--text-faint)' }}>No scans yet</p>
        )}
      </details>

    </div>
  );
}

