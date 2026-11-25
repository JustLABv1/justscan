'use client';

import { HelmImageList, HelmProgress, helmTotals } from '@/components/public/helm-image-list';
import { PublicPage, PublicPageHeader } from '@/components/public/public-page';
import { SeveritySummary } from '@/components/public/public-scan-result';
import { ScanDetailsDisclosure } from '@/components/public/scan-details';
import { FormAlert } from '@/components/ui/form-alert';
import { pluralize } from '@/lib/labels';
import {
  createPublicHelmScans,
  extractPublicHelmImages,
  getPublicHelmScanRun,
  HelmRunItem,
  HelmScanRunDetail,
  reScanPublic,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { getHelmImageSourceLabel } from '@/lib/helm-image-overrides';
import { PublicHelmRunHistoryEntry, updateHelmPublicHistoryEntry } from '@/lib/publicScanHistory';
import { fullDate, timeAgo } from '@/lib/time';
import { Button, Card, Chip, SearchField, Skeleton } from '@/components/ui';
import { ArrowReloadHorizontalIcon, PackageIcon, RefreshIcon } from 'hugeicons-react';
import { useParams, useRouter } from 'next/navigation';
import { FilterChips } from '@/components/ui/filter-chips';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  const runId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [detail, setDetail] = useState<HelmScanRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rescanningChart, setRescanningChart] = useState(false);
  const [retryingScanId, setRetryingScanId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [imageSearch, setImageSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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
        setActionError(
          err instanceof Error ? err.message : 'The Helm chart scan could not be loaded.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [runId]
  );

  useEffect(() => {
    return deferEffect(() => {
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
      setActionError(
        'The chart name is missing, so the chart can’t be scanned again. Start a new scan instead.'
      );
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
      <PublicPage title="Helm chart scan" homeHref="/public/scan/helm">
        <FormAlert
          title="This Helm scan link is incomplete"
          description="Check the link, or start a new Helm chart scan."
        />
      </PublicPage>
    );
  }

  const chartTitle = latestRun?.chart_name || guessChartNameFromUrl(displayUrl) || 'Helm chart';
  const totals = helmTotals(latestScans);
  const platform = latestRun?.platform;

  return (
    <PublicPage title={chartTitle} homeHref="/public/scan/helm">
      <PublicPageHeader
        eyebrow="Helm chart scan"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {chartTitle}
            {latestRun?.chart_version ? (
              <Chip size="sm" variant="soft" className="font-mono">
                v{latestRun.chart_version}
              </Chip>
            ) : null}
          </span>
        }
        titleTooltip={chartTitle}
        subtitle={
          latestRun?.created_at ? (
            <span title={fullDate(latestRun.created_at)}>
              {pluralize(totalImages, 'image')} · started {timeAgo(latestRun.created_at)}
            </span>
          ) : undefined
        }
        actions={[
          {
            label: 'Scan chart again',
            icon: <ArrowReloadHorizontalIcon size={15} />,
            onPress: handleRescanChart,
            pending: rescanningChart,
            disabled: !latestRun,
            variant: 'primary',
          },
        ]}
        moreActions={[
          {
            id: 'refresh',
            label: refreshing ? 'Refreshing…' : 'Refresh results',
            icon: <RefreshIcon size={15} />,
            pending: refreshing,
            onAction: () => void loadRun(true),
          },
          {
            id: 'new',
            label: 'Scan another chart',
            icon: <PackageIcon size={15} />,
            onAction: () => router.push('/public/scan/helm'),
          },
        ]}
      />

      {actionError ? <FormAlert title="Something went wrong" description={actionError} /> : null}

      {loading ? (
        <Card className="gap-0 py-0">
          <div role="status" aria-live="polite" className="divide-y divide-border">
            <span className="sr-only">Loading Helm chart scan</span>
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2 px-4 py-4">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {!loading && latestScans.length > 0 ? (
        <SeveritySummary
          counts={totals.counts}
          context={`Across ${pluralize(totals.images, 'image')}:`}
          status={<HelmProgress totals={totals} />}
        />
      ) : null}

      {!loading && items.length === 0 ? (
        <Card className="gap-0 py-0">
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No images were scanned for this chart.
          </p>
        </Card>
      ) : null}

      {!loading && items.length > 0 ? (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="space-y-3 border-b border-border p-4">
            <h2 className="text-base font-semibold">Images</h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SearchField
                aria-label="Search images"
                value={imageSearch}
                onChange={setImageSearch}
                className="w-full sm:max-w-sm"
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Search images" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <FilterChips
                label="Filter images by status"
                items={[
                  { id: 'all', label: 'All' },
                  { id: 'active', label: 'Scanning', tone: 'accent' as const },
                  { id: 'completed', label: 'Scanned', tone: 'success' as const },
                  { id: 'failed', label: 'Failed', tone: 'danger' as const },
                ].map((option) => ({
                  ...option,
                  active: statusFilter === option.id,
                  onPress: () => setStatusFilter(option.id),
                }))}
              />
            </div>
          </div>
          <HelmImageList
            items={filteredItems.map((item: HelmRunItem) => {
              const scan = item.latest_scan;
              return {
                key: item.key,
                scan,
                href: `/public/scan/${scan.id}`,
                attempts: item.attempt_count,
                action:
                  scan.status === 'failed' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      isPending={retryingScanId === scan.id}
                      isDisabled={retryingScanId === scan.id}
                      onPress={() => handleRetryScan(scan.id)}
                    >
                      Try again
                    </Button>
                  ) : undefined,
              };
            })}
          />
        </Card>
      ) : null}

      {latestRun ? (
        <ScanDetailsDisclosure
          items={[
            { label: 'Chart source', value: chartUrl, mono: true, wide: true },
            {
              label: 'Repository type',
              value: isOCI ? 'OCI registry' : 'Chart repository',
            },
            { label: 'Platform', value: platform, hidden: !platform },
            {
              label: 'Started',
              value: (
                <span title={fullDate(latestRun.created_at)}>{timeAgo(latestRun.created_at)}</span>
              ),
            },
          ]}
        />
      ) : null}
    </PublicPage>
  );
}
