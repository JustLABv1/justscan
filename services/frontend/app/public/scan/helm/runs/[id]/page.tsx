'use client';

import { PublicNavbar } from '@/components/public/public-navbar';
import { StatCard } from '@/components/ui/stat-card';
import {
    createPublicHelmScans,
    extractPublicHelmImages,
    getPublicHelmScanRun,
    getToken,
    HelmRunItem,
    HelmScanRunDetail,
    reScanPublic,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { getHelmImageSourceLabel } from '@/lib/helm-image-overrides';
import { PublicHelmRunHistoryEntry, updateHelmPublicHistoryEntry } from '@/lib/publicScanHistory';
import { fullDate, timeAgo } from '@/lib/time';
import { Alert, Button, Card, Chip, Spinner, Table } from '@heroui/react';
import {
  AlertCircleIcon,
  ArrowReloadHorizontalIcon,
  Bug02Icon,
  CheckmarkCircle02Icon,
  PackageIcon,
  Refresh01Icon,
} from 'hugeicons-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ChipColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

function StatusBadge({ status }: { status: string }) {
  const color: ChipColor =
    status === 'completed'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : status === 'running'
          ? 'accent'
          : status === 'cancelled'
            ? 'warning'
            : 'default';
  const label = status === 'pending' ? 'queued' : status;
  return (
    <Chip color={color} size="sm" variant="soft">
      <span
        className={`mr-1.5 inline-block size-1.5 rounded-full bg-current ${
          status === 'running' ? 'animate-pulse' : ''
        }`}
      />
      {label}
    </Chip>
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

function guessChartNameFromUrl(url: string) {
  const cleaned = url.replace(/\/+$/, '');
  const segments = cleaned.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export default function PublicHelmRunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const isDark = mounted && resolvedTheme === 'dark';
  const runId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [detail, setDetail] = useState<HelmScanRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rescanningChart, setRescanningChart] = useState(false);
  const [retryingScanId, setRetryingScanId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [isLoggedIn] = useState(() => !!getToken());

  const loadRun = useCallback(
    async (silent = false) => {
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
    },
    [runId]
  );

  useEffect(() => {
    return deferEffect(() => {
      setMounted(true);
      void loadRun().catch(() => {});
    });
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
  const pending = latestScans.filter(
    (scan) => scan.status === 'pending' || scan.status === 'running'
  ).length;
  const totalCritical = latestScans.reduce((sum, scan) => sum + (scan.critical_count ?? 0), 0);
  const totalHigh = latestScans.reduce((sum, scan) => sum + (scan.high_count ?? 0), 0);
  const totalMedium = latestScans.reduce((sum, scan) => sum + (scan.medium_count ?? 0), 0);
  const totalLow = latestScans.reduce((sum, scan) => sum + (scan.low_count ?? 0), 0);
  const statCardClassName = 'border border-divider/60 bg-surface/50 shadow-sm backdrop-blur';
  const statValueClassName = 'text-lg font-semibold text-zinc-900 dark:text-white';

  useEffect(() => {
    if (
      !items.some(
        (item) => item.latest_scan.status === 'pending' || item.latest_scan.status === 'running'
      )
    ) {
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
        latestRun.chart_version || undefined
      );
      const images = (extracted.images ?? []).map((img) => ({
        full_ref: img.full_ref,
        source_path: getHelmImageSourceLabel(img),
      }));
      if (images.length === 0) {
        throw new Error('No images were extracted from this chart');
      }

      const created = await createPublicHelmScans(
        latestRun.chart_url,
        images,
        latestRun.platform || undefined,
        extracted.chart_name || chartName || undefined,
        extracted.chart_version || latestRun.chart_version || undefined
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
    return (
      <div className="p-6">
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Invalid Helm run ID</Alert.Title>
            <Alert.Description>The requested Helm run could not be resolved.</Alert.Description>
          </Alert.Content>
        </Alert>
      </div>
    );
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
        <div className="sticky top-0 z-20">
        <PublicNavbar
          isDark={isDark}
          isLoggedIn={isLoggedIn}
          onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
          homeHref="/public/scan/helm"
          leadingActions={
            <>
              <Button onPress={() => loadRun(true)} isDisabled={refreshing} variant="secondary">
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
              <Button
                onPress={handleRescanChart}
                isDisabled={rescanningChart || !latestRun}
                variant="secondary"
                isPending={rescanningChart}
              >
                <ArrowReloadHorizontalIcon size={15} />
                Re-scan chart
              </Button>
            </>
          }
        />
      </div>

      <main className="relative z-10 mx-auto flex max-w-7xl flex-col gap-6 px-6 pb-16 pt-8">
        {actionError ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Helm run action failed</Alert.Title>
              <Alert.Description>{actionError}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <Card className="border border-divider/60 bg-surface/50 shadow-sm backdrop-blur">
          <Card.Content className="gap-6 px-6 py-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-4">
                <div className="flex items-start gap-3">
                  <PackageIcon size={20} className="mt-1 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1
                        className="min-w-0 flex-1 truncate text-2xl font-semibold text-foreground"
                        title={latestRun?.chart_name || chartUrl}
                      >
                        {latestRun?.chart_name || displayUrl || 'Helm run'}
                      </h1>
                      <Chip color={isOCI ? 'accent' : 'default'} size="sm" variant="soft">
                        {isOCI ? 'OCI' : 'HTTP'}
                      </Chip>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted" title={chartUrl}>
                      {displayUrl}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {latestRun?.chart_version ? (
                    <Chip size="sm" variant="secondary">
                      v{latestRun.chart_version}
                    </Chip>
                  ) : null}
                  {latestRun?.platform ? (
                    <Chip color="accent" size="sm" variant="soft">
                      {latestRun.platform}
                    </Chip>
                  ) : null}
                  {latestRun?.created_at ? (
                    <Chip size="sm" variant="secondary">
                      {timeAgo(latestRun.created_at)}
                    </Chip>
                  ) : null}
                  {latestRun ? (
                    <Chip size="sm" variant="secondary">
                      Run {latestRun.id.slice(0, 8)}
                    </Chip>
                  ) : null}
                </div>
              </div>

              {latestRun?.created_at ? (
                <div className="text-sm text-muted">
                  <p>Started</p>
                  <p className="font-mono text-xs text-foreground" title={fullDate(latestRun.created_at)}>
                    {fullDate(latestRun.created_at)}
                  </p>
                </div>
              ) : null}
            </div>
          </Card.Content>
        </Card>

        {!loading && latestScans.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Images"
              value={totalImages}
              icon={<PackageIcon size={16} />}
              iconTone="accent"
              hint="Latest child scans in this Helm run."
              className={statCardClassName}
              valueClassName={statValueClassName}
            />
            <StatCard
              label="Completed"
              value={completed}
              icon={<CheckmarkCircle02Icon size={16} />}
              iconTone="success"
              hint="Finished successfully."
              className={statCardClassName}
              valueClassName={`${statValueClassName} text-emerald-600 dark:text-emerald-400`}
            />
            <StatCard
              label="Running"
              value={pending}
              icon={<Refresh01Icon size={16} />}
              iconTone="accent"
              hint="Queued or currently scanning."
              className={statCardClassName}
              valueClassName={
                pending > 0
                  ? `${statValueClassName} text-sky-600 dark:text-sky-400`
                  : statValueClassName
              }
            />
            <StatCard
              label="Failed"
              value={failed}
              icon={<AlertCircleIcon size={16} />}
              iconTone="danger"
              hint="Latest attempts that need attention."
              className={statCardClassName}
              valueClassName={
                failed > 0
                  ? `${statValueClassName} text-red-600 dark:text-red-400`
                  : statValueClassName
              }
            />
            <StatCard
              label="Critical"
              value={totalCritical}
              icon={<Bug02Icon size={16} />}
              iconTone="danger"
              hint="Critical findings across latest scans."
              className={statCardClassName}
              valueClassName={
                totalCritical > 0
                  ? `${statValueClassName} text-red-600 dark:text-red-400`
                  : statValueClassName
              }
            />
            <StatCard
              label="High"
              value={totalHigh}
              icon={<Bug02Icon size={16} />}
              iconTone="warning"
              hint="High severity findings."
              className={statCardClassName}
              valueClassName={
                totalHigh > 0
                  ? `${statValueClassName} text-orange-600 dark:text-orange-400`
                  : statValueClassName
              }
            />
            <StatCard
              label="Medium"
              value={totalMedium}
              icon={<Bug02Icon size={16} />}
              iconTone="accent"
              hint="Medium severity findings."
              className={statCardClassName}
              valueClassName={
                totalMedium > 0
                  ? `${statValueClassName} text-yellow-600 dark:text-yellow-400`
                  : statValueClassName
              }
            />
            <StatCard
              label="Low"
              value={totalLow}
              icon={<Bug02Icon size={16} />}
              hint="Low severity findings."
              className={statCardClassName}
              valueClassName={statValueClassName}
            />
          </div>
        ) : null}

        {loading ? (
          <Card className="border border-divider/60 bg-surface/50 shadow-sm backdrop-blur">
            <Card.Content className="flex items-center justify-center gap-3 px-6 py-10 text-sm text-muted">
              <Spinner size="sm" />
              Loading Helm run…
            </Card.Content>
          </Card>
        ) : null}

        {!loading && items.length === 0 ? (
          <Card className="border border-divider/60 bg-surface/50 shadow-sm backdrop-blur">
            <Card.Content className="px-6 py-10 text-center text-sm text-muted">
              No scans found for this Helm run.
            </Card.Content>
          </Card>
        ) : null}

        {!loading && items.length > 0 ? (
          <Card className="border border-divider/60 bg-surface/50 shadow-sm backdrop-blur">
            <Card.Content className="gap-4 px-0 py-0">
              <div className="flex items-center justify-between gap-3 px-6 pt-6">
                <div>
                  <p className="text-sm font-semibold text-foreground">Images in this run</p>
                  <p className="mt-1 text-sm text-muted">
                    Retry failed scans or open any child scan for details.
                  </p>
                </div>
                <Button onPress={() => loadRun(true)} isDisabled={refreshing} size="sm" variant="secondary">
                  <Refresh01Icon size={15} className={refreshing ? 'animate-spin' : ''} />
                  Refresh
                </Button>
              </div>

              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label="Helm run scans" className="min-w-[980px]">
                    <Table.Header>
                      <Table.Column isRowHeader>Image</Table.Column>
                      <Table.Column>Tag</Table.Column>
                      <Table.Column>Source</Table.Column>
                      <Table.Column>Attempts</Table.Column>
                      <Table.Column>Status</Table.Column>
                      <Table.Column className="text-right">Action</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {items.map((item: HelmRunItem) => {
                        const scan = item.latest_scan;
                        const retrying = retryingScanId === scan.id;
                        return (
                          <Table.Row key={item.key} id={scan.id}>
                            <Table.Cell className="min-w-[260px]">
                              <Link
                                href={`/public/scan/${scan.id}`}
                                className="block truncate font-mono text-sm text-foreground"
                                title={scan.image_name}
                              >
                                {scan.image_name}
                              </Link>
                            </Table.Cell>
                            <Table.Cell className="font-mono text-xs text-muted">
                              {scan.image_tag || 'latest'}
                            </Table.Cell>
                            <Table.Cell className="max-w-[320px] truncate text-xs text-muted">
                              <span title={scan.helm_source_path ?? ''}>{scan.helm_source_path || '—'}</span>
                            </Table.Cell>
                            <Table.Cell className="text-xs text-muted">{item.attempt_count}</Table.Cell>
                            <Table.Cell>
                              <StatusBadge status={scan.status} />
                            </Table.Cell>
                            <Table.Cell className="text-right">
                              {scan.status === 'failed' ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  isPending={retrying}
                                  onPress={() => handleRetryScan(scan.id)}
                                >
                                  Retry failed
                                </Button>
                              ) : (
                                <Link href={`/public/scan/${scan.id}`}>
                                  <Button size="sm" variant="tertiary">
                                    View scan
                                  </Button>
                                </Link>
                              )}
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Card.Content>
          </Card>
        ) : null}
      </main>
      </section>
    </div>
  );
}
