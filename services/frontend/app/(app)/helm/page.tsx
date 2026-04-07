'use client';
import { useToast } from '@/components/toast';
import {
    createHelmScans,
    createShare,
    extractHelmImages,
    getTokenType,
    HelmExtractResponse,
    HelmScanRunSummary,
    listHelmScanRuns,
    listTags,
    Tag,
} from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { ListBox, Select } from '@heroui/react';
import {
    ArrowLeft01Icon,
    CheckmarkSquare02Icon,
    Globe02Icon,
    PackageIcon,
    Refresh01Icon,
    SquareIcon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

const inputCls =
  'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

type Step = 'input' | 'preview';

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
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<Step>('input');
  const [chartURL, setChartURL] = useState('');
  const [chartName, setChartName] = useState('');
  const [chartVersion, setChartVersion] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');

  const [extracted, setExtracted] = useState<HelmExtractResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState('');
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [makePublic, setMakePublic] = useState(false);

  const [helmRuns, setHelmRuns] = useState<HelmScanRunSummary[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isOCI = chartURL.trim().startsWith('oci://');

  const loadTags = useCallback(async () => {
    try {
      setAvailableTags(await listTags());
    } catch {
      // Tags are optional.
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data } = await listHelmScanRuns(1, 24);
      setHelmRuns(Array.isArray(data) ? data : []);
    } catch {
      setHelmRuns([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsAdmin(getTokenType() === 'admin');
    loadTags();
    loadHistory();
  }, [loadHistory, loadTags]);

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
      const images = Array.isArray(result.images) ? result.images : [];
      setExtracted({ ...result, images });
      setSelected(new Set(images.map((img) => img.full_ref)));
      setStep('preview');
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }

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
        extracted.chart_name,
        extracted.chart_version,
      );

      if (makePublic && (result.scans?.length ?? 0) > 0) {
        await Promise.all(
          result.scans.map((scan) => createShare(scan.id, 'public').catch(() => null)),
        );
      }

      await loadHistory();
      toast.success(`${result.scans.length} image${result.scans.length === 1 ? '' : 's'} queued in Helm run ${result.run.id.slice(0, 8)}`);
      router.push(`/helm/runs/${result.run.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create scans');
    } finally {
      setScanning(false);
    }
  }

  function toggleAll() {
    if (!extracted) return;
    if (selected.size === extracted.images.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(extracted.images.map((image) => image.full_ref)));
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

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <PackageIcon size={22} className="text-violet-500 shrink-0" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Helm Scan Runs</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              Queue a chart run once, keep it as a first-class record, and drill into the child scans by run ID.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadHistory}
          disabled={historyLoading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <Refresh01Icon size={14} className={historyLoading ? 'animate-spin' : ''} />
          Refresh history
        </button>
      </div>

      <StepBar current={step} />

      {step === 'input' && (
        <div
          className="glass-panel rounded-2xl p-6 space-y-5"
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
                    Chart Name <span className="text-red-400">*</span>
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

      {step === 'input' && (
        <HelmRunHistory runs={helmRuns} isAdmin={isAdmin} loading={historyLoading} />
      )}

      {step === 'preview' && extracted && (
        <div className="space-y-4">
          <div
            className="glass-panel rounded-2xl px-5 py-4 flex items-center justify-between gap-4"
          >
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {extracted.chart_name}
                {extracted.chart_version && (
                  <span className="ml-2 text-xs font-normal text-zinc-400">v{extracted.chart_version}</span>
                )}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Found {extracted.images.length} image{extracted.images.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
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

          <div
            className="glass-panel rounded-2xl px-5 py-4 flex flex-wrap items-center gap-4"
          >
            <div className="flex items-center gap-2 min-w-[200px]">
              <label className="text-xs text-zinc-500 whitespace-nowrap">Platform</label>
              <Select
                selectedKey={platform || '__auto__'}
                onSelectionChange={(key) => setPlatform(String(key === '__auto__' ? '' : key))}
              >
                <Select.Trigger className="flex-1 px-3 py-1.5 text-sm rounded-xl glass-input">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {PLATFORMS.map((platformOption) => (
                      <ListBox.Item key={platformOption.id} id={platformOption.id}>
                        {platformOption.label}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

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

            <div className="ml-auto flex items-center gap-2">
              <Globe02Icon size={14} className={makePublic ? 'text-violet-500' : 'text-zinc-400'} />
              <button
                type="button"
                onClick={() => setMakePublic((value) => !value)}
                className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none"
                style={{ background: makePublic ? '#7c3aed' : 'var(--border-subtle)' }}
                title={makePublic ? 'Result scans will be shared publicly' : 'Create public share links after queueing'}
              >
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: makePublic ? 'translateX(18px)' : 'translateX(2px)' }}
                />
              </button>
              <label className="text-xs text-zinc-500 cursor-pointer" onClick={() => setMakePublic((value) => !value)}>
                Share publicly
              </label>
            </div>
          </div>

          <div className="glass-panel rounded-2xl overflow-hidden">
            <div
              className="flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide"
              style={{ background: 'var(--row-hover)', borderBottom: '1px solid var(--border-subtle)' }}
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
                    background: checked ? 'rgba(124,58,237,0.04)' : 'transparent',
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
                  <span className="flex-1 text-sm font-mono text-zinc-800 dark:text-zinc-200 truncate">{img.name}</span>
                  <span className="w-32 text-xs font-mono text-zinc-500 truncate">{img.tag || 'latest'}</span>
                  <span className="w-48 hidden sm:block text-xs text-zinc-400 truncate" title={`${img.source_file} › ${img.source_path}`}>
                    {img.source_file}
                  </span>
                </div>
              );
            })}
          </div>

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
              {scanning ? 'Queuing Helm run…' : `Queue ${selected.size} selected image${selected.size !== 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusDot(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-red-500';
    case 'running':
      return 'bg-blue-400 animate-pulse';
    default:
      return 'bg-zinc-400 animate-pulse';
  }
}

function HelmRunHistory({ runs, isAdmin, loading }: { runs: HelmScanRunSummary[]; isAdmin: boolean; loading: boolean }) {
  if (loading) {
    return <div className="text-xs text-zinc-400 text-center py-4">Loading Helm runs…</div>;
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Recent Helm runs</h2>
        <span className="text-xs text-zinc-400">{runs.length} visible</span>
      </div>

      {runs.length === 0 ? (
        <div
          className="glass-panel rounded-2xl px-5 py-8 text-center text-sm text-zinc-400"
        >
          No Helm runs yet. Queue one above to start tracking chart history by run ID.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/helm/runs/${run.id}`}
              className="glass-panel rounded-2xl p-4 transition-colors hover:bg-violet-500/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={run.chart_name || run.chart_url}>
                    {run.chart_name || run.chart_url.replace(/^oci:\/\//, '')}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 truncate" title={run.chart_url}>
                    {run.chart_url.replace(/^oci:\/\//, '')}
                  </p>
                </div>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot(run.active_images > 0 ? 'running' : run.failed_images > 0 ? 'failed' : 'completed')}`} />
              </div>

              <div className="flex items-center gap-2 mt-3 text-xs text-zinc-500 flex-wrap">
                {run.chart_version && <span>v{run.chart_version}</span>}
                <span>{run.total_images} image{run.total_images === 1 ? '' : 's'}</span>
                <span>Started {timeAgo(run.created_at)}</span>
              </div>

              <div className="grid grid-cols-4 gap-2 mt-4 text-center">
                <RunMetric label="Done" value={run.completed_images} tone="text-emerald-400" />
                <RunMetric label="Fail" value={run.failed_images} tone="text-red-400" />
                <RunMetric label="High" value={run.high_count} tone="text-orange-400" />
                <RunMetric label="Crit" value={run.critical_count} tone="text-red-400 font-bold" />
              </div>

              <div className="flex items-center justify-between gap-2 mt-4 text-xs text-zinc-400">
                <span className="font-mono">Run {run.id.slice(0, 8)}</span>
                {isAdmin && run.owner_username ? <span>{run.owner_username}</span> : <span>Open run →</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function RunMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl px-2 py-2" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
      <div className={`text-sm font-semibold ${value > 0 ? tone : 'text-zinc-400'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

function StepBar({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'input', label: 'Chart' },
    { key: 'preview', label: 'Review Images' },
  ];
  const idx = steps.findIndex((step) => step.key === current);

  return (
    <div className="flex items-center gap-2">
      {steps.map((step, index) => (
        <div key={step.key} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{
                background: index <= idx ? 'linear-gradient(135deg,#7c3aed,#6d28d9)' : 'var(--row-hover)',
                color: index <= idx ? '#fff' : 'var(--text-muted)',
                border: index <= idx ? 'none' : '1px solid var(--border-subtle)',
              }}
            >
              {index + 1}
            </div>
            <span
              className="text-sm font-medium hidden sm:block"
              style={{ color: index <= idx ? 'var(--text-primary)' : 'var(--text-muted)' }}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div className="h-px flex-1 min-w-[24px]" style={{ background: index < idx ? '#7c3aed' : 'var(--border-subtle)' }} />
          )}
        </div>
      ))}
    </div>
  );
}