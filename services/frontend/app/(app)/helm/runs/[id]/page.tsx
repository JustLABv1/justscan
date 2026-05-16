'use client';
import { useToast } from '@/components/toast';
import { PageHeader } from '@/components/ui/page-header';
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
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import { Alert, Button, Card, Chip, Dropdown, Label, Spinner, Table } from '@heroui/react';
import {
  ArrowLeft01Icon,
  CopyLinkIcon,
  FileValidationIcon,
  MoreVerticalIcon,
  PackageIcon,
  Refresh01Icon,
  Share01Icon,
} from 'hugeicons-react';
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
      {label}
    </Chip>
  );
}

function SeverityCount({ count, color }: { count: number; color: ChipColor }) {
  if (!count) return <span className="text-xs text-muted">-</span>;

  return (
    <Chip color={color} size="sm" variant="soft">
      {count}
    </Chip>
  );
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: ChipColor;
}) {
  return (
    <Card>
      <Card.Content className="flex flex-row items-center justify-between gap-3 px-4 py-3">
        <span className="text-xs text-muted">{label}</span>
        <Chip color={color ?? 'default'} size="sm" variant={color ? 'soft' : 'secondary'}>
          {value}
        </Chip>
      </Card.Content>
    </Card>
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

  const loadRun = useCallback(
    async (silent = false) => {
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
    },
    [runId, toast]
  );

  useEffect(() => {
    return deferEffect(loadRun);
  }, [loadRun]);

  const items = useMemo(() => detail?.items ?? [], [detail]);
  const latestScans = items.map((item) => item.latest_scan);
  const shareableScans = latestScans.filter(
    (scan) => scan.status === 'completed' || scan.status === 'failed'
  );
  const sharedScans = shareableScans.filter((scan) => scan.share_token);

  useEffect(() => {
    if (
      !items.some(
        (item) => item.latest_scan.status === 'pending' || item.latest_scan.status === 'running'
      )
    ) {
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
  const pending = latestScans.filter(
    (scan) => scan.status === 'pending' || scan.status === 'running'
  ).length;
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
        latestRun.chart_version || undefined
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
        inheritedOrgId || undefined
      );

      toast.success(
        `Queued ${images.length} image${images.length === 1 ? '' : 's'} in new Helm run`
      );
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
      await Promise.all(
        shareableScans.map((scan) => createShare(scan.id, 'public').catch(() => null))
      );
      await loadRun(true);
      toast.success(
        `Shared ${shareableScans.length} scan${shareableScans.length === 1 ? '' : 's'}`
      );
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
      toast.success(
        `Disabled sharing for ${sharedScans.length} scan${sharedScans.length === 1 ? '' : 's'}`
      );
    } finally {
      setShareLoading(false);
    }
  }

  async function handleCopyGroupLink() {
    if (sharedScans.length === 0) return;
    const [first, ...rest] = sharedScans;
    const base = `${window.location.origin}/shared/helm/${first.share_token}`;
    const url =
      rest.length > 0 ? `${base}?tokens=${rest.map((scan) => scan.share_token).join(',')}` : base;
    await navigator.clipboard.writeText(url);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1500);
  }

  if (!runId) {
    return (
      <div className="p-6">
        <PageHeader
          title="Helm Run"
          description="Invalid Helm run ID."
          breadcrumbs={[{ label: 'Helm', href: '/helm' }, { label: 'Run' }]}
        />
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
    <div className="p-6 space-y-5">
      <PageHeader
        title={latestRun?.chart_name || displayUrl || 'Helm run'}
        titleCom={
          latestRun ? (
            <Chip color={isOCI ? 'accent' : 'default'} size="sm" variant="soft">
              {isOCI ? 'OCI' : 'HTTP'}
            </Chip>
          ) : null
        }
        description={displayUrl || 'Loading Helm run details.'}
        breadcrumbs={[{ label: 'Helm', href: '/helm' }, { label: latestRun?.chart_name || 'Run' }]}
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button type="button" variant="secondary" onPress={() => router.push('/helm')}>
              <ArrowLeft01Icon size={15} />
              Back
            </Button>
            <Dropdown>
              <Dropdown.Trigger>
                <Button aria-label="Open Helm run actions" isIconOnly variant="secondary">
                  <MoreVerticalIcon size={15} />
                </Button>
              </Dropdown.Trigger>
              <Dropdown.Popover className="min-w-[220px]">
                <Dropdown.Menu
                  onAction={(key) => {
                    if (key === 'report' && canGenerateReport) {
                      router.push(`/reports/print?helmRun=${encodeURIComponent(runId)}`);
                    }
                    if (key === 'refresh') {
                      void loadRun(true);
                    }
                    if (key === 'share') {
                      void handleShareAll();
                    }
                    if (key === 'copy') {
                      void handleCopyGroupLink();
                    }
                    if (key === 'disable-shares') {
                      void handleDisableShares();
                    }
                  }}
                >
                  <Dropdown.Item
                    id="report"
                    isDisabled={!canGenerateReport}
                    textValue="Generate report"
                  >
                    <div className="flex items-center gap-2">
                      <FileValidationIcon size={14} />
                      <Label>Generate report</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item id="refresh" isDisabled={refreshing} textValue="Refresh">
                    <div className="flex items-center gap-2">
                      <Refresh01Icon size={14} className={refreshing ? 'animate-spin' : ''} />
                      <Label>Refresh</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="share"
                    isDisabled={shareLoading || shareableScans.length === 0}
                    textValue="Share all scans"
                  >
                    <div className="flex items-center gap-2">
                      <Share01Icon size={14} />
                      <Label>Share all scans</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="copy"
                    isDisabled={sharedScans.length === 0}
                    textValue="Copy share link"
                  >
                    <div className="flex items-center gap-2">
                      <CopyLinkIcon size={14} />
                      <Label>{shareCopied ? 'Copied' : 'Copy share link'}</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="disable-shares"
                    isDisabled={shareLoading || sharedScans.length === 0}
                    textValue="Disable shares"
                    variant="danger"
                  >
                    <div className="flex items-center gap-2">
                      <Share01Icon size={14} />
                      <Label>Disable shares</Label>
                    </div>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Button
              type="button"
              variant="primary"
              onPress={handleRescanChart}
              isDisabled={rescanningChart || !latestRun}
              isPending={rescanningChart}
            >
              Re-scan chart
            </Button>
          </div>
        }
      />

      <Card>
        <Card.Content className="gap-3">
          <div className="flex items-start gap-2.5">
            <PackageIcon size={20} className="shrink-0" />
            <div className="min-w-0">
              <p
                className="truncate text-sm font-semibold"
                title={latestRun?.chart_name || chartUrl}
              >
                {latestRun?.chart_name || displayUrl || 'Helm run'}
              </p>
              <p className="mt-1 truncate font-mono text-xs text-muted" title={chartUrl}>
                {displayUrl}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
            {latestRun?.chart_version && (
              <Chip size="sm" variant="secondary">
                v{latestRun.chart_version}
              </Chip>
            )}
            {latestRun?.platform && (
              <Chip size="sm" variant="secondary">
                {latestRun.platform}
              </Chip>
            )}
            {latestRun?.created_at && (
              <span title={fullDate(latestRun.created_at)}>
                Started {timeAgo(latestRun.created_at)}
              </span>
            )}
            {latestRun && <span className="font-mono">Run {latestRun.id}</span>}
          </div>
        </Card.Content>
      </Card>

      {!loading && latestScans.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <StatBox label="Images" value={totalImages} />
          <StatBox label="Completed" value={completed} color="success" />
          {pending > 0 && <StatBox label="Running" value={pending} color="accent" />}
          {failed > 0 && <StatBox label="Failed" value={failed} color="danger" />}
          {totalCritical > 0 && <StatBox label="Critical" value={totalCritical} color="danger" />}
          {totalHigh > 0 && <StatBox label="High" value={totalHigh} color="warning" />}
          {totalMedium > 0 && <StatBox label="Medium" value={totalMedium} color="warning" />}
          {totalLow > 0 && <StatBox label="Low" value={totalLow} color="accent" />}
          {totalCritical === 0 && totalHigh === 0 && completed > 0 && (
            <StatBox label="Vulnerabilities" value="Clean" color="success" />
          )}
        </div>
      )}

      {loading && (
        <Card>
          <Card.Content className="px-6 py-10">
            <div className="flex items-center justify-center gap-3 text-sm text-muted">
              <Spinner size="sm" />
              Loading Helm run...
            </div>
          </Card.Content>
        </Card>
      )}

      {!loading && items.length === 0 && (
        <Card>
          <Card.Content className="px-6 py-10 text-center text-sm text-muted">
            No scans found for this Helm run.
          </Card.Content>
        </Card>
      )}

      {!loading && items.length > 0 && (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Helm run image scans" className="min-w-[1120px]">
              <Table.Header>
                <Table.Column isRowHeader>Image</Table.Column>
                <Table.Column>Tag</Table.Column>
                <Table.Column>Source</Table.Column>
                <Table.Column className="text-center">Attempts</Table.Column>
                <Table.Column className="text-center">C</Table.Column>
                <Table.Column className="text-center">H</Table.Column>
                <Table.Column className="text-center">M</Table.Column>
                <Table.Column className="text-center">L</Table.Column>
                <Table.Column className="text-right">Status</Table.Column>
                <Table.Column className="text-right">Action</Table.Column>
              </Table.Header>
              <Table.Body>
                {items.map((item) => {
                  const scan = item.latest_scan;
                  const retrying = retryingScanId === scan.id;
                  return (
                    <Table.Row key={item.key} id={item.key} className="hover:bg-[var(--row-hover)]">
                      <Table.Cell>
                        <Link
                          href={`/scans/${scan.id}`}
                          className="block truncate font-mono text-sm"
                          title={scan.image_name}
                        >
                          {scan.image_name}
                        </Link>
                      </Table.Cell>
                      <Table.Cell className="truncate font-mono text-xs text-muted">
                        {scan.image_tag || 'latest'}
                      </Table.Cell>
                      <Table.Cell className="truncate text-xs text-muted">
                        <span title={scan.helm_source_path ?? ''}>
                          {scan.helm_source_path ? scan.helm_source_path.split(' › ')[0] : '-'}
                        </span>
                      </Table.Cell>
                      <Table.Cell className="text-center font-mono text-xs text-muted">
                        {item.attempt_count}
                      </Table.Cell>
                      <Table.Cell className="text-center">
                        <SeverityCount count={scan.critical_count ?? 0} color="danger" />
                      </Table.Cell>
                      <Table.Cell className="text-center">
                        <SeverityCount count={scan.high_count ?? 0} color="warning" />
                      </Table.Cell>
                      <Table.Cell className="text-center">
                        <SeverityCount count={scan.medium_count ?? 0} color="warning" />
                      </Table.Cell>
                      <Table.Cell className="text-center">
                        <SeverityCount count={scan.low_count ?? 0} color="accent" />
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        <StatusBadge status={scan.status} />
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        {scan.status === 'failed' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onPress={() => handleRetryScan(scan.id)}
                            isDisabled={retrying}
                            isPending={retrying}
                          >
                            Retry failed
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onPress={() => router.push(`/scans/${scan.id}`)}
                          >
                            View
                          </Button>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}

      {!loading && Object.keys(bySource).length > 1 && (
        <Card>
          <Card.Header>
            <Card.Title>Images by template file</Card.Title>
          </Card.Header>
          <Card.Content className="gap-2">
            {Object.entries(bySource)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([source, sourceItems]) => {
                const critical = sourceItems.reduce(
                  (sum, item) => sum + (item.latest_scan.critical_count ?? 0),
                  0
                );
                const high = sourceItems.reduce(
                  (sum, item) => sum + (item.latest_scan.high_count ?? 0),
                  0
                );
                return (
                  <div key={source} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted w-72 truncate" title={source}>
                      {source}
                    </span>
                    <span className="text-xs text-muted">
                      {sourceItems.length} image{sourceItems.length === 1 ? '' : 's'}
                    </span>
                    {(critical > 0 || high > 0) && (
                      <div className="flex items-center gap-1">
                        {critical > 0 && (
                          <Chip color="danger" size="sm" variant="soft">
                            {critical}C
                          </Chip>
                        )}
                        {high > 0 && (
                          <Chip color="warning" size="sm" variant="soft">
                            {high}H
                          </Chip>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </Card.Content>
        </Card>
      )}
    </div>
  );
}
