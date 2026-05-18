'use client';
import { Logo } from '@/components/logo';
import { PublicNavbar } from '@/components/public/public-navbar';
import {
  createPublicHelmScans,
  extractPublicHelmImages,
  getPublicHelmScanRun,
  getPublicSettings,
  getToken,
  HelmExtractResponse,
  PublicSettings,
  Scan,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import {
  createEditableHelmImages,
  EditableHelmImage,
  getHelmImageSourceLabel,
  parseHelmImageRef,
} from '@/lib/helm-image-overrides';
import {
  addToHelmPublicHistory,
  addToPublicHistory,
  getHelmPublicHistory,
  PublicHelmRunHistoryEntry,
  timeAgo,
  updateHelmPublicHistoryEntry,
} from '@/lib/publicScanHistory';
import { Button, Chip, Input, Label, Table } from '@heroui/react';
import { ArrowRight01Icon, IrisScanIcon, LinkSquare02Icon } from 'hugeicons-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const PLATFORMS = [
  { value: '', label: 'Auto (detect)' },
  { value: 'linux/amd64', label: 'linux/amd64' },
  { value: 'linux/arm64', label: 'linux/arm64' },
  { value: 'linux/arm/v7', label: 'linux/arm/v7' },
  { value: 'windows/amd64', label: 'windows/amd64' },
];

type Step = 'form' | 'extracting' | 'review' | 'scanning';

function toRunHistoryEntry(detail: {
  run: {
    id: string;
    chart_url: string;
    chart_name?: string;
    chart_version?: string;
    platform?: string;
    created_at: string;
  };
  items: Array<{ latest_scan: Scan }>;
}): PublicHelmRunHistoryEntry {
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
    active_images: latestScans.filter(
      (scan) => scan.status !== 'completed' && scan.status !== 'failed'
    ).length,
    critical_count: latestScans.reduce((sum, scan) => sum + (scan.critical_count ?? 0), 0),
    high_count: latestScans.reduce((sum, scan) => sum + (scan.high_count ?? 0), 0),
    medium_count: latestScans.reduce((sum, scan) => sum + (scan.medium_count ?? 0), 0),
    low_count: latestScans.reduce((sum, scan) => sum + (scan.low_count ?? 0), 0),
    created_at: detail.run.created_at,
  };
}

export default function PublicHelmScanPage() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Form
  const [chartUrl, setChartUrl] = useState('');
  const [chartName, setChartName] = useState('');
  const [chartVersion, setChartVersion] = useState('');
  const [platform, setPlatform] = useState('');

  // Steps
  const [step, setStep] = useState<Step>('form');
  const [extractError, setExtractError] = useState('');
  const [scanError, setScanError] = useState('');

  // Extracted images
  const [chartInfo, setChartInfo] = useState<{ name: string; version: string }>({
    name: '',
    version: '',
  });
  const [images, setImages] = useState<EditableHelmImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [helmHistory, setHelmHistory] = useState<PublicHelmRunHistoryEntry[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  const isDark = mounted && resolvedTheme === 'dark';
  const isOCI = chartUrl.startsWith('oci://');
  const selectedImages = images.filter((img) => selected.has(img.id));
  const hasInvalidSelection = selectedImages.some((img) => img.edited_ref.trim() === '');
  const isDisabled =
    settings !== null && (!settings.enabled || settings.local_scan_available === false);
  const disabledMessage =
    settings?.disabled_reason ||
    'The administrator has disabled this feature. Please check back later.';

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      const initialHistory = getHelmPublicHistory();
      if (cancelled) return;

      if (initialHistory.length === 0) {
        setHelmHistory([]);
        return;
      }

      const refreshedHistory = await Promise.all(
        initialHistory.map(async (entry) => {
          try {
            const detail = await getPublicHelmScanRun(entry.id);
            const nextEntry = toRunHistoryEntry(detail);
            updateHelmPublicHistoryEntry(entry.id, nextEntry);
            return nextEntry;
          } catch {
            return entry;
          }
        })
      );

      if (!cancelled) {
        setHelmHistory(refreshedHistory);
      }
    }

    const cancelDeferred = deferEffect(() => {
      setMounted(true);
      setIsLoggedIn(!!getToken());
      void getPublicSettings()
        .then(setSettings)
        .catch(() =>
          setSettings({ enabled: true, rate_limit_per_hour: 5, local_scan_available: true })
        );
      void loadHistory().catch(() => setHelmHistory(getHelmPublicHistory()));
    });

    return () => {
      cancelled = true;
      cancelDeferred();
    };
  }, []);

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    setExtractError('');
    setStep('extracting');
    try {
      const res: HelmExtractResponse = await extractPublicHelmImages(
        chartUrl.trim(),
        isOCI ? undefined : chartName.trim() || undefined,
        chartVersion.trim() || undefined
      );
      const extractedImages = Array.isArray(res.images) ? res.images : [];
      const nextImages = createEditableHelmImages(extractedImages);
      setChartInfo({ name: res.chart_name, version: res.chart_version });
      setImages(nextImages);
      setSelected(new Set(nextImages.map((img) => img.id)));
      setStep('review');
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Failed to extract images');
      setStep('form');
    }
  }

  async function handleScan() {
    setScanError('');
    const selectedImages = images.filter((img) => selected.has(img.id));
    if (selectedImages.length === 0) return;
    if (hasInvalidSelection) {
      setScanError('Each selected image needs a non-empty image reference.');
      return;
    }

    setStep('scanning');
    try {
      const res = await createPublicHelmScans(
        chartUrl.trim(),
        selectedImages.map((img) => ({
          full_ref: img.edited_ref.trim(),
          source_path: getHelmImageSourceLabel(img),
        })),
        platform || undefined,
        chartInfo.name || undefined,
        chartInfo.version || undefined
      );

      if (!res.run?.id) {
        throw new Error('Helm run was created without a persisted run ID');
      }

      // Add to localStorage history
      (res.scans ?? []).forEach((scan: Scan) =>
        addToPublicHistory({
          id: scan.id,
          image_name: scan.image_name,
          image_tag: scan.image_tag,
          platform: platform || undefined,
          status: scan.status,
          critical_count: scan.critical_count ?? 0,
          high_count: scan.high_count ?? 0,
          medium_count: scan.medium_count ?? 0,
          low_count: scan.low_count ?? 0,
          unknown_count: 0,
          created_at: scan.created_at,
        })
      );

      const createdEntry: PublicHelmRunHistoryEntry = {
        id: res.run.id,
        chart_url: res.run.chart_url,
        chart_name: res.run.chart_name || undefined,
        chart_version: res.run.chart_version || undefined,
        platform: res.run.platform || undefined,
        total_images: res.scans.length,
        completed_images: res.scans.filter((scan) => scan.status === 'completed').length,
        failed_images: res.scans.filter((scan) => scan.status === 'failed').length,
        active_images: res.scans.filter(
          (scan) => scan.status !== 'completed' && scan.status !== 'failed'
        ).length,
        critical_count: res.scans.reduce((sum, scan) => sum + (scan.critical_count ?? 0), 0),
        high_count: res.scans.reduce((sum, scan) => sum + (scan.high_count ?? 0), 0),
        medium_count: res.scans.reduce((sum, scan) => sum + (scan.medium_count ?? 0), 0),
        low_count: res.scans.reduce((sum, scan) => sum + (scan.low_count ?? 0), 0),
        created_at: res.run.created_at,
      };
      addToHelmPublicHistory(createdEntry);
      setHelmHistory(getHelmPublicHistory());
      router.push(`/public/scan/helm/runs/${res.run.id}`);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : 'Failed to start scans');
      setStep('review');
    }
  }

  function updateEditedRef(id: string, value: string) {
    setImages((prev) =>
      prev.map((image) => (image.id === id ? { ...image, edited_ref: value } : image))
    );
  }

  function openRun(run: PublicHelmRunHistoryEntry) {
    router.push(`/public/scan/helm/runs/${run.id}`);
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}
    >
      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <style>{`
          @keyframes helmGridDrift {
            0%   { background-position: 0 0; }
            100% { background-position: 40px 40px; }
          }
          @keyframes helmSweepBeam {
            0%   { transform: translateY(-100vh); opacity: 0; }
            5%   { opacity: 1; }
            95%  { opacity: 1; }
            100% { transform: translateY(100vh); opacity: 0; }
          }
        `}</style>
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 size-[600px] rounded-full"
          style={{
            background: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--accent) 15%, transparent) 0%, transparent 65%)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 8%, transparent) 0%, transparent 65%)',
          }}
        />
        <div
          className="absolute bottom-0 left-1/4 size-[400px] rounded-full"
          style={{
            background: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 65%)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 5%, transparent) 0%, transparent 65%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--accent) 10%, transparent) 1px, transparent 1px)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 6%, transparent) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            animation: 'helmGridDrift 16s linear infinite',
          }}
        />
        <div
          className="absolute inset-x-0 h-px"
          style={{
            background: isDark
              ? 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent) 40%, transparent), color-mix(in srgb, var(--accent) 30%, transparent), transparent)'
              : 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 15%, transparent), color-mix(in srgb, var(--accent) 22%, transparent), color-mix(in srgb, var(--accent) 15%, transparent), transparent)',
            animation: 'helmSweepBeam 11s ease-in-out infinite',
            animationDelay: '2s',
            top: 0,
          }}
        />
      </div>

      <PublicNavbar
        isDark={isDark}
        isLoggedIn={isLoggedIn}
        onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
        alternateAction={{
          href: '/public/scan/image',
          label: 'Scan Image',
          icon: <IrisScanIcon size={16} />,
          hideOnMobile: true,
        }}
      />

      <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12">
        <div
          className={`w-full space-y-8 my-auto ${
            step === 'review' || step === 'scanning' ? 'max-w-5xl' : 'max-w-2xl'
          }`}
        >
          {/* Hero */}
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <Logo size={48} className="text-white" />
            </div>
            <div>
              <h1
                className="text-3xl sm:text-4xl font-bold tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                Scan Helm chart{' '}
                <span
                  style={{
                    background:
                      'linear-gradient(135deg, color-mix(in srgb, var(--accent) 55%, white), var(--accent))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  images
                </span>
              </h1>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                Extract all container images from your Helm chart and scan them for CVEs · No
                account needed
              </p>
            </div>
          </div>

          {/* Step 1 - Chart URL form */}
          {(step === 'form' || step === 'extracting') && isDisabled && (
            <div
              className="rounded-2xl px-6 py-5 text-center"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
              }}
            >
              <p className="text-red-500 dark:text-red-400 font-medium">
                Public Helm scanning is temporarily disabled
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                {disabledMessage}
              </p>
            </div>
          )}

          {(step === 'form' || step === 'extracting') && !isDisabled && (
            <form onSubmit={handleExtract} className="space-y-3">
              {/* Chart URL */}
              <div>
                <Label>Chart URL</Label>
                <div className="flex items-center gap-2 p-2">
                  <div className="pl-2 shrink-0" style={{ color: 'var(--text-faint)' }}>
                    <LinkSquare02Icon size={16} />
                  </div>
                  <Input
                    value={chartUrl}
                    onChange={(e) => setChartUrl(e.target.value)}
                    placeholder="oci://ghcr.io/org/chart:1.0  or  https://charts.example.com"
                    disabled={step === 'extracting'}
                    aria-label="Chart URL"
                    variant="secondary"
                    className="flex-1 text-sm font-mono"
                  />
                </div>
              </div>

              {/* Chart name + version (only required for HTTP repositories, not OCI) */}
              {!isOCI && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      className="block text-xs font-medium mb-1.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Chart name <span className="text-red-400">*</span>
                    </label>
                    <Input
                      value={chartName}
                      onChange={(e) => setChartName(e.target.value)}
                      placeholder="e.g. nginx"
                      disabled={step === 'extracting'}
                      aria-label="Chart name"
                      variant="secondary"
                      className="w-full text-sm"
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Version <span style={{ color: 'var(--text-faint)' }}>(optional)</span>
                    </label>
                    <Input
                      value={chartVersion}
                      onChange={(e) => setChartVersion(e.target.value)}
                      placeholder="e.g. 1.2.3"
                      disabled={step === 'extracting'}
                      aria-label="Chart version"
                      variant="secondary"
                      className="w-full text-sm"
                    />
                  </div>
                </div>
              )}
              {isOCI && (
                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Version / tag{' '}
                    <span style={{ color: 'var(--text-faint)' }}>
                      (optional - overrides tag in URL)
                    </span>
                  </label>
                  <Input
                    value={chartVersion}
                    onChange={(e) => setChartVersion(e.target.value)}
                    placeholder="e.g. 1.2.3"
                    disabled={step === 'extracting'}
                    aria-label="OCI chart version"
                    variant="secondary"
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none font-mono border border-[var(--surface-border)] shadow-none"
                    style={{
                      background: 'var(--surface-bg)',
                      color: 'var(--text-primary)',
                      caretColor: 'var(--accent)',
                    }}
                  />
                </div>
              )}

              {extractError && (
                <p className="text-sm text-red-500 dark:text-red-400">{extractError}</p>
              )}

              <Button
                type="submit"
                isDisabled={
                  step === 'extracting' || !chartUrl.trim() || (!isOCI && !chartName.trim())
                }
                className="w-full py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-90"
                style={{
                  background:
                    'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, black))',
                  boxShadow:
                    '0 0 24px color-mix(in srgb, var(--accent) 35%, transparent), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
              >
                {step === 'extracting' ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Extracting images…
                  </span>
                ) : (
                  'Extract images →'
                )}
              </Button>

              <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
                {settings?.rate_limit_per_hour ?? 5} free scans per hour · Public charts only
              </p>
            </form>
          )}

          {/* Helm scan history - shown only on form step */}
          {(step === 'form' || step === 'extracting') && helmHistory.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                <span className="text-xs font-medium px-2" style={{ color: 'var(--text-faint)' }}>
                  Recent scans
                </span>
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              </div>
              <div
                className="rounded-2xl overflow-hidden divide-y"
                style={{
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--surface-border)',
                }}
              >
                {helmHistory.slice(0, 5).map((run) => {
                  const displayUrl = run.chart_url.replace(/^oci:\/\//, '');
                  const isGroupOCI = run.chart_url.startsWith('oci://');
                  return (
                    <button
                      key={run.id}
                      onClick={() => openRun(run)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors group"
                      style={{ borderTop: '1px solid var(--row-divider)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--row-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div className="flex-1 min-w-0">
                        <p
                          className="font-mono text-sm font-medium truncate"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {displayUrl}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0"
                            style={{
                              background: isGroupOCI
                                ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                                : 'rgba(59,130,246,0.1)',
                              color: isGroupOCI
                                ? 'color-mix(in srgb, var(--accent) 55%, white)'
                                : '#60a5fa',
                            }}
                          >
                            {isGroupOCI ? 'OCI' : 'HTTP'}
                          </span>
                          {run.chart_version && (
                            <span
                              className="text-xs font-mono"
                              style={{ color: 'var(--text-faint)' }}
                            >
                              v{run.chart_version}
                            </span>
                          )}
                          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                            {run.completed_images + run.failed_images}/{run.total_images} scanned ·{' '}
                            {timeAgo(run.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-2 shrink-0 text-xs font-mono">
                        {run.critical_count > 0 && (
                          <span className="text-red-500">{run.critical_count}C</span>
                        )}
                        {run.high_count > 0 && (
                          <span className="text-orange-500">{run.high_count}H</span>
                        )}
                        {run.critical_count === 0 &&
                          run.high_count === 0 &&
                          run.completed_images > 0 &&
                          run.active_images === 0 &&
                          run.failed_images === 0 && (
                            <span className="text-emerald-600">Clean</span>
                          )}
                      </div>
                      <ArrowRight01Icon
                        size={14}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--text-muted)' }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2 - Review images */}
          {(step === 'review' || step === 'scanning') && (
            <div className="space-y-4">
              {/* Chart info */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {chartInfo.name || 'Chart'}
                    {chartInfo.version && (
                      <span
                        className="ml-2 text-xs px-2 py-0.5 rounded-full font-mono"
                        style={{
                          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                          color: 'var(--accent)',
                          border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                        }}
                      >
                        v{chartInfo.version}
                      </span>
                    )}
                  </p>
                  <p
                    className="text-xs mt-0.5 font-mono truncate max-w-xs"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {chartUrl}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setStep('form');
                    setImages([]);
                    setSelected(new Set());
                  }}
                  variant="secondary"
                  size="sm"
                >
                  ← Change chart
                </Button>
              </div>

              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Override any extracted image reference before scanning. Selected rows will use the
                edited values.
              </p>

              {/* Image list */}
              <Table className="rounded-2xl overflow-hidden">
                <Table.ScrollContainer>
                  <Table.Content
                    aria-label="Extracted Helm images"
                    className="min-w-[980px]"
                    selectionMode="multiple"
                    selectedKeys={selected}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') {
                        setSelected(new Set(images.map((img) => img.id)));
                        return;
                      }
                      setSelected(new Set(Array.from(keys, (key) => String(key))));
                    }}
                  >
                    <Table.Header>
                      <Table.Column className="w-[62%] min-w-[440px]">Image Reference</Table.Column>
                      <Table.Column className="w-[38%] min-w-[320px]">Parsed / Source</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {images.map((img) => {
                        const parsed = parseHelmImageRef(img.edited_ref);
                        return (
                          <Table.Row key={img.id} id={img.id}>
                            <Table.Cell>
                              <Input
                                value={img.edited_ref}
                                onChange={(event) => updateEditedRef(img.id, event.target.value)}
                                aria-label="Image reference"
                                variant="secondary"
                                className="w-full bg-transparent text-sm font-mono font-medium border-0 shadow-none"
                                placeholder="registry.example.com/org/image:tag"
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p
                                    className="text-xs font-mono truncate"
                                    style={{ color: 'var(--text-faint)' }}
                                  >
                                    {parsed.name || 'Enter an image reference'}
                                  </p>
                                  <Chip
                                    size="sm"
                                    variant="soft"
                                    color="accent"
                                    className="font-mono"
                                  >
                                    {parsed.tag || '-'}
                                  </Chip>
                                </div>
                                {img.source_path ? (
                                  <p
                                    className="text-xs mt-1 font-mono truncate"
                                    style={{ color: 'var(--text-faint)' }}
                                  >
                                    {getHelmImageSourceLabel(img)}
                                  </p>
                                ) : null}
                              </div>
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>

              {/* Platform & scan button */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    Platform:
                  </span>
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPlatform(p.value)}
                      className="text-xs px-2.5 py-1 rounded-lg font-mono transition-all"
                      style={
                        platform === p.value
                          ? {
                              background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                              border:
                                '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                              color: 'var(--accent)',
                            }
                          : {
                              background: 'var(--row-hover)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-muted)',
                            }
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {scanError && <p className="text-sm text-red-500 dark:text-red-400">{scanError}</p>}

                <Button
                  onPress={handleScan}
                  isDisabled={selected.size === 0 || step === 'scanning' || hasInvalidSelection}
                  className="w-full py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-90"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, black))',
                    boxShadow: '0 0 24px color-mix(in srgb, var(--accent) 35%, transparent)',
                  }}
                >
                  {step === 'scanning' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Creating Helm run…
                    </span>
                  ) : (
                    `Scan ${selected.size} image${selected.size !== 1 ? 's' : ''} →`
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer
        className="relative z-10 text-center py-6 text-xs"
        style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}
      >
        JustScan · Self-hosted image vulnerability scanner
      </footer>
    </div>
  );
}
