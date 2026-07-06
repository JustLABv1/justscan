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
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  Disclosure,
  Input,
  Table,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from '@heroui/react';
import { ArrowRight01Icon, IrisScanIcon, LinkSquare02Icon } from 'hugeicons-react';
import Link from 'next/link';
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
const HISTORY_DISPLAY_LIMIT = 5;

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

function HelmHistoryDisclosure({
  history,
  onOpenRun,
}: {
  history: PublicHelmRunHistoryEntry[];
  onOpenRun: (run: PublicHelmRunHistoryEntry) => void;
}) {
  return (
    <Card className="border border-divider/60 bg-surface/40 p-2 shadow-sm backdrop-blur">
      <Disclosure className="rounded-[1.5rem]">
        <Disclosure.Heading>
          <Disclosure.Trigger className="flex w-full items-center justify-between gap-4 rounded-[1.25rem] px-4 py-3 text-left transition-colors hover:bg-background/45">
            <div>
              <p className="text-sm font-semibold text-foreground">Recent Helm runs on this device</p>
              <p className="mt-1 text-xs text-muted">
                {history.length} saved locally. Reopen a run without crowding the main flow.
              </p>
            </div>
            <Disclosure.Indicator />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="space-y-3 px-2 pb-2 pt-3">
            <div className="grid gap-3">
              {history.slice(0, HISTORY_DISPLAY_LIMIT).map((run) => {
                const displayUrl = run.chart_url.replace(/^oci:\/\//, '');
                const isGroupOCI = run.chart_url.startsWith('oci://');

                return (
                  <Card
                    key={run.id}
                    className="border border-divider/50 bg-background/55 transition-colors hover:border-accent/30 hover:bg-background/75"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenRun(run)}
                      className="flex w-full items-start justify-between gap-3 p-4 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-foreground">
                            {displayUrl}
                          </p>
                          <Chip color="accent" size="sm" variant="soft">
                            {isGroupOCI ? 'OCI' : 'HTTP'}
                          </Chip>
                          {run.chart_version ? (
                            <Chip size="sm" variant="soft">
                              v{run.chart_version}
                            </Chip>
                          ) : null}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>
                            {run.completed_images + run.failed_images}/{run.total_images} scanned
                          </span>
                          {run.critical_count > 0 ? (
                            <Chip color="danger" size="sm" variant="soft">
                              {run.critical_count} critical
                            </Chip>
                          ) : null}
                          {run.high_count > 0 ? (
                            <Chip color="warning" size="sm" variant="soft">
                              {run.high_count} high
                            </Chip>
                          ) : null}
                          {run.critical_count === 0 &&
                          run.high_count === 0 &&
                          run.completed_images > 0 &&
                          run.active_images === 0 &&
                          run.failed_images === 0 ? (
                            <Chip color="success" size="sm" variant="soft">
                              Clean
                            </Chip>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
                        <span>{timeAgo(run.created_at)}</span>
                        <ArrowRight01Icon aria-hidden size={14} className="hidden sm:block" />
                      </div>
                    </button>
                  </Card>
                );
              })}
            </div>
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
    </Card>
  );
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
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--background) 92%, #07111b) 0%, var(--background) 42%, color-mix(in srgb, var(--background) 96%, #05070c) 100%)'
            : 'linear-gradient(180deg, color-mix(in srgb, var(--background) 88%, #f4f8fd) 0%, var(--background) 42%, color-mix(in srgb, var(--background) 94%, #eef4fa) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.55] dark:opacity-[0.42]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--accent) 34%, transparent) 1.15px, transparent 0), linear-gradient(180deg, color-mix(in srgb, var(--foreground) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--foreground) 4%, transparent) 1px, transparent 1px)',
          backgroundPosition: 'center top, center top, center top',
          backgroundSize: '24px 24px, 24px 24px, 24px 24px',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'radial-gradient(circle at 50% 10%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 26%), radial-gradient(circle at 50% 54%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 24%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 22%)'
            : 'radial-gradient(circle at 50% 8%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 22%), radial-gradient(circle at 50% 54%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 20%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 18%)',
        }}
      />
      <section className="relative z-10 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: isDark
              ? 'linear-gradient(180deg, color-mix(in srgb, var(--background) 82%, #05111c) 0%, color-mix(in srgb, var(--background) 50%, transparent) 72%, transparent 100%)'
              : 'linear-gradient(180deg, color-mix(in srgb, var(--background) 76%, #edf7ff) 0%, color-mix(in srgb, var(--background) 44%, transparent) 72%, transparent 100%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{
            background:
              'radial-gradient(circle at 64% 48%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 28%)',
          }}
        />

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
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Logo size={40} />
            </div>
            <div className="mt-5">
              <Chip color="accent" variant="soft">
                Public Helm scanning
              </Chip>
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold leading-tight tracking-normal text-foreground sm:text-5xl">
                Scan Helm chart images instantly.
              </h1>
              <p className="mx-auto max-w-xl text-sm leading-7 text-muted sm:text-base">
                Extract image references from a public chart, review what will be scanned, and run
                the check without needing an account first.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted">
              <span>{settings?.rate_limit_per_hour ?? 5} free scans per hour</span>
              <span>Review extracted images first</span>
              <span>Local recent runs</span>
            </div>
          </div>

          {(step === 'form' || step === 'extracting') && isDisabled && (
            <Card className="rounded-[2rem] border border-divider/60 bg-surface/50 px-5 py-5 text-center shadow-sm backdrop-blur sm:px-6 sm:py-6">
              <div
                className="rounded-[1.25rem] px-6 py-5"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}
              >
                <p className="font-medium text-red-500 dark:text-red-400">
                  Public Helm scanning is temporarily disabled
                </p>
                <p className="mt-1 text-sm text-muted">{disabledMessage}</p>
              </div>
            </Card>
          )}

          {(step === 'form' || step === 'extracting') && !isDisabled && (
            <Card className="rounded-[2rem] border border-divider/60 bg-surface/50 px-5 py-5 shadow-sm backdrop-blur sm:px-6 sm:py-6">
              <form onSubmit={handleExtract} className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Extract chart images</p>
                    <p className="mt-1 text-sm text-muted">
                      Paste a public chart source, review the discovered images, then scan.
                    </p>
                  </div>
                  <Link href="/public/scan/image" className="hidden sm:block">
                    <Button size="sm" variant="tertiary">
                      <IrisScanIcon size={16} />
                      Scan image
                    </Button>
                  </Link>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-col gap-3 rounded-[1.25rem] border border-divider/60 px-4 py-4">
                    <div className="flex items-center gap-3 text-muted">
                      <LinkSquare02Icon size={18} />
                      <span className="text-xs font-medium uppercase tracking-[0.18em]">
                        Chart URL
                      </span>
                    </div>
                    <Input
                      value={chartUrl}
                      onChange={(e) => setChartUrl(e.target.value)}
                      placeholder="oci://ghcr.io/org/chart:1.0  or  https://charts.example.com"
                      disabled={step === 'extracting'}
                      aria-label="Chart URL"
                      variant="secondary"
                      className="w-full text-sm font-mono"
                    />
                  </div>

                  {!isOCI && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="mb-1.5 text-xs font-medium text-muted">
                          Chart name <span className="text-red-400">*</span>
                        </p>
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
                        <p className="mb-1.5 text-xs font-medium text-muted">
                          Version <span className="text-[var(--text-faint)]">(optional)</span>
                        </p>
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

                  {isOCI ? (
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted">
                        Version / tag{' '}
                        <span className="text-[var(--text-faint)]">
                          (optional - overrides tag in URL)
                        </span>
                      </p>
                      <Input
                        value={chartVersion}
                        onChange={(e) => setChartVersion(e.target.value)}
                        placeholder="e.g. 1.2.3"
                        disabled={step === 'extracting'}
                        aria-label="OCI chart version"
                        variant="secondary"
                        className="w-full text-sm font-mono"
                      />
                    </div>
                  ) : null}

                  {extractError && (
                    <p className="text-sm text-red-500 dark:text-red-400">{extractError}</p>
                  )}

                  <Button
                    type="submit"
                    fullWidth
                    isDisabled={
                      step === 'extracting' || !chartUrl.trim() || (!isOCI && !chartName.trim())
                    }
                    isPending={step === 'extracting'}
                    size="lg"
                  >
                    {step === 'extracting' ? 'Extracting images…' : 'Extract images'}
                  </Button>

                  <div className="flex flex-col gap-3 border-t border-divider/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted">
                      Public charts only. Sign in later for saved history and shared workflows.
                    </p>
                    <Link href="/login">
                      <Button size="sm" variant="secondary">
                        Sign in
                      </Button>
                    </Link>
                  </div>
                </div>
              </form>
            </Card>
          )}

          {(step === 'form' || step === 'extracting') && helmHistory.length > 0 && (
            <HelmHistoryDisclosure history={helmHistory} onOpenRun={openRun} />
          )}

          {/* Step 2 - Review images */}
          {(step === 'review' || step === 'scanning') && (
            <Card className="rounded-[2rem] border border-divider/60 bg-surface/50 px-5 py-5 shadow-sm backdrop-blur sm:px-6 sm:py-6">
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
                        setSelected(new Set(images.map((image) => image.id)));
                        return;
                      }
                      setSelected(new Set(Array.from(keys, (key) => String(key))));
                    }}
                  >
                    <Table.Header>
                      <Table.Column className="w-12">
                        <Checkbox
                          aria-label={
                            selected.size === images.length && images.length > 0
                              ? 'Deselect all images'
                              : 'Select all images'
                          }
                          isSelected={images.length > 0 && selected.size === images.length}
                          isIndeterminate={selected.size > 0 && selected.size < images.length}
                          slot="selection"
                          variant="secondary"
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                          </Checkbox.Content>
                        </Checkbox>
                      </Table.Column>
                      <Table.Column className="w-[62%] min-w-[440px]">Image Reference</Table.Column>
                      <Table.Column className="w-[38%] min-w-[320px]">Parsed / Source</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {images.map((img) => {
                        const parsed = parseHelmImageRef(img.edited_ref);
                        return (
                          <Table.Row key={img.id} id={img.id}>
                            <Table.Cell onClick={(event) => event.stopPropagation()}>
                              <Checkbox
                                aria-label={`Select ${img.edited_ref || 'image'}`}
                                slot="selection"
                                variant="secondary"
                              >
                                <Checkbox.Content>
                                  <Checkbox.Control>
                                    <Checkbox.Indicator />
                                  </Checkbox.Control>
                                </Checkbox.Content>
                              </Checkbox>
                            </Table.Cell>
                            <Table.Cell>
                              <Input
                                value={img.edited_ref}
                                onChange={(event) => updateEditedRef(img.id, event.target.value)}
                                onClick={(event) => event.stopPropagation()}
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
              <div className="space-y-3 border-t border-divider/50 pt-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                    Platform
                  </span>
                  <span className="text-xs text-muted">Optional</span>
                </div>
                <ToggleButtonGroup
                  selectionMode="single"
                  selectedKeys={[platform || '__auto_platform__']}
                  disallowEmptySelection
                  onSelectionChange={(keys) => {
                    const key = Array.from(keys)[0] as Key | undefined;
                    const next = key ? String(key) : '__auto_platform__';
                    setPlatform(next === '__auto_platform__' ? '' : next);
                  }}
                  size="sm"
                  className="font-mono"
                >
                  {PLATFORMS.map((p, i) => (
                    <ToggleButton
                      key={p.value || '__auto_platform__'}
                      id={p.value || '__auto_platform__'}
                      className="text-xs"
                    >
                      {i > 0 ? <ToggleButtonGroup.Separator /> : null}
                      {p.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>

                {scanError ? (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Unable to create Helm run</Alert.Title>
                      <Alert.Description>{scanError}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}

                {step === 'scanning' ? (
                  <Alert status="accent">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Creating Helm run</Alert.Title>
                      <Alert.Description>
                        Queueing the selected images now. This can take a few seconds before the
                        run detail page is ready.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}

                <Button
                  onPress={handleScan}
                  isDisabled={selected.size === 0 || step === 'scanning' || hasInvalidSelection}
                  isPending={step === 'scanning'}
                  fullWidth
                  size="lg"
                >
                  {step === 'scanning'
                    ? 'Creating Helm run…'
                    : `Scan ${selected.size} image${selected.size !== 1 ? 's' : ''}`}
                </Button>
              </div>
              </div>
            </Card>
          )}
        </div>
      </main>

        <footer className="relative z-10 px-6 pb-10">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-[2rem] border border-divider/50 bg-surface/35 px-6 py-5 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>JustScan keeps the public path fast, then grows with you when scans need to be shared.</p>
            <Link href={isLoggedIn ? '/scans' : '/login'}>
              <Button variant="secondary">
                {isLoggedIn ? 'Open dashboard' : 'Create workspace'}
                <ArrowRight01Icon aria-hidden size={16} />
              </Button>
            </Link>
          </div>
        </footer>
      </section>
    </div>
  );
}
