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
import { Alert, Button, Card, Chip, Spinner, Table, Tabs, SearchField } from '@/components/ui';
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
  const [imageSearch, setImageSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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
  const filteredItems = items.filter((item) => {
    const scan = item.latest_scan;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active'
        ? scan.status !== 'completed' && scan.status !== 'failed' && scan.status !== 'cancelled'
        : scan.status === statusFilter);
    return (
      matchesStatus &&
      `${scan.image_name} ${scan.image_tag} ${scan.helm_source_path ?? ''}`
        .toLowerCase()
        .includes(imageSearch.trim().toLowerCase())
    );
  });

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
      <section>
        <div className="sticky top-0 z-20">
          <PublicNavbar
            isDark={isDark}
            isLoggedIn={isLoggedIn}
            onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
            homeHref="/public/scan/helm"
            title={latestRun?.chart_name || displayUrl || 'Helm run'}
            leadingActions={
              <>
                <Button variant="secondary" onPress={() => router.push('/public/scan/helm')}>
                  New chart scan
                </Button>
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

          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>{isOCI ? 'OCI chart' : 'HTTP repository'}</span>
            {latestRun?.chart_version ? <span>v{latestRun.chart_version}</span> : null}
            {latestRun?.platform ? <span>{latestRun.platform}</span> : null}
            {latestRun?.created_at ? (
              <span title={fullDate(latestRun.created_at)}>
                Started {timeAgo(latestRun.created_at)}
              </span>
            ) : null}
            <code title={chartUrl} className="min-w-0 max-w-full truncate sm:ml-auto sm:max-w-md">
              {displayUrl}
            </code>
          </div>

          {!loading && latestScans.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                {
                  label: 'Images',
                  value: totalImages,
                  hint: 'Latest scans in this run',
                  tone: 'default',
                },
                {
                  label: 'Completed',
                  value: completed,
                  hint: 'Finished successfully',
                  tone: 'success',
                },
                { label: 'Active', value: pending, hint: 'Queued or scanning', tone: 'default' },
                { label: 'Failed', value: failed, hint: 'Needs attention', tone: 'danger' },
                {
                  label: 'Critical',
                  value: totalCritical,
                  hint: 'Findings across images',
                  tone: 'danger',
                },
                {
                  label: 'High',
                  value: totalHigh,
                  hint: 'Findings across images',
                  tone: 'warning',
                },
                {
                  label: 'Medium',
                  value: totalMedium,
                  hint: 'Findings across images',
                  tone: 'warning',
                },
                { label: 'Low', value: totalLow, hint: 'Findings across images', tone: 'default' },
              ].map((metric) => (
                <StatCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  hint={metric.hint}
                  tone={metric.tone as 'default' | 'success' | 'danger' | 'warning'}
                />
              ))}
            </div>
          ) : null}

          {loading ? (
            <Card className="gap-0 overflow-hidden py-0">
              <Card.Content className="flex items-center justify-center gap-3 px-6 py-10 text-sm text-muted-foreground">
                <Spinner size="sm" />
                Loading Helm run…
              </Card.Content>
            </Card>
          ) : null}

          {!loading && items.length === 0 ? (
            <Card className="gap-0 overflow-hidden py-0">
              <Card.Content className="px-6 py-10 text-center text-sm text-muted-foreground">
                No scans found for this Helm run.
              </Card.Content>
            </Card>
          ) : null}

          {!loading && items.length > 0 ? (
            <Card className="gap-0 overflow-hidden py-0">
              <Card.Content className="space-y-4 p-0">
                <div className="space-y-4 border-b p-4">
                  <div>
                    <p className="text-sm font-semibold">Images in this run</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Open a scan for findings, or retry a failed attempt.
                    </p>
                  </div>
                  <Tabs
                    selectedKey={statusFilter}
                    onSelectionChange={(key) => setStatusFilter(String(key))}
                    variant="secondary"
                  >
                    <Tabs.ListContainer className="overflow-x-auto">
                      <Tabs.List aria-label="Filter Helm scans by status" className="min-w-max">
                        {['all', 'active', 'completed', 'failed'].map((key) => (
                          <Tabs.Tab id={key} key={key}>
                            {key === 'all'
                              ? 'All images'
                              : key === 'active'
                                ? 'Active'
                                : key === 'completed'
                                  ? 'Completed'
                                  : 'Failed'}
                            <Tabs.Indicator />
                          </Tabs.Tab>
                        ))}
                      </Tabs.List>
                    </Tabs.ListContainer>
                    {['all', 'active', 'completed', 'failed'].map((key) => (
                      <Tabs.Panel className="hidden" id={key} key={key} />
                    ))}
                  </Tabs>
                  <SearchField
                    aria-label="Search Helm run images"
                    value={imageSearch}
                    onChange={setImageSearch}
                  >
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="Search image, tag, or source…" />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                </div>

                <Table variant="secondary">
                  <Table.ScrollContainer className="rounded-none border-0">
                    <Table.Content
                      aria-label="Helm run scans"
                      className="min-w-[1000px] table-fixed [&_td]:px-3 [&_th]:px-3 [&_td]:py-3"
                    >
                      <Table.Header>
                        <Table.Column isRowHeader className="w-auto">
                          Image
                        </Table.Column>
                        <Table.Column className="w-[140px]">Tag</Table.Column>
                        <Table.Column className="w-[220px]">Source</Table.Column>
                        <Table.Column className="w-[90px]">Attempts</Table.Column>
                        <Table.Column className="w-[120px]">Status</Table.Column>
                        <Table.Column className="w-[120px] text-right">Action</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {filteredItems.length === 0 ? (
                          <Table.Row id="empty">
                            <Table.Cell colSpan={6}>
                              <p className="py-10 text-center text-sm text-muted-foreground">
                                No images match these filters.
                              </p>
                            </Table.Cell>
                          </Table.Row>
                        ) : null}
                        {filteredItems.map((item: HelmRunItem) => {
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
                              <Table.Cell className="font-mono text-xs text-muted-foreground">
                                {scan.image_tag || 'latest'}
                              </Table.Cell>
                              <Table.Cell className="max-w-[320px] truncate text-xs text-muted-foreground">
                                <span title={scan.helm_source_path ?? ''}>
                                  {scan.helm_source_path || '—'}
                                </span>
                              </Table.Cell>
                              <Table.Cell className="text-xs text-muted-foreground">
                                {item.attempt_count}
                              </Table.Cell>
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
