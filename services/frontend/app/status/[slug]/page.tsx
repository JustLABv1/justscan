'use client';

import { Logo } from '@/components/logo';
import { ApiError, getStatusPageBySlug, getToken, StatusPageItem, StatusPageResponse } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const AUTO_REFRESH_MS = 30000;

// ── Severity colours (used only in charts + numbers) ──────────────────────────
const SEV = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#71717a',
} as const;

// ── Status dot colours ────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  healthy:   '#22c55e',
  degraded:  '#f97316',
  stale:     '#eab308',
  failed:    '#ef4444',
  pending:   '#a78bfa',
  running:   '#60a5fa',
  cancelled: '#52525b',
};

// ── Tiny inline SVG donut chart ───────────────────────────────────────────────
function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const r = 36;
  const cx = 44;
  const cy = 44;
  const circumference = 2 * Math.PI * r;

  const slices = data.map((d, i) => {
    const pct = d.value / total;
    const dashArray = `${pct * circumference} ${circumference}`;
    const prevOffset = data.slice(0, i).reduce((s, x) => s + x.value / total, 0);
    const dashOffset = circumference - prevOffset * circumference;
    return { ...d, dashArray, dashOffset };
  });

  return (
    <svg width={88} height={88} viewBox="0 0 88 88" className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} />
      {slices.map(s => (
        <circle
          key={s.label}
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={10}
          strokeDasharray={s.dashArray}
          strokeDashoffset={s.dashOffset}
          strokeLinecap="butt"
          style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px`, transition: 'stroke-dasharray 600ms ease' }}
        />
      ))}
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={600} fill="white">{total}</text>
    </svg>
  );
}

// ── Horizontal stacked bar for severity breakdown ─────────────────────────────
function SeverityBar({ item }: { item: StatusPageItem }) {
  const total = item.critical_count + item.high_count + item.medium_count + item.low_count;
  if (total === 0) {
    return (
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-white/5" />
        <span className="text-xs text-zinc-500 tabular-nums w-12 text-right">0 vulns</span>
      </div>
    );
  }
  const segments = [
    { key: 'critical', count: item.critical_count, color: SEV.critical },
    { key: 'high',     count: item.high_count,     color: SEV.high },
    { key: 'medium',   count: item.medium_count,   color: SEV.medium },
    { key: 'low',      count: item.low_count,       color: SEV.low },
  ].filter(s => s.count > 0);

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        {segments.map(s => (
          <div
            key={s.key}
            className="h-full transition-all duration-700"
            style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <span className="text-xs text-zinc-500 tabular-nums w-16 text-right">{total.toLocaleString()} vulns</span>
    </div>
  );
}

// ── Delta badge ───────────────────────────────────────────────────────────────
function Delta({ value }: { value?: number }) {
  if (!value) return null;
  const up = value > 0;
  return (
    <span className={`text-[10px] font-medium tabular-nums ${up ? 'text-red-400' : 'text-emerald-400'}`}>
      {up ? `+${value}` : value}
    </span>
  );
}

// ── Status indicator dot ──────────────────────────────────────────────────────
function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.pending;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize text-zinc-400">
      <span className="relative flex h-2 w-2">
        {(status === 'running' || status === 'pending') && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />
        )}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
      </span>
      {status}
    </span>
  );
}

// ── Single metric tile ────────────────────────────────────────────────────────
function MetricTile({
  label, value, delta, color, sub,
}: {
  label: string; value: React.ReactNode; delta?: number; color?: string; sub?: string;
}) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3.5 gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums leading-none" style={{ color: color ?? 'var(--text-primary)' }}>
          {value}
        </span>
        {delta !== undefined ? <Delta value={delta} /> : sub ? <span className="text-[11px] text-zinc-600">{sub}</span> : null}
      </div>
    </div>
  );
}

// ── Image item card ───────────────────────────────────────────────────────────
function ItemCard({ item, index }: { item: StatusPageItem; index: number }) {
  const color = STATUS_COLOR[item.status] ?? STATUS_COLOR.pending;

  return (
    <div
      className="status-item-enter relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-all duration-200 hover:border-white/[0.1] hover:bg-white/[0.04]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* left accent bar */}
      <div className="absolute inset-y-0 left-0 w-0.5 rounded-full" style={{ background: color }} />

      <div className="px-5 py-4 md:px-6 md:py-5 space-y-4">
        {/* header row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Image
              </span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-400">
                {item.image_tag}
              </span>
            </div>
            <p className="font-mono text-sm font-medium text-zinc-100 break-all leading-relaxed">
              {item.image_name}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-600">
              <span>Observed {timeAgo(item.observed_at)}</span>
              <span>·</span>
              <span className="capitalize">Scan {item.scan_status}</span>
              {item.previous_scan_at && (
                <>
                  <span>·</span>
                  <span>Prev {timeAgo(item.previous_scan_at)}</span>
                </>
              )}
            </div>
          </div>
          <StatusDot status={item.status} />
        </div>

        {/* severity bar */}
        <SeverityBar item={item} />

        {/* metrics grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <MetricTile label="Critical" value={item.critical_count} delta={item.delta_critical_count} color={item.critical_count > 0 ? SEV.critical : undefined} />
          <MetricTile label="High"     value={item.high_count}     delta={item.delta_high_count}     color={item.high_count > 0     ? SEV.high     : undefined} />
          <MetricTile label="Medium"   value={item.medium_count}   delta={item.delta_medium_count}   color={item.medium_count > 0   ? SEV.medium   : undefined} />
          <MetricTile
            label="Freshness"
            value={`${item.freshness_hours}h`}
            sub={item.latest_scan_id ? 'tracked' : 'awaiting'}
            color="var(--text-primary)"
          />
        </div>

        {/* error */}
        {item.error_message && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-red-400 mb-1.5">Scan Error</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-red-300/80">
              {item.error_message}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Thin auto-refresh progress bar (top of page) ──────────────────────────────
function RefreshBar({ progress }: { progress: number }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[2px] bg-white/5">
      <div
        className="h-full transition-all duration-1000 ease-linear"
        style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #7c3aed, #a78bfa)' }}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<StatusPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(prev => prev); // keep existing data visible during refresh
      try {
        const result = await getStatusPageBySlug(slug);
        if (cancelled) return;
        setData(result);
        setError('');
        setNeedsAuth(false);
      } catch (err: unknown) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setNeedsAuth(true);
          setError('This status page requires authentication.');
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load status page');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLastLoadedAt(Date.now());
        }
      }
    }
    load();
    const interval = setInterval(load, AUTO_REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [slug]);

  const summary = useMemo(() => {
    const items = data?.items ?? [];
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc.critical += item.critical_count;
        acc.high += item.high_count;
        acc.medium += item.medium_count;
        acc.statuses[item.status] = (acc.statuses[item.status] ?? 0) + 1;
        return acc;
      },
      { total: 0, critical: 0, high: 0, medium: 0, statuses: {} as Record<string, number> },
    );
  }, [data]);

  const elapsedMs = lastLoadedAt ? Math.max(0, now - lastLoadedAt) : 0;
  const refreshProgress = Math.min(100, (elapsedMs / AUTO_REFRESH_MS) * 100);
  const secondsRemaining = Math.max(0, Math.ceil((AUTO_REFRESH_MS - Math.min(elapsedMs, AUTO_REFRESH_MS)) / 1000));

  const donutData = Object.entries(summary.statuses).map(([status, count]) => ({
    label: status,
    value: count,
    color: STATUS_COLOR[status] ?? '#52525b',
  }));

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center app-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
            <Logo size={18} className="text-white" />
          </div>
          <div className="w-6 h-6 rounded-full border-2 border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      </div>
    );
  }

  // ── Error / no data ────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center px-6">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-8 max-w-md text-center space-y-4">
          <div className="w-11 h-11 rounded-2xl mx-auto flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
            <Logo size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Status Page Unavailable</h1>
            <p className="text-sm text-zinc-500 mt-1.5">{error}</p>
          </div>
          {needsAuth && !getToken() && (
            <Link href={`/login?returnUrl=/status/${slug}`} className="inline-flex px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
              Sign in to continue
            </Link>
          )}
        </div>
      </div>
    );
  }

  const activeUpdate = data.page.updates?.[0];

  return (
    <div className="min-h-screen app-bg">
      <RefreshBar progress={refreshProgress} />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
              <Logo size={16} className="text-white" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-600">JustScan Status</p>
              <h1 className="text-xl font-semibold text-zinc-100 leading-tight">{data.page.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="capitalize rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1">{data.page.visibility}</span>
            <span>Updated {timeAgo(data.page.updated_at)}</span>
            <span className="tabular-nums text-zinc-600">Refresh in {secondsRemaining}s</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* ── Active update banner ─────────────────────────────────────────── */}
        {activeUpdate && (
          <div className={`rounded-2xl border px-5 py-4 ${
            activeUpdate.level === 'incident'    ? 'border-red-500/20 bg-red-500/5' :
            activeUpdate.level === 'maintenance' ? 'border-yellow-500/20 bg-yellow-500/5' :
                                                   'border-blue-500/20 bg-blue-500/5'
          }`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-zinc-100">{activeUpdate.title}</p>
                {activeUpdate.body && <p className="text-sm text-zinc-400 mt-1">{activeUpdate.body}</p>}
              </div>
              <span className="text-[10px] uppercase tracking-widest text-zinc-500">{activeUpdate.level}</span>
            </div>
          </div>
        )}

        {/* ── Summary ──────────────────────────────────────────────────────── */}
        <section className="flex flex-col sm:flex-row items-start gap-6">
          {/* donut + legend */}
          <div className="flex items-center gap-5 shrink-0">
            <DonutChart data={donutData} />
            <div className="space-y-1.5">
              {donutData.map(d => (
                <div key={d.label} className="flex items-center gap-2 text-[11px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="capitalize text-zinc-400">{d.label}</span>
                  <span className="font-semibold text-zinc-200 tabular-nums">{d.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* stat tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 flex-1 w-full">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 flex flex-col justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Tracked Tags</p>
              <p className="text-3xl font-semibold tabular-nums text-zinc-100">{summary.total}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 flex flex-col justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Critical</p>
              <p className="text-3xl font-semibold tabular-nums" style={{ color: summary.critical > 0 ? SEV.critical : '#52525b' }}>
                {summary.critical.toLocaleString()}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 flex flex-col justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">High</p>
              <p className="text-3xl font-semibold tabular-nums" style={{ color: summary.high > 0 ? SEV.high : '#52525b' }}>
                {summary.high.toLocaleString()}
              </p>
            </div>
          </div>
        </section>

        {/* description */}
        {data.page.description && (
          <p className="text-sm text-zinc-500 -mt-2">{data.page.description}</p>
        )}

        {/* ── Image tag list ────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Tracked Image Tags
            </h2>
            <span className="text-[11px] text-zinc-600">{data.items.length} images</span>
          </div>
          <div className="space-y-3">
            {data.items.map((item, i) => (
              <ItemCard key={`${item.image_name}:${item.image_tag}`} item={item} index={i} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
