'use client';
import { useToast } from '@/components/toast';
import {
    createHelmScans,
    createShare,
    deleteShare,
    extractHelmImages,
    getHelmScanRun,
    HelmRunItem,
    HelmScanRunDetail,
    reScan,
} from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import {
    ArrowLeft01Icon,
    PackageIcon,
    Refresh01Icon,
    Share01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

const SEV: Record<string, string> = {
  critical: 'text-red-400 font-bold',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string; label?: string }> = {
  completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.22)' },
  failed: { color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.22)' },
  running: { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.22)' },
  pending: { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: 'queued' },
  cancelled: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)' },
};

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

function SevCount({ count, cls }: { count: number; cls: string }) {
  return <span className={`font-mono text-sm ${count ? cls : 'text-zinc-400 dark:text-zinc-700'}`}>{count || '—'}</span>;
}

function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div
      className="glass-panel flex flex-col gap-0.5 px-4 py-3 rounded-xl"
    >
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-xl font-bold font-mono ${color ?? 'text-zinc-900 dark:text-zinc-100'}`}>{value}</span>
    </div>
  );
}

function guessChartNameFromUrl(url: string) {
  const cleaned = url.replace(/\/+$/, '');
  const segments = cleaned.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export default function HelmRunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const runId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [detail, setDetail] = useState<HelmScanRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rescanningChart, setRescanningChart] = useState(false);
  const [retryingScanId, setRetryingScanId] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const loadRun = useCallback(async (silent = false) => {
    if (!runId) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      setDetail(await getHelmScanRun(runId));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load Helm run');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runId, toast]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  const items = useMemo(() => detail?.items ?? [], [detail]);
  const latestScans = items.map((item) => item.latest_scan);
  const shareableScans = latestScans.filter((scan) => scan.status === 'completed' || scan.status === 'failed');
  const sharedScans = shareableScans.filter((scan) => scan.share_token);

  useEffect(() => {
    if (!items.some((item) => item.latest_scan.status === 'pending' || item.latest_scan.status === 'running')) {
      return;
    }
    const timer = setInterval(() => loadRun(true), 5000);
    return () => clearInterval(timer);
  }, [items, loadRun]);

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
  const canGenerateReport = latestScans.length > 0 && pending === 0;

  const bySource = items.reduce<Record<string, HelmRunItem[]>>((acc, item) => {
    const key = item.latest_scan.helm_source_path?.split(' › ')[0] ?? 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  async function handleRetryScan(scanId: string) {
    setRetryingScanId(scanId);
    try {
      await reScan(scanId);
      toast.success('Retry queued');
      await loadRun(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to retry scan');
    } finally {
      setRetryingScanId(null);
    }
  }

  async function handleRescanChart() {
    if (!latestRun || rescanningChart) return;

    const fallbackChartName = isOCI ? '' : guessChartNameFromUrl(latestRun.chart_url);
    const chartName = latestRun.chart_name || fallbackChartName;
    if (!isOCI && !chartName) {
      toast.error('Chart name is unavailable for this HTTP repository scan.');
      return;
    }

    setRescanningChart(true);
    try {
      const extracted = await extractHelmImages(
        latestRun.chart_url,
        isOCI ? undefined : chartName,
        latestRun.chart_version || undefined,
      );
      const images = (extracted.images ?? []).map((img) => ({
        full_ref: img.full_ref,
        source_path: `${img.source_file} › ${img.source_path}`,
      }));
      if (images.length === 0) {
        throw new Error('No images were extracted from this chart');
      }

      const firstTaggedScan = latestScans.find((scan) => (scan.tags?.length ?? 0) > 0);
      const inheritedOrgId = latestScans.find((scan) => scan.owner_org_id)?.owner_org_id;
      const created = await createHelmScans(
        latestRun.chart_url,
        images,
        latestRun.platform || firstTaggedScan?.platform || undefined,
        firstTaggedScan?.tags?.map((tag) => tag.id),
        extracted.chart_name || chartName || undefined,
        extracted.chart_version || latestRun.chart_version || undefined,
        undefined,
        inheritedOrgId || undefined,
      );

      toast.success(`Queued ${images.length} image${images.length === 1 ? '' : 's'} in new Helm run`);
      router.push(`/helm/runs/${created.run.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to re-scan chart');
    } finally {
      setRescanningChart(false);
    }
  }

  async function handleShareAll() {
    if (shareableScans.length === 0) return;
    setShareLoading(true);
    try {
      await Promise.all(shareableScans.map((scan) => createShare(scan.id, 'public').catch(() => null)));
      await loadRun(true);
      toast.success(`Shared ${shareableScans.length} scan${shareableScans.length === 1 ? '' : 's'}`);
    } finally {
      setShareLoading(false);
    }
  }

  async function handleDisableShares() {
    if (sharedScans.length === 0) return;
    setShareLoading(true);
    try {
      await Promise.all(sharedScans.map((scan) => deleteShare(scan.id).catch(() => null)));
      await loadRun(true);
      toast.success(`Disabled sharing for ${sharedScans.length} scan${sharedScans.length === 1 ? '' : 's'}`);
    } finally {
      setShareLoading(false);
    }
  }

  async function handleCopyGroupLink() {
    if (sharedScans.length === 0) return;
    const [first, ...rest] = sharedScans;
    const base = `${window.location.origin}/shared/helm/${first.share_token}`;
    const url = rest.length > 0
      ? `${base}?tokens=${rest.map((scan) => scan.share_token).join(',')}`
      : base;
    await navigator.clipboard.writeText(url);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1500);
  }

  if (!runId) {
    return <div className="p-6 text-sm text-zinc-400">Invalid Helm run ID.</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <button
          onClick={() => router.push('/helm')}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors mb-3"
        >
          <ArrowLeft01Icon size={15} />
          Back to Helm runs
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <PackageIcon size={20} className="text-violet-500 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={latestRun?.chart_name || chartUrl}>
                  {latestRun?.chart_name || displayUrl || 'Helm run'}
                </h1>
                <p className="text-xs text-zinc-500 mt-1 font-mono truncate" title={chartUrl}>{displayUrl}</p>
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

            <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500 flex-wrap">
              {latestRun?.chart_version && <span>v{latestRun.chart_version}</span>}
              {latestRun?.platform && <span>{latestRun.platform}</span>}
              {latestRun?.created_at && <span title={fullDate(latestRun.created_at)}>Started {timeAgo(latestRun.created_at)}</span>}
              {latestRun && <span className="font-mono">Run {latestRun.id}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {canGenerateReport ? (
              <Link
                href={`/reports/print?helmRun=${encodeURIComponent(runId)}`}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                style={{ border: '1px solid var(--border-subtle)' }}
              >
                Generate report
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl text-zinc-400 disabled:opacity-60"
                style={{ border: '1px solid var(--border-subtle)' }}
                title="Wait for active scans to finish before generating a report"
              >
                Generate report
              </button>
            )}

            <button
              onClick={() => loadRun(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-40"
              style={{ border: '1px solid var(--border-subtle)' }}
              title="Refresh"
            >
              <Refresh01Icon size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>

            <button
              type="button"
              onClick={handleShareAll}
              disabled={shareLoading || shareableScans.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl font-medium disabled:opacity-50"
              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }}
            >
              <Share01Icon size={14} />
              Share all
            </button>

            {sharedScans.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleCopyGroupLink}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors"
                  style={{ border: '1px solid rgba(124,58,237,0.2)', color: '#a78bfa' }}
                >
                  {shareCopied ? 'Copied' : 'Copy share link'}
                </button>
                <button
                  type="button"
                  onClick={handleDisableShares}
                  disabled={shareLoading}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors disabled:opacity-50"
                  style={{ border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}
                >
                  Disable shares
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleRescanChart}
              disabled={rescanningChart || !latestRun}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl transition-all disabled:opacity-60"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
              }}
            >
              {rescanningChart ? 'Re-scanning…' : 'Re-scan chart'}
            </button>
          </div>
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
        <div className="glass-panel rounded-2xl px-6 py-10 flex items-center justify-center gap-3 text-zinc-400 text-sm">
          <span className="w-4 h-4 rounded-full border-2 border-zinc-400/30 border-t-zinc-400 animate-spin" />
          Loading Helm run…
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="glass-panel rounded-2xl px-6 py-10 text-center text-zinc-400 text-sm">
          No scans found for this Helm run.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div
            className="grid px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide"
            style={{
              gridTemplateColumns: 'minmax(0,1fr) 120px minmax(0,1fr) 90px 70px 70px 70px 70px 120px 120px',
              background: 'var(--row-hover)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span>Image</span>
            <span>Tag</span>
            <span>Source</span>
            <span className="text-center">Attempts</span>
            <span className="text-center">C</span>
            <span className="text-center">H</span>
            <span className="text-center">M</span>
            <span className="text-center">L</span>
            <span className="text-right">Status</span>
            <span className="text-right">Action</span>
          </div>

          {items.map((item, index) => {
            const scan = item.latest_scan;
            const retrying = retryingScanId === scan.id;
            return (
              <div
                key={item.key}
                className="grid items-center px-4 py-3 gap-2"
                style={{
                  gridTemplateColumns: 'minmax(0,1fr) 120px minmax(0,1fr) 90px 70px 70px 70px 70px 120px 120px',
                  borderBottom: index < items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  background: 'transparent',
                }}
              >
                <Link href={`/scans/${scan.id}`} className="text-sm font-mono text-zinc-800 dark:text-zinc-200 truncate hover:text-violet-500 transition-colors" title={scan.image_name}>
                  {scan.image_name}
                </Link>
                <span className="text-xs font-mono text-zinc-500 truncate" title={scan.image_tag}>{scan.image_tag || 'latest'}</span>
                <span className="text-xs text-zinc-400 truncate" title={scan.helm_source_path ?? ''}>
                  {scan.helm_source_path ? scan.helm_source_path.split(' › ')[0] : '—'}
                </span>
                <span className="text-center text-xs font-mono text-zinc-500">{item.attempt_count}</span>
                <span className="text-center"><SevCount count={scan.critical_count ?? 0} cls={SEV.critical} /></span>
                <span className="text-center"><SevCount count={scan.high_count ?? 0} cls={SEV.high} /></span>
                <span className="text-center"><SevCount count={scan.medium_count ?? 0} cls={SEV.medium} /></span>
                <span className="text-center"><SevCount count={scan.low_count ?? 0} cls={SEV.low} /></span>
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
                    <Link href={`/scans/${scan.id}`} className="text-xs text-violet-500 hover:text-violet-400 font-medium">
                      View →
                    </Link>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!loading && Object.keys(bySource).length > 1 && (
        <div className="glass-panel rounded-2xl px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Images by template file</h2>
          <div className="flex flex-col gap-1.5">
            {Object.entries(bySource)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([source, sourceItems]) => {
                const critical = sourceItems.reduce((sum, item) => sum + (item.latest_scan.critical_count ?? 0), 0);
                const high = sourceItems.reduce((sum, item) => sum + (item.latest_scan.high_count ?? 0), 0);
                return (
                  <div key={source} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-zinc-500 w-72 truncate" title={source}>{source}</span>
                    <span className="text-xs text-zinc-400">{sourceItems.length} image{sourceItems.length === 1 ? '' : 's'}</span>
                    {(critical > 0 || high > 0) && (
                      <span className="text-xs font-mono">
                        {critical > 0 && <span className="text-red-400">{critical}C </span>}
                        {high > 0 && <span className="text-orange-400">{high}H</span>}
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