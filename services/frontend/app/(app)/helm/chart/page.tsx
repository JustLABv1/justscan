'use client';
import { useToast } from '@/components/toast';
import { createShare, deleteShare, listScans, Scan } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import {
    ArrowLeft01Icon,
    PackageIcon,
    Refresh01Icon,
    Share01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

// ── Severity colour map ──────────────────────────────────────────────
const SEV: Record<string, string> = {
  critical: 'text-red-400 font-bold',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string; label?: string }> = {
  completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.22)' },
  failed:    { color: '#f87171', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.22)' },
  running:   { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.22)' },
  pending:   { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: 'queued' },
  cancelled: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${status === 'running' ? 'animate-pulse' : ''}`} />
      {s.label ?? status}
    </span>
  );
}

function SevCount({ count, cls }: { count: number; cls: string }) {
  return (
    <span className={`font-mono text-sm ${count ? cls : 'text-zinc-400 dark:text-zinc-700'}`}>
      {count || '—'}
    </span>
  );
}

// ── Stat box ─────────────────────────────────────────────────────────
function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div
      className="flex flex-col gap-0.5 px-4 py-3 rounded-xl"
      style={{ background: 'var(--table-header-bg)', border: '1px solid var(--border-subtle)' }}
    >
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-xl font-bold font-mono ${color ?? 'text-zinc-900 dark:text-zinc-100'}`}>
        {value}
      </span>
    </div>
  );
}

// ── Main page (requires Suspense boundary for useSearchParams) ───────
function HelmChartDetailContent() {
  const router = useRouter();
  const params = useSearchParams();
  const chartUrl = params.get('url') ?? '';
  const toast = useToast();

  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Share state
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareVisibility, setShareVisibility] = useState<'public' | 'authenticated'>('public');
  const [shareCopied, setShareCopied] = useState<string | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!chartUrl) return;
      if (!silent) setLoading(true);
      else setRefreshing(true);
      try {
        const { data } = await listScans(1, 200, undefined, undefined, false, false, chartUrl);
        setScans(data);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to load scans');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [chartUrl, toast],
  );

  async function handleBulkShare() {
    setShareLoading(true);
    const shareableScans = scans.filter((s) => s.status === 'completed' || s.status === 'failed');
    let count = 0;
    for (const scan of shareableScans) {
      try {
        await createShare(scan.id, shareVisibility);
        count++;
      } catch { /* already shared or failed */ }
    }
    toast.success(`${count} scan${count !== 1 ? 's' : ''} shared`);
    setShareLoading(false);
    await load(true);
  }

  function buildGroupUrl(currentScans: Scan[]): string {
    const sharedScans = currentScans.filter(s => s.share_token);
    if (sharedScans.length === 0) return '';
    const [first, ...rest] = sharedScans;
    const base = `${window.location.origin}/shared/helm/${first.share_token}`;
    return rest.length > 0
      ? `${base}?tokens=${rest.map(s => s.share_token).join(',')}`
      : base;
  }

  async function handleDisableAllShares() {
    setShareLoading(true);
    const sharedScans = scans.filter((s) => s.share_token);
    let count = 0;
    for (const scan of sharedScans) {
      try {
        await deleteShare(scan.id);
        count++;
      } catch { /* ignore */ }
    }
    toast.success(`Sharing disabled for ${count} scan${count !== 1 ? 's' : ''}`);
    setShareLoading(false);
    setShareOpen(false);
    load(true);
  }

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh while any scan is still running/pending
  useEffect(() => {
    const hasActive = scans.some((s) => s.status === 'running' || s.status === 'pending');
    if (!hasActive) return;
    const id = setInterval(() => load(true), 5000);
    return () => clearInterval(id);
  }, [scans, load]);

  if (!chartUrl) {
    return (
      <div className="p-6 text-center text-zinc-400 text-sm">
        No chart URL specified.{' '}
        <Link href="/helm" className="text-violet-500 hover:underline">← Back to Helm</Link>
      </div>
    );
  }

  // ── Derived values ───────────────────────────────────────────────
  const isOCI = chartUrl.startsWith('oci://');
  const displayUrl = chartUrl.replace(/^oci:\/\//, '');

  // Extract chart name + version — helm_source_path is stored as "templates/x.yaml › spec…"
  // The chart name/version come from scans' helm_chart field and the metadata embedded in source path.
  // Version is the same across all images from one chart run; grab it from the most recent scan.
  const latestScan = scans[0];
  const chartVersion = latestScan?.helm_source_path
    ? undefined // source path doesn't contain version; we'd need to store it separately
    : undefined;

  const totalImages = scans.length;
  const completed = scans.filter((s) => s.status === 'completed').length;
  const failed = scans.filter((s) => s.status === 'failed').length;
  const pending = scans.filter((s) => s.status === 'pending' || s.status === 'running').length;
  const totalCritical = scans.reduce((a, s) => a + (s.critical_count ?? 0), 0);
  const totalHigh = scans.reduce((a, s) => a + (s.high_count ?? 0), 0);
  const totalMedium = scans.reduce((a, s) => a + (s.medium_count ?? 0), 0);
  const totalLow = scans.reduce((a, s) => a + (s.low_count ?? 0), 0);

  // Group scans by source file for display context
  const bySource = scans.reduce<Record<string, Scan[]>>((acc, scan) => {
    const key = scan.helm_source_path?.split(' › ')[0] ?? 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(scan);
    return acc;
  }, {});

  const mostRecentAt = scans.length > 0 ? scans[0].created_at : null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors mb-3"
        >
          <ArrowLeft01Icon size={15} />
          Back to Helm
        </button>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <PackageIcon size={20} className="text-violet-500 shrink-0" />
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={chartUrl}>
                {displayUrl}
              </h1>
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
            <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
              {chartVersion && <span>v{chartVersion}</span>}
              {mostRecentAt && (
                <span title={fullDate(mostRecentAt)}>Last scanned {timeAgo(mostRecentAt)}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              title="Refresh"
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-40"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <Refresh01Icon size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>

            {/* Share all dropdown */}
            <div className="relative" ref={shareRef}>
              {(() => {
                const shareableScans = scans.filter((s) => s.status === 'completed' || s.status === 'failed');
                const sharedScans = shareableScans.filter((s) => s.share_token);
                const allShared = shareableScans.length > 0 && sharedScans.length === shareableScans.length;
                return (
                  <button
                    onClick={() => setShareOpen(o => !o)}
                    disabled={shareableScans.length === 0}
                    title="Share all completed and failed scans"
                    className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl font-medium disabled:opacity-50 transition-all hover:opacity-90"
                    style={allShared
                      ? { background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }
                      : { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }}
                  >
                    <Share01Icon size={14} />
                    Share all
                  </button>
                );
              })()}
              {shareOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShareOpen(false)} />
                  <div className="absolute right-0 top-11 w-80 rounded-xl z-50 p-4 space-y-3"
                    style={{ background: 'var(--modal-bg)', border: '1px solid var(--modal-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-white">Share chart scan</p>
                      <button onClick={() => setShareOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>
                    </div>

                    {/* Chart group link — shown when at least one scan is shared */}
                    {(() => {
                      const groupUrl = buildGroupUrl(scans);
                      if (!groupUrl) return null;
                      return (
                        <div className="space-y-1.5">
                          <p className="text-xs text-zinc-500">Chart share link</p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 truncate">
                              {groupUrl.replace(/^https?:\/\/[^/]+/, '')}
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(groupUrl);
                                setShareCopied('__group__');
                                setTimeout(() => setShareCopied(null), 1500);
                              }}
                              className="shrink-0 px-2.5 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap"
                              style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}
                            >
                              {shareCopied === '__group__' ? '✓ Copied' : 'Copy'}
                            </button>
                          </div>
                          <p className="text-xs text-zinc-400 leading-relaxed">Share this link to show all images in this chart scan.</p>
                        </div>
                      );
                    })()}

                    {/* Individual scan links */}
                    {scans.filter(s => s.share_token).length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-zinc-500">Individual image links</p>
                        <div className="max-h-32 overflow-y-auto space-y-1.5">
                          {scans.filter(s => s.share_token).map(scan => (
                            <div key={scan.id} className="flex items-center gap-2">
                              <code className="flex-1 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 truncate">
                                {scan.image_name}:{scan.image_tag}
                              </code>
                              <button
                                onClick={() => {
                                  const url = `${window.location.origin}/shared/${scan.share_token}`;
                                  navigator.clipboard.writeText(url);
                                  setShareCopied(scan.id);
                                  setTimeout(() => setShareCopied(null), 1500);
                                }}
                                className="shrink-0 px-2.5 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap"
                                style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}
                              >
                                {shareCopied === scan.id ? '✓ Copied' : 'Copy'}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <p className="text-xs text-zinc-500">Visibility</p>
                      <div className="flex gap-2">
                        {(['public', 'authenticated'] as const).map(v => (
                          <button key={v} onClick={() => setShareVisibility(v)}
                            className="flex-1 py-1.5 text-xs rounded-lg font-medium transition-all"
                            style={shareVisibility === v
                              ? { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white' }
                              : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                            {v === 'public' ? '🌐 Public' : '🔐 Signed in'}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        {shareVisibility === 'public'
                          ? 'Anyone with the link can view completed and failed scans.'
                          : 'Only signed-in users can view completed and failed scans.'}
                      </p>
                    </div>

                    <button onClick={handleBulkShare} disabled={shareLoading || scans.filter(s => s.status === 'completed' || s.status === 'failed').length === 0}
                      className="w-full py-2 text-sm rounded-lg font-medium transition-all disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white' }}>
                      {(() => {
                        if (shareLoading) return 'Sharing…';
                        const n = scans.filter(s => s.status === 'completed' || s.status === 'failed').length;
                        return `Share all ${n} scan${n !== 1 ? 's' : ''}`;
                      })()}
                    </button>

                    {scans.some(s => s.share_token) && (
                      <button onClick={handleDisableAllShares} disabled={shareLoading}
                        className="w-full py-2 text-xs rounded-lg transition-all disabled:opacity-50"
                        style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.18)' }}>
                        {shareLoading ? 'Processing…' : 'Disable all sharing'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <Link
              href="/helm"
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl transition-all"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
              }}
            >
              Re-scan chart
            </Link>
          </div>
        </div>
      </div>

      {/* Stats row */}
      {!loading && scans.length > 0 && (
        <div className="flex gap-3 flex-wrap [&>*]:flex-1 [&>*]:min-w-[90px]">
          <StatBox label="Images" value={totalImages} />
          <StatBox label="Completed" value={completed} color="text-emerald-400" />
          {pending > 0 && <StatBox label="Running" value={pending} color="text-blue-400" />}
          {failed > 0  && <StatBox label="Failed"  value={failed}  color="text-red-400" />}
          {totalCritical > 0 && <StatBox label="Critical" value={totalCritical} color="text-red-400 font-bold" />}
          {totalHigh > 0     && <StatBox label="High"     value={totalHigh}     color="text-orange-400" />}
          {totalMedium > 0   && <StatBox label="Medium"   value={totalMedium}   color="text-yellow-400" />}
          {totalLow > 0      && <StatBox label="Low"      value={totalLow}      color="text-blue-400" />}
          {totalCritical === 0 && totalHigh === 0 && completed > 0 && (
            <StatBox label="Vulnerabilities" value="Clean ✓" color="text-emerald-400" />
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div
          className="rounded-2xl px-6 py-10 flex items-center justify-center gap-3 text-zinc-400 text-sm"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <span className="w-4 h-4 rounded-full border-2 border-zinc-400/30 border-t-zinc-400 animate-spin" />
          Loading scans…
        </div>
      )}

      {/* Empty state */}
      {!loading && scans.length === 0 && (
        <div
          className="rounded-2xl px-6 py-10 text-center text-zinc-400 text-sm"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          No scans found for this chart.{' '}
          <Link href="/helm" className="text-violet-500 hover:underline">Scan it now →</Link>
        </div>
      )}

      {/* Scan table */}
      {!loading && scans.length > 0 && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          {/* Table header */}
          <div
            className="grid px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide"
            style={{
              gridTemplateColumns: '1fr 120px 1fr 80px 80px 80px 80px 120px',
              background: 'var(--table-header-bg)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span>Image</span>
            <span>Tag</span>
            <span>Source</span>
            <span className="text-center">C</span>
            <span className="text-center">H</span>
            <span className="text-center">M</span>
            <span className="text-center">L</span>
            <span className="text-right">Status</span>
          </div>

          {/* Rows */}
          {scans.map((scan, i) => (
            <Link
              key={scan.id}
              href={`/scans/${scan.id}`}
              className="grid items-center px-4 py-3 gap-2 group transition-colors hover:bg-violet-500/5"
              style={{
                gridTemplateColumns: '1fr 120px 1fr 80px 80px 80px 80px 120px',
                borderBottom: i < scans.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                background: 'var(--card-bg)',
              }}
            >
              <span
                className="text-sm font-mono text-zinc-800 dark:text-zinc-200 truncate group-hover:text-violet-500 transition-colors"
                title={scan.image_name}
              >
                {scan.image_name}
              </span>
              <span className="text-xs font-mono text-zinc-500 truncate" title={scan.image_tag}>
                {scan.image_tag || 'latest'}
              </span>
              <span
                className="text-xs text-zinc-400 truncate"
                title={scan.helm_source_path ?? ''}
              >
                {scan.helm_source_path
                  ? scan.helm_source_path.split(' › ')[0]
                  : '—'}
              </span>
              <span className="text-center">
                <SevCount count={scan.critical_count ?? 0} cls={SEV.critical} />
              </span>
              <span className="text-center">
                <SevCount count={scan.high_count ?? 0} cls={SEV.high} />
              </span>
              <span className="text-center">
                <SevCount count={scan.medium_count ?? 0} cls={SEV.medium} />
              </span>
              <span className="text-center">
                <SevCount count={scan.low_count ?? 0} cls={SEV.low} />
              </span>
              <span className="flex justify-end">
                <StatusBadge status={scan.status} />
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Source breakdown */}
      {!loading && Object.keys(bySource).length > 1 && (
        <div
          className="rounded-2xl px-5 py-4 space-y-3"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
        >
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Images by template file
          </h2>
          <div className="flex flex-col gap-1.5">
            {Object.entries(bySource)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([source, sourceScans]) => {
                const c = sourceScans.reduce((a, s) => a + (s.critical_count ?? 0), 0);
                const h = sourceScans.reduce((a, s) => a + (s.high_count ?? 0), 0);
                return (
                  <div key={source} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-zinc-500 w-72 truncate" title={source}>
                      {source}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {sourceScans.length} image{sourceScans.length !== 1 ? 's' : ''}
                    </span>
                    {(c > 0 || h > 0) && (
                      <span className="text-xs font-mono">
                        {c > 0 && <span className="text-red-400">{c}C </span>}
                        {h > 0 && <span className="text-orange-400">{h}H</span>}
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HelmChartDetailPage() {
  return (
    <Suspense fallback={
      <div className="p-6 flex items-center justify-center gap-3 text-zinc-400 text-sm">
        <span className="w-4 h-4 rounded-full border-2 border-zinc-400/30 border-t-zinc-400 animate-spin" />
        Loading…
      </div>
    }>
      <HelmChartDetailContent />
    </Suspense>
  );
}
