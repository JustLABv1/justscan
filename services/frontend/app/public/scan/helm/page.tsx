'use client';
import { FormAlert } from '@/components/ui/form-alert';
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
  Input,
  Table,
  Select,
  ListBox,
  Label,
} from '@/components/ui';
import { IrisScanIcon } from 'hugeicons-react';
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
    <Card className="gap-0 py-0">
      <Card.Header className="border-b p-4">
        <Card.Title>Recent Helm runs</Card.Title>
        <Card.Description>Saved on this device only.</Card.Description>
      </Card.Header>
      <Card.Content className="divide-y p-0">
        {history.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            Extract and scan a chart to see its runs here.
          </div>
        ) : (
          history.slice(0, HISTORY_DISPLAY_LIMIT).map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onOpenRun(run)}
              className="flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-muted/50"
            >
              <div className="min-w-0 space-y-2">
                <p className="truncate text-sm font-medium" title={run.chart_url}>
                  {run.chart_name || run.chart_url.replace(/^oci:\/\//, '')}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {run.completed_images + run.failed_images}/{run.total_images} scanned
                  </span>
                  {run.chart_version ? <span>v{run.chart_version}</span> : null}
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
                  {run.failed_images > 0 ? (
                    <Chip color="danger" size="sm" variant="soft">
                      {run.failed_images} failed
                    </Chip>
                  ) : null}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {timeAgo(run.created_at)}
              </span>
            </button>
          ))
        )}
      </Card.Content>
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
      <section>
        <PublicNavbar
          leadingActions={
            step === 'review' ? (
              <Button
                variant="secondary"
                onPress={() => {
                  setStep('form');
                  setImages([]);
                  setSelected(new Set());
                }}
              >
                Change chart
              </Button>
            ) : undefined
          }
          title={
            step === 'review' || step === 'scanning'
              ? `Review ${chartInfo.name || 'chart images'}`
              : 'Scan a Helm chart'
          }
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

        <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
          <div className="space-y-6">
            {(step === 'form' || step === 'extracting') && (
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <Card className="gap-0 py-0">
                  <Card.Header className="border-b p-5">
                    <Card.Title>Extract chart images</Card.Title>
                    <Card.Description>Review the images before starting a scan.</Card.Description>
                  </Card.Header>
                  <Card.Content className="p-5">
                    {isDisabled ? (
                      <FormAlert
                        title="Public Helm scanning is unavailable"
                        description={disabledMessage}
                      />
                    ) : (
                      <form onSubmit={handleExtract} className="space-y-5">
                        <div className="space-y-2">
                          <label htmlFor="helm-chart-url" className="text-sm font-medium">
                            Chart source
                          </label>
                          <Input
                            id="helm-chart-url"
                            value={chartUrl}
                            onChange={(e) => setChartUrl(e.target.value)}
                            placeholder="https://charts.example.com"
                            disabled={step === 'extracting'}
                            required
                            className="w-full font-mono"
                          />
                          <p className="text-xs text-muted-foreground">
                            Use a public HTTP repository or an oci:// chart reference.
                          </p>
                        </div>
                        {!isOCI ? (
                          <div className="space-y-2">
                            <label htmlFor="helm-chart-name" className="text-sm font-medium">
                              Chart name
                            </label>
                            <Input
                              id="helm-chart-name"
                              value={chartName}
                              onChange={(e) => setChartName(e.target.value)}
                              placeholder="nginx"
                              disabled={step === 'extracting'}
                              required
                              className="w-full"
                            />
                          </div>
                        ) : null}
                        <div className="space-y-2">
                          <label htmlFor="helm-chart-version" className="text-sm font-medium">
                            Version{' '}
                            <span className="font-normal text-muted-foreground">(optional)</span>
                          </label>
                          <Input
                            id="helm-chart-version"
                            value={chartVersion}
                            onChange={(e) => setChartVersion(e.target.value)}
                            placeholder="Latest available"
                            disabled={step === 'extracting'}
                            className="w-full"
                          />
                          {isOCI ? (
                            <p className="text-xs text-muted-foreground">
                              Overrides the tag in the chart reference.
                            </p>
                          ) : null}
                        </div>
                        {extractError ? (
                          <FormAlert title="Couldn’t extract images" description={extractError} />
                        ) : null}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                          <span className="text-xs text-muted-foreground">
                            {settings?.rate_limit_per_hour ?? 5} free scans per hour
                          </span>
                          <Button
                            type="submit"
                            isDisabled={
                              step === 'extracting' ||
                              !chartUrl.trim() ||
                              (!isOCI && !chartName.trim())
                            }
                            isPending={step === 'extracting'}
                          >
                            {step === 'extracting' ? 'Extracting…' : 'Extract images'}
                          </Button>
                        </div>
                      </form>
                    )}
                  </Card.Content>
                </Card>
                <section className="min-w-0" aria-label="Recent Helm runs">
                  <HelmHistoryDisclosure history={helmHistory} onOpenRun={openRun} />
                </section>
              </div>
            )}

            {/* Step 2 - Review images */}
            {(step === 'review' || step === 'scanning') && (
              <Card className="gap-0 p-5 sm:p-6">
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
                              background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                              color: 'var(--primary)',
                              border:
                                '1px solid color-mix(in srgb, var(--primary) 20%, transparent)',
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
                  </div>

                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    Override any extracted image reference before scanning. Selected rows will use
                    the edited values.
                  </p>

                  {/* Image list */}
                  <Table className="rounded-xl overflow-hidden">
                    <Table.ScrollContainer>
                      <Table.Content
                        aria-label="Extracted Helm images"
                        className="min-w-[720px] table-fixed [&_td]:py-3"
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
                          <Table.Column isRowHeader className="w-[62%] min-w-[440px]">
                            Image Reference
                          </Table.Column>
                          <Table.Column className="w-[38%] min-w-[320px]">
                            Parsed / Source
                          </Table.Column>
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
                                    onChange={(event) =>
                                      updateEditedRef(img.id, event.target.value)
                                    }
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
                    <Select
                      aria-label="Image platform"
                      className="w-full sm:max-w-xs"
                      value={platform || '__auto_platform__'}
                      isDisabled={step === 'scanning'}
                      onChange={(value) =>
                        setPlatform(value === '__auto_platform__' ? '' : String(value ?? ''))
                      }
                    >
                      <Label>Platform</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {PLATFORMS.map((item) => (
                            <ListBox.Item
                              id={item.value || '__auto_platform__'}
                              key={item.value || '__auto_platform__'}
                            >
                              {item.label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>

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
      </section>
    </div>
  );
}
