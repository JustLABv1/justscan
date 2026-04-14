'use client';

import { Logo } from '@/components/logo';
import { createPublicHelmScans, extractPublicHelmImages, getPublicHelmScanRun, getToken, HelmRunItem, HelmScanRunDetail, reScanPublic } from '@/lib/api';
import { PublicHelmRunHistoryEntry, updateHelmPublicHistoryEntry } from '@/lib/publicScanHistory';
import { fullDate, timeAgo } from '@/lib/time';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string; label?: string }> = {
  completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.22)' },
  failed: { color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.22)' },
  running: { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.22)' },
  pending: { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: 'queued' },
  cancelled: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)' },
};

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="w-9 h-9" />;

  const isDark = resolvedTheme === 'dark';
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
      style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const state = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: state.color, background: state.bg, border: `1px solid ${state.border}` }}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${status === 'running' ? 'animate-pulse' : ''}`} />
      {state.label ?? status}
    </span>
  );
}

function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 rounded-xl" style={{ background: 'var(--table-header-bg)', border: '1px solid var(--border-subtle)' }}>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className={`text-xl font-bold font-mono ${color ?? ''}`} style={!color ? { color: 'var(--text-primary)' } : undefined}>{value}</span>
    </div>
  );
}

function toHistoryEntry(detail: HelmScanRunDetail): PublicHelmRunHistoryEntry {
  const latestScans = detail.items.map((item) => item.latest_scan);
  return {
    id: detail.run.id,
    chart_url: detail.run.chart_url,
    chart_name: detail.run.chart_name || undefined,
    chart_version: detail.run.chart_version || undefined,
    platform: detail.run.platform || undefined,
    total_images: latestScans.length,
    completed_images: latestScans.filter((scan) => scan.status === 'completed').length,
    failed_images: latestScans.filter((scan) => scan.status === 'failed').length,
    active_images: latestScans.filter((scan) => scan.status !== 'completed' && scan.status !== 'failed').length,
    critical_count: latestScans.reduce((sum, scan) => sum + (scan.critical_count ?? 0), 0),
    high_count: latestScans.reduce((sum, scan) => sum + (scan.high_count ?? 0), 0),
    medium_count: latestScans.reduce((sum, scan) => sum + (scan.medium_count ?? 0), 0),
    low_count: latestScans.reduce((sum, scan) => sum + (scan.low_count ?? 0), 0),
    created_at: detail.run.created_at,
  };
}

function guessChartNameFromUrl(url: string) {
  const cleaned = url.replace(/\/+$/, '');
  const segments = cleaned.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export default function PublicHelmRunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const runId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [detail, setDetail] = useState<HelmScanRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rescanningChart, setRescanningChart] = useState(false);
  const [retryingScanId, setRetryingScanId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const loadRun = useCallback(async (silent = false) => {
    if (!runId) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const nextDetail = await getPublicHelmScanRun(runId);
      setDetail(nextDetail);
      updateHelmPublicHistoryEntry(runId, toHistoryEntry(nextDetail));
      setActionError('');
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to load Helm run');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runId]);

  useEffect(() => setIsLoggedIn(!!getToken()), []);

  useEffect(() => {
    loadRun().catch(() => null);
  }, [loadRun]);

  const items = useMemo(() => detail?.items ?? [], [detail]);
  const latestScans = items.map((item) => item.latest_scan);
  const latestRun = detail?.run;
  const chartUrl = latestRun?.chart_url ?? '';
  const isOCI = chartUrl.startsWith('oci://');
  const displayUrl = chartUrl.replace(/^oci:\/\//, '');
  const totalImages = items.length;
  const completed = latestScans.filter((scan) => scan.status === 'completed').length;
  const failed = latestScans.filter((scan) => scan.status === 'failed').length;
  const pending = latestScans.filter((scan) => scan.status === 'pending' || scan.status === 'running').length;
  const totalCritical = latestScans.reduce((sum, scan) => sum + (scan.critical_count ?? 0), 0);
  const totalHigh = latestScans.reduce((sum, scan) => sum + (scan.high_count ?? 0), 0);
  const totalMedium = latestScans.reduce((sum, scan) => sum + (scan.medium_count ?? 0), 0);
  const totalLow = latestScans.reduce((sum, scan) => sum + (scan.low_count ?? 0), 0);

  useEffect(() => {
    if (!items.some((item) => item.latest_scan.status === 'pending' || item.latest_scan.status === 'running')) {
      return;
    }
    const timer = setInterval(() => {
      loadRun(true).catch(() => null);
    }, 5000);
    return () => clearInterval(timer);
  }, [items, loadRun]);

  async function handleRetryScan(scanId: string) {
    setRetryingScanId(scanId);
    setActionError('');
    try {
      await reScanPublic(scanId);
      await loadRun(true);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to retry scan');
    } finally {
      setRetryingScanId(null);
    }
  }

  async function handleRescanChart() {
    if (!latestRun || rescanningChart) return;

    const fallbackChartName = isOCI ? '' : guessChartNameFromUrl(latestRun.chart_url);
    const chartName = latestRun.chart_name || fallbackChartName;
    if (!isOCI && !chartName) {
      setActionError('Chart name is unavailable for this HTTP repository scan.');
      return;
    }

    setRescanningChart(true);
    setActionError('');
    try {
      const extracted = await extractPublicHelmImages(
        latestRun.chart_url,
        isOCI ? undefined : chartName,
        latestRun.chart_version || undefined,
      );
      const images = (extracted.images ?? []).map((img) => ({
        full_ref: img.full_ref,
        source_path: img.source_path,
      }));
      if (images.length === 0) {
        throw new Error('No images were extracted from this chart');
      }

      const created = await createPublicHelmScans(
        latestRun.chart_url,
        images,
        latestRun.platform || undefined,
        extracted.chart_name || chartName || undefined,
        extracted.chart_version || latestRun.chart_version || undefined,
      );

      if (!created.run?.id) {
        throw new Error('Helm run was created without a persisted run ID');
      }

      router.push(`/public/scan/helm/runs/${created.run.id}`);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to re-scan chart');
    } finally {
      setRescanningChart(false);
    }
  }

  if (!runId) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}>Invalid Helm run ID.</div>;
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--app-bg)' }}>
      <header
        className="sticky top-0 z-20 flex items-center justify-between px-6 py-4"
        style={{ background: 'var(--app-bg)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <Link href="/public/scan/helm" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', boxShadow: '0 0 12px rgba(124,58,237,0.4)' }}>
            <Logo size={16} className="text-white" />
          </div>
          <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadRun(true)}
            disabled={refreshing}
            className="text-sm px-3 py-1.5 rounded-xl font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={handleRescanChart}
            disabled={rescanningChart || !latestRun}
            className="text-sm px-3 py-1.5 rounded-xl font-medium transition-colors disabled:opacity-50"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#c4b5fd' }}
          >
            {rescanningChart ? 'Re-scanning…' : 'Re-scan chart'}
          </button>
          <ThemeToggle />
          <Link
            href={isLoggedIn ? '/scans' : '/login'}
            className="text-sm px-3 py-1.5 rounded-xl font-medium transition-colors"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            {isLoggedIn ? 'Dashboard →' : 'Sign in'}
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-5">
        {actionError && (
          <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
            {actionError}
          </div>
        )}

        <div>
          <Link
            href="/public/scan/helm"
            className="inline-flex items-center gap-1.5 text-sm transition-colors mb-3"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(event) => (event.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={(event) => (event.currentTarget.style.color = 'var(--text-muted)')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to Helm scans
          </Link>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={latestRun?.chart_name || chartUrl}>
                {latestRun?.chart_name || displayUrl || 'Helm run'}
              </h1>
              <p className="text-xs mt-1 font-mono truncate" style={{ color: 'var(--text-faint)' }} title={chartUrl}>{displayUrl}</p>
              <div className="flex items-center gap-3 mt-2 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
                {latestRun?.chart_version && <span>v{latestRun.chart_version}</span>}
                {latestRun?.platform && <span>{latestRun.platform}</span>}
                {latestRun?.created_at && <span title={fullDate(latestRun.created_at)}>Started {timeAgo(latestRun.created_at)}</span>}
                {latestRun && <span className="font-mono">Run {latestRun.id}</span>}
              </div>
            </div>

            <span
              className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                background: isOCI ? 'rgba(124,58,237,0.1)' : 'rgba(59,130,246,0.1)',
                color: isOCI ? '#a78bfa' : '#60a5fa',
                border: `1px solid ${isOCI ? 'rgba(124,58,237,0.2)' : 'rgba(59,130,246,0.2)'}`,
              }}
            >
              {isOCI ? 'OCI' : 'HTTP'}
            </span>
          </div>
        </div>

        {!loading && latestScans.length > 0 && (
          <div className="flex gap-3 flex-wrap [&>*]:flex-1 [&>*]:min-w-[90px]">
            <StatBox label="Images" value={totalImages} />
            <StatBox label="Completed" value={completed} color="text-emerald-400" />
            {pending > 0 && <StatBox label="Running" value={pending} color="text-blue-400" />}
            {failed > 0 && <StatBox label="Failed" value={failed} color="text-red-400" />}
            {totalCritical > 0 && <StatBox label="Critical" value={totalCritical} color="text-red-400 font-bold" />}
            {totalHigh > 0 && <StatBox label="High" value={totalHigh} color="text-orange-400" />}
            {totalMedium > 0 && <StatBox label="Medium" value={totalMedium} color="text-yellow-400" />}
            {totalLow > 0 && <StatBox label="Low" value={totalLow} color="text-blue-400" />}
            {totalCritical === 0 && totalHigh === 0 && completed > 0 && <StatBox label="Vulnerabilities" value="Clean ✓" color="text-emerald-400" />}
          </div>
        )}

        {loading && (
          <div className="rounded-2xl px-6 py-10 flex items-center justify-center gap-3 text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            <span className="w-4 h-4 rounded-full border-2 border-zinc-400/30 border-t-zinc-400 animate-spin" />
            Loading Helm run…
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="rounded-2xl px-6 py-10 text-center text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            No scans found for this Helm run.
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
            <div
              className="grid px-4 py-2.5 text-xs font-medium uppercase tracking-wide"
              style={{
                gridTemplateColumns: 'minmax(0,1fr) 120px minmax(0,1fr) 90px 90px 120px',
                background: 'var(--table-header-bg)',
                borderBottom: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)',
              }}
            >
              <span>Image</span>
              <span>Tag</span>
              <span>Source</span>
              <span className="text-center">Attempts</span>
              <span className="text-right">Status</span>
              <span className="text-right">Action</span>
            </div>

            {items.map((item: HelmRunItem, index) => {
              const scan = item.latest_scan;
              const retrying = retryingScanId === scan.id;
              return (
                <div
                  key={item.key}
                  className="grid items-center px-4 py-3 gap-2"
                  style={{
                    gridTemplateColumns: 'minmax(0,1fr) 120px minmax(0,1fr) 90px 90px 120px',
                    borderBottom: index < items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    background: 'var(--card-bg)',
                  }}
                >
                  <Link href={`/public/scan/${scan.id}`} className="text-sm font-mono truncate" style={{ color: 'var(--text-primary)' }} title={scan.image_name}>
                    {scan.image_name}
                  </Link>
                  <span className="text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }} title={scan.image_tag}>{scan.image_tag || 'latest'}</span>
                  <span className="text-xs truncate" style={{ color: 'var(--text-faint)' }} title={scan.helm_source_path ?? ''}>
                    {scan.helm_source_path || '—'}
                  </span>
                  <span className="text-center text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{item.attempt_count}</span>
                  <span className="flex justify-end"><StatusBadge status={scan.status} /></span>
                  <span className="flex justify-end">
                    {scan.status === 'failed' ? (
                      <button
                        type="button"
                        onClick={() => handleRetryScan(scan.id)}
                        disabled={retrying}
                        className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#c4b5fd' }}
                      >
                        {retrying ? 'Retrying…' : 'Retry failed'}
                      </button>
                    ) : (
                      <Link href={`/public/scan/${scan.id}`} className="text-xs font-medium" style={{ color: '#a78bfa' }}>
                        View →
                      </Link>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}