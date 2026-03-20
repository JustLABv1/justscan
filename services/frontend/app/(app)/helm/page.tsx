'use client';
import { useToast } from '@/components/toast';
import {
    AdminScan,
    createHelmScans,
    createShare,
    extractHelmImages,
    getTokenType,
    HelmExtractResponse,
    listAdminScans,
    listScans,
    listTags,
    Scan,
    Tag,
} from '@/lib/api';
import { ListBox, Select } from '@heroui/react';
import {
    ArrowLeft01Icon,
    CheckmarkSquare02Icon,
    Globe02Icon,
    PackageIcon,
    SquareIcon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const inputCls =
  'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

type Step = 'input' | 'preview' | 'results';

const PLATFORMS = [
  { id: '__auto__', label: 'Auto-detect' },
  { id: 'linux/amd64', label: 'linux/amd64' },
  { id: 'linux/arm64', label: 'linux/arm64' },
  { id: 'linux/arm/v7', label: 'linux/arm/v7' },
  { id: 'linux/arm/v6', label: 'linux/arm/v6' },
  { id: 'linux/386', label: 'linux/386' },
  { id: 'linux/s390x', label: 'linux/s390x' },
  { id: 'linux/ppc64le', label: 'linux/ppc64le' },
  { id: 'windows/amd64', label: 'windows/amd64' },
];

export default function HelmPage() {
  const toast = useToast();

  // Step state
  const [step, setStep] = useState<Step>('input');

  // Step 1 – input
  const [chartURL, setChartURL] = useState('');
  const [chartName, setChartName] = useState('');
  const [chartVersion, setChartVersion] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');

  // Step 2 – preview
  const [extracted, setExtracted] = useState<HelmExtractResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState('');
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [makePublic, setMakePublic] = useState(false);

  // Step 3 – results
  const [createdScans, setCreatedScans] = useState<Scan[]>([]);

  // History
  const [helmHistory, setHelmHistory] = useState<Scan[]>([]);
  const [adminHelmHistory, setAdminHelmHistory] = useState<AdminScan[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isOCI = chartURL.trim().startsWith('oci://');

  const loadTags = useCallback(async () => {
    try {
      setAvailableTags(await listTags());
    } catch {
      // tags are optional — non-fatal
    }
  }, []);

  const loadHistory = useCallback(async (adminMode: boolean) => {
    setHistoryLoading(true);
    try {
      const { data } = await listScans(1, 50, undefined, undefined, false, true);
      setHelmHistory(data);
      if (adminMode) {
        const { data: adminData } = await listAdminScans(1, 50, undefined, undefined, true);
        setAdminHelmHistory(adminData);
      }
    } catch {
      // non-fatal
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const admin = getTokenType() === 'admin';
    setIsAdmin(admin);
    loadTags();
    loadHistory(admin);
  }, [loadTags, loadHistory]);

  // ---- Step 1: extract ----
  async function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    setExtractError('');
    const url = chartURL.trim();
    if (!url) return;
    if (!isOCI && !chartName.trim()) {
      setExtractError('Chart name is required for HTTP repository URLs.');
      return;
    }
    setExtracting(true);
    try {
      const result = await extractHelmImages(
        url,
        chartName.trim() || undefined,
        chartVersion.trim() || undefined,
      );
      setExtracted(result);
      // Pre-select all images
      setSelected(new Set(result.images.map((img) => img.full_ref)));
      setStep('preview');
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }

  // ---- Step 2: scan ----
  async function handleScan() {
    if (!extracted || selected.size === 0) return;
    setScanning(true);
    try {
      const images = extracted.images
        .filter((img) => selected.has(img.full_ref))
        .map((img) => ({
          full_ref: img.full_ref,
          source_path: `${img.source_file} › ${img.source_path}`,
        }));

      const result = await createHelmScans(
        chartURL.trim(),
        images,
        platform || undefined,
        selectedTagIds.size > 0 ? Array.from(selectedTagIds) : undefined,
      );

      let scans = result.scans ?? [];

      if (makePublic && scans.length > 0) {
        scans = await Promise.all(
          scans.map(async (scan) => {
            try {
              const share = await createShare(scan.id, 'public');
              return { ...scan, share_token: share.share_token, share_visibility: share.share_visibility };
            } catch {
              return scan;
            }
          }),
        );
      }

      setCreatedScans(scans);
      setStep('results');
      // Reload history so new scans appear
      loadHistory(isAdmin);
      toast.success(`${scans.length ?? 0} scans queued`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create scans');
    } finally {
      setScanning(false);
    }
  }

  // ---- helpers ----
  function toggleAll() {
    if (!extracted) return;
    if (selected.size === extracted.images.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(extracted.images.map((i) => i.full_ref)));
    }
  }

  function toggleRow(ref: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  function toggleTag(id: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setStep('input');
    setExtracted(null);
    setSelected(new Set());
    setCreatedScans([]);
    setExtractError('');
    setChartVersion('');
    setChartName('');
    setPlatform('');
    setSelectedTagIds(new Set());
    setMakePublic(false);
  }

  // ---- render ----
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <PackageIcon size={22} className="text-violet-500 shrink-0" />
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Helm Chart Scan
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Extract container images from a Helm chart and scan them for vulnerabilities.
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <StepBar current={step} />

      {/* ---- STEP 1: INPUT ---- */}
      {step === 'input' && (
        <div
          className="rounded-2xl p-6 space-y-5"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <form onSubmit={handleExtract} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Chart URL <span className="text-zinc-400 font-normal text-xs">(OCI or HTTP repository)</span>
              </label>
              <input
                className={inputCls}
                placeholder="oci://ghcr.io/org/charts/mychart   or   https://charts.bitnami.com/bitnami"
                value={chartURL}
                onChange={(e) => setChartURL(e.target.value)}
                required
              />
              <p className="mt-1 text-xs text-zinc-400">
                OCI: <code className="font-mono">oci://registry/path/chartname</code> &nbsp;·&nbsp;
                HTTP: provide the repo URL and the chart name below
              </p>
            </div>

            {!isOCI && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Chart Name {!isOCI && <span className="text-red-400">*</span>}
                  </label>
                  <input
                    className={inputCls}
                    placeholder="nginx"
                    value={chartName}
                    onChange={(e) => setChartName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Version <span className="text-zinc-400 font-normal text-xs">(optional)</span>
                  </label>
                  <input
                    className={inputCls}
                    placeholder="15.3.0"
                    value={chartVersion}
                    onChange={(e) => setChartVersion(e.target.value)}
                  />
                </div>
              </div>
            )}

            {isOCI && (
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Version <span className="text-zinc-400 font-normal text-xs">(optional)</span>
                </label>
                <input
                  className={inputCls}
                  placeholder="1.0.0"
                  value={chartVersion}
                  onChange={(e) => setChartVersion(e.target.value)}
                />
              </div>
            )}

            {extractError && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                {extractError}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={extracting || !chartURL.trim()}
                className="px-5 py-2.5 text-sm font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                  color: '#fff',
                  boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
                }}
              >
                {extracting ? 'Extracting images…' : 'Extract Images'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---- STEP 1: HISTORY ---- */}
      {step === 'input' && (
        <HelmHistory
          history={helmHistory}
          adminHistory={isAdmin ? adminHelmHistory : []}
          isAdmin={isAdmin}
          loading={historyLoading}
        />
      )}

      {/* ---- STEP 2: PREVIEW ---- */}
      {step === 'preview' && extracted && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div
            className="rounded-2xl px-5 py-4 flex items-center justify-between gap-4"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
          >
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {extracted.chart_name}
                {extracted.chart_version && (
                  <span className="ml-2 text-xs font-normal text-zinc-400">
                    v{extracted.chart_version}
                  </span>
                )}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Found {extracted.images.length} image{extracted.images.length !== 1 ? 's' : ''} &nbsp;·&nbsp;{' '}
                <span className="text-violet-500 font-medium">{selected.size} selected</span>
              </p>
            </div>
            <button
              onClick={() => setStep('input')}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              <ArrowLeft01Icon size={14} />
              Change chart
            </button>
          </div>

          {/* Options row */}
          <div
            className="rounded-2xl px-5 py-4 flex flex-wrap items-center gap-4"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
          >
            {/* Platform */}
            <div className="flex items-center gap-2 min-w-[200px]">
              <label className="text-xs text-zinc-500 whitespace-nowrap">Platform</label>
              <Select
                selectedKey={platform || '__auto__'}
                onSelectionChange={(k) => setPlatform(String(k === '__auto__' ? '' : k))}
              >
                <Select.Trigger className="flex-1 px-3 py-1.5 text-sm rounded-xl glass-input">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {PLATFORMS.map((p) => (
                      <ListBox.Item key={p.id} id={p.id}>
                        {p.label}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            {/* Tags inline toggle */}
            {availableTags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-zinc-500 whitespace-nowrap">Tags</label>
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map((tag) => {
                    const active = selectedTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className="text-xs px-2.5 py-1 rounded-full font-medium border transition-all"
                        style={{
                          background: active ? tag.color + '22' : 'transparent',
                          borderColor: active ? tag.color : 'var(--border-subtle)',
                          color: active ? tag.color : 'var(--text-muted)',
                        }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Public share toggle */}
            <div className="ml-auto flex items-center gap-2">
              <Globe02Icon size={14} className={makePublic ? 'text-violet-500' : 'text-zinc-400'} />
              <button
                type="button"
                onClick={() => setMakePublic((v) => !v)}
                className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none"
                style={{ background: makePublic ? '#7c3aed' : 'var(--border-subtle)' }}
                title={makePublic ? 'Results will be shared publicly' : 'Make scan results publicly accessible'}
              >
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: makePublic ? 'translateX(18px)' : 'translateX(2px)' }}
                />
              </button>
              <label className="text-xs text-zinc-500 cursor-pointer" onClick={() => setMakePublic((v) => !v)}>
                Share publicly
              </label>
            </div>
          </div>

          {/* Image table */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            {/* Table header */}
            <div
              className="flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide"
              style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--border-subtle)' }}
            >
              <button
                type="button"
                onClick={toggleAll}
                className="shrink-0 hover:text-violet-500 transition-colors"
                title={selected.size === extracted.images.length ? 'Deselect all' : 'Select all'}
              >
                {selected.size === extracted.images.length ? (
                  <CheckmarkSquare02Icon size={16} className="text-violet-500" />
                ) : (
                  <SquareIcon size={16} />
                )}
              </button>
              <span className="flex-1">Image</span>
              <span className="w-32">Tag</span>
              <span className="w-48 hidden sm:block">Source</span>
            </div>

            {extracted.images.map((img) => {
              const checked = selected.has(img.full_ref);
              return (
                <div
                  key={img.full_ref}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    background: checked ? 'rgba(124,58,237,0.04)' : 'var(--card-bg)',
                  }}
                  onClick={() => toggleRow(img.full_ref)}
                >
                  <span className="shrink-0">
                    {checked ? (
                      <CheckmarkSquare02Icon size={16} className="text-violet-500" />
                    ) : (
                      <SquareIcon size={16} className="text-zinc-400" />
                    )}
                  </span>
                  <span className="flex-1 text-sm font-mono text-zinc-800 dark:text-zinc-200 truncate">
                    {img.name}
                  </span>
                  <span className="w-32 text-xs font-mono text-zinc-500 truncate">{img.tag || 'latest'}</span>
                  <span
                    className="w-48 hidden sm:block text-xs text-zinc-400 truncate"
                    title={`${img.source_file} › ${img.source_path}`}
                  >
                    {img.source_file}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-4 pt-1">
            <button
              type="button"
              onClick={() => setStep('input')}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-xl transition-all text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <ArrowLeft01Icon size={14} />
              Back
            </button>
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning || selected.size === 0}
              className="px-5 py-2.5 text-sm font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
              }}
            >
              {scanning
                ? 'Queuing scans…'
                : `Scan ${selected.size} selected image${selected.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* ---- STEP 3: RESULTS ---- */}
      {step === 'results' && (
        <div className="space-y-4">
          <div
            className="rounded-2xl px-5 py-4"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-0.5">
              {createdScans.length} scan{createdScans.length !== 1 ? 's' : ''} queued
            </p>
            <p className="text-sm text-zinc-500">
              from{' '}
              <span className="font-mono text-xs text-violet-500">{chartURL}</span>
            </p>
          </div>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <div
              className="flex gap-4 px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide"
              style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--border-subtle)' }}
            >
              <span className="flex-1">Image</span>
              <span className="w-32">Tag</span>
              {makePublic && <span className="w-36 hidden sm:block">Share link</span>}
              <span className="w-24 text-right">Scan</span>
            </div>
            {createdScans.map((scan) => (
              <div
                key={scan.id}
                className="flex items-center gap-4 px-4 py-3"
                style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--card-bg)' }}
              >
                <span className="flex-1 text-sm font-mono text-zinc-800 dark:text-zinc-200 truncate">
                  {scan.image_name}
                </span>
                <span className="w-32 text-xs font-mono text-zinc-500 truncate">
                  {scan.image_tag}
                </span>
                {makePublic && (
                  <span className="w-36 hidden sm:block">
                    {scan.share_token ? (
                      <CopyShareButton token={scan.share_token} />
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </span>
                )}
                <span className="w-24 text-right">
                  <Link
                    href={`/scans/${scan.id}`}
                    className="text-xs text-violet-500 hover:text-violet-400 font-medium"
                  >
                    View →
                  </Link>
                </span>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2.5 text-sm rounded-xl transition-all text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              Scan another chart
            </button>
            <Link
              href="/scans"
              className="px-5 py-2.5 text-sm font-medium rounded-xl transition-all"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
              }}
            >
              View all scans
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- CopyShareButton ----
function CopyShareButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/shared/${token}`
    : `/shared/${token}`;
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg transition-colors"
      style={{
        background: copied ? 'rgba(52,211,153,0.1)' : 'rgba(124,58,237,0.08)',
        border: `1px solid ${copied ? 'rgba(52,211,153,0.3)' : 'rgba(124,58,237,0.2)'}`,
        color: copied ? '#34d399' : '#a78bfa',
      }}
      title={url}
    >
      {copied ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      )}
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
}

// ---- HelmHistory ----
interface HelmHistoryProps {
  history: Scan[];
  adminHistory: AdminScan[];
  isAdmin: boolean;
  loading: boolean;
}

function groupByChart<T extends { helm_chart?: string }>(scans: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const scan of scans) {
    const key = scan.helm_chart ?? '';
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(scan);
  }
  return map;
}

function statusDot(status: string) {
  switch (status) {
    case 'completed': return 'bg-emerald-500';
    case 'failed':    return 'bg-red-500';
    case 'running':   return 'bg-blue-400 animate-pulse';
    default:          return 'bg-zinc-400 animate-pulse';
  }
}

function HelmHistory({ history, adminHistory, isAdmin, loading }: HelmHistoryProps) {
  const userGroups = groupByChart(history);
  const adminGroups = isAdmin ? groupByChart(adminHistory) : new Map();

  if (loading) {
    return (
      <div className="text-xs text-zinc-400 text-center py-4">Loading history…</div>
    );
  }

  if (userGroups.size === 0 && adminGroups.size === 0) return null;

  return (
    <div className="space-y-5">
      {/* User history */}
      {userGroups.size > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Your recent Helm scans
          </h2>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            {Array.from(userGroups.entries()).map(([chartUrl, scans], idx, arr) => (
              <ChartHistoryRow
                key={chartUrl}
                chartUrl={chartUrl}
                scans={scans}
                isLast={idx === arr.length - 1}
              />
            ))}
          </div>
        </section>
      )}

      {/* Admin: all users' helm scans */}
      {isAdmin && adminGroups.size > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            All users — Helm scans
            <span className="ml-1.5 text-xs font-normal text-zinc-400">(admin view)</span>
          </h2>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            {Array.from(adminGroups.entries()).map(([chartUrl, scans], idx, arr) => (
              <ChartHistoryRow
                key={chartUrl}
                chartUrl={chartUrl}
                scans={scans as AdminScan[]}
                isLast={idx === arr.length - 1}
                showOwner
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ChartHistoryRow({
  chartUrl,
  scans,
  isLast,
  showOwner = false,
}: {
  chartUrl: string;
  scans: Array<Scan & { owner_email?: string; owner_username?: string }>;
  isLast: boolean;
  showOwner?: boolean;
}) {
  const total = scans.length;
  const latest = scans[0];
  const critical = scans.reduce((s, x) => s + (x.critical_count ?? 0), 0);
  const high = scans.reduce((s, x) => s + (x.high_count ?? 0), 0);
  const owners = showOwner
    ? [...new Set(scans.map((s) => (s as AdminScan).owner_username).filter(Boolean))].join(', ')
    : '';
  const detailHref = `/helm/chart?url=${encodeURIComponent(chartUrl)}`;

  return (
    <Link
      href={detailHref}
      className="flex items-center gap-3 px-4 py-3 group transition-colors hover:bg-violet-500/5"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)', background: 'var(--card-bg)' }}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(latest.status)}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-mono truncate text-zinc-800 dark:text-zinc-200 group-hover:text-violet-500 transition-colors" title={chartUrl}>
          {chartUrl.replace(/^oci:\/\//, '')}
        </p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {total} image{total !== 1 ? 's' : ''}
          {showOwner && owners && (
            <span className="ml-2 text-zinc-400">· {owners}</span>
          )}
        </p>
      </div>
      {(critical > 0 || high > 0) && (
        <div className="flex items-center gap-1.5 text-xs font-mono shrink-0">
          {critical > 0 && <span className="text-red-500">{critical}C</span>}
          {high > 0    && <span className="text-orange-500">{high}H</span>}
        </div>
      )}
      <svg className="w-4 h-4 shrink-0 text-zinc-400 group-hover:text-violet-500 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
    </Link>
  );
}

function StepBar({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'input', label: 'Chart URL' },
    { key: 'preview', label: 'Review Images' },
    { key: 'results', label: 'Results' },
  ];
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{
                background:
                  i <= idx
                    ? 'linear-gradient(135deg,#7c3aed,#6d28d9)'
                    : 'var(--table-header-bg)',
                color: i <= idx ? '#fff' : 'var(--text-muted)',
                border: i <= idx ? 'none' : '1px solid var(--border-subtle)',
              }}
            >
              {i + 1}
            </div>
            <span
              className="text-sm font-medium hidden sm:block"
              style={{ color: i <= idx ? 'var(--text-primary)' : 'var(--text-muted)' }}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className="h-px flex-1 min-w-[24px]"
              style={{ background: i < idx ? '#7c3aed' : 'var(--border-subtle)' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
