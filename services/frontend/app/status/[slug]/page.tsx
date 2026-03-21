'use client';

import { Logo } from '@/components/logo';
import { ApiError, getStatusPageBySlug, getToken, StatusPageItem, StatusPageResponse } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { Card } from '@heroui/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const STATUS_STYLES: Record<string, { color: string; background: string; border: string }> = {
  healthy: { color: '#4ade80', background: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.2)' },
  degraded: { color: '#fb923c', background: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.22)' },
  stale: { color: '#fbbf24', background: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)' },
  failed: { color: '#f87171', background: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.22)' },
  pending: { color: '#a78bfa', background: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.22)' },
  running: { color: '#60a5fa', background: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.22)' },
  cancelled: { color: '#a1a1aa', background: 'rgba(113,113,122,0.12)', border: 'rgba(113,113,122,0.22)' },
};

function StatusChip({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize"
      style={{ color: style.color, background: style.background, border: `1px solid ${style.border}` }}
    >
      {status}
    </span>
  );
}

function Delta({ value }: { value?: number }) {
  if (value === undefined || value === 0) return <span className="text-xs text-zinc-400">0</span>;
  return (
    <span className={`text-xs font-medium ${value > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

function ItemCard({ item }: { item: StatusPageItem }) {
  return (
    <Card className="glass-panel rounded-2xl p-5 space-y-4 status-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-zinc-700 dark:text-zinc-200">{item.image_name}:{item.image_tag}</p>
          <p className="text-xs text-zinc-500 mt-1">Observed {timeAgo(item.observed_at)}</p>
        </div>
        <StatusChip status={item.status} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="status-metric rounded-xl px-3 py-3 flex flex-col justify-between" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.14)' }}>
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Critical</p>
          <div className="flex items-end justify-between gap-2 mt-2">
            <span className="text-lg font-semibold text-red-400">{item.critical_count}</span>
            <Delta value={item.delta_critical_count} />
          </div>
        </div>
        <div className="status-metric rounded-xl px-3 py-3 flex flex-col justify-between" style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.14)' }}>
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">High</p>
          <div className="flex items-end justify-between gap-2 mt-2">
            <span className="text-lg font-semibold text-orange-400">{item.high_count}</span>
            <Delta value={item.delta_high_count} />
          </div>
        </div>
        <div className="status-metric rounded-xl px-3 py-3 flex flex-col justify-between" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.14)' }}>
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Medium</p>
          <div className="flex items-end justify-between gap-2 mt-2">
            <span className="text-lg font-semibold text-yellow-400">{item.medium_count}</span>
            <Delta value={item.delta_medium_count} />
          </div>
        </div>
        <div className="status-metric rounded-xl px-3 py-3 flex flex-col justify-between" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.14)' }}>
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Freshness</p>
          <div className="mt-2 space-y-1.5">
            <p className="text-lg font-semibold text-sky-400">{item.freshness_hours}h</p>
            <p className="text-xs text-zinc-500 leading-tight">Latest scan {item.scan_status}</p>
          </div>
        </div>
      </div>

      {item.error_message && (
        <div className="rounded-xl px-3 py-2.5 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.16)', color: '#fca5a5' }}>
          {item.error_message}
        </div>
      )}
    </Card>
  );
}

export default function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<StatusPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
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
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [slug]);

  const summary = useMemo(() => {
    const items = data?.items ?? [];
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc.critical += item.critical_count;
        acc.high += item.high_count;
        acc.statuses[item.status] = (acc.statuses[item.status] ?? 0) + 1;
        return acc;
      },
      { total: 0, critical: 0, high: 0, statuses: {} as Record<string, number> },
    );
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center app-bg">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen app-bg px-6 py-16 flex items-center justify-center">
        <div className="glass-panel rounded-3xl p-8 max-w-lg text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', boxShadow: '0 0 16px rgba(124,58,237,0.3)' }}>
            <Logo size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Status Page Unavailable</h1>
            <p className="text-sm text-zinc-500 mt-2">{error}</p>
          </div>
          {needsAuth && !getToken() && (
            <Link href={`/login?returnUrl=/status/${slug}`} className="inline-flex px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
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
      <header className="border-b px-6 py-5" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', boxShadow: '0 0 16px rgba(124,58,237,0.3)' }}>
              <Logo size={18} className="text-white" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">JustScan Status</p>
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">{data.page.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="px-2.5 py-1 rounded-full capitalize" style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)' }}>{data.page.visibility}</span>
            <span>Updated {timeAgo(data.page.updated_at)}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <section className="grid grid-cols-1 lg:grid-cols-[1.35fr,0.65fr] gap-6">
          <Card className="glass-panel rounded-3xl p-6 md:p-8 status-hero">
            <div className="absolute inset-x-0 top-0 h-24 opacity-80" style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.12) 0%, transparent 100%)' }} />
            <div className="relative space-y-3">
              <p className="text-sm text-zinc-500 max-w-3xl">{data.page.description || 'Current security status and scan freshness for the tracked image tags.'}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(summary.statuses).map(([status, count]) => (
                  <div key={status} className="rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)' }}>
                    <span className="text-zinc-500 capitalize">{status}</span>
                    <span className="ml-2 font-semibold text-zinc-900 dark:text-zinc-100">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <div className="glass-panel rounded-2xl p-4">
              <p className="text-xs uppercase tracking-wider text-zinc-500">Tracked Tags</p>
              <p className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">{summary.total}</p>
            </div>
            <div className="glass-panel rounded-2xl p-4">
              <p className="text-xs uppercase tracking-wider text-zinc-500">Critical</p>
              <p className="mt-2 text-3xl font-semibold text-red-400">{summary.critical}</p>
            </div>
            <div className="glass-panel rounded-2xl p-4">
              <p className="text-xs uppercase tracking-wider text-zinc-500">High</p>
              <p className="mt-2 text-3xl font-semibold text-orange-400">{summary.high}</p>
            </div>
            <div className="glass-panel rounded-2xl p-4">
              <p className="text-xs uppercase tracking-wider text-zinc-500">Refresh</p>
              <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">30s auto-refresh</p>
            </div>
          </div>
        </section>

        {activeUpdate && (
          <section className="rounded-2xl px-5 py-4" style={activeUpdate.level === 'incident'
            ? { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }
            : activeUpdate.level === 'maintenance'
            ? { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }
            : { background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.18)' }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{activeUpdate.title}</p>
                {activeUpdate.body && <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">{activeUpdate.body}</p>}
              </div>
              <span className="text-xs uppercase tracking-wider text-zinc-500">{activeUpdate.level}</span>
            </div>
          </section>
        )}

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Tracked Image Tags</h2>
              <p className="text-sm text-zinc-500 mt-0.5">Latest scan result, freshness, and change deltas per tag.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {data.items.map(item => <ItemCard key={`${item.image_name}:${item.image_tag}`} item={item} />)}
          </div>
        </section>
      </main>
    </div>
  );
}